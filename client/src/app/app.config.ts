import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { routes } from './app.routes';
import { DatasetProvider } from './data-management/providers/dataset-provider';
import { ServerDatasetProvider } from './data-management/providers/server-dataset.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // The one place the app decides where dataset work happens. Everything that
    // computes a dataset asks for DatasetProvider, so a call site never knows
    // which implementation it got - which is what kept the indirection worth
    // having while a browser-side one existed alongside this.
    { provide: DatasetProvider, useExisting: ServerDatasetProvider },
    // Material caps dialogs at 80vw, which on a phone wastes a fifth of a screen
    // the edit dialog needs. Spread over the defaults: the provided object replaces
    // them wholesale, so anything left out would come through undefined.
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { ...new MatDialogConfig(), maxWidth: 'calc(100vw - 32px)' },
    },
  ],
};
