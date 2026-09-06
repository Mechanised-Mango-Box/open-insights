import { describe, expect, it } from 'vitest';
import { parseYoutubeContentCsv } from './youtube-csv-import';

/**
 * The CSV text below is copied from the fixtures under `data/sample/mock-v3/`
 * and `data/local/`, trimmed to the rows each case is about. Inlined rather
 * than read off disk: those files live outside `client/`, so a spec that read
 * them would depend on the wider checkout being present.
 */
const CONTENT_HEADER =
  'Content,Video title,Video publish time,Duration,Views,Watch time (hours),Subscribers,Average view duration,Impressions,Impressions click-through rate (%)';

const durationsOf = (csv: string) =>
  parseYoutubeContentCsv(csv).map((row) => row.content.duration_secs);

describe('parseYoutubeContentCsv duration', () => {
  it('reads the Duration column as a count of seconds', () => {
    const csv = [
      CONTENT_HEADER,
      '"Q6nP2mT9xLv","How to Fix Slow PC (Step-by-Step)","2026-07-20 13:18:00",8120,175,0.0182,90,0:16:02,35,',
    ].join('\n');

    expect(durationsOf(csv)).toEqual([8120]);
  });

  it('does not confuse the video length with the average view duration', () => {
    const csv = [
      CONTENT_HEADER,
      '"Q6nP2mT9xLv","How to Fix Slow PC (Step-by-Step)","2026-07-20 13:18:00",8120,175,0.0182,90,0:16:02,35,',
    ].join('\n');

    const [row] = parseYoutubeContentCsv(csv);
    expect(row.content.duration_secs).toBe(8120);
    expect(row.content.average_view_duration_secs).toBe(962); // 0:16:02
  });

  it('also accepts a clock-style Duration, which some exports use', () => {
    const csv = [
      CONTENT_HEADER,
      '"CLOCK","H:MM:SS duration","2026-07-20 13:18:00",1:04:05,1,0,0,0:00:30,0,',
    ].join('\n');

    expect(durationsOf(csv)).toEqual([3845]);
  });

  it('yields null for empty, non-numeric and null-like Duration values', () => {
    const csv = [
      CONTENT_HEADER,
      '"EMPTY_NUMBERS","All Numeric Fields Empty","2026-07-21 19:44:00",,,,,,',
      '"MALFORMED_TEXT","Non-Numeric Text","2026-07-05 20:12:00","not_a_number","unknown","error",0,"0:13:05",210,0.02',
      '"NULL_VALUES","Testing actual null-like strings","2026-07-16 20:03:00",None,None,None,None,"0:00:28",1040,None',
    ].join('\n');

    expect(durationsOf(csv)).toEqual([null, null, null]);
  });

  it('tolerates padding around the Duration value', () => {
    const csv = [
      CONTENT_HEADER,
      '"EXTRA_WHITESPACE","   Spaced Title   ","2026-07-12 18:14:00", 17350 , 260 , 0.0229 , 180 , "0:10:02" , 240 , 0.02',
    ].join('\n');

    expect(durationsOf(csv)).toEqual([17350]);
  });

  it('yields null throughout for older exports that have no Duration column', () => {
    const csv = [
      'Video title,Content,Views,Watch time (hours),Subscribers,Average view duration,Impressions,Impressions click-through rate (%)',
      '"Performance Excuses Debunked [x2EOOJg8FkA]","Performance Excuses Debunked [x2EOOJg8FkA]",40300,3895.7,210,5:48,650000,6.2',
    ].join('\n');

    expect(durationsOf(csv)).toEqual([null]);
  });
});
