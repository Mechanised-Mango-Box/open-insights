type VideoRecord = {
  id?: number;
  sort_name: string;
  file_hash?: string;
  youtube_content_id?: string;

  file_handle?: File;

  ds_youtubeContent?: YoutubeContent;
  ds_youtubeAudienceRetention?: YoutubeAudienceRetention;
  ds_transcript?: Transcript;
  ds_sceneStats?: SceneStats;
};
