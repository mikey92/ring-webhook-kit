#!/usr/bin/env node
// ring-webhook: send signed Ring webhooks to your endpoint, or run a local receiver that verifies them.
// The Ring Developer Playground can't send doorbell or motion webhooks, so this is how you exercise that path.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Deduper, makeWebhook, parseWebhook, send, sign, verify } from "./index.ts";

const USAGE = `ring-webhook — Ring Partner API webhook tools (key from RING_HMAC_KEY)

  ring-webhook send <url> <type> <device_id> [--sub-type human] [--doc-ids] [--at <ms>]
      type: button_press | motion_detected | device_online | device_offline
  ring-webhook listen [port]          verify and print webhooks (default 8787, POST any path)
  ring-webhook sign <file.json>       print the X-Signature for a body file
  ring-webhook verify <file.json> <signature>
`;

const key = process.env.RING_HMAC_KEY ?? "";
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i < 0 ? undefined : rest.splice(i, 2)[1];
};
const bool = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 && rest.splice(i, 1).length > 0;
};
const needKey = () => {
  if (!key) {
    console.error("Set RING_HMAC_KEY to your app's HMAC key (Ring Developer Console → app credentials).");
    process.exit(2);
  }
};

if (cmd === "send") {
  needKey();
  const subType = flag("--sub-type");
  const at = flag("--at");
  const docs = bool("--doc-ids");
  const [url, type, deviceId] = rest;
  if (!url || !type || !deviceId) {
    console.log(USAGE);
    process.exit(1);
  }
  const hook = makeWebhook(type, deviceId, { subType, timestamp: at ? Number(at) : undefined, idStyle: docs ? "docs" : "device" });
  const t0 = Date.now();
  const status = await send(url, key, hook);
  console.log(`${type} ${hook.data.id} → ${url}: HTTP ${status} (${Date.now() - t0} ms)`);
  process.exit(status >= 200 && status < 300 ? 0 : 1);
} else if (cmd === "listen") {
  needKey();
  const port = Number(rest[0] ?? 8787);
  const dedupe = new Deduper();
  createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const time = new Date().toLocaleTimeString();
      if (!verify(key, raw, req.headers["x-signature"] as string | undefined)) {
        console.log(`${time}  ✗ bad signature (${raw.length} bytes)`);
        return res.writeHead(401).end();
      }
      try {
        const hook = parseWebhook(raw);
        const a = hook.data.attributes;
        const verdict = dedupe.check(hook);
        console.log(`${time}  ✓ ${hook.data.type}${a.sub_type ? `/${a.sub_type}` : ""} from …${a.source.slice(-6)}  ${verdict}  lag ${Date.now() - a.timestamp} ms  id ${hook.data.id.slice(-30)}`);
        res.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"processed"}');
      } catch (e) {
        console.log(`${time}  ✗ ${(e as Error).message}`);
        res.writeHead(400).end();
      }
    });
  }).listen(port, () => console.log(`Listening on http://localhost:${port} — point a tunnel at it and set it as your app's webhook URL.`));
} else if (cmd === "sign") {
  needKey();
  console.log(sign(key, readFileSync(rest[0])));
} else if (cmd === "verify") {
  needKey();
  const ok = verify(key, readFileSync(rest[0]), rest[1]);
  console.log(ok ? "valid" : "INVALID");
  process.exit(ok ? 0 : 1);
} else {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}
