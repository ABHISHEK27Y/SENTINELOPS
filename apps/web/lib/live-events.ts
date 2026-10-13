/** Reconnect live updates with bounded backoff; polling remains the fallback. */
export function subscribeLiveEvents(token: string, url: string, refresh: () => void): () => void {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (stopped || retry) return;
    retry = setTimeout(
      () => {
        retry = null;
        connect();
      },
      Math.min(1000 * 2 ** attempt++, 30_000)
    );
  };
  const connect = () => {
    if (stopped) return;
    try {
      socket = new WebSocket(url, ['sentinelops', token]);
      socket.onopen = () => {
        attempt = 0;
        refresh();
      };
      socket.onmessage = () => refresh();
      socket.onclose = event => {
        // Authentication rejection/expiry requires a fresh login, not a retry loop.
        if (event.code !== 1008) schedule();
      };
      socket.onerror = () => socket?.close();
    } catch {
      schedule();
    }
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  };
}
