import { Injectable, computed, signal } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { VideoRecord } from './VideoRecord';

/**
 * Shared row-selection state so the video table (which owns the checkboxes) and the
 * bulk-action panels in other tabs (Scan, Export, ...) can act on the same selection.
 *
 * `selection` itself is a plain mutable SelectionModel, not a signal, so a mutation made
 * from one component's event handler (e.g. the table's checkbox) only marks that
 * component's own view for refresh under Angular's zoneless change detection - sibling
 * tabs reading `selection` directly never get re-checked. `selectedCount`/`isEmpty` bridge
 * `selection.changed` into a signal so any template that reads them is tracked and
 * refreshed regardless of where the mutation happened.
 */
@Injectable({
  providedIn: 'root',
})
export class SelectionService {
  selection = new SelectionModel<VideoRecord>(true, []);

  private readonly tick = signal(0);

  constructor() {
    this.selection.changed.subscribe(() => this.tick.update((v) => v + 1));
  }

  readonly selectedCount = computed(() => {
    this.tick();
    return this.selection.selected.length;
  });

  readonly isEmpty = computed(() => this.selectedCount() === 0);
}
