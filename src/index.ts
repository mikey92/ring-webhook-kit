// ring-webhook-kit: sign, verify, parse, build and send Ring Partner API webhooks (v1.1).
// Zero dependencies. Docs: https://developer.amazon.com/docs/ring/api-documentation.html

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type RingEventType = "button_press" | "motion_detected" | "device_online" | "device_offline" | (string & {});

/** A Ring webhook, v1.1. */
export interface RingWebhook {
  meta: { version: string; time: string; request_id: string; account_id: string };
  data: {
    id: string;
    type: RingEventType;
    attributes: { source: string; source_type: string; timestamp: number; sub_type?: string; component_ids?: string[] };
    relationships?: Record<string, unknown>;
  };
}

/** `X-Signature` value for a body: `sha256=` + hex HMAC-SHA256 over the raw bytes. */
export function sign(key: string, rawBody: string | Uint8Array): string {
  return "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex");
}

/**
 * Checks an `X-Signature` header against the raw body, in constant time.
 * Pass the bytes exactly as received: re-serialised JSON will not match.
 */
export function verify(key: string, rawBody: string | Uint8Array, header: string | null | undefined): boolean {
  if (!header) return false;
  const want = Buffer.from(sign(key, rawBody).slice(7), "hex");
  const got = Buffer.from(header.trim().replace(/^sha256=/i, ""), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Parses a verified body and checks the fields handlers rely on. Throws on anything else (answer 400; Ring does not retry 4xx). */
export function parseWebhook(rawBody: string | Uint8Array): RingWebhook {
  const p = JSON.parse(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8"));
  if (!p?.meta?.request_id || !p?.data?.type || !p?.data?.attributes?.source || typeof p.data.attributes.timestamp !== "number")
    throw new Error("not a Ring v1.1 webhook");
  return p as RingWebhook;
}

/**
 * Remembers request ids so a retried delivery is handled once, and refuses events whose own timestamp is
 * older than `maxAgeMs` (default 10 min) so a captured, correctly signed webhook can't be replayed later.
 * Raise `maxAgeMs` if you must accept retries that arrive later than that.
 */
export class Deduper {
  maxAgeMs: number;
  limit: number;
  private seen = new Map<string, number>();
  constructor(opts: { maxAgeMs?: number; limit?: number } = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? 10 * 60_000;
    this.limit = opts.limit ?? 10_000;
  }
  /** "new" to handle, "duplicate" to answer 200 and skip, "stale" to answer 200 and skip (or log). */
  check(hook: RingWebhook, now = Date.now()): "new" | "duplicate" | "stale" {
    if (now - hook.data.attributes.timestamp > this.maxAgeMs) return "stale";
    if (this.seen.has(hook.meta.request_id)) return "duplicate";
    this.seen.set(hook.meta.request_id, now);
    if (this.seen.size > this.limit) this.seen.delete(this.seen.keys().next().value!);
    return "new";
  }
}

// What real devices put in `data.id`. The docs show `<device>_button_press_<ts>`; a Battery Doorbell 2K sends `<device>_ding_<ts>`.
const REAL_TAG: Record<string, string> = { button_press: "ding", device_offline: "offline", device_online: "online" };
const DOC_TAG: Record<string, string> = { button_press: "button_press", device_offline: "offline", device_online: "online" };

export interface MakeOptions {
  subType?: string;
  timestamp?: number;
  accountId?: string;
  /** "device" (default) builds ids the way a real doorbell does; "docs" the way the documentation shows. */
  idStyle?: "device" | "docs";
}

/** Builds a v1.1 payload in the shape Ring sends. */
export function makeWebhook(type: RingEventType, deviceId: string, opts: MakeOptions = {}): RingWebhook {
  const ts = opts.timestamp ?? Date.now();
  const tags = opts.idStyle === "docs" ? DOC_TAG : REAL_TAG;
  const tag = type === "motion_detected" ? (opts.subType ?? "motion") : (tags[type] ?? type);
  return {
    meta: { version: "1.1", time: new Date().toISOString(), request_id: randomUUID(), account_id: opts.accountId ?? "ava1.ring.account.SIMULATED" },
    data: {
      id: `${deviceId}_${tag}_${ts}`,
      type,
      attributes: {
        source: deviceId,
        source_type: "devices",
        timestamp: ts,
        ...(type === "motion_detected" ? { sub_type: opts.subType ?? "motion" } : {}),
      },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}

/** Signs and POSTs one webhook. Resolves to the status your endpoint answered with. */
export async function send(url: string, key: string, hook: RingWebhook, fetchFn: typeof fetch = fetch): Promise<number> {
  const body = JSON.stringify(hook);
  const r = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": sign(key, body) }, body });
  return r.status;
}
