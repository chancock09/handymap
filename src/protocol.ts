export const PULSE_MS = 2_000;
export const DOT_MS = 60_000;
export const LIFETIME_MS = PULSE_MS + DOT_MS;
export const INTERVAL_MS = 1_000;
export const BODY_LIMIT = 4_096;

export interface PingInput {
  latitude: number;
  longitude: number;
  title: string;
  message: string;
  imageUrl?: string;
}

export interface Ping extends PingInput {
  id: string;
  createdAt: number;
  expiresAt: number;
}

export type MapEvent =
  | { type: "snapshot"; pings: Ping[]; serverTime: number }
  | { type: "ping"; ping: Ping; serverTime: number };

export interface ApiError {
  error: { code: string; message: string; retryAfterMs?: number };
}
