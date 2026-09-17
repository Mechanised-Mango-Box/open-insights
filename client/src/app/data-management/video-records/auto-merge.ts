import { computeMergePreview, resolveMerge } from './merge-videos';
import { recordDurationSecs } from './video-duration';
import { VideoRecord } from './VideoRecord';

/**
 * Pairs the two halves a video is split into when a library is built from both a
 * YouTube content export and the video files: the CSV import gives a row with the
 * YouTube data and the title, the file import a row with the file and its file
 * name. Neither side carries an id the other has, so the pair is found the way a
 * person would find it - similar name, same length.
 */

/** YouTube reports whole seconds, the browser a fractional probe of the container. */
export const DURATION_TOLERANCE_SECS = 2;
/** With durations agreeing, the names only need to be recognisably the same video. */
export const MIN_SIMILARITY_WITH_DURATION = 0.5;
/** Without a duration to confirm it, the name has to carry the match on its own. */
export const MIN_SIMILARITY_TITLE_ONLY = 0.85;
/** Ranks a duration-confirmed pair above any title-only one. */
const DURATION_BONUS = 0.5;

export type AutoMergePair = {
  youtube: VideoRecord;
  file: VideoRecord;
  similarity: number;
  durationMatched: boolean;
};

export type AutoMergeResult = {
  pairs: AutoMergePair[];
  /** Records on either side that could have been paired but were not. */
  unmatched: number;
};

const isYoutubeSide = (record: VideoRecord): boolean =>
  record.ds_youtubeContent !== null && !record.video_file.hash;

const isFileSide = (record: VideoRecord): boolean =>
  record.ds_youtubeContent === null && !!record.video_file.hash;

/** The name a file-side record was imported under, preferring the file's own. */
export const fileTitle = (record: VideoRecord): string =>
  record.video_file.file?.name ?? record.sort_name;

export const normalizeTitle = (title: string): string =>
  title
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    // Downloaders commonly append the 11-character video id: "Title [dQw4w9WgXcQ]".
    .replace(/\s*[[(][A-Za-z0-9_-]{11}[\])]\s*$/, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Dice coefficient over word tokens: 1 for the same words, 0 for none shared. */
export const titleSimilarity = (a: string, b: string): number => {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared++;
  return (2 * shared) / (leftTokens.size + rightTokens.size);
};

type Candidate = AutoMergePair & { score: number };

const scorePair = (youtube: VideoRecord, file: VideoRecord): Candidate | null => {
  const similarity = titleSimilarity(youtube.sort_name, fileTitle(file));
  const youtubeSecs = youtube.ds_youtubeContent?.duration_secs ?? null;
  const fileSecs = recordDurationSecs(file);

  if (youtubeSecs !== null && youtubeSecs > 0 && fileSecs !== null) {
    if (Math.abs(youtubeSecs - fileSecs) > DURATION_TOLERANCE_SECS) return null;
    if (similarity < MIN_SIMILARITY_WITH_DURATION) return null;
    return { youtube, file, similarity, durationMatched: true, score: similarity + DURATION_BONUS };
  }

  if (similarity < MIN_SIMILARITY_TITLE_ONLY) return null;
  return { youtube, file, similarity, durationMatched: false, score: similarity };
};

const sameScore = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/**
 * Best pairs first, each record used at most once. A record with two equally good
 * candidates is left alone rather than handed to whichever came first: a guess
 * there merges the wrong video, and Merge Selected is still there for it.
 */
export function findAutoMergePairs(records: VideoRecord[]): AutoMergeResult {
  const youtubeSide = records.filter(isYoutubeSide);
  const fileSide = records.filter(isFileSide);

  const candidates: Candidate[] = [];
  for (const youtube of youtubeSide) {
    for (const file of fileSide) {
      const candidate = scorePair(youtube, file);
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const used = new Set<VideoRecord>();
  const pairs: AutoMergePair[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.youtube) || used.has(candidate.file)) continue;

    const rivals = candidates.filter(
      (other) =>
        other !== candidate &&
        sameScore(other.score, candidate.score) &&
        !used.has(other.youtube) &&
        !used.has(other.file) &&
        (other.youtube === candidate.youtube || other.file === candidate.file),
    );
    if (rivals.length > 0) {
      // Only the contested record is set aside; the rivals' other halves stay free
      // to pair with something else.
      for (const rival of rivals) {
        used.add(rival.youtube === candidate.youtube ? candidate.youtube : candidate.file);
      }
      continue;
    }

    const { score: _score, ...pair } = candidate;
    pairs.push(pair);
    used.add(candidate.youtube);
    used.add(candidate.file);
  }

  return { pairs, unmatched: youtubeSide.length + fileSide.length - pairs.length * 2 };
}

/**
 * The merged record for a pair, named after the YouTube title. Null when the two
 * disagree on anything besides the name - that is no longer the simple two-halves
 * case, and needs the manual merge dialog to choose.
 */
export function mergePair(pair: AutoMergePair): Omit<VideoRecord, '__id'> | null {
  const preview = computeMergePreview([pair.youtube, pair.file]);
  if (preview.conflicts.some((conflict) => conflict.key !== 'sort_name')) return null;
  return resolveMerge(preview, { sort_name: pair.youtube.sort_name });
}
