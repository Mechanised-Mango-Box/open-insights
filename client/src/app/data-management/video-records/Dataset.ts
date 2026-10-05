import { calculateSpeechPaceVariation } from './speech-features';

/**
 * Where a locally-held dataset value came from, when it does not come from a
 * server run. `producer` is stamped by whatever made the data, so it doubles as
 * provenance: the old model carried an `is_local` boolean, which said where the
 * value was but nothing about what made it.
 */
export const LOCAL_IMPORT = 'local-import';
export const LOCAL_RECOMPUTE = 'local-recompute';

/**
 * The thresholds and models a value was made with, by name - `{ threshold: 30 }` for scene
 * stats, say. The server reports its own with every result (the *_SETTINGS in
 * server/config.py), and each browser computer declares its own beside its producer.
 * Absent on values made before results carried them.
 */
export type DatasetSettings = Record<string, string | number | boolean>;

/**
 * One dataset value and what is known about it, mirroring the states the server
 * derives (see dataset_state() in server/db.py) so client and server share a
 * single vocabulary instead of translating between three.
 *
 * `data` lives only in the 'ready' case. That is the point of the shape: a
 * failed or in-flight value cannot carry a payload, which the previous model
 * allowed and relied on convention to avoid.
 */
export type DatasetState<T> =
  | { state: 'absent' }
  | { state: 'queued' }
  | { state: 'running' }
  | { state: 'failed'; error: string; attempts?: number }
  | {
      state: 'ready';
      data: T;
      producer: string;
      produced_at?: string;
      settings?: DatasetSettings;
      /** A regeneration is in flight; the data below is still the current one. */
      refreshing?: 'queued' | 'running';
      /**
       * A refresh over this value failed. The data is still usable and still
       * exports - it just is not what the current producer would make now. Kept
       * rather than discarded so a network blip cannot destroy a transcript
       * that took eleven minutes to produce.
       */
      refresh_error?: string;
    };

/** Narrowing helper - reads better than checking the tag at every call site. */
export const isReady = <T>(
  value: DatasetState<T> | undefined,
): value is Extract<DatasetState<T>, { state: 'ready' }> => value?.state === 'ready';

/** The value if it is ready, otherwise null - for the many read-only consumers. */
export const readyData = <T>(value: DatasetState<T> | undefined): T | null =>
  isReady(value) ? value.data : null;

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
  /**
   * How long the video is, not how long it was watched for - the neighbouring
   * average_view_duration_secs is the latter. Nullable because only newer
   * YouTube Studio content exports carry the "Duration" column at all.
   */
  duration_secs: number | null;
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
    duration_secs: null,
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

/** Formats a seconds offset as "MM:SS" for display next to a transcript segment. Display
 * only - the manifest export writes SRT timestamps of its own, which keep the hours part
 * and the milliseconds this drops. */
export const formatTimestamp = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Formats a length of video as "M:SS", growing an hours part only when there is
 * one. Kept separate from formatTimestamp above rather than widening it: that
 * one pads to a fixed "MM:SS" for transcript segments, and it has no hours part
 * at all - so a 75-minute lecture reads as "75:30", which is fine for a segment
 * offset and wrong for a whole-video duration.
 */
export const formatDuration = (seconds: number): string => {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/** Flattens a transcript's segments down to plain text. */
export const transcriptFullText = (transcript: Transcript): string =>
  transcript.segments.map((segment) => segment.text).join(' ');

/**
 * `durationSecs` is what the speech feature is measured against, and it
 * comes from a different dataset than the transcript does - so it is passed in
 * rather than read here, and is nullable because a transcript can land before
 * any duration source exists.
 */
export type SpeechFeatures = Pick<TranscriptStats, 'speech_pace_variation'>;

/**
 * The duration-dependent half of the transcript stats, split out because the
 * server supplies the two counts but not this - so the path that takes a
 * server transcript computes only this part, and both paths agree on when the
 * answer is null.
 */
export const computeSpeechFeatures = (
  transcript: Transcript,
  durationSecs: number | null,
): SpeechFeatures =>
  durationSecs != null && durationSecs > 0
    ? {
        speech_pace_variation: calculateSpeechPaceVariation(transcript, durationSecs),
      }
    : { speech_pace_variation: null };

export const computeTranscriptStats = (
  transcript: Transcript,
  durationSecs: number | null,
): TranscriptStats => {
  const text = transcriptFullText(transcript);
  const words = text.trim().length ? text.trim().split(/\s+/) : [];
  return {
    count_chars: text.length,
    count_words: words.length,
    ...computeSpeechFeatures(transcript, durationSecs),
  };
};

export interface TranscriptStats {
  count_chars: number;
  count_words: number;
  /**
   * Needs the video's duration, which a transcript can arrive without - so
   * null means "not computable yet", kept distinct from a real 0. A 0 is a
   * legitimate measurement here (silence, or a single speech window), and the
   * speech-features function returns one for missing input too, which is why
   * the decision is made from the inputs rather than from its result.
   */
  speech_pace_variation: number | null;
}

export const TranscriptStats: CanCreateEmpty<TranscriptStats> = {
  createEmpty: () => ({
    count_chars: 0,
    count_words: 0,
    speech_pace_variation: null,
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

/**
 * On-screen text, read by OCR on the server from one frame every few seconds
 * (server/text_stats.py). The server also returns what each sampled frame said;
 * only this summary is kept here, since nothing in the app reads the samples and
 * a lecture's worth of them would sit in IndexedDB for every record.
 */
export interface TextStats {
  sample_count: number;
  /** Words on screen, averaged over the video - the model's text_density. */
  mean_words: number;
  max_words: number;
  /** The share of the frame covered by text, averaged over the video (0-1). */
  mean_coverage: number;
  /** The share of sampled frames with any text on them (0-1). */
  text_frames_ratio: number;
}

export const TextStats: CanCreateEmpty<TextStats> = {
  createEmpty: () => ({
    sample_count: 0,
    mean_words: 0,
    max_words: 0,
    mean_coverage: 0,
    text_frames_ratio: 0,
  }),
};

/**
 * How a video sounds, measured on the server (server/audio_stats.py) for two of
 * Mayer's multimedia principles. The nullable fields are null for a video with
 * no speech in it, which has no speech level or pitch to report.
 */
export interface AudioStats {
  duration_secs: number;
  /** Seconds the voice-activity detector found speech in. */
  speech_secs: number;
  /** The speech's median loudness, in dBFS. */
  speech_level_db: number | null;
  /** Coherence: the share of the video that is sound other than speech -
   * music or effects no more than 20 dB quieter than the speaker (0-1). */
  background_sound_ratio: number;
  median_pitch_hz: number | null;
  /** Voice: the standard deviation of the speaker's pitch, in semitones. */
  pitch_variation_st: number;
  /**
   * Segmenting: speech and pauses, from a voice-activity pass that ends speech
   * at a 250 ms silence. Speech heard in the audio, not the time Whisper's
   * transcript segments cover - those run straight across pauses.
   *
   * Optional because results scanned before these existed lack them; such a
   * result is stale on the server and gains them when scanned again.
   */
  speech_ratio?: number;
  /** Pauses per minute, between the first speech and the last. */
  pause_rate_per_min?: number;
  /** Null with fewer than two stretches of speech. */
  mean_pause_secs?: number | null;
}

export const AudioStats: CanCreateEmpty<AudioStats> = {
  createEmpty: () => ({
    duration_secs: 0,
    speech_secs: 0,
    speech_level_db: null,
    background_sound_ratio: 0,
    median_pitch_hz: null,
    pitch_variation_st: 0,
    speech_ratio: 0,
    pause_rate_per_min: 0,
    mean_pause_secs: null,
  }),
};
