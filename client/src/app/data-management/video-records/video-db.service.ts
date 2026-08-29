// video-database.service.ts
import { Injectable } from '@angular/core';
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

  constructor() {
    this.dbPromise = this.initDB();
  }

  private async initDB() {
    return openDB<VideoDBSchema>('video-library-db', 1, {
      upgrade(db) {
        // Create an object store named 'videos' with an auto-incrementing primary key 'id'
        const store = db.createObjectStore('videos', {
          keyPath: 'id',
          autoIncrement: true,
        });

        // Optional: create indexes if you need to query records later
        store.createIndex('by_file_hash', 'file_hash', { unique: false });
      },
    });
  }

  // 3. Add a record (ID auto-increments automatically)
  async addVideo(record: Omit<VideoRecord, 'id'>): Promise<number> {
    const db = await this.dbPromise;
    // Cast to VideoRecord since id is optional on input but generated upon insertion
    return (await db.add('videos', record as VideoRecord)) as number;
  }

  // 4. Retrieve a record by its auto-incremented ID
  async getVideo(id: number): Promise<VideoRecord | undefined> {
    const db = await this.dbPromise;
    return db.get('videos', id);
  }

  // 5. Retrieve all records
  async getAllVideos(): Promise<VideoRecord[]> {
    const db = await this.dbPromise;
    return db.getAll('videos');
  }

  // 6. Delete a record
  async deleteVideo(id: number): Promise<void> {
    const db = await this.dbPromise;
    return db.delete('videos', id);
  }
}
