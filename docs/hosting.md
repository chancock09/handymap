# Host HandyMap on Cloudflare

HandyMap follows the Workers pattern in `chris-net-infra` and `olivia-trivia`.
The intended public hostname is `handymap.gobbi.tech`.

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

## First deployment

1. Run `npm ci`, `npm run check`, and `npm run test:browser`.
2. Confirm that the Cloudflare account uses Workers Free.
3. Set the two deployment variables from the existing local credential files.
4. Run `npm run deploy`.
5. Confirm that the new hostname redirects to the existing Access login.
6. Add only `handymap.gobbi.tech` to the existing `public sites (bypass)` Access application.
7. Add the public Worker row to `chris-net-infra/sites.json` and update its README and runbook.
8. Set the two GitHub Actions secrets on `chancock09/handymap`.
9. Verify the public pages, API, and WebSocket from a browser without an Access session.

Workers creates the DNS record for its custom domain.
Do not replace an existing DNS record without first checking its owner and purpose.
The wildcard Access application protects the first deployment until the explicit public bypass exists.
Preserve all other Access destinations and policies.

Use this registry row:

```json
{
  "host": "handymap.gobbi.tech",
  "label": "HandyMap",
  "worker": "handymap",
  "repo": "handymap",
  "tier": "public"
}
```

The GitHub owner can set the secrets with these commands:

```sh
gh secret set CLOUDFLARE_API_TOKEN -R chancock09/handymap < ~/.config/gobbi/cf-workers-token
gh secret set CLOUDFLARE_ACCOUNT_ID -R chancock09/handymap < ~/.config/gobbi/cf-account-id
```

The active GitHub login configured both secrets for this deployment.
The workflow deploys only from `master` after all checks pass. Pull requests do not deploy.

## Verify a release

```sh
curl --fail --silent --show-error https://handymap.gobbi.tech/ > /dev/null
curl --fail --silent --show-error https://handymap.gobbi.tech/docs > /dev/null
curl -i -X OPTIONS https://handymap.gobbi.tech/api/pings \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST'
```

Require `200` for both pages without an Access redirect.
Require `204` and `Access-Control-Allow-Origin: *` for preflight.
Open two browser windows. Send one labelled release-check ping with the API example.
Confirm that both windows receive it and a new window receives its remaining lifetime.
A second request within one second must return `429` and `Retry-After`.
Confirm that the dot disappears 62 seconds after acceptance.

Run the infrastructure gate check for `handymap.gobbi.tech`.
The standard gate check verifies the page. Verify API preflight and WebSockets separately.

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

Static assets bypass Worker execution, so the map shell and API guide remain available when dynamic requests fail.
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

To stop public access, remove only this hostname from the public bypass application.
The existing wildcard Access rule then applies.
Update its registry tier to `private` and run the gate check.
Do not change the shared wildcard or the bypass destinations for other sites.

## Deployment record — 2026-09-10

The site is public at `https://handymap.gobbi.tech`.
The current Worker version is `6d46b9db-372b-41d8-882b-221ffdf6c3bd`.
The deployment uses the existing account and does not change its billing plan.
The available API tokens cannot read billing subscriptions; the infrastructure runbook records Workers Free.

Both GitHub Actions secrets are configured.
The Access bypass contains the exact HandyMap hostname.
All prior bypass destinations and policy IDs remain unchanged.
The registry update is in infrastructure pull request 9.

The public smoke check passes for the map, API guide, health endpoint, CORS preflight, and WebSocket snapshot.
The local suite passes 30 server tests and 10 browser tests.
The dependency audit reports no known vulnerabilities.

Two public browser windows received the release-check ping.
The next request returned `429`.
The dot and card expired after 62 seconds, and a refresh did not restore the ping.
The browser reported no page errors.
