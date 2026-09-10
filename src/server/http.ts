import { BODY_LIMIT, type PingInput } from "../protocol";

export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function error(
  status: number,
  code: string,
  message: string,
  retryAfterMs?: number,
) {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
    },
    {
      status,
      headers:
        retryAfterMs === undefined
          ? {}
          : {
              "Retry-After": String(
                Math.max(1, Math.ceil(retryAfterMs / 1_000)),
              ),
            },
    },
  );
}

export function cors(response: Response) {
  const result = new Response(response.body, response);
  result.headers.set("Access-Control-Allow-Origin", "*");
  result.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  result.headers.set("Access-Control-Allow-Headers", "Content-Type");
  result.headers.set("Access-Control-Expose-Headers", "Retry-After");
  result.headers.set("Access-Control-Max-Age", "86400");
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

export async function readInput(request: Request): Promise<PingInput> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new RequestError(
      415,
      "unsupported_media_type",
      "Use Content-Type: application/json.",
    );
  }
  const tooLarge = () =>
    new RequestError(
      413,
      "payload_too_large",
      "The request body must be 4 KiB or smaller.",
    );
  if (Number(request.headers.get("Content-Length")) > BODY_LIMIT)
    throw tooLarge();
  if (!request.body)
    throw new RequestError(400, "invalid_json", "Send a JSON object.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let input: unknown;
  try {
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new RequestError(400, "invalid_json", "Send valid UTF-8 JSON.");
  }
  return validateInput(input);
}

export function validateInput(input: unknown): PingInput {
  const invalid = (message: string): never => {
    throw new RequestError(400, "invalid_payload", message);
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("Send a JSON object.");
  const data = input as Record<string, unknown>;
  for (const [field, bound] of [
    ["latitude", 90],
    ["longitude", 180],
  ] as const) {
    if (
      typeof data[field] !== "number" ||
      !Number.isFinite(data[field]) ||
      Math.abs(data[field]) > bound
    ) {
      return invalid(`${field} must be a number from ${-bound} to ${bound}.`);
    }
  }
  const text = (field: string, max: number) => {
    if (typeof data[field] !== "string")
      return invalid(`${field} must be text.`);
    const value = data[field].trim();
    if (!value || [...value].length > max)
      return invalid(`${field} must contain 1–${max} characters.`);
    return value;
  };
  const result: PingInput = {
    latitude: data.latitude as number,
    longitude: data.longitude as number,
    title: text("title", 80),
    message: text("message", 160),
  };
  if (data.imageUrl !== undefined) {
    if (typeof data.imageUrl !== "string" || data.imageUrl.length > 2048)
      return invalid(
        "imageUrl must be an HTTPS URL of 2,048 characters or fewer.",
      );
    try {
      const url = new URL(data.imageUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        return invalid("imageUrl must use HTTPS without credentials.");
      result.imageUrl = url.href;
      if (result.imageUrl.length > 2048)
        return invalid("imageUrl must contain 2,048 characters or fewer.");
    } catch (cause) {
      if (cause instanceof RequestError) throw cause;
      return invalid("imageUrl must be a valid HTTPS URL.");
    }
  }
  return result;
}
