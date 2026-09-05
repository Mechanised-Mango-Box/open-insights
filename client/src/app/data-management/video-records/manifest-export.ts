import JSZip from 'jszip';
import { VideoRecord } from './VideoRecord';
import {
  Transcript,
  TranscriptStats,
  SceneStats,
  YoutubeContent,
  formatTimestamp,
  readyData,
} from './Dataset';

export interface ManifestRecord {
  id: string;
  sort_name: string;
  video_file: { hash: string; exists_on_server: boolean } | null;
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

/** Renders a Transcript as human-readable plain text for the transcript/ subdirectory. */
const transcriptToText = (transcript: Transcript): string =>
  transcript.segments.map(({ start, text }) => `[${formatTimestamp(start)}] ${text}`).join('\n');

const fileExtension = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1);
};

export interface ExportOptions {
  /**
   * Video files dwarf everything else in the zip, so an export can leave them out. The
   * records still carry their hash in the manifest - only video_file_path goes null, exactly
   * as it already does for a record whose file isn't in this browser.
   */
  includeVideoFiles?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Builds the README-documented export tree (manifest.json + transcript/, video_files/ and
 * audience_retention/ subdirectories) as a zip Blob. Simple/scalar fields are inlined into
 * the manifest; complex/large data gets its own file, linked from the manifest by path.
 */
export async function buildExportZip(
  records: VideoRecord[],
  { includeVideoFiles = true, onProgress }: ExportOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  const manifest: ExportManifest = { generated_at: new Date().toISOString(), records: [] };

  records.forEach((record, index) => {
    const hash = record.video_file.hash || null;
    const manifestRecord: ManifestRecord = {
      id: hash || `record-${index}`,
      sort_name: record.sort_name,
      video_file: hash ? { hash, exists_on_server: record.video_file.exists_on_server } : null,
      youtube_content: record.ds_youtubeContent,
      transcript_stats: readyData(record.ds_transcriptStats),
      scene_stats: readyData(record.ds_sceneStats),
      transcript_path: null,
      video_file_path: null,
      audience_retention_path: null,
    };

    const transcript = readyData(record.ds_transcript);
    if (hash && transcript) {
      const path = `transcript/${hash}.txt`;
      zip.file(path, transcriptToText(transcript));
      manifestRecord.transcript_path = path;
    }

    if (includeVideoFiles && hash && record.video_file.file) {
      const ext = fileExtension(record.video_file.file.name);
      const path = `video_files/${hash}${ext ? '.' + ext : ''}`;
      zip.file(path, record.video_file.file);
      manifestRecord.video_file_path = path;
    }

    if (hash && record.ds_youtubeAudienceRetention) {
      const path = `audience_retention/${hash}.json`;
      zip.file(path, JSON.stringify(record.ds_youtubeAudienceRetention, null, 2));
      manifestRecord.audience_retention_path = path;
    }

    manifest.records.push(manifestRecord);
    onProgress?.(index + 1, records.length);
  });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

/** Triggers a browser download of the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
