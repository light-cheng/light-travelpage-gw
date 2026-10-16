# Gateway connection

Read this when you connect a `light-travelpage` AI page to a gateway on the owner's machine.

## Boundary

| Part | Owner |
| --- | --- |
| Page, AI switch, `ai-setup.mjs`, round trip, `.dev.vars` and Pages secrets | `light-travelpage` |
| Loopback check, Tunnel plan, public-address and auth checks | this package |
| Gateway install, its key, `cloudflared` login, DNS, Tunnel service | the owner |

This package never installs a gateway, never edits Cloudflare settings and never stores a key.

## Local preview

The local preview runs Pages Functions on the owner's machine, so it can reach `127.0.0.1`. `gw-check.mjs local`:

1. accepts only `127.0.0.1` (or another `127.x` address), `::1` or `localhost`;
2. reads `GET <base>/models` without a key and, when `AI_API_KEY` is set, with `Authorization: Bearer <key>`;
3. notes an open gateway (acceptable on loopback, but fix it before tunnel mode) and refuses a key the gateway rejects;
4. prints `ai-setup.mjs <project> --base-url <base> --target local`.

Use the gateway's real port. Nothing here assumes one.

## Deployed page through a named Tunnel

A deployed Pages Function runs on Cloudflare, not on the owner's machine. It reaches the gateway only through a public HTTPS hostname. The supported route is a Cloudflare named Tunnel on a domain the owner controls in Cloudflare.

`gw-check.mjs plan` prints the steps: `cloudflared tunnel login`, `tunnel create`, `tunnel route dns`, a `config.yml` and `tunnel run`. The ingress rule matches only the API path prefix (default `/v1`) and sends everything else to `http_status:404`. The owner runs each step. `light-wizard` can walk them through it.

`gw-check.mjs tunnel` then checks the public address:

1. it must be `https://`;
2. it must not be `trycloudflare.com` (quick tunnels change address and have no uptime promise) or a private or loopback address;
3. `GET <base>/models` without a key must be refused. If the list comes back, the check stops: anyone who finds the hostname could use the gateway;
4. the same request with `AI_API_KEY` must list models;
5. it prints `ai-setup.mjs <project> --base-url <base> --target pages --project-name <name>`.

Not supported: Cloudflare Workers VPC. It is in beta and Pages Functions cannot bind to it. Cloudflare Access in front of the Tunnel is also not used, because the public `light-travelpage` runtime sends only the content type and the gateway key, not Access service-token headers.

## What the checks prove

A passing check proves the address shape, that the gateway answers, and that it refuses requests without the key. It does not prove the model can call tools. `ai-setup.mjs` proves that with a real tool-call round trip before it writes anything.

## Availability

The deployed page's AI works only while the owner's machine, the gateway and `cloudflared` are running. When any of them stops, AI requests fail; the rest of the page keeps working. Install `cloudflared` as a service (`cloudflared service install`) and start the gateway at login when the owner wants AI to stay available. Test the failure case after deployment: stop the gateway and confirm the page reports the AI error and still serves the trip.

## Verify

1. `node --test scripts/tests/` passes.
2. Local: run a real gateway on loopback, then `gw-check.mjs local`, `ai-setup.mjs --target local`, `npm run preview`, and one real tool-created task.
3. Deployed: run the plan steps, `gw-check.mjs tunnel`, `ai-setup.mjs --target pages`, deploy, and one real tool-created task on the hosted page. Then stop the gateway and check the failure case.

Report each gate separately. A fake-fetch unit test is not a real gateway check.
