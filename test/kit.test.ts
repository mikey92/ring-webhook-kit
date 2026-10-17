import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Deduper, makeWebhook, parseWebhook, send, sign, verify } from "../src/index.ts";

const KEY = "test-key";

test("sign matches a known HMAC-SHA256 hex digest", () => {
  // printf '{"a":1}' | openssl dgst -sha256 -hmac test-key
  assert.equal(sign(KEY, '{"a":1}'), "sha256=486ecd1b18e77ef1945ee984d77f0882eaf31c75c94be6324b2c0472af9556e7");
  assert.match(sign(KEY, "x"), /^sha256=[0-9a-f]{64}$/);
});

test("verify accepts the exact bytes and rejects any change", () => {
  const body = JSON.stringify(makeWebhook("button_press", "dev1"));
  const sig = sign(KEY, body);
  assert.ok(verify(KEY, body, sig));
  assert.ok(verify(KEY, Buffer.from(body), sig.slice(7)), "the sha256= prefix is optional");
  assert.ok(!verify(KEY, body + " ", sig), "re-serialised or padded JSON fails");
  assert.ok(!verify("other", body, sig));
  assert.ok(!verify(KEY, body, undefined));
  assert.ok(!verify(KEY, body, "sha256=zz"));
});

test("makeWebhook: real-device ids by default, documented ids on request", () => {
  const real = makeWebhook("button_press", "dev1", { timestamp: 1000 });
  assert.equal(real.data.id, "dev1_ding_1000");
  assert.equal(makeWebhook("button_press", "dev1", { timestamp: 1000, idStyle: "docs" }).data.id, "dev1_button_press_1000");
  const m = makeWebhook("motion_detected", "dev1", { subType: "human", timestamp: 5 });
  assert.equal(m.data.id, "dev1_human_5");
  assert.equal(m.data.attributes.sub_type, "human");
  assert.equal(real.meta.version, "1.1");
});

test("parseWebhook checks the fields handlers use", () => {
  const ok = makeWebhook("device_offline", "dev1");
  assert.equal(parseWebhook(JSON.stringify(ok)).data.type, "device_offline");
  assert.throws(() => parseWebhook('{"meta":{}}'));
  assert.throws(() => parseWebhook("not json"));
});

test("Deduper: retries handled once, old events refused", () => {
  const d = new Deduper({ maxAgeMs: 60_000 });
  const h = makeWebhook("button_press", "dev1", { timestamp: 1_000_000 });
  assert.equal(d.check(h, 1_010_000), "new");
  assert.equal(d.check(h, 1_020_000), "duplicate");
  assert.equal(d.check(makeWebhook("button_press", "dev1", { timestamp: 1_000_000 }), 1_000_000 + 61_000), "stale");
});

test("send POSTs a body whose signature verifies", async (t) => {
  let seen = false;
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen = verify(KEY, Buffer.concat(chunks), req.headers["x-signature"] as string);
      res.writeHead(seen ? 200 : 401).end();
    });
  }).listen(0);
  t.after(() => srv.close());
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as { port: number }).port;
  assert.equal(await send(`http://127.0.0.1:${port}/hook`, KEY, makeWebhook("button_press", "dev1")), 200);
  assert.ok(seen);
});
