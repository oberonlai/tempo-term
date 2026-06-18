interface BufferSnapshot {
  content: string;
  baseline: string;
}

/**
 * Whether an editor tab should re-read its file from disk when it (re)opens.
 *
 * Reading on every open lets external edits show up, but a buffer with unsaved
 * changes (content diverged from its baseline) must be kept so reopening the
 * tab never clobbers the user's work.
 */
export function shouldReloadFromDisk(buffer: BufferSnapshot | undefined): boolean {
  if (!buffer) {
    return true;
  }
  return buffer.content === buffer.baseline;
}
