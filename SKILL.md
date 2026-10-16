---
name: light-travelpage-gw
description: Connect a light-travelpage AI page to a self-hosted AI gateway on the owner's machine, either on loopback for local preview or through a Cloudflare named Tunnel for the deployed page. Use only when the owner wants a local or self-hosted gateway (CLIProxyAPI, LiteLLM, one-api and similar), not for a public HTTPS API.
---

# Light-TravelPage Gateway

This is a model-invoked capability. `light-travelpage` calls it when the page owner wants AI through a gateway on their own machine. It checks the gateway and prepares the connection. The public `light-travelpage` package still writes the settings: its `ai-setup.mjs` stores the key and runs the tool-call round trip.

## Pick the mode

- **Local preview** (`npm run preview` on the same machine): the page reaches the gateway on a loopback address. No Tunnel is needed.
- **Deployed page** (Cloudflare Pages): a deployed page cannot reach loopback. The owner exposes only the gateway's API path through a Cloudflare named Tunnel on their own domain. Quick tunnels (`trycloudflare.com`) change address and are refused.

Ask which mode the owner wants when it is unclear. Do not choose deployment for them.

## Do it

1. Local preview: run `node <skill>/scripts/gw-check.mjs local --base-url <loopback-url> --project <dir>`.
2. Deployed page: run `node <skill>/scripts/gw-check.mjs plan --hostname <ai.their-domain> --service <loopback-origin>` and hand the printed steps to the owner, or to `light-wizard` for a guided walkthrough. Each step changes their Cloudflare account or machine, so the owner runs it. Then the owner runs `gw-check.mjs tunnel --public-url https://<host>/v1 --project-name <pages-project>` with `AI_API_KEY` set in their shell.
3. When the check passes, give the owner the `ai-setup.mjs` command it prints. The owner runs it in their own terminal.

The key never enters the conversation, a command argument or a shell line the Agent runs. `gw-check.mjs` reads it only from `AI_API_KEY` and never writes it.

Read [gateway.md](references/gateway.md) for what each check proves, the Tunnel layout, gateway auth and availability limits.

## Stop

Stop when `gw-check.mjs` passes and the owner has the `ai-setup.mjs` command, or when a check fails and the owner must fix the gateway, Tunnel or DNS. Return to `light-travelpage` for the build, preview and deployment.
