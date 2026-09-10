# HandyMap

[HandyMap](https://handymap.gobbi.tech) is a public world map for small, shared signals.
Send a location, title, sentence, and optional image URL with one JSON request.
The ping pulses for two seconds, then leaves a dot for another minute.

Read the [API guide](https://handymap.gobbi.tech/docs) for examples and error responses.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open the local URL that Wrangler prints. `npm run dev` builds the browser files and starts the local Worker.
Restart this command after browser changes. Wrangler reloads server changes automatically.
Local Durable Object data lives in `.wrangler/`.

## Send a ping

```sh
curl http://localhost:8787/api/pings \
  --header 'Content-Type: application/json' \
  --data '{"latitude":37.7749,"longitude":-122.4194,"title":"Hello from San Francisco","message":"We just shipped our first project."}'
```

The API returns `201` with the accepted payload, ID, and Unix timestamps in milliseconds.
`expiresAt` is 62 seconds after `createdAt`.
The browser form uses the same endpoint and limits.

| Field       | Requirement                                                       |
| ----------- | ----------------------------------------------------------------- |
| `latitude`  | JSON number from −90 to 90                                        |
| `longitude` | JSON number from −180 to 180                                      |
| `title`     | 1–80 Unicode code points after trim                               |
| `message`   | 1–160 Unicode code points after trim                              |
| `imageUrl`  | Optional HTTPS URL, at most 2,048 characters, without credentials |

The complete UTF-8 body must be at most 4 KiB.
The API ignores extra fields and returns only the supported fields.
Clients must use `Content-Type: application/json`.
Public browser requests use CORS without credentials.

## Limits

One Durable Object controls the world map.
It accepts one valid ping every 1,000 milliseconds across all callers.
Excess requests receive `429` with `Retry-After`; the server does not queue them.
Invalid requests and preflight requests do not consume the acceptance slot.

`wrangler.jsonc` sets these initial caps:

| Setting             | Default                                      |
| ------------------- | -------------------------------------------- |
| `MAX_PINGS_PER_DAY` | 10,000 accepted pings, reset at midnight UTC |
| `MAX_VIEWERS`       | 100 live WebSocket connections               |

Daily counts and the last acceptance time survive restarts and deployments.
The one-second limit also applies across midnight.
The daily cap does not limit rejected requests or connection attempts.
Cloudflare counts those requests against its shared account quota.
Keep the account on Workers Free; service interruptions are acceptable when its quota runs out.
See [the deployment guide](docs/hosting.md) for operations and quota checks.

## Project structure

- `src/server/`: HTTP validation, the Worker router, and the shared Durable Object.
- `src/client/`: the world map, form, cards, styles, and API examples.
- `src/protocol.ts`: shared payload types and lifetimes.
- `index.html` and `docs/index.html`: the map page and public API guide.
- `public/`: static headers, favicon, error page, and third-party notices.
- `test/`: Worker integration tests and browser tests.

Vite bundles TypeScript, D3 geographic tools, and World Atlas geometry.
The map does not request external tiles, fonts, or scripts.
A browser loads an external image only when its card opens, without a referrer.
The image host receives that browser request. HandyMap does not fetch or store image bytes.

The Worker serves `/api/*`, `/ws`, and `/healthz`.
Cloudflare serves other paths as static assets without Worker execution.
The `/ws` connection first receives a `snapshot` with active pings and server time.
Each accepted ping produces a `ping` event with server time.
The client uses the server timestamps for expiry and replaces its state on reconnect.
WebSocket Hibernation keeps idle connections open without a running event loop.
A runtime auto-response handles `heartbeat` / `alive`; other client messages close the socket.

The Durable Object stores active payloads and rate counters in one transaction before broadcast.
Alarms remove expired payloads and stop when no active pings remain.
Rate counters remain stored. There is no public history endpoint.
Cloudflare manages storage recovery copies; this is not a guarantee of immediate physical erasure.
Operational logs contain status codes, not submitted titles, sentences, or image URLs.

## Check changes

```sh
npm run check
npx playwright install chromium
npm run test:browser
npm audit
```

The server tests check races, time boundaries, validation, CORS, expiry, eviction, and connection caps.
Browser tests check shared updates, form results, cards, images, mobile layouts, and reduced motion.
The public link check prevents accidental links to private infrastructure hostnames.
GitHub Actions runs the checks before a production deployment from `master`.

The `sharp` override selects the patched `0.35.4` release for the local Cloudflare tools.
It addresses advisory GHSA-rgj7-g3m4-5g8c. The deployed Worker does not use image processing.

## Compatibility

Version 1 replaces the original Node server.
`POST /` and Socket.IO's `addBubble` event are no longer supported.
Use `POST /api/pings`; the server controls color and lifetime.
The map now covers the world instead of the United States.

## Attribution

Map geometry comes from [World Atlas](https://github.com/topojson/world-atlas), derived from [Natural Earth](https://www.naturalearthdata.com/).
See [third-party notices](public/third-party.txt) for the bundled packages.
