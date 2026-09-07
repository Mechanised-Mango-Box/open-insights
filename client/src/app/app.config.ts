import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { DatasetProvider } from './data-management/providers/dataset-provider';
import { ServerDatasetProvider } from './data-management/providers/server-dataset.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // The one place the app decides where dataset work happens. Everything that
    // computes a dataset asks for DatasetProvider, so swapping in a browser-local
    // implementation is a change here rather than at every call site.
    { provide: DatasetProvider, useExisting: ServerDatasetProvider },
  ],
};
