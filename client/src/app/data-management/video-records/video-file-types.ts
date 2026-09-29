/**
 * The video files the server takes: ALLOWED_EXTENSIONS in server/config.py.
 *
 * The server also checks what is inside (server/video_files.py) - that the file really
 * is a video, in the container its name says. A browser cannot do that for .mkv or
 * .avi, so this is the name check only. It stops a file the server would refuse from
 * being imported, hashed and stored, only to fail when it is uploaded.
 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi'] as const;

/**
 * For an `<input type="file">`'s `accept`. Extensions rather than `video/*`, which
 * offers .wmv, .flv, .m4v and more, none of which the server takes.
 */
export const VIDEO_FILE_ACCEPT = VIDEO_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/** ".mp4, .mov, .mkv, .webm or .avi", for messages. */
export const VIDEO_EXTENSIONS_LABEL =
  VIDEO_EXTENSIONS.slice(0, -1)
    .map((ext) => `.${ext}`)
    .join(', ') + ` or .${VIDEO_EXTENSIONS[VIDEO_EXTENSIONS.length - 1]}`;

/** Whether the server would take a file by this name. Parsed as the server parses
 * it: whatever follows the last dot, in any case. */
export const isAcceptedVideoName = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
};

export const notAcceptedMessage = (name: string): string =>
  `'${name}' is not a video type the server accepts (${VIDEO_EXTENSIONS_LABEL}).`;
