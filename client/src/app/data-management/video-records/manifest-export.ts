import {
  BlobReader,
  BlobWriter,
  TextReader,
  WritableWriter,
  ZipWriter,
  configure,
} from '@zip.js/zip.js';
import { VideoRecord } from './VideoRecord';
import { Transcript, TranscriptStats, SceneStats, YoutubeContent, readyData } from './Dataset';

export interface ManifestRecord {
  id: string;
  sort_name: string;
  video_file: { hash: string; exists_on_server: boolean; duration_secs: number | null } | null;
  youtube_content: YoutubeContent | null;
  transcript_stats: TranscriptStats | null;
  scene_stats: SceneStats | null;
  transcript_path: string | null;
  video_file_path: string | null;
  audience_retention_path: string | null;
}

export interface ExportManifest {
  generated_at: string;
  records: ManifestRecord[];
}

/**
 * Formats a seconds offset as SRT's "HH:MM:SS,mmm". Not formatTimestamp from Dataset.ts:
 * that one is a fixed "MM:SS" with no hours part and no sub-second precision, which is
 * right for a segment label on screen and lossy for a file meant to be read back in.
 */
const formatSrtTimestamp = (seconds: number): string => {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
};

/**
 * Renders a Transcript as SRT for the transcript/ subdirectory. SRT rather than the plain
 * "[MM:SS] text" this used to write, because it is both human-readable and lossless: it
 * keeps each segment's end time and millisecond precision, so an exported transcript can
 * come back through parseTranscriptFile() as the same data that left.
 */
const transcriptToSrt = (transcript: Transcript): string =>
  transcript.segments
    .map(
      ({ start, end, text }, index) =>
        `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${text}\n`,
    )
    .join('\n');

// zip.js would otherwise spin its codecs up in blob-URL workers, which the CSP has to allow
// for nothing: every video is stored rather than deflated, and the few text entries that are
// compressed go through the browser's native CompressionStream on the main thread.
configure({ useWebWorkers: false });

const fileExtension = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1);
};

export type ExportProgress = {
  records: number;
  totalRecords: number;
  /** Video bytes written so far, against the total of the videos being included. */
  bytes: number;
  totalBytes: number;
};

export interface ExportOptions {
  /**
   * Video files dwarf everything else in the zip, so an export can leave them out. The
   * records still carry their hash in the manifest - only video_file_path goes null, exactly
   * as it already does for a record whose file isn't in this browser.
   */
  includeVideoFiles?: boolean;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Writes the README-documented export tree (manifest.json + transcript/, video_files/ and
 * audience_retention/ subdirectories) as a zip into `target`. Simple/scalar fields are inlined
 * into the manifest; complex/large data gets its own file, linked from the manifest by path.
 *
 * Streamed, one entry at a time: a library runs to many gigabytes of video, and building the
 * zip in memory is what used to run the browser out of it. So only about one chunk of one
 * video is held at once, and the zip is ZIP64 because the whole can pass 4 GB. Videos are
 * stored, not deflated - they don't compress, and a stored entry is one import can slice
 * straight out of the zip on disk (see parseExportZip).
 *
 * Resolves with whatever the writer produces on close - the Blob, for a BlobWriter.
 */
export async function writeExportZip(
  records: VideoRecord[],
  target: WritableWriter | WritableStream<Uint8Array>,
  { includeVideoFiles = true, onProgress }: ExportOptions = {},
): Promise<unknown> {
  const zip = new ZipWriter(target, { zip64: true });
  const manifest: ExportManifest = { generated_at: new Date().toISOString(), records: [] };

  const videoOf = (record: VideoRecord): File | null =>
    includeVideoFiles && record.video_file.hash ? record.video_file.file : null;
  const progress: ExportProgress = {
    records: 0,
    totalRecords: records.length,
    bytes: 0,
    totalBytes: records.reduce((total, record) => total + (videoOf(record)?.size ?? 0), 0),
  };

  try {
    for (const [index, record] of records.entries()) {
      const hash = record.video_file.hash || null;
      const manifestRecord: ManifestRecord = {
        id: hash || `record-${index}`,
        sort_name: record.sort_name,
        video_file: hash
          ? {
              hash,
              exists_on_server: record.video_file.exists_on_server,
              duration_secs: record.video_file.duration_secs,
            }
          : null,
        youtube_content: record.ds_youtubeContent,
        transcript_stats: readyData(record.ds_transcriptStats),
        scene_stats: readyData(record.ds_sceneStats),
        transcript_path: null,
        video_file_path: null,
        audience_retention_path: null,
      };

      const transcript = readyData(record.ds_transcript);
      if (hash && transcript) {
        const path = `transcript/${hash}.srt`;
        await zip.add(path, new TextReader(transcriptToSrt(transcript)));
        manifestRecord.transcript_path = path;
      }

      const video = videoOf(record);
      if (hash && video) {
        const ext = fileExtension(video.name);
        const path = `video_files/${hash}${ext ? '.' + ext : ''}`;
        const before = progress.bytes;
        await zip.add(path, new BlobReader(video), {
          level: 0,
          onprogress: async (written) => {
            progress.bytes = before + written;
            onProgress?.({ ...progress });
          },
        });
        progress.bytes = before + video.size;
        manifestRecord.video_file_path = path;
      }

      if (hash && record.ds_youtubeAudienceRetention) {
        const path = `audience_retention/${hash}.json`;
        await zip.add(
          path,
          new TextReader(JSON.stringify(record.ds_youtubeAudienceRetention, null, 2)),
        );
        manifestRecord.audience_retention_path = path;
      }

      manifest.records.push(manifestRecord);
      progress.records = index + 1;
      onProgress?.({ ...progress });
    }

    await zip.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
    return await zip.close();
  } catch (error) {
    // Leaves a WritableStream target errored rather than hanging open, so a download the
    // browser is still waiting on ends as a failed one.
    if (target instanceof WritableStream) await target.abort(error).catch(() => undefined);
    throw error;
  }
}

/** The whole export as an in-memory Blob - for browsers with no way to stream to disk, and
 * for specs. Holds the entire zip in memory, so it is no place for a library of videos. */
export const buildExportZip = async (
  records: VideoRecord[],
  options?: ExportOptions,
): Promise<Blob> =>
  (await writeExportZip(records, new BlobWriter('application/zip'), options)) as Blob;

/** Triggers a browser download of the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Not revoked straight away: the click only starts the download, and a large blob can still
  // be being read from well after it returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
