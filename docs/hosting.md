# Host HandyMap on Cloudflare

HandyMap follows the Workers pattern in `chris-net-infra` and `olivia-trivia`.
The public hostname is `handymap.gobbi.tech`.

## Configuration

| Item                  | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Worker                | `handymap`                                            |
| Custom domain         | `handymap.gobbi.tech`                                 |
| Durable Object        | `MapRoom`, binding `MAP`, fixed name `world`          |
| Storage               | SQLite, migration `v1`                                |
| Production branch     | `master`                                              |
| Alternate Worker URLs | Disabled: `workers_dev: false`, `preview_urls: false` |
| Deployment secrets    | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`       |

Reuse the existing Workers deploy token from the infrastructure setup.
The Pages token cannot deploy this service.
Keep credentials outside this repository and public build output.

## Deploy and verify

1. Run `npm ci`, `npm run check`, and `npm run test:browser`.
2. Run `npm run smoke` to verify public access before deployment.
3. Merge the checked pull request into `master`.
4. Confirm that the GitHub Actions deployment passes its checks.
5. Open the map and API guide in a private browser window.

The repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
GitHub Actions checks changes before it deploys from `master`. Pull requests do not deploy.
The workflow checks public access before and after deployment.
Workers owns the DNS record for its custom domain.

The `chris-net-infra` registry uses this row:

```json
{
  "host": "handymap.gobbi.tech",
  "label": "HandyMap",
  "worker": "handymap",
  "repo": "handymap",
  "tier": "public"
}
```

The `public sites (bypass)` Access application lists this hostname, so the wildcard `chris-only` policy does not apply.
Remove the row from that application to make the site private again; the wildcard takes over at once.
Preserve the Access destinations and policies for other sites.
Keep `workers.dev` and preview URLs disabled so the custom domain is the only entry point.

Run `npm run smoke` to test anonymous requests without cookies or redirect following.
It requires `200` for the map, docs, assets, and health check, a `400` for an empty API POST, and CORS headers on preflight.
It fails when any of those requests redirects to the Access login.
Run `sh scripts/gate-check.sh handymap.gobbi.tech` in `chris-net-infra` to verify the registry entry.
The local tests check API behavior, shared updates, expiry, and the full-screen map.

## Quotas and operations

Keep the account on Workers Free. Free quota exhaustion returns errors instead of paid overage.
The account shares its quotas with other Workers, including Trivia.
The initial caps are 10,000 accepted pings per UTC day and 100 viewers.
Change these values in `wrangler.jsonc`, then deploy.
Invalid cap values fall back to the initial defaults.

Rejected requests, reconnects, and health checks still consume Worker quota.
The application cannot stop those requests from reaching the Worker.
A single caller can take each available acceptance slot; this API has no identity or fairness guarantee.
Do not raise caps to address repeated rejected requests.

Inspect the Cloudflare dashboard for Worker requests, errors, Durable Object requests, duration, and storage writes.
The application samples operational logs at 10 percent and disables invocation logs.
Application log entries contain only an event name and status code.
Never add payload logging for diagnosis.

Static assets bypass Worker execution and remain behind Access.
The map shell and API guide remain available to authorized viewers when dynamic requests fail.
Existing dots expire locally during an outage.
The client retries failed connections five times with increasing delays, then offers a manual reconnect.
At viewer capacity, it offers a manual reconnect immediately.
A `503` from the application includes `Retry-After: 60`.
Cloudflare can return a non-JSON error before the application runs.

Reference limits checked for this design:

- [Workers account limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Object free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Static asset limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

## Rollback

Use `npx wrangler deployments list` to identify the previous deployment.
Use `npx wrangler rollback VERSION_ID` to restore its code and assets.
Do not change the Durable Object binding, class, or fixed object name during rollback.
Those names locate the stored rate counters and active pings.
A rollback does not undo Durable Object data changes.

Run `npm run smoke` after rollback. Do not change Access policies for other sites.

## Access record — 2026-09-11

The site went public. `handymap.gobbi.tech` is a row in the `public sites (bypass)` application.
The registry marks HandyMap as public. The smoke check now requires open access.
The Durable Object marks new sessions with the public release identifier and closes older sessions on restart.

## Access record — 2026-09-10

The site uses `https://handymap.gobbi.tech` behind Cloudflare Access.
The public bypass no longer contains the HandyMap hostname.
The change preserved all other bypass destinations and policy IDs.
The Durable Object marks new sessions with the private release identifier.
It closes older sessions on restart before it can send another ping.
The infrastructure registry marks HandyMap as private.

The deployment uses the existing account and does not change its billing plan.
The available API tokens cannot read billing subscriptions; the infrastructure runbook records Workers Free.
Both GitHub Actions secrets are configured.
