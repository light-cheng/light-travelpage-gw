# light-travelpage-gw

Optional companion to [`light-travelpage`](https://github.com/light-cheng/skills/tree/main/skills/productivity/light-travelpage). It connects a travel page's AI to a gateway on the owner's own machine: on loopback for local preview, or through a Cloudflare named Tunnel for the deployed page.

```bash
npx skills add light-cheng/light-travelpage-gw
```

Start with [SKILL.md](SKILL.md). The details are in [references/gateway.md](references/gateway.md). The check script is `scripts/gw-check.mjs` (Node 20 or later, no dependencies); run its tests with `node --test scripts/tests/`.
