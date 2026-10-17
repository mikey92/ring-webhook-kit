export type RingEventType = "button_press" | "motion_detected" | "device_online" | "device_offline" | (string & {});
export interface RingWebhook {
  meta: { version: string; time: string; request_id: string; account_id: string };
  data: {
    id: string;
    type: RingEventType;
    attributes: { source: string; source_type: string; timestamp: number; sub_type?: string; component_ids?: string[] };
    relationships?: Record<string, unknown>;
  };
}
export interface MakeOptions { subType?: string; timestamp?: number; accountId?: string; idStyle?: "device" | "docs" }
export declare function sign(key: string, rawBody: string | Uint8Array): string;
export declare function verify(key: string, rawBody: string | Uint8Array, header: string | null | undefined): boolean;
export declare function parseWebhook(rawBody: string | Uint8Array): RingWebhook;
export declare class Deduper {
  maxAgeMs: number;
  limit: number;
  constructor(opts?: { maxAgeMs?: number; limit?: number });
  check(hook: RingWebhook, now?: number): "new" | "duplicate" | "stale";
}
export declare function makeWebhook(type: RingEventType, deviceId: string, opts?: MakeOptions): RingWebhook;
export declare function send(url: string, key: string, hook: RingWebhook, fetchFn?: typeof fetch): Promise<number>;
