import { Injectable, signal } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { VideoRecord } from './VideoRecord';

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
    return openDB<VideoDBSchema>('video-library-db', 2, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('videos', {
            keyPath: '__id',
            autoIncrement: true,
          });
          store.createIndex('by_file_hash', 'video_file.hash', { unique: false });
          return;
        }

        // v1 used keyPath 'id', which predates the VideoRecord.__id rename - recreate
        // the store under the corrected keyPath, carrying existing rows over.
        const oldStore = transaction.objectStore('videos');
        const existingRecords = (await oldStore.getAll()) as (VideoRecord & { id?: number })[];
        db.deleteObjectStore('videos');
        const store = db.createObjectStore('videos', {
          keyPath: '__id',
          autoIncrement: true,
        });
        store.createIndex('by_file_hash', 'video_file.hash', { unique: false });
        for (const { id, ...record } of existingRecords) {
          await store.add({ ...record, __id: record.__id ?? id } as VideoRecord);
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
  async addVideo(record: Omit<VideoRecord, 'id'>): Promise<number> {
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

    // db.put updates the existing record with the same primary key 'id'
    const updatedId = (await db.put('videos', record)) as number;

    // Update the signal reactively so components re-render automatically
    this.videoRecords.update((records) => records.map((v) => (v.__id === record.__id ? record : v)));

    return updatedId;
  };
}
