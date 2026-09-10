export const PULSE_MS = 2_000;
export const LIFETIME_MS = 60_000;
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
  | { type: "snapshot"; pings: Ping[]; serverTime: number; viewers: number }
  | { type: "presence"; viewers: number; serverTime: number }
  | { type: "ping"; ping: Ping; serverTime: number };

export interface ApiError {
  error: { code: string; message: string; retryAfterMs?: number };
}
