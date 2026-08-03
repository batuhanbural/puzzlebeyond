export type RealtimePiece = {
  id: number;
  x: number;
  y: number;
  locked?: boolean;
};

export type RealtimePieceUpdate = {
  piece?: RealtimePiece;
  pieces?: RealtimePiece[];
  updatedAt: number;
};

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePiece(value: unknown): RealtimePiece | null {
  if (!isRecord(value)) return null;
  const id = Number(value.id);
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id, x, y, locked: Boolean(value.locked) };
}

function parseUpdate(value: unknown): RealtimePieceUpdate | null {
  if (!isRecord(value)) return null;
  const updatedAt = Number(value.updatedAt ?? value.updated_at);
  if (!Number.isFinite(updatedAt)) return null;
  if (Array.isArray(value.pieces)) {
    const pieces = value.pieces.map(parsePiece);
    if (pieces.some((piece) => piece === null)) return null;
    return { pieces: pieces as RealtimePiece[], updatedAt };
  }
  const piece = parsePiece(value.piece);
  return piece ? { piece, updatedAt } : null;
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
  onUpdate: (update: RealtimePieceUpdate) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return () => {};

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
    if (stopped || retryTimer !== null) return;
    const delay = retryDelay;
    retryDelay = Math.min(8000, retryDelay * 2);
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      openSocket();
    }, delay);
  };

  const openSocket = () => {
    if (stopped) return;
    onStatus?.("connecting");
    try {
      socket = new WebSocket(realtimeWebSocketUrl(config));
    } catch {
      onStatus?.("disconnected");
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
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

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: RealtimeMessage;
      try {
        message = JSON.parse(event.data) as RealtimeMessage;
      } catch {
        return;
      }
      if (message.event === "phx_reply") {
        const payload = isRecord(message.payload) ? message.payload : null;
        if (message.ref === joinRef && payload?.status === "ok") onStatus?.("connected");
        return;
      }
      if (message.event !== "broadcast" || !isRecord(message.payload)) return;
      const envelope = message.payload;
      if (envelope.event !== "piece-change") return;
      const update = parseUpdate(envelope.payload);
      if (update) onUpdate(update);
    };

    socket.onerror = () => {
      // close() drives one reconnect path and keeps transient errors quiet.
      try { socket?.close(); } catch { /* The browser may already have closed it. */ }
    };

    socket.onclose = () => {
      clearHeartbeat();
      socket = null;
      if (stopped) return;
      onStatus?.("disconnected");
      scheduleReconnect();
    };
  };

  openSocket();

  return () => {
    stopped = true;
    clearHeartbeat();
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    try { socket?.close(1000, "room left"); } catch { /* The socket may already be closed. */ }
    socket = null;
  };
}
