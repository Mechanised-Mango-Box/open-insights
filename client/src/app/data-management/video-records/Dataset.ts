export type Cacheable<T> = {
  upload_state:
    { is_local: false } | { is_local: true; server_side_state: 'ready' | 'failed' | 'in_progress' };
  data: T;
};

export interface CanCreateEmpty<T> {
  createEmpty(): T;
}

export interface YoutubeContent {
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
}

export const YoutubeContent: CanCreateEmpty<YoutubeContent> = {
  createEmpty: () => ({
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
  }),
};

export interface YoutubeAudienceRetention {
  video_position: number[];
  absolute_audience_retention: number[];
}

export const YoutubeAudienceRetention: CanCreateEmpty<YoutubeAudienceRetention> = {
  createEmpty: () => ({
    video_position: [],
    absolute_audience_retention: [],
  }),
};

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  segments: TranscriptSegment[];
}

export const Transcript: CanCreateEmpty<Transcript> = {
  createEmpty: () => ({
    segments: [],
  }),
};

/** Formats a seconds offset as "MM:SS" for display next to a transcript segment. */
export const formatTimestamp = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Flattens a transcript's segments down to plain text. */
export const transcriptFullText = (transcript: Transcript): string =>
  transcript.segments.map((segment) => segment.text).join(' ');

export const computeTranscriptStats = (transcript: Transcript): TranscriptStats => {
  const text = transcriptFullText(transcript);
  const words = text.trim().length ? text.trim().split(/\s+/) : [];
  return { count_chars: text.length, count_words: words.length };
};

export interface TranscriptStats {
  count_chars: number;
  count_words: number;
}

export const TranscriptStats: CanCreateEmpty<TranscriptStats> = {
  createEmpty: () => ({
    count_chars: 0,
    count_words: 0,
  }),
};

export interface SceneStats {
  duration_secs: number;
  scenes: number;
}

export const SceneStats: CanCreateEmpty<SceneStats> = {
  createEmpty: () => ({
    duration_secs: 0,
    scenes: 0,
  }),
};
