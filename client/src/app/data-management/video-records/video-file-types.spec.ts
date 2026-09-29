import { describe, expect, it } from 'vitest';
import { isAcceptedVideoName, VIDEO_EXTENSIONS_LABEL, VIDEO_FILE_ACCEPT } from './video-file-types';

describe('isAcceptedVideoName, parsed as server/config.py video_extension() parses', () => {
  it('takes the five containers the server takes, in any case', () => {
    for (const name of ['a.mp4', 'a.mov', 'a.mkv', 'a.webm', 'a.avi', 'LECTURE.MP4']) {
      expect(isAcceptedVideoName(name)).toBe(true);
    }
  });

  it('goes by the last dot only', () => {
    expect(isAcceptedVideoName('week1.mp4.part')).toBe(false);
    expect(isAcceptedVideoName('week1.final.mkv')).toBe(true);
  });

  it('refuses other video types a video/* picker would have offered', () => {
    for (const name of ['a.m4v', 'a.wmv', 'a.flv', 'a.ts', 'a.3gp']) {
      expect(isAcceptedVideoName(name)).toBe(false);
    }
  });

  it('refuses a name with no extension', () => {
    expect(isAcceptedVideoName('mp4')).toBe(false);
    expect(isAcceptedVideoName('')).toBe(false);
  });

  it("accepts a name that is only an extension, as the server's rsplit does", () => {
    expect(isAcceptedVideoName('.mp4')).toBe(true);
  });
});

describe('the picker filter and the message', () => {
  it('lists the same extensions', () => {
    expect(VIDEO_FILE_ACCEPT).toBe('.mp4,.mov,.mkv,.webm,.avi');
    expect(VIDEO_EXTENSIONS_LABEL).toBe('.mp4, .mov, .mkv, .webm or .avi');
  });
});
