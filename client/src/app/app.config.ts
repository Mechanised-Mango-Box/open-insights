import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { DatasetProvider } from './data-management/providers/dataset-provider';
import { RoutingDatasetProvider } from './data-management/providers/routing-dataset.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // The one place the app decides where dataset work happens. Everything that
    // computes a dataset asks for DatasetProvider; the routing provider picks
    // local or server per kind, so a call site never knows which it got.
    { provide: DatasetProvider, useExisting: RoutingDatasetProvider },
  ],
};
