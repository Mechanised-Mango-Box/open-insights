import { Injectable } from '@angular/core';

export interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(packageName: string): Promise<void>;
}

@Injectable({
  providedIn: 'root',
})
export class PyodideService {
  private pyodide?: PyodideInterface;
  private loading?: Promise<PyodideInterface>;

  async getPyodide(): Promise<PyodideInterface> {
    if (this.pyodide) {
      return this.pyodide;
    }

    if (!this.loading) {
      this.loading = this.load();
    }

    this.pyodide = await this.loading;
    return this.pyodide;
  }

  private async load(): Promise<PyodideInterface> {
    const version = '314.0.6';
    const indexURL =
      `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

    // Prevent Angular's bundler from analyzing the dynamic import.
    const dynamicImport = new Function(
      'url',
      'return import(url)'
    ) as (url: string) => Promise<any>;

    const pyodideModule = await dynamicImport(`${indexURL}pyodide.mjs`);

    return pyodideModule.loadPyodide({ indexURL });
  }
}
