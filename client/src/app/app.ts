import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ViewManager } from '../components/view-manager';

@Component({
  imports: [RouterOutlet, MatSlideToggleModule, ViewManager],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('open-insights');
}
