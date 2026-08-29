import { Injectable, signal } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

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
    return openDB<VideoDBSchema>('video-library-db', 1, {
      upgrade(db) {
        const store = db.createObjectStore('videos', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by_file_hash', 'file_hash', { unique: false });
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
    this.videoRecords.update((records) => records.filter((v) => v.id !== id));
  }

  updateVideo = async (record: VideoRecord): Promise<number> => {
    if (!record.id) {
      throw new Error('Cannot update a video record without an ID.');
    }

    const db = await this.dbPromise;

    // db.put updates the existing record with the same primary key 'id'
    const updatedId = (await db.put('videos', record)) as number;

    // Update the signal reactively so components re-render automatically
    this.videoRecords.update((records) => records.map((v) => (v.id === record.id ? record : v)));

    return updatedId;
  };
}
