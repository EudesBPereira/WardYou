import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export type RealtimeHandlers = Record<string, (payload: unknown) => void>;

/**
 * Connect to the backend Socket.IO server. The access token is sent in the
 * handshake; the server joins the user to their personal + family rooms and
 * pushes events (parental, zones, sos). Reconnects automatically.
 */
export function connectRealtime(baseUrl: string, token: string, handlers: RealtimeHandlers): Socket {
  disconnectRealtime();
  socket = io(baseUrl, {
    path: "/realtime",
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
  });
  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
  return socket;
}

export function disconnectRealtime() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isRealtimeConnected(): boolean {
  return socket?.connected ?? false;
}
