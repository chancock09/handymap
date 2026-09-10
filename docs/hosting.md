# Host HandyMap on Cloudflare

HandyMap follows the Workers pattern in `chris-net-infra` and `olivia-trivia`.
The private hostname is `handymap.gobbi.tech`.

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
2. Run `npm run smoke` to verify private access before deployment.
3. Merge the checked pull request into `master`.
4. Confirm that the GitHub Actions deployment passes its checks.
5. Sign in through Cloudflare Access and open the map and API guide.

The repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
GitHub Actions checks changes before it deploys from `master`. Pull requests do not deploy.
The workflow checks the Access gate before and after deployment.
Workers owns the DNS record for its custom domain.

The `chris-net-infra` registry uses this row:

```json
{
  "host": "handymap.gobbi.tech",
  "label": "HandyMap",
  "worker": "handymap",
  "repo": "handymap",
  "tier": "private"
}
```

The wildcard Access application protects this hostname with the existing `chris-only` policy.
The public bypass application must not contain HandyMap.
Preserve the Access destinations and policies for other sites.
Keep `workers.dev` and preview URLs disabled to prevent alternate access.

Run `npm run smoke` to test anonymous requests without cookies or redirect following.
It requires the Access login redirect for the map, docs, assets, health, API POST, and WebSocket upgrade.
It requires `403` for anonymous preflight, as described in [Cloudflare’s CORS documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/).
Run `sh scripts/gate-check.sh handymap.gobbi.tech` in `chris-net-infra` to verify the registry entry.
These checks prove anonymous access is blocked. They do not prove an authenticated session works.

After login, use the form or the guide's JavaScript example from the hosted page.
The curl example uses the local development server, which has no Access gate.
Anonymous hosted API calls redirect to login. Cross-origin preflight requests receive `403`.
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

Keep the hostname private during rollback. Do not add it to the public bypass application.
Run the Access checks after rollback. Do not change policies for other sites.

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
