# HandyMap

[HandyMap](https://handymap.gobbi.tech) is a live world map for small, shared signals.
Anyone can open it, and anyone can send a ping with one JSON request or the form on the page.
A ping has a location, a title, a sentence, and an optional image URL.
It appears on every open map at once, pulses for two seconds, and disappears after 60 seconds.
There are no accounts, no history, and no archive. It is a small WebSocket demo.

## Use the map

Use **Full screen** on the map to expand it. Press Escape or **Exit full screen** to return.
Click the map to choose a location and open the story form directly.
The header shows how many other visitors are online. When no one else is online, it shows **0 others online**.
The count uses connected browsers. Tabs in one browser share a local identifier and count once when local storage is available.
Separate browsers count separately. The site clears the count when its live connection stops.
Use **Send a ping** to open the form and enter coordinates manually.
Select **Use my location** to ask the browser for your current location and open the story form.
If the browser cannot find your location, select a point on the map or enter coordinates.
The form keeps your draft when you close it. An accepted ping opens on the map.
The map fills the available screen. **Live feed** shows active pings in a horizontal ticker at the bottom.
Each ticker item shows the title and one line of the message, which has a 160-character limit.
Long previews end with an ellipsis. Select an item to read its full message.
The feed advances every five seconds when its items extend beyond the screen.
Use the arrows or swipe to browse. Use **Pause** to stop the feed.
The feed pauses during hover, keyboard use, and open cards or forms. It starts paused when reduced motion is enabled.
A count button opens pings whose map targets overlap. The map and feed remove each ping when it expires.
The form shows text limits, field errors, and the server's retry delay. It does not retry submissions automatically.

The site and API are public. Do not send anything private; everyone on the map sees it.

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
`expiresAt` is 60 seconds after `createdAt`.
The browser form uses `/api/browser-pings` with a shorter wait between pings.

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
The API supports Cross-Origin Resource Sharing (CORS) without credentials, so a script on any site can send a ping.

## Limits

One Durable Object controls the world map.
It accepts one valid ping every 1,000 milliseconds across all callers.
The browser form accepts one ping every 10 seconds from each source address.
The API accepts one ping every 5 seconds across API callers, and one every 60 seconds from each source address.
Both paths share the one-second map limit, source records, and daily cap.
A browser ping also starts the API wait for that address.
The browser route requires a matching `Origin`, `Sec-Fetch-Site: same-origin`, and `Sec-Fetch-Mode: cors`.
It rejects other requests with `403` and does not allow cross-origin access.
`/api/pings` always uses API limits. Headers and payload fields cannot change its limit.
Scripts can imitate browser headers. This distinction does not authenticate users or stop determined bots.
The Worker hashes the `CF-Connecting-IP` value; the room retains source hashes for up to 60 seconds, without raw addresses.
Requests without a client address share one source bucket.
Excess requests receive `429` with `Retry-After`; the server does not queue them.
Invalid requests and preflight requests do not consume the acceptance slot.

The map rejects the same title and message for five minutes across both paths and all source addresses.
The comparison normalizes Unicode with NFKC, converts text to lowercase, and collapses whitespace.
Changes to coordinates or image URLs do not bypass this check.
The room stores a SHA-256 hash for this check. Ping text still expires after 60 seconds.
A rejection returns `duplicate_content` with the remaining wait. Rejected requests do not extend the wait or consume a slot.
This check matches normalized text pairs; it does not detect all similar messages.

`wrangler.jsonc` sets these initial caps:

| Setting             | Default                                      |
| ------------------- | -------------------------------------------- |
| `MAX_PINGS_PER_DAY` | 10,000 accepted pings, reset at midnight UTC |
| `MAX_VIEWERS`       | 100 live WebSocket connections               |

Daily counts, acceptance times, source records, and duplicate hashes survive restarts and deployments.
Interval limits also apply across midnight.
The daily cap does not limit rejected requests or connection attempts.
Cloudflare counts those requests against its shared account quota.
Keep the account on Workers Free; service interruptions are acceptable when its quota runs out.
See [the deployment guide](docs/hosting.md) for operations and quota checks.

## Project structure

- `src/server/`: HTTP validation, the Worker router, and the shared Durable Object.
- `src/client/`: the world map, form, cards, styles, and API examples.
- `src/protocol.ts`: shared payload types and lifetimes.
- `index.html` and `docs/index.html`: the map page and API guide.
- `public/`: static headers, favicon, error page, and third-party notices.
- `test/`: Worker integration tests and browser tests.

Vite bundles TypeScript, D3 geographic tools, and World Atlas geometry.
The map uses D3's [Equal Earth projection](https://d3js.org/d3-geo/cylindrical#geoEqualEarth), which preserves relative area.
Country outlines, ping positions, and map selections use the same projection.
The map does not request external tiles, fonts, or scripts.
A browser loads an external image only when its card opens, without a referrer.
The image host receives that browser request. HandyMap does not fetch or store image bytes.

The Worker serves `/api/*`, `/ws`, and `/healthz`.
Cloudflare serves other paths as static assets without Worker execution.
The `/ws` connection first receives a `snapshot` with active pings, server time, and a `viewers` count that includes the current browser.
Clients can send a UUID in the `viewer` query parameter to share one identity across tabs.
The server assigns a separate identity to each connection without a valid UUID.
A `presence` event supplies `viewers` and `serverTime` when a connection opens or closes.
Each accepted ping produces a `ping` event with server time.
The client uses the server timestamps for expiry and replaces its state on reconnect.
WebSocket Hibernation keeps idle connections open without a running event loop.
A runtime auto-response handles `heartbeat` / `alive`; other client messages close the socket.

The Durable Object stores active payloads and rate counters in one transaction before broadcast.
Alarms remove expired payloads and duplicate hashes. They stop when neither remains.
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
The link check prevents accidental links to private infrastructure hostnames.
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
