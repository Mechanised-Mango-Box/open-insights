type VideoRecord = {
  sort_name: string
  file_hash?: string;
  youtube_content_id?: string;

  file_handle?: string;

  ds_youtubeContent?: YoutubeContent;
  ds_youttubeAudienceRetention?: YoutubeAudienceRetention;
  ds_transcript?: Transcript;
  ds_sceneStats?: SceneStats;
};
