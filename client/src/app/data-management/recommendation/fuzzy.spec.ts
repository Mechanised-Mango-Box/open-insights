import { describe, expect, it } from 'vitest';
import { fuzzyMatch, highlight, rankFuzzy } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches characters in order with gaps, ignoring case and query spaces', () => {
    expect(fuzzyMatch('itml', 'Intro to ML')?.indices).toEqual([0, 2, 9, 10]);
    expect(fuzzyMatch('intro ml', 'Intro to ML')).not.toBeNull();
  });

  it('does not match characters out of order', () => {
    expect(fuzzyMatch('mli', 'Intro to ML')).toBeNull();
  });

  it('prefers a contiguous run over the earliest scattered characters', () => {
    expect(fuzzyMatch('ml', 'Many Lessons: ML')?.indices).toEqual([14, 15]);
  });

  it('matches everything for an empty query', () => {
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indices: [] });
  });
});

describe('rankFuzzy', () => {
  const names = ['Calculus lecture 3', 'Linear algebra', 'Lecture: linear regression'];

  it('drops non-matches and puts the tightest match first', () => {
    const ranked = rankFuzzy(names, 'linear', (name) => name).map(({ item }) => item);
    expect(ranked).toEqual(['Linear algebra', 'Lecture: linear regression']);
  });

  it('keeps the input order for an empty query', () => {
    expect(rankFuzzy(names, '', (name) => name).map(({ item }) => item)).toEqual(names);
  });
});

describe('highlight', () => {
  it('groups consecutive matched and unmatched characters', () => {
    expect(highlight('Intro to ML', [0, 1, 9, 10])).toEqual([
      { text: 'In', match: true },
      { text: 'tro to ', match: false },
      { text: 'ML', match: true },
    ]);
  });
});
