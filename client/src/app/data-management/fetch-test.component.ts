import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { calculateSha256 } from './video-records/VideoRecord';

const SERVER_URL = 'http://localhost:5000';

@Component({
  selector: 'fetch-test',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2>Fetch Test</h2>
    <form>
      <mat-form-field>
        <mat-label>File</mat-label>
        <button mat-stroked-button type="button" (click)="fileInput.click()">Choose File</button>
        <input hidden #fileInput type="file" (change)="onFileSelected($event)" />
        <input matInput readonly [value]="selectedFileName" placeholder="No file chosen" />
        <input matInput readonly [value]="selectedFileHash" placeholder="No file chosen" />
      </mat-form-field>

      <!-- Pass the specific route/action to the handler -->
      <button mat-raised-button color="primary" type="button" (click)="onHasVideo()">
        Has Video
      </button>
      <button mat-raised-button color="primary" type="button" (click)="onGetRecord()">
        Fetch Record
      </button>
      <button mat-raised-button color="primary" type="button" (click)="onUploadVideo()">
        Upload
      </button>
    </form>
  `,
})
export class FetchTestComponent {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);

  selectedFile: File | null = null;
  selectedFileName: string = '';
  selectedFileHash: string | null = null;

  onFileSelected = async (event: any) => {
    const file: File = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.selectedFileName = file.name;
      this.selectedFileHash = null; // Clear while waiting
      this.selectedFileHash = await calculateSha256(file);
    }
  };
  onGetRecord = () => {
    if (this.selectedFileHash == null) {
      console.log('No SHA256 provided');
      return;
    }
    const base = `${SERVER_URL}/api/videos/${this.selectedFileHash}`;

    this.http.get(`${base}/transcript`).subscribe({
      next: (response) => {
        console.log(`Transcript success!`, response);
      },
      error: (error) => {
        console.error(`Transcript failed:`, error);
      },
    });
    this.http.get(`${base}/scene_stats`).subscribe({
      next: (response) => {
        console.log(`Scene stats success!`, response);
      },
      error: (error) => {
        console.error(`Scene stats failed:`, error);
      },
    });
  };
  onHasVideo = () => {
    if (this.selectedFileHash == null) {
      console.log('No SHA256 provided');
      return;
    }

    const url = `${SERVER_URL}/api/videos/${this.selectedFileHash}`;

    this.http.get(url).subscribe({
      next: (response) => {
        console.log(`Success! `, response);
      },
      error: (error) => {
        console.error(`Failed: `, error);
      },
    });
  };
  onUploadVideo = () => {
    const url = SERVER_URL + '/api/videos';
    const formData = new FormData();

    if (this.selectedFile) {
      formData.append('file', this.selectedFile, this.selectedFile.name);
    }

    this.http.post(url, formData).subscribe({
      next: (response) => {
        console.log(`Success! `, response);
      },
      error: (error) => {
        console.error(`Failed: `, error);
      },
    });
  };
}
