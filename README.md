# ring-webhook-kit

Sign, verify, parse, simulate and receive **Ring Partner API webhooks** (v1.1). Zero dependencies, Node 22.18+.

The Ring Developer Playground can't send doorbell or motion webhooks, so until you have a real device linked there's no way to exercise your webhook handler. This kit sends correctly signed, correctly shaped events to your endpoint, and gives you a local receiver to check what Ring (or this kit) is sending.

Pulled out of [DoorPass](https://github.com/mikey92/doorpass), where it was checked against a real Ring Battery Doorbell 2K.

## CLI

```sh
export RING_HMAC_KEY=...   # your app's HMAC key from the Ring Developer Console

# Send a doorbell press to your handler
npx github:mikey92/ring-webhook-kit send https://your.app/webhooks/ring button_press ava1.ring.device.XXXX

# Person motion, or the id format the docs show instead of the one devices send
ring-webhook send http://localhost:3000/hook motion_detected ava1.ring.device.XXXX --sub-type human
ring-webhook send http://localhost:3000/hook button_press ava1.ring.device.XXXX --doc-ids

# Receive and verify (point a tunnel at it and set it as your app's webhook URL)
ring-webhook listen 8787
#  12:53:17 PM  ✓ button_press from …123456  new  lag 1402 ms  id …_ding_1792264762146
#  12:53:17 PM  ✗ bad signature (355 bytes)

# Check a captured body
ring-webhook sign samples/button_press.json
ring-webhook verify body.json "sha256=..."
```

## Library

`npm i github:mikey92/ring-webhook-kit`

```ts
import { verify, parseWebhook, Deduper } from "ring-webhook-kit";

const dedupe = new Deduper(); // request_id dedupe + refuses events older than 10 min

// raw = the request body bytes exactly as received
if (!verify(process.env.RING_HMAC_KEY!, raw, req.headers["x-signature"])) return res.status(401).end();
const hook = parseWebhook(raw); // throws on anything that isn't v1.1 → answer 400 (Ring doesn't retry 4xx)
res.status(200).end();          // answer fast, then work
if (dedupe.check(hook) !== "new") return;
if (hook.data.type === "button_press") { /* someone is at the door */ }
```

`makeWebhook(type, deviceId, opts)` and `send(url, key, hook)` build and deliver events from your own tests.

## Things the docs don't tell you

Found while building against a real doorbell:

- **`data.id` on a real doorbell is `<device>_ding_<timestamp>`**, not `<device>_button_press_<timestamp>` as documented. `data.type` is still `button_press`. Branch on `data.type`; treat `data.id` as opaque. This kit sends the real format by default (`--doc-ids` for the documented one).
- **Verify the raw bytes.** `X-Signature: sha256=<hex>` is HMAC-SHA256 over the body as sent. Parsing and re-serialising the JSON first will fail verification.
- **Retries reuse `meta.request_id`**: dedupe on it, not on `data.id`.
- **A signed webhook stays valid forever.** Nothing in the signature binds it to a time, so a captured request can be replayed. `Deduper` refuses events whose own timestamp is older than `maxAgeMs`.
- A press reached our endpoint about **1.4 s** after Ring's event timestamp.

## Samples

`samples/` has a doorbell press, a person-motion event and a device-offline event in the shape a real device sends (device id replaced).

## License

MIT
