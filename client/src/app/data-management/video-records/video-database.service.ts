import { Injectable, signal } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { VideoRecord } from './VideoRecord';
import { DatasetState, LOCAL_IMPORT, computeSpeechFeatures, isReady } from './Dataset';
import { readFileDurationSecs, recordDurationSecs } from './video-duration';

/** The pre-v3 stored shape, kept only so the upgrade can read it. */
type LegacyCacheable = {
  upload_state:
    { is_local: false } | { is_local: true; server_side_state: 'ready' | 'failed' | 'in_progress' };
  data: unknown;
};

/**
 * Rewrites one stored Cacheable into a DatasetState.
 *
 * Every legacy variant that held data maps to 'ready', because it did hold
 * usable data - the old `server_side_state` described the last *sync attempt*,
 * not the payload. So 'in_progress' becomes ready rather than running (the sync
 * it referred to is long over), and 'failed' becomes ready-with-refresh_error
 * rather than failed, which would have thrown away a real transcript.
 */
function migrateCacheable(stored: unknown): DatasetState<unknown> {
  if (!stored || typeof stored !== 'object' || !('upload_state' in stored)) {
    return { state: 'absent' };
  }
  const legacy = stored as LegacyCacheable;
  const base = { state: 'ready' as const, data: legacy.data };

  if (!legacy.upload_state.is_local) {
    return { ...base, producer: 'server (pre-v3)' };
  }
  switch (legacy.upload_state.server_side_state) {
    case 'failed':
      return { ...base, producer: 'server (pre-v3)', refresh_error: 'sync failed before v3' };
    case 'in_progress':
      return { ...base, producer: 'server (pre-v3)' };
    case 'ready':
    default:
      return { ...base, producer: LOCAL_IMPORT };
  }
}

interface VideoDBSchema extends DBSchema {
  videos: {
    key: number;
    value: VideoRecord;
    indexes: { by_file_hash: string };
  };
}

@Injectable({
  providedIn: 'root',
})
export class VideoDatabaseService {
  private dbPromise: Promise<IDBPDatabase<VideoDBSchema>>;
  videoRecords = signal<VideoRecord[]>([]);

  constructor() {
    this.dbPromise = this.initDB();
    this.loadInitialVideos();
  }

  private initDB = async () => {
    return openDB<VideoDBSchema>('video-library-db', 7, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // `upgrade` runs on every version increase, not just on first creation, so the
        // initial schema is gated on the version that introduced it - re-running
        // createObjectStore over an existing store throws ConstraintError, which would
        // leave every caller stuck on a rejected dbPromise. A future bump adds its own
        // `if (oldVersion < 3)` block alongside this one.
        if (oldVersion < 2) {
          const store = db.createObjectStore('videos', {
            keyPath: '__id',
            autoIncrement: true,
          });
          store.createIndex('by_file_hash', 'video_file.hash', { unique: false });
        }
        // v3 replaced Cacheable<T> - a payload plus an `upload_state` that
        // described a sync nothing ever performed - with DatasetState<T>, where
        // the payload exists only in the 'ready' case. Stored records carry the
        // old shape, so they are rewritten in place; without this every
        // ds_ field would read as malformed and the data would look lost.
        if (oldVersion > 0 && oldVersion < 3) {
          const store = tx.objectStore('videos');
          store.openCursor().then(function migrate(cursor): unknown {
            if (!cursor) return undefined;
            const record = cursor.value as Record<string, unknown>;
            for (const field of ['ds_transcript', 'ds_transcriptStats', 'ds_sceneStats']) {
              record[field] = migrateCacheable(record[field]);
            }
            // v5's and v6's fields as well: this cursor is already rewriting every
            // record, and a second one over the same store could race it (see below).
            record['ds_textStats'] ??= { state: 'absent' };
            record['ds_audioStats'] ??= { state: 'absent' };
            return cursor.update(record as VideoRecord).then(() => cursor.continue().then(migrate));
          });
        }
        // v5 adds ds_textStats and v6 ds_audioStats. A stored record has no such
        // field, and every reader of a dataset field expects a DatasetState there -
        // 'absent' is the honest value for a record nobody has scanned for it yet.
        // One cursor for both, so a v3 or v4 library does not have two over the
        // same store; a library older than v3 gets both from the v3 pass above
        // instead, for the same reason.
        if (oldVersion >= 3 && oldVersion < 6) {
          const store = tx.objectStore('videos');
          store.openCursor().then(function addDatasets(cursor): unknown {
            if (!cursor) return undefined;
            const record = cursor.value as Partial<VideoRecord>;
            if (record.ds_textStats && record.ds_audioStats) {
              return cursor.continue().then(addDatasets);
            }
            return cursor
              .update({
                ...record,
                ds_textStats: record.ds_textStats ?? { state: 'absent' },
                ds_audioStats: record.ds_audioStats ?? { state: 'absent' },
              } as VideoRecord)
              .then(() => cursor.continue().then(addDatasets));
          });
        }
        // v4 held a cache of datasets computed in this browser, which v7 removes
        // along with the browser compute that filled it. Dropped rather than
        // left behind: nothing reads it, and its rows are stamped with producers
        // that no longer exist, so they could never be served again anyway.
        // `contains` because v4 is where the store appeared - a library older
        // than that never had one.
        // Reached through the untyped handle because the name is deliberately
        // no longer in VideoDBSchema - a store only an upgrade still mentions.
        const untyped = db as unknown as IDBDatabase;
        if (oldVersion < 7 && untyped.objectStoreNames.contains('dataset_results')) {
          untyped.deleteObjectStore('dataset_results');
        }
      },
    });
  };
  private loadInitialVideos = async () => {
    try {
      const records = await this.getAllVideos();
      this.videoRecords.set(records);
      await this.backfillFileDurations(records);
      await this.backfillSpeechFeatures(records);
      await this.dropSpeakingRatio(records);
    } catch (error) {
      console.error('Failed to load initial videos into signal:', error);
    }
  };

  /**
   * Fills in video_file.duration_secs for files attached before that field
   * existed. Records stored under schema v3 read it back as undefined, and the
   * field is only written when a file is attached - so without this pass an
   * existing library would never show a file-derived duration until every file
   * was re-attached by hand. No schema version bump goes with it: the field is
   * additive and its absent case is already the same as its empty one.
   *
   * Deliberately a one-shot from the constructor rather than anything reactive.
   * It writes records back, which updates videoRecords(), so running it from an
   * effect subscribed to that signal would re-trigger itself on every write.
   *
   * Sequential rather than Promise.all: each read spins up a decoder over a
   * whole video file, and a library of them at once is worth avoiding for a
   * value nothing is waiting on.
   */
  private backfillFileDurations = async (records: VideoRecord[]): Promise<void> => {
    for (const record of records) {
      const { file, duration_secs } = record.video_file;
      if (!file || duration_secs != null) continue;
      try {
        const duration = await readFileDurationSecs(file);
        if (duration == null) continue;
        record.video_file.duration_secs = duration;
        await this.updateVideo(record);
      } catch (error) {
        console.error('Failed to read duration for', file.name, error);
      }
    }
  };

  /**
   * Fills in the two speech features for transcript stats computed before those
   * fields existed, and for any left null because no duration was known at the
   * time. Runs after backfillFileDurations above, so a duration that pass just
   * recovered is already available to this one.
   *
   * Additive like that pass, so no schema version bump: absent reads back as
   * undefined, which means the same thing here as the null it becomes.
   *
   * Unlike the duration backfill this decodes nothing - it reads a transcript
   * already in the record - so there is no reason to space the work out, but it
   * keeps the same one-shot-from-the-constructor shape for the same reason: it
   * writes records back, and an effect over videoRecords() would re-trigger
   * itself on every write.
   */
  private backfillSpeechFeatures = async (records: VideoRecord[]): Promise<void> => {
    for (const record of records) {
      const stats = record.ds_transcriptStats;
      if (!isReady(stats) || stats.data.speech_pace_variation != null) continue;
      if (!isReady(record.ds_transcript)) continue;

      const features = computeSpeechFeatures(record.ds_transcript.data, recordDurationSecs(record));
      if (features.speech_pace_variation == null) continue;

      stats.data = { ...stats.data, ...features };
      try {
        await this.updateVideo(record);
      } catch (error) {
        console.error('Failed to backfill speech features for', record.sort_name, error);
      }
    }
  };
  /**
   * Removes the transcript's speaking_ratio from records stored while it was
   * still computed. It was replaced by audio stats' speech_ratio, and left in
   * place it would keep riding along into every export. Same one-shot shape as
   * the backfills above, and like them no schema bump: nothing reads the field.
   */
  private dropSpeakingRatio = async (records: VideoRecord[]): Promise<void> => {
    for (const record of records) {
      const stats = record.ds_transcriptStats;
      if (!isReady(stats) || !('speaking_ratio' in stats.data)) continue;

      delete (stats.data as Partial<Record<'speaking_ratio', unknown>>).speaking_ratio;
      try {
        await this.updateVideo(record);
      } catch (error) {
        console.error('Failed to drop speaking ratio for', record.sort_name, error);
      }
    }
  };

  async addVideo(record: Omit<VideoRecord, '__id'>): Promise<number> {
    const db = await this.dbPromise;
    // Insert into IndexedDB
    const newId = (await db.add('videos', record as VideoRecord)) as number;

    // Fetch the newly inserted record with its generated ID and update the signal
    const insertedRecord = await this.getVideo(newId);
    if (insertedRecord) {
      this.videoRecords.update((records) => [...records, insertedRecord]);
    }

    return newId;
  }

  async getVideo(id: number): Promise<VideoRecord | undefined> {
    const db = await this.dbPromise;
    return db.get('videos', id);
  }

  async getAllVideos(): Promise<VideoRecord[]> {
    const db = await this.dbPromise;
    return db.getAll('videos');
  }

  async deleteVideo(id: number): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('videos', id);

    // Remove the deleted record from the signal reactively
    this.videoRecords.update((records) => records.filter((v) => v.__id !== id));
  }

  updateVideo = async (record: VideoRecord): Promise<number> => {
    if (!record.__id) {
      throw new Error('Cannot update a video record without an ID.');
    }

    const db = await this.dbPromise;

    // db.put updates the existing record with the same primary key
    const updatedId = (await db.put('videos', record)) as number;

    // Update the signal reactively so components re-render automatically
    this.videoRecords.update((records) =>
      records.map((v) => (v.__id === record.__id ? record : v)),
    );

    return updatedId;
  };
}
