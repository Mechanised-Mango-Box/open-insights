import {
  DestroyRef,
  Injectable,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatasetKind, DatasetProvider, SourceResolver } from '../providers/dataset-provider';
import { ComputeConfigService } from '../compute-config.service';
import { ServerConfigService } from '../server-config.service';
import { VideoRecord } from './VideoRecord';
import { DatasetState, LOCAL_RECOMPUTE, computeTranscriptStats, isReady } from './Dataset';
import { DatasetPeekResult, ServerStatus } from './dataset-status';

/** How often a hash still in a non-terminal state gets re-peeked in the background. */
const STATUS_REFRESH_INTERVAL_MS = 5000;

type CheckOptions = {
  /** Skip the leading 'checking' state. Background refreshes set this so a settled icon
   * never flickers back to a spinner underneath the user. */
  quiet?: boolean;
};

/**
 * The one implementation of "do a dataset action to a video record", shared by every
 * entry point that offers one: the table's per-row buttons, the Scan tab's bulk buttons (which
 * are just these actions applied across the selection) and the edit dialog. Also owns the
 * per-hash status/in-flight state behind the badges, so an action started from one place shows
 * up everywhere the same record is on screen.
 *
 * The work itself belongs to a DatasetProvider - this knows nothing about where it happens.
 *
 * Those badges are a cache of answers from one particular provider, so keeping them honest takes
 * three things, all handled here rather than by each consumer: a first check when a hash comes
 * on screen (trackHashes), wiping the lot when the nominated server changes, and a background
 * re-peek of anything still in a state that can change without the user doing something.
 *
 * Deliberately does *not* touch VideoDatabaseService: persistence stays with the caller,
 * because the edit dialog mustn't write to the DB until the user hits Save.
 *
 * Every action throws on failure so each caller can present the error its own way (a console
 * line for a row click, a counter for a bulk run, an inline message in the dialog); the record
 * itself is left marked up ready to persist either way.
 */
@Injectable({
  providedIn: 'root',
})
export class DatasetActionsService {
  private provider = inject(DatasetProvider);
  private serverConfig = inject(ServerConfigService);
  private computeConfig = inject(ComputeConfigService);
  private destroyRef = inject(DestroyRef);

  /** Where work currently goes, for badge wording - the badges say "on X", and X
   * is no longer always a server. */
  readonly providerLabel = computed(() => this.provider.label());

  // In-flight actions, keyed by file hash.
  uploadingFile = signal<Set<string>>(new Set());
  sendingTranscript = signal<Set<string>>(new Set());
  sendingSceneStats = signal<Set<string>>(new Set());

  // Last-known server state, keyed by file hash.
  serverStatusByHash = signal<Map<string, ServerStatus>>(new Map());
  transcriptStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());
  sceneStatsStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());

  // Hashes currently on screen. Only these are kept fresh - a record that leaves the table
  // stops being polled and drops its cached status.
  private trackedHashes = new Set<string>();

  // Background re-checks in flight. Kept outside the status signals precisely because a
  // background refresh must not publish a 'checking' state.
  private refreshing = new Set<string>();

  constructor() {
    // Every cached status is an answer from one specific place, so changing where the
    // question goes invalidates all of them at once - whether that is a different server
    // or a kind moving between the server and this browser. Harmless on the first run,
    // when nothing is tracked yet.
    effect(() => {
      this.serverConfig.serverUrl();
      this.computeConfig.targets();
      untracked(() => this.recheckAll());
    });

    const timer = setInterval(() => this.refreshStaleStatuses(), STATUS_REFRESH_INTERVAL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /**
   * Declares which hashes are currently on screen: newly-arrived ones get their first status
   * check, departed ones are forgotten. Reads no signals, so callers can invoke it from an
   * effect without that effect re-running on every status write.
   */
  trackHashes(hashes: Iterable<string>): void {
    const next = new Set(hashes);

    for (const hash of next) {
      if (!this.trackedHashes.has(hash)) this.checkAll(hash);
    }

    const dropped = [...this.trackedHashes].filter((hash) => !next.has(hash));
    if (dropped.length > 0) this.forget(dropped);

    this.trackedHashes = next;
  }

  async checkServerStatus(hash: string, { quiet }: CheckOptions = {}): Promise<void> {
    if (!quiet) this.serverStatusByHash.update((map) => new Map(map).set(hash, 'checking'));
    const status = await this.provider.sourceStatus(hash);
    this.serverStatusByHash.update((map) => new Map(map).set(hash, status));
  }

  checkTranscriptStatus(hash: string, options: CheckOptions = {}): Promise<void> {
    return this.checkDatasetStatus('transcript', this.transcriptStatusByHash, hash, options);
  }

  checkSceneStatsStatus(hash: string, options: CheckOptions = {}): Promise<void> {
    return this.checkDatasetStatus('scene_stats', this.sceneStatsStatusByHash, hash, options);
  }

  /** One body for both kinds: they differ only in which signal they write to.
   * The provider has already folded "no such video" into 'absent', so the only
   * thing left to distinguish here is not being able to ask at all. */
  private async checkDatasetStatus(
    kind: DatasetKind,
    target: WritableSignal<Map<string, DatasetPeekResult>>,
    hash: string,
    { quiet }: CheckOptions,
  ): Promise<void> {
    if (!quiet) target.update((map) => new Map(map).set(hash, { status: 'checking' }));
    let result: DatasetPeekResult;
    try {
      const response = await this.provider.peek(kind, hash);
      result =
        response.state === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.state };
    } catch {
      result = { status: 'error' };
    }
    target.update((map) => new Map(map).set(hash, result));
  }

  /**
   * Records that a refresh failed, keeping any value already held.
   *
   * The two cases differ in what there is to preserve. Over a 'ready' value the
   * data survives and gains refresh_error: it is still usable, still exports,
   * and still counts toward the analysis - it simply is not the newest. With
   * nothing held, the failure becomes the state in its own right, so that a
   * first-time failure is visible instead of leaving the field looking as
   * though generation had never been attempted.
   */
  private markRefreshFailure<T>(current: DatasetState<T>, error: string): DatasetState<T> {
    if (isReady(current)) {
      return { ...current, refreshing: undefined, refresh_error: error };
    }
    return { state: 'failed', error };
  }

  /**
   * Sends the record's local video file to the server, if there is one to send. Reports
   * 'no-local-file' rather than failing, so the caller decides whether that's worth telling the
   * user about (the table's file-hash button just re-checks status; the dialog says so out loud).
   */
  async uploadFile(record: VideoRecord): Promise<'uploaded' | 'no-local-file'> {
    if (!record.video_file.file) {
      if (record.video_file.hash) await this.checkServerStatus(record.video_file.hash);
      return 'no-local-file';
    }
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    this.uploadingFile.update((set) => new Set(set).add(hash));
    try {
      await this.provider.putSource(record.video_file.file);
      record.video_file.exists_on_server = true;
    } finally {
      this.uploadingFile.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      await this.checkServerStatus(hash);
    }
    return 'uploaded';
  }

  /**
   * Re-runs server generation for this record's transcript, overwriting local data with the
   * server's result - this is "sync with the server", not pushing local edits verbatim (the
   * dataset-server API has no endpoint to accept those).
   */
  async fetchTranscript(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    const finished = this.logScan('transcript', record);
    let outcome = 'failed';

    this.sendingTranscript.update((set) => new Set(set).add(hash));
    try {
      // Segments and their stats arrive in one payload; the record models them
      // as two separately cacheable fields, so split here.
      const { segments, count_chars, count_words, producer } = await this.provider.request(
        'transcript',
        hash,
        this.sourceFor(record),
      );
      record.ds_transcript = { state: 'ready', data: { segments }, producer };
      record.ds_transcriptStats = { state: 'ready', data: { count_chars, count_words }, producer };
      outcome = `${count_words} words, ${segments.length} segments`;
    } catch (error) {
      // A failed refresh over a good value keeps the value and records why -
      // losing an eleven-minute transcript to a network blip would be worse
      // than holding one that is merely not the newest. With no prior value
      // there is nothing to keep, so the failure itself becomes the state:
      // previously that case was dropped entirely and read as 'never tried'.
      const message = error instanceof Error ? error.message : String(error);
      record.ds_transcript = this.markRefreshFailure(record.ds_transcript, message);
      record.ds_transcriptStats = this.markRefreshFailure(record.ds_transcriptStats, message);
      outcome = `failed - ${message}`;
      throw error;
    } finally {
      this.sendingTranscript.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      void this.checkTranscriptStatus(hash);
      finished(outcome);
    }
  }

  async fetchSceneStats(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    const finished = this.logScan('scene_stats', record);
    let outcome = 'failed';

    this.sendingSceneStats.update((set) => new Set(set).add(hash));
    try {
      const { duration_secs, scenes, producer } = await this.provider.request(
        'scene_stats',
        hash,
        this.sourceFor(record),
      );
      record.ds_sceneStats = { state: 'ready', data: { duration_secs, scenes }, producer };
      outcome = `${scenes} scenes over ${duration_secs.toFixed(1)}s`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.ds_sceneStats = this.markRefreshFailure(record.ds_sceneStats, message);
      outcome = `failed - ${message}`;
      throw error;
    } finally {
      this.sendingSceneStats.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      void this.checkSceneStatsStatus(hash);
      finished(outcome);
    }
  }

  /**
   * Announces the start of a scan and hands back the call that ends it.
   *
   * Shaped this way so a start cannot be logged without a finish: the caller
   * holds the closure and calls it from a `finally`, which covers the failure
   * path as well as the successful one. Scans run for minutes, so the elapsed
   * time is the useful part - it is how a slow file is told from a stuck one.
   */
  private logScan(kind: DatasetKind, record: VideoRecord): (outcome: string) => void {
    const name = record.sort_name || record.video_file.hash.slice(0, 8);
    const startedAt = performance.now();
    console.log(`Scan started: ${kind} - ${name}`);

    return (outcome: string) => {
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      console.log(`Scan finished: ${kind} - ${name} (${outcome}) in ${seconds}s`);
    };
  }

  /**
   * Recomputes count_chars/count_words from an already-fetched transcript, locally - no server
   * round-trip. Useful after a transcript's text was edited/imported without its stats being
   * refreshed. Requires a transcript to already be set.
   */
  recomputeTranscriptStats(record: VideoRecord): void {
    if (!isReady(record.ds_transcript)) {
      throw new Error('No transcript to compute stats from - run Extract Transcript first.');
    }
    record.ds_transcriptStats = {
      state: 'ready',
      data: computeTranscriptStats(record.ds_transcript.data),
      producer: LOCAL_RECOMPUTE,
    };
  }

  private checkAll(hash: string, options?: CheckOptions): Promise<unknown> {
    return Promise.all([
      this.checkServerStatus(hash, options),
      this.checkTranscriptStatus(hash, options),
      this.checkSceneStatsStatus(hash, options),
    ]);
  }

  /** Drops every cached answer and asks the current server again. */
  private recheckAll(): void {
    this.serverStatusByHash.set(new Map());
    this.transcriptStatusByHash.set(new Map());
    this.sceneStatsStatusByHash.set(new Map());
    this.refreshing.clear();
    for (const hash of this.trackedHashes) this.checkAll(hash);
  }

  private forget(hashes: string[]): void {
    const without = <T>(map: Map<string, T>): Map<string, T> => {
      const next = new Map(map);
      for (const hash of hashes) next.delete(hash);
      return next;
    };
    this.serverStatusByHash.update(without);
    this.transcriptStatusByHash.update(without);
    this.sceneStatsStatusByHash.update(without);
    for (const hash of hashes) this.refreshing.delete(hash);
  }

  /**
   * Re-peeks the three states that can still change with no input from this browser: a job the
   * server is running (nothing else will tell us it finished - only the caller that started it
   * polls, and it may have been started from another tab or by the Scan tab in a previous
   * session), a hash whose last check couldn't reach the server (which recovers on its own
   * when the server comes back), and 'absent'.
   *
   * 'absent' is the recent addition, and it is here because the server no longer waits to be
   * asked: it now fills in videos with no dataset whenever it has nothing else to do. So a row
   * can go absent -> queued -> ready with this browser doing nothing at all, and without this
   * the badge would sit on "Not started" until a reload.
   *
   * 'complete', 'failed', 'exists' and 'missing' still only move in response to something done
   * here, and every one of those paths already re-checks the hash itself - so polling them
   * would be traffic that can never change an icon.
   */
  private refreshStaleStatuses(): void {
    if (this.trackedHashes.size === 0) return;

    const serverStatuses = this.serverStatusByHash();
    const transcriptStatuses = this.transcriptStatusByHash();
    const sceneStatsStatuses = this.sceneStatsStatusByHash();
    const busy = [this.uploadingFile(), this.sendingTranscript(), this.sendingSceneStats()];

    for (const hash of this.trackedHashes) {
      // An action already in flight writes its own result when it lands.
      if (this.refreshing.has(hash) || busy.some((set) => set.has(hash))) continue;

      // Worth re-asking about: work still in flight will change on its own, an
      // unreachable server may come back, and the server's idle backfill can turn
      // an absent dataset into a ready one unprompted. Both queued and running
      // count - they are two distinct states now, where 'processing' was one.
      const isStale = (result: DatasetPeekResult | undefined): boolean =>
        result?.status === 'absent' ||
        result?.status === 'queued' ||
        result?.status === 'running' ||
        result?.status === 'error';

      const server = serverStatuses.get(hash) === 'error';
      const transcript = isStale(transcriptStatuses.get(hash));
      const sceneStats = isStale(sceneStatsStatuses.get(hash));
      if (!server && !transcript && !sceneStats) continue;

      this.refreshing.add(hash);
      Promise.all([
        server ? this.checkServerStatus(hash, { quiet: true }) : null,
        transcript ? this.checkTranscriptStatus(hash, { quiet: true }) : null,
        sceneStats ? this.checkSceneStatsStatus(hash, { quiet: true }) : null,
      ]).finally(() => this.refreshing.delete(hash));
    }
  }

  /**
   * Lets a provider reach this record's bytes if it turns out to need them, and
   * marks the record once it has taken them.
   *
   * The provider asks only when it has to - it tries the cheap path first, which
   * covers both "already uploaded" and "already cached" - so `read` is not
   * called at all in the common case, and a record with no file in memory this
   * session costs nothing until something actually wants it.
   */
  private sourceFor(record: VideoRecord): SourceResolver {
    return {
      read: async () => record.video_file.file,
      stored: () => {
        record.video_file.exists_on_server = true;
      },
    };
  }
}
