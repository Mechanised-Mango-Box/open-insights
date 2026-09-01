import { Component, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ServerConfigService, DEFAULT_SERVER_URL } from './server-config.service';

@Component({
  selector: 'server-settings',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="server-settings">
      <h2>Dataset Server</h2>
      <p>Choose which dataset-server this browser talks to. Saved only in this browser.</p>
      <mat-form-field>
        <mat-label>Server URL</mat-label>
        <input matInput [value]="draftUrl()" (input)="onInput($event)" placeholder="http://localhost:5000" />
      </mat-form-field>
      <button mat-stroked-button type="button" (click)="useLocal()">Use Local</button>
      <button mat-raised-button color="primary" type="button" (click)="save()">Save</button>
      <p>Active: {{ serverConfig.serverUrl() }}</p>
    </div>
  `,
})
export class ServerSettingsComponent {
  serverConfig = inject(ServerConfigService);
  draftUrl = signal(this.serverConfig.serverUrl());

  onInput(event: Event): void {
    this.draftUrl.set((event.target as HTMLInputElement).value);
  }

  useLocal(): void {
    this.draftUrl.set(DEFAULT_SERVER_URL);
  }

  save(): void {
    this.serverConfig.setServerUrl(this.draftUrl());
  }
}
