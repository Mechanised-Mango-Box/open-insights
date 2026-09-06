import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatDividerModule, MatDivider } from '@angular/material/divider';
import { VideoRecord } from './VideoRecord';
import {
  computeMergePreview,
  resolveMerge,
  MergeFieldKey,
  MergeOption,
  MergePreview,
} from './merge-videos';

@Component({
  selector: 'app-merge-videos-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatRadioModule, MatDividerModule, MatDivider],
  templateUrl: './merge-videos-dialog.component.html',
})
export class MergeVideosDialogComponent {
  readonly dialogRef = inject(MatDialogRef<MergeVideosDialogComponent>);
  readonly data = inject<VideoRecord[]>(MAT_DIALOG_DATA);

  readonly preview: MergePreview = computeMergePreview(this.data);

  readonly choices = signal<Partial<Record<MergeFieldKey, unknown>>>(
    Object.fromEntries(this.preview.conflicts.map((conflict) => [conflict.key, conflict.options[0].value])),
  );

  isSelected(key: MergeFieldKey, option: MergeOption): boolean {
    return this.choices()[key] === option.value;
  }

  select(key: MergeFieldKey, option: MergeOption): void {
    this.choices.update((current) => ({ ...current, [key]: option.value }));
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onMerge(): void {
    this.dialogRef.close(resolveMerge(this.preview, this.choices()));
  }
}
