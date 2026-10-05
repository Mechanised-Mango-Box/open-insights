import { Component, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { ModelPageComponent } from './model-page.component';
import { RecommendationEngineComponent } from './recommendation-engine.component';

/** Which subpage was open, kept at module scope so leaving Recommend and coming
 * back lands where you were rather than back on the model list. */
const activeTab = signal(0);

/**
 * The Recommend step, in two subpages: choosing a model (and reading its card),
 * then choosing a video and reading what that model makes of it. Each subpage is
 * its own component; the model choice they share lives in ModelSelectionService.
 */
@Component({
  selector: 'recommend-page',
  standalone: true,
  imports: [MatTabsModule, ModelPageComponent, RecommendationEngineComponent],
  template: `
    <mat-tab-group
      [selectedIndex]="tab()"
      (selectedIndexChange)="tab.set($event)"
      animationDuration="0ms"
      mat-stretch-tabs="false"
    >
      <mat-tab label="Model">
        <div class="subpage">
          <recommend-model-page (next)="tab.set(1)" />
        </div>
      </mat-tab>
      <mat-tab label="Video and Results">
        <div class="subpage">
          <recommendation-engine (changeModel)="tab.set(0)" />
        </div>
      </mat-tab>
    </mat-tab-group>
  `,
  styles: [
    `
      .subpage {
        padding-top: 24px;
      }
    `,
  ],
})
export class RecommendPageComponent {
  protected tab = activeTab;
}
