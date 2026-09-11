export const PULSE_MS = 2_000;
export const LIFETIME_MS = 60_000;
export const INTERVAL_MS = 1_000;
export const SOURCE_INTERVAL_MS = 10_000;
export const API_INTERVAL_MS = 5_000;
export const API_SOURCE_INTERVAL_MS = 60_000;
export const DUPLICATE_INTERVAL_MS = 300_000;
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
