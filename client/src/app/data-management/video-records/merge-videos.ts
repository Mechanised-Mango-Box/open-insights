import { Cacheable, SceneStats, Transcript, TranscriptStats, YoutubeAudienceRetention, YoutubeContent } from './Dataset';
import { VideoFile, VideoRecord } from './VideoRecord';

export type MergeFieldKey =
  | 'sort_name'
  | 'video_file'
  | 'ds_youtubeContent'
  | 'ds_youtubeAudienceRetention'
  | 'ds_transcript'
  | 'ds_transcriptStats'
  | 'ds_sceneStats';

export type MergeOption = { sourceLabel: string; value: unknown };

export type MergeConflict = {
  key: MergeFieldKey;
  label: string;
  describe: (value: unknown) => string;
  options: MergeOption[];
};

export type MergePreview = {
  autoMerged: Partial<VideoRecord>;
  conflicts: MergeConflict[];
};

const MERGE_FIELD_KEYS: MergeFieldKey[] = [
  'sort_name',
  'video_file',
  'ds_youtubeContent',
  'ds_youtubeAudienceRetention',
  'ds_transcript',
  'ds_transcriptStats',
  'ds_sceneStats',
];

const FIELD_LABELS: Record<MergeFieldKey, string> = {
  sort_name: 'Name',
  video_file: 'Video File',
  ds_youtubeContent: 'YouTube Content Report',
  ds_youtubeAudienceRetention: 'YouTube Audience Retention',
  ds_transcript: 'Transcript',
  ds_transcriptStats: 'Transcript Stats',
  ds_sceneStats: 'Scene Stats',
};

const DESCRIBERS: Record<MergeFieldKey, (value: unknown) => string> = {
  sort_name: (value) => value as string,
  video_file: (value) => {
    const file = value as VideoFile;
    return file.file?.name ?? file.hash ?? '(no file)';
  },
  ds_youtubeContent: (value) => (value as YoutubeContent).content?.trim() || 'N/a',
  ds_youtubeAudienceRetention: (value) =>
    `Audience retention (${(value as YoutubeAudienceRetention).video_position.length} points)`,
  ds_transcript: (value) => {
    const transcript = (value as Cacheable<Transcript>).data;
    if (!('text' in transcript)) return 'Timestamped transcript';
    const preview = transcript.text.slice(0, 60);
    const ellipsis = transcript.text.length > 60 ? '…' : '';
    return `"${preview}${ellipsis}"`;
  },
  ds_transcriptStats: (value) => {
    const stats = (value as Cacheable<TranscriptStats>).data;
    return `${stats.count_words} words`;
  },
  ds_sceneStats: (value) => {
    const stats = (value as Cacheable<SceneStats>).data;
    return `${stats.scenes} scenes over ${stats.duration_secs}s`;
  },
};

// video_file compares by hash, not deep-equality: it also carries a raw File
// object whose interesting properties are inherited accessors, not own
// enumerable ones, so two different Files would both JSON.stringify to '{}'.
const EQUALS: Record<MergeFieldKey, (a: unknown, b: unknown) => boolean> = {
  sort_name: (a, b) => a === b,
  video_file: (a, b) => (a as VideoFile).hash === (b as VideoFile).hash,
  ds_youtubeContent: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ds_youtubeAudienceRetention: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ds_transcript: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ds_transcriptStats: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ds_sceneStats: (a, b) => JSON.stringify(a) === JSON.stringify(b),
};

const recordLabel = (record: VideoRecord, index: number): string =>
  record.sort_name?.trim() || `Row ${index + 1}`;

const getFieldValue = (record: VideoRecord, key: MergeFieldKey): unknown => {
  if (key === 'video_file') {
    const file = record.video_file;
    return file.hash || file.file ? file : undefined;
  }
  return record[key];
};

const applyValue = (target: Partial<VideoRecord>, key: MergeFieldKey, value: unknown): void => {
  (target as Record<string, unknown>)[key] = value;
};

/** Compares every merge field across the selected records. Fields where every
 * record either omits the field or agrees on its value are resolved automatically;
 * fields with 2+ distinct values become a MergeConflict for the user to resolve. */
export function computeMergePreview(records: VideoRecord[]): MergePreview {
  const autoMerged: Partial<VideoRecord> = {};
  const conflicts: MergeConflict[] = [];

  for (const key of MERGE_FIELD_KEYS) {
    const distinct: MergeOption[] = [];

    records.forEach((record, index) => {
      const value = getFieldValue(record, key);
      if (value === undefined || value === null) return;
      if (!distinct.some((option) => EQUALS[key](option.value, value))) {
        distinct.push({ sourceLabel: recordLabel(record, index), value });
      }
    });

    if (distinct.length === 0) continue;
    if (distinct.length === 1) {
      applyValue(autoMerged, key, distinct[0].value);
      continue;
    }
    conflicts.push({ key, label: FIELD_LABELS[key], describe: DESCRIBERS[key], options: distinct });
  }

  return { autoMerged, conflicts };
}

/** Applies the user's per-conflict choices (falling back to each conflict's
 * first option for any left unresolved) on top of the auto-merged fields. */
export function resolveMerge(
  preview: MergePreview,
  choices: Partial<Record<MergeFieldKey, unknown>>,
): Omit<VideoRecord, 'id'> {
  const merged: Partial<VideoRecord> = { ...preview.autoMerged };

  for (const conflict of preview.conflicts) {
    applyValue(merged, conflict.key, choices[conflict.key] ?? conflict.options[0].value);
  }

  return {
    sort_name: merged.sort_name ?? 'Untitled Merged Record',
    video_file: merged.video_file ?? VideoFile.createEmpty(),
    ds_youtubeContent: merged.ds_youtubeContent ?? null,
    ds_youtubeAudienceRetention: merged.ds_youtubeAudienceRetention ?? null,
    ds_transcript: merged.ds_transcript ?? null,
    ds_transcriptStats: merged.ds_transcriptStats ?? null,
    ds_sceneStats: merged.ds_sceneStats ?? null,
  };
}
