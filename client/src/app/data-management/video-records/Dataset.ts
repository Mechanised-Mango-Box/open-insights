interface Dataset {}

export type YoutubeContent = Dataset & {
  content: string | null;
  engaged_views: number | null;
  average_percentage_viewed: number | null;
  stayed_to_watch: number | null;
  unique_viewers: number | null;
  unique_reach: number | null;
  average_views_per_viewer: number | null;
  new_viewers: number | null;
  regular_viewers: number | null;
  casual_viewers: number | null;
  returning_viewers: number | null;
  views: number | null;
  watch_time_hours: number | null;
  subscribers: number | null;
  average_view_duration_secs: number | null;
  impressions: number | null;
  impressions_click_through_rate: number | null;
};

export type YoutubeAudienceRetention = Dataset & {
  video_position: number[];
  absolute_audience_retention: number[];
};

export type Transcript = Dataset & {
  text: string;
  count_chars: number;
  count_words: number;
};
export type SceneStats = Dataset & {
  duration_secs: number;
  scenes: number;
};

export const createEmptyTranscript = (): Transcript => ({
  text: '',
  count_chars: 0,
  count_words: 0,
});

export const createEmptyYoutubeAudienceRetention = (): YoutubeAudienceRetention => ({
  video_position: [],
  absolute_audience_retention: [],
});

export const createEmptyYoutubeContent = (): YoutubeContent => ({
  content: null,
  engaged_views: null,
  average_percentage_viewed: null,
  stayed_to_watch: null,
  unique_viewers: null,
  unique_reach: null,
  average_views_per_viewer: null,
  new_viewers: null,
  regular_viewers: null,
  casual_viewers: null,
  returning_viewers: null,
  views: null,
  watch_time_hours: null,
  subscribers: null,
  average_view_duration_secs: null,
  impressions: null,
  impressions_click_through_rate: null,
});
