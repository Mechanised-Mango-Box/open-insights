import Papa from 'papaparse';
import { YoutubeAudienceRetention, YoutubeContent } from './Dataset';

export type YoutubeContentCsvRow = {
  title: string;
  content: YoutubeContent;
};

// Handles both "MM:SS" and "H:MM:SS" (YouTube Studio's "Average view duration" column).
const parseDurationToSeconds = (value: string | undefined): number | null => {
  if (!value) return null;
  const parts = value.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, val) => acc * 60 + val, 0);
};

const parseNullableNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

/**
 * YouTube writes the "Duration" column as a plain integer count of seconds, but
 * this routes on the shape rather than trusting that: a colon means it is a
 * clock-style value and goes through parseDurationToSeconds, anything else is
 * read as seconds. Older exports omit the column entirely, which lands as null
 * like any other absent value.
 */
const parseDurationColumn = (value: string | undefined): number | null =>
  value?.includes(':') ? parseDurationToSeconds(value) : parseNullableNumber(value);

/**
 * Parses a YouTube Studio "Content" export. Columns with no corresponding field in
 * YoutubeContent (engaged_views, average_percentage_viewed, stayed_to_watch, unique_viewers,
 * unique_reach, average_views_per_viewer, new_viewers, regular_viewers, casual_viewers,
 * returning_viewers) are left null - this export format doesn't carry them.
 */
export function parseYoutubeContentCsv(csvText: string): YoutubeContentCsvRow[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  return data.map((row) => ({
    title: row['Video title'] ?? '',
    content: {
      content: row['Content'] || null,
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
      views: parseNullableNumber(row['Views']),
      watch_time_hours: parseNullableNumber(row['Watch time (hours)']),
      subscribers: parseNullableNumber(row['Subscribers']),
      average_view_duration_secs: parseDurationToSeconds(row['Average view duration']),
      duration_secs: parseDurationColumn(row['Duration']),
      impressions: parseNullableNumber(row['Impressions']),
      impressions_click_through_rate: parseNullableNumber(
        row['Impressions click-through rate (%)'],
      ),
    },
  }));
}

/** Parses a YouTube Studio "Audience retention" export for a single video. */
export function parseYoutubeAudienceRetentionCsv(csvText: string): YoutubeAudienceRetention {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const video_position: number[] = [];
  const absolute_audience_retention: number[] = [];
  for (const row of data) {
    const position = parseNullableNumber(row['Video position (%)']);
    const retention = parseNullableNumber(row['Absolute audience retention (%)']);
    if (position !== null && retention !== null) {
      video_position.push(position);
      absolute_audience_retention.push(retention);
    }
  }

  return { video_position, absolute_audience_retention };
}
