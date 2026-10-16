#!/usr/bin/env node
// Check a self-hosted AI gateway before light-travelpage connects to it.
// This script reads and prints; it never writes a secret or changes a Host, a tunnel or DNS.
//
// usage: node gw-check.mjs local  --base-url <http://127.0.0.1:PORT/v1> [--project <dir>]
//        node gw-check.mjs tunnel --public-url <https://ai.example.com/v1> --project-name <pages-project> [--project <dir>]
//        node gw-check.mjs plan   --hostname <ai.example.com> --service <http://127.0.0.1:PORT> [--tunnel-name <name>] [--path <prefix>]
// The gateway key comes from AI_API_KEY, never from the command line.
import { pathToFileURL } from "node:url";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const QUICK_TUNNEL = /(^|\.)trycloudflare\.com$/i;
const AI_SETUP = "node <light-travelpage>/scripts/ai-setup.mjs";

export function parseUrl(text, flag) {
  let url;
  try { url = new URL(text); } catch { throw new Error(`${flag} is not a valid URL: ${text}`); }
  if (url.username || url.password) throw new Error(`${flag} must not carry credentials.`);
  if (url.search || url.hash) throw new Error(`${flag} must not carry a query or fragment.`);
  return url;
}

export function isLoopback(url) { return LOOPBACK.has(url.hostname.toLowerCase()) || /^127\./.test(url.hostname); }

/** Private, link-local and CGNAT IPv4 literals, plus IPv6 ULA and link-local. A public tunnel must not name one. */
export function isPrivateAddress(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) || host === "localhost";
}

function base(url) { return url.href.replace(/\/+$/, ""); }

async function listModels(baseUrl, headers, fetchImpl) {
  try {
    const response = await fetchImpl(`${baseUrl}/models`, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { status: response.status, models: null };
    const body = await response.json().catch(() => null);
    const models = Array.isArray(body?.data) ? body.data.map((item) => item?.id).filter((id) => typeof id === "string") : null;
    return { status: response.status, models };
  } catch (error) { return { status: 0, models: null, error: error.message }; }
}

/** Probe without a key (must be refused) and with the key (must list models). */
export async function probeGateway(baseUrl, apiKey, fetchImpl = fetch) {
  const open = await listModels(baseUrl, {}, fetchImpl);
  const keyed = apiKey ? await listModels(baseUrl, { Authorization: `Bearer ${apiKey}` }, fetchImpl) : null;
  return { reachable: open.status !== 0 || Boolean(keyed && keyed.status !== 0), openModels: open.models, keyedModels: keyed?.models ?? null,
    keyedStatus: keyed?.status ?? null, error: open.error };
}

function quote(value) { return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`; }

export async function checkLocal({ baseUrl, project = "<project>", apiKey, fetchImpl = fetch }) {
  const url = parseUrl(baseUrl, "--base-url");
  if (!isLoopback(url)) throw new Error("local mode needs a loopback address (127.0.0.1, ::1 or localhost). Use tunnel mode for anything else.");
  const result = await probeGateway(base(url), apiKey, fetchImpl);
  if (!result.reachable) throw new Error(`The gateway does not answer at ${base(url)}/models${result.error ? ` (${result.error})` : ""}. Start it and check the port.`);
  const notes = [];
  if (result.openModels) notes.push("The gateway lists models without a key. That is acceptable on loopback, but enable its key before tunnel mode.");
  if (apiKey && !result.keyedModels) throw new Error(`The gateway refused AI_API_KEY (HTTP ${result.keyedStatus}).`);
  if (!apiKey && !result.openModels) notes.push("The gateway needs a key. ai-setup.mjs will ask for it in a hidden prompt.");
  const models = result.keyedModels || result.openModels || [];
  return { ok: true, models, notes, next: `${AI_SETUP} ${quote(project)} --base-url ${quote(base(url))} --target local` };
}

export async function checkTunnel({ publicUrl, projectName, project = "<project>", apiKey, fetchImpl = fetch }) {
  const url = parseUrl(publicUrl, "--public-url");
  if (url.protocol !== "https:") throw new Error("tunnel mode needs an https:// address.");
  if (QUICK_TUNNEL.test(url.hostname)) throw new Error("Quick tunnels (trycloudflare.com) change address and have no uptime promise. Use a named Tunnel on your own domain.");
  if (isPrivateAddress(url)) throw new Error("The public address points at a private or loopback host. A deployed page cannot reach it.");
  if (!projectName) throw new Error("tunnel mode needs --project-name <pages-project>.");
  if (!apiKey) throw new Error("Set AI_API_KEY in this shell (for example with `read -rs AI_API_KEY; export AI_API_KEY`) so the check can prove the key works.");
  const result = await probeGateway(base(url), apiKey, fetchImpl);
  if (!result.reachable) throw new Error(`Nothing answers at ${base(url)}/models${result.error ? ` (${result.error})` : ""}. Check that the tunnel runs and DNS points at it.`);
  if (result.openModels) throw new Error("The gateway lists models without a key through the public address. Enable gateway auth before you connect a page.");
  if (!result.keyedModels) throw new Error(`The gateway refused AI_API_KEY through the tunnel (HTTP ${result.keyedStatus}).`);
  return { ok: true, models: result.keyedModels, notes: [],
    next: `${AI_SETUP} ${quote(project)} --base-url ${quote(base(url))} --target pages --project-name ${quote(projectName)}` };
}

/** The named-Tunnel steps a person runs. Ingress exposes only the API path of one local service. */
export function tunnelPlan({ hostname, service, tunnelName = "travelpage-ai", pathPrefix = "/v1" }) {
  if (!hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) throw new Error("plan needs --hostname, a DNS name on your own Cloudflare zone, such as ai.example.com.");
  if (QUICK_TUNNEL.test(hostname)) throw new Error("Use a hostname on your own domain, not trycloudflare.com.");
  const target = parseUrl(service || "", "--service");
  if (!isLoopback(target)) throw new Error("--service must be the gateway's loopback address, such as http://127.0.0.1:8317.");
  if (!/^\/[\w./-]*$/.test(pathPrefix)) throw new Error("--path must start with / and contain only path characters.");
  const prefix = pathPrefix.replace(/\/+$/, "");
  const name = quote(tunnelName);
  return [
    "Run these steps yourself. Each one changes your Cloudflare account or this machine.",
    "",
    "1. Sign in once: cloudflared tunnel login",
    `2. Create the tunnel: cloudflared tunnel create ${name}`,
    `3. Point DNS at it: cloudflared tunnel route dns ${name} ${hostname}`,
    "4. Write ~/.cloudflared/config.yml (use the credentials file path that step 2 printed):",
    "",
    `   tunnel: ${tunnelName}`,
    "   credentials-file: <path printed by step 2>",
    "   ingress:",
    `     - hostname: ${hostname}`,
    `       path: ^${prefix.replaceAll(".", "\\.")}/`,
    `       service: ${target.origin}`,
    "     - service: http_status:404",
    "",
    `5. Start it: cloudflared tunnel run ${name}`,
    "   To keep it running after reboot, install it as a service: cloudflared service install",
    `6. Check it: node gw-check.mjs tunnel --public-url https://${hostname}${prefix} --project-name <pages-project>`,
  ].join("\n");
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = { "--base-url": "baseUrl", "--public-url": "publicUrl", "--project-name": "projectName", "--project": "project",
    "--hostname": "hostname", "--service": "service", "--tunnel-name": "tunnelName", "--path": "pathPrefix" };
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    if (/^--api-key(=|$)/.test(rest[i])) throw new Error("Do not pass the key as an argument. Set AI_API_KEY in this shell instead.");
    if (flags[rest[i]] && i + 1 < rest.length) options[flags[rest[i]]] = rest[++i];
    else throw new Error(`Unknown argument: ${rest[i]}`);
  }
  return { mode, options };
}

async function main(argv) {
  const { mode, options } = parseArgs(argv);
  const apiKey = process.env.AI_API_KEY || undefined;
  if (mode === "plan") { console.log(tunnelPlan(options)); return; }
  let result;
  if (mode === "local") {
    if (!options.baseUrl) throw new Error("local mode needs --base-url.");
    result = await checkLocal({ ...options, apiKey });
  } else if (mode === "tunnel") {
    if (!options.publicUrl) throw new Error("tunnel mode needs --public-url.");
    result = await checkTunnel({ ...options, apiKey });
  } else throw new Error("usage: gw-check.mjs local|tunnel|plan … (see the file header)");
  console.log(`Gateway OK. Models: ${result.models.length ? result.models.join(", ") : "(list not shown)"}`);
  for (const note of result.notes) console.log(`Note: ${note}`);
  console.log(`Next, in your own terminal:\n  ${result.next}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
