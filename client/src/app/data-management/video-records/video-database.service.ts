import { Injectable, signal } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { VideoRecord } from './VideoRecord';
import { DatasetState, LOCAL_IMPORT } from './Dataset';

/** The pre-v3 stored shape, kept only so the upgrade can read it. */
type LegacyCacheable = {
  upload_state:
    | { is_local: false }
    | { is_local: true; server_side_state: 'ready' | 'failed' | 'in_progress' };
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
    return openDB<VideoDBSchema>('video-library-db', 3, {
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
            return cursor.update(record as VideoRecord).then(() => cursor.continue().then(migrate));
          });
        }
      },
    });
  };
  private loadInitialVideos = async () => {
    try {
      const records = await this.getAllVideos();
      this.videoRecords.set(records);
    } catch (error) {
      console.error('Failed to load initial videos into signal:', error);
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
    this.videoRecords.update((records) => records.map((v) => (v.__id === record.__id ? record : v)));

    return updatedId;
  };
}
