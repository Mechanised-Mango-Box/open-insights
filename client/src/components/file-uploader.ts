import { DecimalPipe } from '@angular/common';
import { Component } from '@angular/core';
// Added MatButtonModule so your buttons work
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'file-uploader', // Changed to standard 'app-' prefix
  template: `
    <mat-card style="max-width: 400px; margin: 20px auto;">
      <mat-card-header>
        <mat-card-title>File Upload</mat-card-title>
      </mat-card-header>

      <mat-card-content>
        <p>Select a file to save to browser storage.</p>

        <!-- Hidden input -->
        <input type="file" #fileInput (change)="onFileSelected($event)" style="display: none" />

        <button mat-raised-button color="primary" (click)="fileInput.click()">
          <mat-icon>attach_file</mat-icon>
          Choose File
        </button>

        <!-- THE NEW WAY: Built-in Control Flow -->
        @if (selectedFile) {
          <div style="margin-top: 15px;">
            <strong>Name:</strong> {{ selectedFile.name }} <br />
            <strong>Size:</strong> {{ selectedFile.size | number }} bytes
          </div>
        } @else {
          <p style="color: gray; font-size: 0.8rem;">No file selected</p>
        }
      </mat-card-content>

      <mat-card-actions>
        <button mat-button color="accent" (click)="saveToIndexedDB()" [disabled]="!selectedFile">
          Save to IndexedDB
        </button>
      </mat-card-actions>
    </mat-card>
  `,
  standalone: true, // Explicitly marking as standalone for clarity
  imports: [
    MatCard,
    MatCardContent,
    MatCardTitle,
    MatCardHeader,
    MatCardActions,
    MatButtonModule, // Required for mat-raised-button
    MatIcon,
    DecimalPipe,
  ],
})
export class FileUploader {
  // Renamed to follow standard naming
  selectedFile: File | null = null;

  onFileSelected(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;
    if (fileList && fileList.length > 0) {
      this.selectedFile = fileList[0];
      console.log('File selected:', this.selectedFile.name);
    }
  }

  saveToIndexedDB() {
    if (!this.selectedFile) return;

    const request = indexedDB.open('FileStorageDB', 1);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: any) => {
      const db = event.target.result;
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');

      // Store the file object directly
      store.put({
        id: 'user-file',
        file: this.selectedFile,
        timestamp: new Date(),
      });

      transaction.oncomplete = () => {
        alert('File saved to IndexedDB!');
      };
    };
  }
}
