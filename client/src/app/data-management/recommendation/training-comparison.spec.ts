import { describe, expect, it } from 'vitest';
import { FeatureDistribution } from './recommendation.service';
import {
  ordinal,
  percentileSentence,
  stripGeometry,
  typicalSeries,
  viewingSentence,
  xRange,
} from './training-comparison';

describe('ordinal', () => {
  it('uses st, nd and rd except in the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 82, 100].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '82nd',
      '100th',
    ]);
  });
});

describe('percentileSentence', () => {
  it('reads from the side of the middle the value is on', () => {
    expect(percentileSentence(82.4, 114)).toBe('higher than 82% of the 114 training videos');
    expect(percentileSentence(31, 114)).toBe('lower than 69% of the 114 training videos');
  });

  it('names the ends rather than claiming 100%', () => {
    expect(percentileSentence(100, 10)).toBe('at or above the highest of the 10 training videos');
    expect(percentileSentence(0, 10)).toBe('at or below the lowest of the 10 training videos');
    expect(percentileSentence(99.7, 10)).toBe('higher than 99% of the 10 training videos');
  });
});

describe('stripGeometry', () => {
  const histogram = { edges: [0, 1, 2, 4], counts: [2, 4, 1] };

  it('scales bars to the tallest and places the marker on the range', () => {
    const geometry = stripGeometry(histogram, 1);
    expect(geometry.bars).toEqual([
      { x: 0, width: 0.25, height: 0.5 },
      { x: 0.25, width: 0.25, height: 1 },
      { x: 0.5, width: 0.5, height: 0.25 },
    ]);
    expect(geometry.marker).toBe(0.25);
    expect(geometry.outside).toBeNull();
  });

  it('pins a value off the training range to the end it fell past', () => {
    expect(stripGeometry(histogram, -3)).toMatchObject({ marker: 0, outside: 'below' });
    expect(stripGeometry(histogram, 9)).toMatchObject({ marker: 1, outside: 'above' });
  });
});

describe('typicalSeries', () => {
  it('plots each bin at its centre and breaks at held-back bins', () => {
    const distribution: FeatureDistribution = {
      quantiles: [],
      histogram: {
        edges: [0, 2, 4],
        counts: [6, 1],
        target_p25: [40, null],
        target_median: [50, null],
        target_p75: [60, null],
      },
    };
    expect(typicalSeries(distribution).median).toEqual([
      { x: 1, y: 50 },
      { x: 3, y: null },
    ]);
  });
});

describe('xRange', () => {
  it('widens the training range to take in the video', () => {
    expect(xRange({ edges: [1, 2, 3], counts: [1, 1] }, 5)).toEqual({ min: 1, max: 5 });
    expect(xRange({ edges: [1, 2, 3], counts: [1, 1] }, 2)).toEqual({ min: 1, max: 3 });
  });
});

describe('viewingSentence', () => {
  it('compares the prediction with what the training videos got', () => {
    expect(viewingSentence(64.2, 114)).toBe(
      'more than 64% of the 114 training videos actually got',
    );
    expect(viewingSentence(9, 114)).toBe('less than 91% of the 114 training videos actually got');
    expect(viewingSentence(100, 114)).toBe('more than any of the 114 training videos actually got');
  });
});
