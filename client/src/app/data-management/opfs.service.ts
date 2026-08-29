import { Injectable, signal } from '@angular/core';
declare var cv: any;
export interface VideoItem {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string; // Object URL for playback
  createdAt: Date;
}

@Injectable({
  providedIn: 'root',
})
export class OpfsService {
  // Reactive signal tracking the video records
  videos = signal<VideoItem[]>([]);

  constructor() {
    this.loadStoredVideos();
  }

  // Helper to get the OPFS root directory
  private async getRootDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('videos', { create: true });
  }

  // CREATE: Save multiple videos to OPFS
  async uploadVideos(files: FileList | File[]): Promise<void> {
    const dirHandle = await this.getRootDir();

    // Convert FileList to an array and process them concurrently
    const uploadPromises = Array.from(files).map(async (file) => {
      const fileHandle = await dirHandle.getFileHandle(file.name, { create: true });

      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    });

    await Promise.all(uploadPromises);
    await this.loadStoredVideos();
  }

  // READ: Load all videos from OPFS into memory/signals
  async loadStoredVideos(): Promise<void> {
    try {
      const dirHandle = await this.getRootDir();
      const loadedVideos: VideoItem[] = [];

      for await (const [name, handle] of (dirHandle as any).entries()) {
        if (handle.kind === 'file') {
          const fileHandle = await dirHandle.getFileHandle(name);
          const file = await fileHandle.getFile();
          const url = URL.createObjectURL(file);

          loadedVideos.push({
            id: name,
            name: file.name,
            size: file.size,
            type: file.type,
            url: url,
            createdAt: new Date(file.lastModified),
          });
        }
      }
      this.videos.set(loadedVideos);
    } catch (error) {
      console.error('Failed to load videos from OPFS', error);
    }
  }

  // DELETE: Remove video from OPFS
  async deleteVideo(name: string): Promise<void> {
    const dirHandle = await this.getRootDir();
    await dirHandle.removeEntry(name);
    await this.loadStoredVideos();
  }
}
async function listOpfsFiles() {
  const dirHandle = await navigator.storage.getDirectory();
  for await (const [name, handle] of dirHandle.entries()) {
    console.log(`Found file: ${name}, Type: ${handle.kind}`);
  }
}

