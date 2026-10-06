/**
 * An `onConnect` for a live stream that refreshes on every connect but the
 * first.
 *
 * The stream opens a moment after the page has asked for its data, so the
 * first connect has missed nothing; refreshing then asked for every list on
 * screen a second time and moved whatever had changed under the reader. A
 * connect after a drop is different — the frames sent meanwhile are gone, and
 * only a refetch brings their changes in.
 */
export function refreshOnReconnect(refresh: () => void): () => void {
  let connectedBefore = false;
  return () => {
    if (connectedBefore) refresh();
    connectedBefore = true;
  };
}
