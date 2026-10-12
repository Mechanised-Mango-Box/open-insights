import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { routes } from './app.routes';
import { DatasetProvider } from './data-management/providers/dataset-provider';
import { RoutingDatasetProvider } from './data-management/providers/routing-dataset.provider';
import { provideLocalCompute } from './data-management/local-compute/provide-local-compute';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // The one place the app decides where dataset work happens. Everything that
    // computes a dataset asks for DatasetProvider; the routing provider picks
    // local or server per kind, so a call site never knows which it got.
    { provide: DatasetProvider, useExisting: RoutingDatasetProvider },
    provideLocalCompute(),
    // Material caps dialogs at 80vw, which on a phone wastes a fifth of a screen
    // the edit dialog needs. Spread over the defaults: the provided object replaces
    // them wholesale, so anything left out would come through undefined.
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { ...new MatDialogConfig(), maxWidth: 'calc(100vw - 32px)' },
    },
  ],
};
