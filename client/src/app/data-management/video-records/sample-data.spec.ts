/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExportZip } from './manifest-import';
import { parseYoutubeAudienceRetentionCsv, parseYoutubeContentCsv } from './youtube-csv-import';

// The public sample in data/sample/ - see its README. These check it still goes through
// the app's own import path, so a format change that strands it fails here.
const SAMPLE = resolve(__dirname, '../../../../../data/sample');
const RAW = `${SAMPLE}/edu-video-insights-recreated_raw/newcastle_mech1750_lecture_level1_agregg_2025`;

describe('the public edu-video-insights sample', () => {
  it('imports the export zip with every Scan result and retention curve', async () => {
    const zip = new Blob([readFileSync(`${SAMPLE}/edu-video-insights-export.zip`)]);
    const records = await parseExportZip(zip);

    expect(records).toHaveLength(144);
    for (const record of records) {
      expect(record.ds_youtubeContent?.average_view_duration_secs).toBeGreaterThan(0);
      expect(record.ds_transcript.state).toBe('ready');
      expect(record.ds_sceneStats.state).toBe('ready');
      expect(record.ds_textStats.state).toBe('ready');
      expect(record.ds_audioStats.state).toBe('ready');
      expect(record.ds_youtubeAudienceRetention?.video_position).toHaveLength(100);
    }
  });

  it('parses the Studio files the zip was built from', () => {
    const content = parseYoutubeContentCsv(
      readFileSync(`${RAW}/Content 2025-01-01_2025-12-31 MECH1750/Table data.csv`, 'utf-8'),
    );
    expect(content.find((row) => row.content.content === 'Upitsn2JRp0')?.title).toBe(
      'Tensile Testing and Stress-Strain Curves',
    );

    const retention = parseYoutubeAudienceRetentionCsv(
      readFileSync(
        `${RAW}/Audience retention 2025-01-01_2025-12-31 Tensile Testing and Stress-Strain Curves/All.csv`,
        'utf-8',
      ),
    );
    expect(retention.video_position).toEqual([...Array(100).keys()]);
    expect(retention.absolute_audience_retention.slice(0, 3)).toEqual([108.79, 91.33, 89.01]);
  });
});
