import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkLocal, checkTunnel, isPrivateAddress, probeGateway, tunnelPlan } from "../gw-check.mjs";

const script = fileURLToPath(new URL("../gw-check.mjs", import.meta.url));
const KEY = "synthetic-gateway-key-0123456789";
const models = { object: "list", data: [{ id: "model-a", object: "model" }, { id: "model-b", object: "model" }] };

// A fake gateway: whether it needs a key, and whether it answers at all.
function gateway({ auth = true, down = false, seen = [] } = {}) {
  return async (url, options) => {
    seen.push({ url, options });
    if (down) throw new Error("connect ECONNREFUSED");
    if (!url.endsWith("/models")) return new Response("not found", { status: 404 });
    const sent = options.headers.Authorization;
    if (auth && sent !== `Bearer ${KEY}`) return new Response("unauthorized", { status: 401 });
    return Response.json(models);
  };
}

test("probe reports an open list and a keyed list separately", async () => {
  const closed = await probeGateway("http://127.0.0.1:8317/v1", KEY, gateway());
  assert.equal(closed.openModels, null);
  assert.deepEqual(closed.keyedModels, ["model-a", "model-b"]);
  const open = await probeGateway("http://127.0.0.1:8317/v1", undefined, gateway({ auth: false }));
  assert.deepEqual(open.openModels, ["model-a", "model-b"]);
});

test("local mode accepts loopback and prints the local ai-setup command", async () => {
  const result = await checkLocal({ baseUrl: "http://127.0.0.1:8317/v1/", project: "my trip", apiKey: KEY, fetchImpl: gateway() });
  assert.deepEqual(result.models, ["model-a", "model-b"]);
  assert.match(result.next, /ai-setup\.mjs 'my trip' --base-url http:\/\/127\.0\.0\.1:8317\/v1 --target local$/);
  assert.ok(!result.next.includes(KEY));
});

test("local mode refuses a non-loopback address", async () => {
  await assert.rejects(checkLocal({ baseUrl: "http://192.168.1.5:8317/v1", fetchImpl: gateway() }), /loopback/);
});

test("local mode warns about an open gateway and refuses a wrong key", async () => {
  const open = await checkLocal({ baseUrl: "http://localhost:8317/v1", fetchImpl: gateway({ auth: false }) });
  assert.match(open.notes.join(" "), /without a key/);
  await assert.rejects(checkLocal({ baseUrl: "http://localhost:8317/v1", apiKey: "wrong", fetchImpl: gateway() }), /refused AI_API_KEY \(HTTP 401\)/);
});

test("local mode says when nothing answers", async () => {
  await assert.rejects(checkLocal({ baseUrl: "http://127.0.0.1:9/v1", fetchImpl: gateway({ down: true }) }), /does not answer.*ECONNREFUSED/);
});

test("tunnel mode passes only an authenticated HTTPS gateway on a named host", async () => {
  const seen = [];
  const result = await checkTunnel({ publicUrl: "https://ai.example.com/v1", projectName: "trip", apiKey: KEY, fetchImpl: gateway({ seen }) });
  assert.match(result.next, /--base-url https:\/\/ai\.example\.com\/v1 --target pages --project-name trip$/);
  assert.equal(seen[0].options.headers.Authorization, undefined);
  assert.equal(seen[0].options.redirect, "manual");
});

test("tunnel mode stops when the public gateway lists models without a key", async () => {
  await assert.rejects(checkTunnel({ publicUrl: "https://ai.example.com/v1", projectName: "trip", apiKey: KEY, fetchImpl: gateway({ auth: false }) }),
    /Enable gateway auth/);
});

test("tunnel mode refuses http, quick tunnels, private hosts and a missing key", async () => {
  const base = { projectName: "trip", apiKey: KEY, fetchImpl: gateway() };
  await assert.rejects(checkTunnel({ ...base, publicUrl: "http://ai.example.com/v1" }), /https/);
  await assert.rejects(checkTunnel({ ...base, publicUrl: "https://abc-def.trycloudflare.com/v1" }), /named Tunnel/);
  await assert.rejects(checkTunnel({ ...base, publicUrl: "https://10.0.0.4/v1" }), /private or loopback/);
  await assert.rejects(checkTunnel({ ...base, publicUrl: "https://user:pw@ai.example.com/v1" }), /credentials/);
  await assert.rejects(checkTunnel({ ...base, publicUrl: "https://ai.example.com/v1", apiKey: undefined }), /AI_API_KEY/);
  await assert.rejects(checkTunnel({ ...base, publicUrl: "https://ai.example.com/v1", projectName: undefined }), /project-name/);
});

test("private address detection covers the usual ranges and leaves public hosts alone", () => {
  for (const host of ["https://10.1.2.3", "https://172.20.0.1", "https://192.168.0.2", "https://169.254.1.1", "https://100.64.0.1", "https://[fd00::1]", "https://[::1]", "https://127.0.0.1"])
    assert.equal(isPrivateAddress(new URL(host)), true, host);
  for (const host of ["https://ai.example.com", "https://8.8.8.8", "https://172.32.0.1"])
    assert.equal(isPrivateAddress(new URL(host)), false, host);
});

test("plan exposes only the API path of the loopback service", () => {
  const plan = tunnelPlan({ hostname: "ai.example.com", service: "http://127.0.0.1:8317" });
  assert.match(plan, /cloudflared tunnel route dns travelpage-ai ai\.example\.com/);
  assert.match(plan, /path: \^\/v1\//);
  assert.match(plan, /service: http:\/\/127\.0\.0\.1:8317\n\s+- service: http_status:404/);
  assert.throws(() => tunnelPlan({ hostname: "x.trycloudflare.com", service: "http://127.0.0.1:8317" }), /own domain/);
  assert.throws(() => tunnelPlan({ hostname: "ai.example.com", service: "http://192.168.1.2:8317" }), /loopback/);
});

test("the CLI refuses a key on the command line", () => {
  const run = spawnSync(process.execPath, [script, "local", "--base-url", "http://127.0.0.1:8317/v1", "--api-key", KEY], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Do not pass the key/);
  assert.ok(!run.stderr.includes(KEY));
});

test("the CLI prints the plan without network access", () => {
  const run = spawnSync(process.execPath, [script, "plan", "--hostname", "ai.example.com", "--service", "http://127.0.0.1:8317"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /cloudflared tunnel create travelpage-ai/);
});
