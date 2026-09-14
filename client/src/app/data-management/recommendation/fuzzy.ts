/**
 * A small fuzzy matcher for picking one video by name, written here rather than
 * pulled in as a dependency: the picker ranks a user's own library of at most a
 * few hundred names, which needs a scoring rule, not a search engine.
 *
 * A query matches when its characters appear in the text in order, gaps allowed
 * and case ignored ("itml" finds "Intro to ML"). Whitespace in the query is
 * ignored, so "intro ml" behaves the same. Matches are ranked so the ones a
 * person meant come first: runs of consecutive characters and characters at the
 * start of a word score higher, and gaps cost a little.
 */

export type FuzzyMatch = {
  score: number;
  /** Positions in the text of each matched character, ascending. */
  indices: number[];
};

export type HighlightSegment = { text: string; match: boolean };

const WORD_BOUNDARY = /[\s\-_.,:;/\\()[\]{}'"]/;

const isWordStart = (text: string, index: number): boolean =>
  index === 0 || WORD_BOUNDARY.test(text[index - 1]);

/** Null when the query does not match. An empty query matches everything,
 * equally, with nothing highlighted. */
export const fuzzyMatch = (query: string, text: string): FuzzyMatch | null => {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return { score: 0, indices: [] };
  const haystack = text.toLowerCase();

  // A contiguous occurrence is always what was meant when there is one, but the
  // greedy walk below would take the earliest scattered characters instead - so
  // "ml" in "Many Lessons: ML" would light up "M...L" rather than "ML".
  const at = haystack.indexOf(needle);
  let indices: number[];
  if (at !== -1) {
    indices = Array.from({ length: needle.length }, (_, i) => at + i);
  } else {
    indices = [];
    let from = 0;
    for (const char of needle) {
      const found = haystack.indexOf(char, from);
      if (found === -1) return null;
      indices.push(found);
      from = found + 1;
    }
  }

  return { score: scoreIndices(haystack, indices), indices };
};

const scoreIndices = (text: string, indices: number[]): number => {
  let score = 0;
  indices.forEach((index, i) => {
    score += 10;
    if (isWordStart(text, index)) score += 10;
    if (i > 0) {
      const gap = index - indices[i - 1] - 1;
      score += gap === 0 ? 15 : -Math.min(gap, 10);
    }
  });
  // Matching near the front of the name reads as more relevant than deep inside it.
  return score - Math.min(indices[0] ?? 0, 10);
};

/**
 * Keeps the items that match, best first. Ties keep the input order - the
 * picker hands these in name-sorted, so an empty query is simply that list.
 */
export const rankFuzzy = <T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): { item: T; match: FuzzyMatch }[] =>
  items
    .map((item) => ({ item, match: fuzzyMatch(query, textOf(item)) }))
    .filter((entry): entry is { item: T; match: FuzzyMatch } => entry.match !== null)
    .sort((a, b) => b.match.score - a.match.score);

/** Splits text into runs of matched and unmatched characters, for rendering. */
export const highlight = (text: string, indices: readonly number[]): HighlightSegment[] => {
  const matched = new Set(indices);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = matched.has(i);
    const last = segments.at(-1);
    if (last && last.match === match) last.text += text[i];
    else segments.push({ text: text[i], match });
  }
  return segments;
};
