import { Injectable, computed, inject } from '@angular/core';
import { ComputeConfigService } from '../compute-config.service';
import {
  DATASET_KINDS,
  DatasetKind,
  DatasetPayload,
  DatasetProvider,
  DatasetReady,
  DatasetStatusResponse,
  ProviderStatus,
  SourceResolver,
  SourceStatus,
} from './dataset-provider';
import { LocalDatasetProvider } from './local-dataset.provider';
import { ServerDatasetProvider } from './server-dataset.provider';

/**
 * Sends each kind to wherever it is configured to run.
 *
 * Routing is per kind rather than per app because the kinds move to the browser
 * one at a time: scene stats can be local while transcription is still on the
 * server, and each flips only once its results have been checked against the
 * server's. Without this the two stages would have to land together.
 */
@Injectable({
  providedIn: 'root',
})
export class RoutingDatasetProvider extends DatasetProvider {
  private config = inject(ComputeConfigService);
  private local = inject(LocalDatasetProvider);
  private server = inject(ServerDatasetProvider);

  /**
   * Where the work happens, for badges. Reads as one place while the kinds
   * agree, and names both while they are split - "this browser" on a row whose
   * transcript came from a server would be a lie.
   */
  readonly label = computed(() => {
    const labels = new Set(DATASET_KINDS.map((kind) => this.providerFor(kind).label()));
    return [...labels].join(' + ');
  });

  peek<K extends DatasetKind>(
    kind: K,
    hash: string,
  ): Promise<DatasetStatusResponse<DatasetPayload[K]>> {
    return this.providerFor(kind).peek(kind, hash);
  }

  request<K extends DatasetKind>(
    kind: K,
    hash: string,
    source: SourceResolver,
  ): Promise<DatasetReady<DatasetPayload[K]>> {
    return this.providerFor(kind).request(kind, hash, source);
  }

  /**
   * Whether the video's bytes are where they need to be.
   *
   * Not routed per kind, because it is not a per-kind question. While anything
   * still runs on the server the server's answer is the one that can block
   * work, so it wins; once nothing does, the local answer stands.
   */
  sourceStatus(hash: string): Promise<SourceStatus> {
    const usesServer = DATASET_KINDS.some((kind) => this.config.targetFor(kind) === 'server');
    return usesServer ? this.server.sourceStatus(hash) : this.local.sourceStatus();
  }

  putSource(file: File): Promise<void> {
    return this.server.putSource(file);
  }

  /** The server's queue is the one worth reporting while it still has work;
   * with everything local there is no server to ask. */
  status(): Promise<ProviderStatus> {
    const usesServer = DATASET_KINDS.some((kind) => this.config.targetFor(kind) === 'server');
    return usesServer ? this.server.status() : this.local.status();
  }

  private providerFor(kind: DatasetKind): DatasetProvider {
    return this.config.targetFor(kind) === 'local' ? this.local : this.server;
  }
}
