import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
export function sign(key, rawBody) {
    return "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex");
}
export function verify(key, rawBody, header) {
    if (!header) return false;
    const want = Buffer.from(sign(key, rawBody).slice(7), "hex");
    const got = Buffer.from(header.trim().replace(/^sha256=/i, ""), "hex");
    return got.length === want.length && timingSafeEqual(got, want);
}
export function parseWebhook(rawBody) {
    const p = JSON.parse(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8"));
    if (!p?.meta?.request_id || !p?.data?.type || !p?.data?.attributes?.source || typeof p.data.attributes.timestamp !== "number") throw new Error("not a Ring v1.1 webhook");
    return p;
}
export class Deduper {
    maxAgeMs;
    limit;
    seen = new Map();
    constructor(opts = {}){
        this.maxAgeMs = opts.maxAgeMs ?? 10 * 60_000;
        this.limit = opts.limit ?? 10_000;
    }
    check(hook, now = Date.now()) {
        if (now - hook.data.attributes.timestamp > this.maxAgeMs) return "stale";
        if (this.seen.has(hook.meta.request_id)) return "duplicate";
        this.seen.set(hook.meta.request_id, now);
        if (this.seen.size > this.limit) this.seen.delete(this.seen.keys().next().value);
        return "new";
    }
}
const REAL_TAG = {
    button_press: "ding",
    device_offline: "offline",
    device_online: "online"
};
const DOC_TAG = {
    button_press: "button_press",
    device_offline: "offline",
    device_online: "online"
};
export function makeWebhook(type, deviceId, opts = {}) {
    const ts = opts.timestamp ?? Date.now();
    const tags = opts.idStyle === "docs" ? DOC_TAG : REAL_TAG;
    const tag = type === "motion_detected" ? opts.subType ?? "motion" : tags[type] ?? type;
    return {
        meta: {
            version: "1.1",
            time: new Date().toISOString(),
            request_id: randomUUID(),
            account_id: opts.accountId ?? "ava1.ring.account.SIMULATED"
        },
        data: {
            id: `${deviceId}_${tag}_${ts}`,
            type,
            attributes: {
                source: deviceId,
                source_type: "devices",
                timestamp: ts,
                ...type === "motion_detected" ? {
                    sub_type: opts.subType ?? "motion"
                } : {}
            },
            relationships: {
                devices: {
                    links: {
                        self: `/v1/devices/${deviceId}`
                    }
                }
            }
        }
    };
}
export async function send(url, key, hook, fetchFn = fetch) {
    const body = JSON.stringify(hook);
    const r = await fetchFn(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Signature": sign(key, body)
        },
        body
    });
    return r.status;
}
