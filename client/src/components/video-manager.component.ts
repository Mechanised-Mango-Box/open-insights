import { Component, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpfsService, VideoItem } from '../services/opfs.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-video-manager',
  standalone: true,
  imports: [CommonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  templateUrl: './video-manager.component.html',
})
export class VideoManagerComponent {
  opfsService = inject(OpfsService);
  activeVideo: VideoItem | null = null;
  dataSource = new MatTableDataSource<VideoItem>([]);

  constructor() {
    // 3. THE FIX: Sync Signal to MatTableDataSource
    // This effect runs whenever the opfsService.videos() signal changes
    effect(() => {
      this.dataSource.data = this.opfsService.videos();
    });
  }

  async onFilesSelected(event: any) {
    const files: FileList = event.target.files;
    if (files && files.length > 0) {
      await this.opfsService.uploadVideos(files);
      event.target.value = ''; // Reset input so selecting the same files again triggers change
    }
  }

  playVideo(video: VideoItem) {
    this.activeVideo = video;
  }

  async deleteVideo(name: string) {
    if (confirm(`Are you sure you want to delete ${name} from OPFS?`)) {
      if (this.activeVideo?.name === name) {
        this.activeVideo = null;
      }
      await this.opfsService.deleteVideo(name);
    }
  }
  getSceneStats(names: string[]) {
    startSceneWW(names)
  }
  displayedColumns: string[] = ['name', 'size', 'type', 'createdAt', 'actions'];

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }
}

const startSceneWW = (names: string[]) => {
  console.log(`Starting WebWorker for ${names.length} items.`);

  if (window.Worker) {
    const w = new Worker(new URL('../workers/pyodide-scene-stats.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.postMessage(names);

    w.onmessage = (ev) => {
      console.log('Message received from worker' + ev.data);
    };
    
  } else {
    console.error('[ WebWorkers ] No supported.');
  }
};
