import { SceneStats, Transcript, YoutubeAudienceRetention, YoutubeContent } from './Dataset';

export type VideoRecord = {
  id?: number;
  sort_name: string;
  file_hash?: string;

  file_handle?: File;

  ds_youtubeContent?: YoutubeContent;
  ds_youtubeAudienceRetention?: YoutubeAudienceRetention;
  ds_transcript?: Transcript;
  ds_sceneStats?: SceneStats;
};

export const calculateSha256 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);

  // Convert ArrayBuffer to Hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};
