import JSZip from 'jszip';
import { VideoFile, VideoRecord } from './VideoRecord';
import {
  DatasetState,
  isReady,
  LOCAL_IMPORT,
  Transcript,
  TranscriptSegment,
  YoutubeAudienceRetention,
} from './Dataset';
import { ExportManifest, ManifestRecord } from './manifest-export';
import { parseTranscriptFile } from './transcript-import';
import { readFileDurationSecs } from './video-duration';

/** A record as it comes out of a zip: everything a VideoRecord has except the local
 * primary key, which IndexedDB assigns when the record is first written. */
export type ImportedRecord = Omit<VideoRecord, '__id'>;

/**
 * Wraps a value restored from a zip as a ready DatasetState.
 *
 * The producer is always LOCAL_IMPORT rather than whatever originally made the value: the
 * manifest does not carry the original (readyData() strips the envelope on the way out),
 * and local-import is the honest answer anyway - this copy of the data did arrive by being
 * imported. `produced_at` is the export's own timestamp, the one date the zip does know.
 */
const restored = <T>(data: T, generated_at: string): DatasetState<T> => ({
  state: 'ready',
  data,
  producer: LOCAL_IMPORT,
  produced_at: generated_at,
});

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
};

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const mimeTypeFor = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : (VIDEO_MIME_TYPES[filename.slice(dot + 1).toLowerCase()] ?? '');
};

// Matches a line of the pre-SRT transcript format, "[MM:SS] some text". The minutes part is
// unbounded because the format never had an hours field - a 75-minute video wrote "[75:30]".
const LEGACY_TIMESTAMP_LINE = /^\[(\d+):(\d{2})\]\s*(.*)$/;

/**
 * Parses the "[MM:SS] text" transcript files written before the export switched to SRT, so
 * an older zip still imports its transcripts rather than silently yielding none (which is
 * what parseTranscriptFile, correctly, does with a file that has no cue timings).
 *
 * Lossy by nature: the format recorded no end times, so each segment ends where the next
 * one starts. Only the edit dialog's segment list reads `end`, so the cost is cosmetic.
 */
const parseTimestampedText = (content: string): Transcript => {
  const segments: TranscriptSegment[] = [];

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(LEGACY_TIMESTAMP_LINE);
    if (!match) {
      // A wrapped continuation of the previous line rather than a new segment. Nothing
      // writes one today, but joining beats dropping the text on the floor.
      const previous = segments.at(-1);
      if (previous && line.trim()) previous.text = `${previous.text} ${line.trim()}`.trim();
      continue;
    }
    const start = Number(match[1]) * 60 + Number(match[2]);
    segments.push({ start, end: start, text: match[3].trim() });
  }

  segments.forEach((segment, index) => {
    const next = segments[index + 1];
    if (next) segment.end = next.start;
  });

  return { segments };
};

const parseTranscript = (path: string, content: string): Transcript =>
  path.toLowerCase().endsWith('.txt')
    ? parseTimestampedText(content)
    : parseTranscriptFile(content);

/** Rebuilds one record's VideoFile, restoring the video itself when the zip carries it. */
async function readVideoFile(zip: JSZip, record: ManifestRecord): Promise<VideoFile> {
  const restoredFile: VideoFile = {
    ...VideoFile.createEmpty(),
    hash: record.video_file?.hash ?? '',
    exists_on_server: record.video_file?.exists_on_server ?? false,
    // ?? null, not ||: a manifest written before this field existed reads back undefined,
    // which VideoFile does not allow, and a genuine 0 is not a reason to discard it.
    duration_secs: record.video_file?.duration_secs ?? null,
  };

  const entry = record.video_file_path ? zip.file(record.video_file_path) : null;
  if (!entry) return restoredFile;

  const name = basename(record.video_file_path!);
  const blob = await entry.async('blob');
  restoredFile.file = new File([blob], name, { type: mimeTypeFor(name) });

  // The hash in the manifest is taken at face value rather than recomputed over the
  // restored bytes: export wrote the hash it had, and re-hashing a library of multi-gigabyte
  // videos would cost minutes to arrive at the same answer.
  if (restoredFile.duration_secs == null) {
    restoredFile.duration_secs = await readFileDurationSecs(restoredFile.file);
  }
  return restoredFile;
}

/**
 * Reads an export zip back into records - the inverse of buildExportZip. Scalar fields come
 * straight out of manifest.json; the side-car files it links to are pulled out of the zip
 * and parsed back into the shapes they were serialized from.
 *
 * Nothing here touches the database: the caller decides what to do with records that
 * already exist (see fillGaps).
 */
export async function parseExportZip(
  file: File | Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportedRecord[]> {
  const zip = await JSZip.loadAsync(file);

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('Not an Open Insights export: manifest.json is missing.');
  }

  const manifest = JSON.parse(await manifestEntry.async('string')) as ExportManifest;
  if (!Array.isArray(manifest?.records)) {
    throw new Error('This export’s manifest.json is malformed: no records array.');
  }

  const generated_at = manifest.generated_at;
  const records: ImportedRecord[] = [];

  // Sequential rather than Promise.all: each iteration can inflate a whole video file out
  // of the zip and then decode its header, and a library of them at once is worth avoiding.
  for (const [index, entry] of manifest.records.entries()) {
    const transcriptEntry = entry.transcript_path ? zip.file(entry.transcript_path) : null;
    const transcript = transcriptEntry
      ? parseTranscript(entry.transcript_path!, await transcriptEntry.async('string'))
      : null;

    const retentionEntry = entry.audience_retention_path
      ? zip.file(entry.audience_retention_path)
      : null;
    const retention = retentionEntry
      ? (JSON.parse(await retentionEntry.async('string')) as YoutubeAudienceRetention)
      : null;

    records.push({
      sort_name: entry.sort_name || 'Untitled Imported Record',
      video_file: await readVideoFile(zip, entry),
      ds_youtubeContent: entry.youtube_content ?? null,
      ds_youtubeAudienceRetention: retention,
      ds_transcript: transcript ? restored(transcript, generated_at) : { state: 'absent' },
      ds_transcriptStats: entry.transcript_stats
        ? restored(entry.transcript_stats, generated_at)
        : { state: 'absent' },
      ds_sceneStats: entry.scene_stats
        ? restored(entry.scene_stats, generated_at)
        : { state: 'absent' },
    });
    onProgress?.(index + 1, manifest.records.length);
  }

  return records;
}

/**
 * Merges an imported record into one already in the library, filling only the gaps: a field
 * the existing record has is never overwritten by the zip's version of it. So re-importing
 * an old export cannot undo newer local work, and importing a zip that has a transcript the
 * library lacks still gains it.
 *
 * Returns null when there is nothing to add, which spares the caller a pointless write and
 * lets it report the record as unchanged.
 *
 * Deliberately not the computeMergePreview/MergeConflict machinery in merge-videos.ts: that
 * exists to ask which of several rival values should win. A gap has no rival - by definition
 * there is exactly one candidate for it.
 */
export function fillGaps(existing: VideoRecord, incoming: ImportedRecord): VideoRecord | null {
  const merged: VideoRecord = { ...existing, video_file: { ...existing.video_file } };
  let changed = false;

  if (!merged.video_file.file && incoming.video_file.file) {
    merged.video_file.file = incoming.video_file.file;
    changed = true;
  }
  // The hash comes with the file it identifies. Only ever a gap when the two records were
  // matched on their YouTube content id instead - matching by hash implies one already.
  if (!merged.video_file.hash && incoming.video_file.hash) {
    merged.video_file.hash = incoming.video_file.hash;
    changed = true;
  }
  if (merged.video_file.duration_secs == null && incoming.video_file.duration_secs != null) {
    merged.video_file.duration_secs = incoming.video_file.duration_secs;
    changed = true;
  }
  // sort_name and exists_on_server are never taken from the zip. The first is always set on
  // an existing record, so it is never a gap; the second describes whether this user's
  // server holds the file, which is a live local fact the export cannot speak to.

  if (!merged.ds_youtubeContent && incoming.ds_youtubeContent) {
    merged.ds_youtubeContent = incoming.ds_youtubeContent;
    changed = true;
  }
  if (!merged.ds_youtubeAudienceRetention && incoming.ds_youtubeAudienceRetention) {
    merged.ds_youtubeAudienceRetention = incoming.ds_youtubeAudienceRetention;
    changed = true;
  }

  // 'ready' is the test rather than 'absent': a record whose transcript is queued, running
  // or failed has no usable value there either, and real imported data beats all three.
  // Spelled out one field at a time rather than looped over the three keys: a loop makes
  // both sides of the assignment the union of all three payload types, which does not
  // type-check even though every iteration is sound.
  const fillDataset = <T>(current: DatasetState<T>, incomingState: DatasetState<T>) => {
    if (isReady(current) || !isReady(incomingState)) return current;
    changed = true;
    return incomingState;
  };

  merged.ds_transcript = fillDataset(merged.ds_transcript, incoming.ds_transcript);
  merged.ds_transcriptStats = fillDataset(merged.ds_transcriptStats, incoming.ds_transcriptStats);
  merged.ds_sceneStats = fillDataset(merged.ds_sceneStats, incoming.ds_sceneStats);

  return changed ? merged : null;
}
