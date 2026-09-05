import {
  CanCreateEmpty,
  DatasetState,
  SceneStats,
  Transcript,
  TranscriptStats,
  YoutubeAudienceRetention,
  YoutubeContent,
} from './Dataset';

export type VideoRecord = {
  __id?: number; // Local IndexedDB primary key - unset until the record is first persisted
  sort_name: string;
  video_file: VideoFile;

  ds_youtubeContent: YoutubeContent | null;
  ds_youtubeAudienceRetention: YoutubeAudienceRetention | null;

  // No `| null`: 'absent' is already the empty case of DatasetState, and having
  // both meant two ways to say the same thing - which is how a first-time
  // failure used to vanish, recorded as neither.
  ds_transcript: DatasetState<Transcript>;
  ds_transcriptStats: DatasetState<TranscriptStats>;

  ds_sceneStats: DatasetState<SceneStats>;
};

export const calculateSha256 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

export interface VideoFile {
  file: File | null;
  hash: string; // sha256 of the file, derived from `file` when one is present
  exists_on_server: boolean;
}

export const VideoFile: CanCreateEmpty<VideoFile> = {
  createEmpty: () => ({
    file: null,
    hash: '',
    exists_on_server: false,
  }),
};
