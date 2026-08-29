interface Dataset {}

type YoutubeContent = Dataset & {
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

type YoutubeAudienceRetention = Dataset & {
  video_position: number[];
  absolute_audience_retention: number[];
};

type Transcript = Dataset & {
  text: string;
  count_chars: number;
  count_words: number;
};
type SceneStats = Dataset & {
  duration_secs: number;
  scenes: number;
};
