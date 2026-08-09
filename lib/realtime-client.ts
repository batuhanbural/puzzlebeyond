export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export type RealtimeSubscription = {
  unsubscribe: () => void;
};

type RealtimeConfig = {
  url: string;
  key: string;
};

type RealtimeMessage = {
  event?: string;
  payload?: unknown;
  topic?: string;
  ref?: string | null;
};

function normalizeMessage(value: unknown): RealtimeMessage | null {
  if (Array.isArray(value) && value.length >= 5) {
    return {
      ref: typeof value[1] === "string" ? value[1] : null,
      topic: typeof value[2] === "string" ? value[2] : undefined,
      event: typeof value[3] === "string" ? value[3] : undefined,
      payload: value[4],
    };
  }
  return isRecord(value) ? value as RealtimeMessage : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function realtimeWebSocketUrl(config: RealtimeConfig) {
  const projectUrl = new URL(config.url);
  const protocol = projectUrl.protocol === "http:" ? "ws:" : "wss:";
  const query = new URLSearchParams({ apikey: config.key, vsn: "1.0.0" });
  return `${protocol}//${projectUrl.host}/realtime/v1/websocket?${query.toString()}`;
}

/**
 * Subscribe to a public Supabase Realtime Broadcast channel without adding a
 * client SDK to the bundle. Polling remains the fallback when this channel
 * cannot be opened (for example before the public key is configured).
 */
export function subscribeToRoomRealtime(
  config: RealtimeConfig,
  roomCode: string,
  onUpdate: () => void,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeSubscription {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return { unsubscribe: () => {} };
  }

  const topic = `realtime:puzzlebeyond-room-${roomCode}`;
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let retryDelay = 1000;
  let nextRef = 0;
  let joinRef = "";

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const send = (event: string, payload: unknown, targetTopic = topic, ref?: string, joinReference?: string | null) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      topic: targetTopic,
      event,
      payload,
      ref: ref ?? String(++nextRef),
      join_ref: joinReference ?? (joinRef || null),
    }));
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null || document.visibilityState === "hidden" || navigator.onLine === false) return;
    const delay = retryDelay;
    retryDelay = Math.min(8000, retryDelay * 2);
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      openSocket();
    }, delay);
  };

  const openSocket = () => {
    if (stopped || document.visibilityState === "hidden" || navigator.onLine === false) return;
    onStatus?.("connecting");
    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(realtimeWebSocketUrl(config));
      socket = nextSocket;
    } catch {
      onStatus?.("disconnected");
      scheduleReconnect();
      return;
    }

    nextSocket.onopen = () => {
      if (stopped || socket !== nextSocket) return;
      retryDelay = 1000;
      joinRef = String(++nextRef);
      send("phx_join", {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
          private: false,
        },
      }, topic, joinRef, joinRef);
      clearHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        send("heartbeat", {}, "phoenix", String(++nextRef), null);
      }, 25_000);
    };

    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket || typeof event.data !== "string" || event.data.length > 256_000) return;
      let message: RealtimeMessage | null;
      try {
        message = normalizeMessage(JSON.parse(event.data));
      } catch {
        return;
      }
      if (!message) return;
      if (message.event === "phx_reply") {
        const payload = isRecord(message.payload) ? message.payload : null;
        if (message.ref === joinRef && payload?.status === "ok") {
          onStatus?.("connected");
        }
        return;
      }
      if (message.topic !== topic || message.event !== "broadcast" || !isRecord(message.payload)) return;
      const envelope = message.payload;
      if (envelope.event !== "piece-change") return;
      onUpdate();
    };

    nextSocket.onerror = () => {
      // close() drives one reconnect path and keeps transient errors quiet.
      try { nextSocket.close(); } catch { /* The browser may already have closed it. */ }
    };

    nextSocket.onclose = () => {
      if (socket !== nextSocket) return;
      clearHeartbeat();
      socket = null;
      if (stopped) return;
      onStatus?.("disconnected");
      scheduleReconnect();
    };
  };

  const suspendSocket = () => {
    clearHeartbeat();
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    try { socket?.close(1000, "page suspended"); } catch { /* The socket may already be closed. */ }
    socket = null;
  };

  const resumeSocket = () => {
    if (stopped || socket || retryTimer !== null || document.visibilityState === "hidden" || navigator.onLine === false) return;
    retryDelay = 1000;
    openSocket();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") suspendSocket();
    else resumeSocket();
  };

  const handleOffline = () => suspendSocket();
  const handleOnline = () => resumeSocket();

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);
  openSocket();

  return {
    unsubscribe: () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearHeartbeat();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
      try { socket?.close(1000, "room left"); } catch { /* The socket may already be closed. */ }
      socket = null;
    },
  };
}
