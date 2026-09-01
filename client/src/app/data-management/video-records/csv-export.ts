import Papa from 'papaparse';
import { VideoRecord } from './VideoRecord';

/** Flattens all records + their datasets into one CSV, one row per record. */
export function buildExportCsv(records: VideoRecord[]): string {
  const rows = records.map((record) => ({
    sort_name: record.sort_name,
    file_hash: record.file_hash ?? '',
    yt_content: record.ds_youtubeContent?.content ?? '',
    yt_engaged_views: record.ds_youtubeContent?.engaged_views ?? '',
    yt_average_percentage_viewed: record.ds_youtubeContent?.average_percentage_viewed ?? '',
    yt_stayed_to_watch: record.ds_youtubeContent?.stayed_to_watch ?? '',
    yt_unique_viewers: record.ds_youtubeContent?.unique_viewers ?? '',
    yt_unique_reach: record.ds_youtubeContent?.unique_reach ?? '',
    yt_average_views_per_viewer: record.ds_youtubeContent?.average_views_per_viewer ?? '',
    yt_new_viewers: record.ds_youtubeContent?.new_viewers ?? '',
    yt_regular_viewers: record.ds_youtubeContent?.regular_viewers ?? '',
    yt_casual_viewers: record.ds_youtubeContent?.casual_viewers ?? '',
    yt_returning_viewers: record.ds_youtubeContent?.returning_viewers ?? '',
    yt_views: record.ds_youtubeContent?.views ?? '',
    yt_watch_time_hours: record.ds_youtubeContent?.watch_time_hours ?? '',
    yt_subscribers: record.ds_youtubeContent?.subscribers ?? '',
    yt_average_view_duration_secs: record.ds_youtubeContent?.average_view_duration_secs ?? '',
    yt_impressions: record.ds_youtubeContent?.impressions ?? '',
    yt_impressions_click_through_rate:
      record.ds_youtubeContent?.impressions_click_through_rate ?? '',
    transcript_text: record.ds_transcript?.text ?? '',
    transcript_count_chars: record.ds_transcript?.count_chars ?? '',
    transcript_count_words: record.ds_transcript?.count_words ?? '',
    scene_stats_duration_secs: record.ds_sceneStats?.duration_secs ?? '',
    scene_stats_scenes: record.ds_sceneStats?.scenes ?? '',
  }));

  return Papa.unparse(rows);
}

/** Triggers a browser download of the given CSV text. */
export function downloadCsv(csvText: string, filename: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
