import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerConfigService } from '../server-config.service';
import { ServerDatasetProvider } from './server-dataset.provider';

const video = (name: string) => new File([new Uint8Array([1])], name);

describe('ServerDatasetProvider.putSource', () => {
  let provider: ServerDatasetProvider;
  let http: HttpTestingController;
  let uploadUrl: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    provider = TestBed.inject(ServerDatasetProvider);
    http = TestBed.inject(HttpTestingController);
    uploadUrl = `${TestBed.inject(ServerConfigService).serverUrl()}/api/videos`;
  });

  afterEach(() => http.verify());

  it('sends an accepted video', async () => {
    const upload = provider.putSource(video('lecture.mp4'));
    http
      .expectOne(uploadUrl)
      .flush({ file_hash: 'h', filename: 'h.mp4' }, { status: 201, statusText: 'Created' });
    await expect(upload).resolves.toBeUndefined();
  });

  it('refuses a type the server does not take without sending it', async () => {
    await expect(provider.putSource(video('lecture.m4v'))).rejects.toThrow(
      "'lecture.m4v' is not a video type the server accepts (.mp4, .mov, .mkv, .webm or .avi).",
    );
    http.expectNone(uploadUrl);
  });

  it("passes on the server's reason when it refuses the content", async () => {
    const upload = provider.putSource(video('notes.mp4'));
    http
      .expectOne(uploadUrl)
      .flush(
        { err: 'The file could not be read as a video: Invalid data found when processing input.' },
        { status: 415, statusText: 'Unsupported Media Type' },
      );
    await expect(upload).rejects.toThrow(
      "The server refused 'notes.mp4': The file could not be read as a video: Invalid data found when processing input.",
    );
  });

  it('leaves a server fault as it was', async () => {
    const upload = provider.putSource(video('lecture.mp4'));
    http
      .expectOne(uploadUrl)
      .flush(
        { err: 'Internal Server Error' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await expect(upload).rejects.toMatchObject({ status: 500 });
  });
});
