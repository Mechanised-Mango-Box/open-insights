import { describe, expect, it } from 'vitest';
import { recommendationUrl } from './recommendation.service';

/**
 * The path only. The request itself is not covered: no spec in this repo mocks
 * HTTP, and standing that up for a route the server has not implemented would
 * pin down Angular's machinery rather than anything of ours.
 */
describe('recommendationUrl', () => {
  it('sits under the video it is about, like the dataset kinds do', () => {
    expect(recommendationUrl('https://example.test', 'abc123')).toBe(
      'https://example.test/api/videos/abc123/recommendation',
    );
  });

  it('does not mangle a server url carrying a port or a path', () => {
    expect(recommendationUrl('http://localhost:5000', 'deadbeef')).toBe(
      'http://localhost:5000/api/videos/deadbeef/recommendation',
    );
  });
});
