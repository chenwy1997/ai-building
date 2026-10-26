import { join } from "node:path";
import { read, exists, hash, Blocked } from "./core.ts";
import type { ResponseBody } from "./responses.ts";

export interface CompletedRequest {
  request: { key: string; body: Record<string, any>; identity: { releaseId: string; snapshotVersion: string };
    mode: "offline" | "network"; transportId: string };
  response: ResponseBody;
  responseHash: string;
}
// Read-only, independent of category/stage/batch. A completed response and its
// receipt must agree; missing/unknown outcomes never license a resend.
export async function readCompletedRequest(dir: string, key: string): Promise<CompletedRequest> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("invalid historical request key");
  const base = join(dir, "requests", key), request = await read(base + ".request.json"),
    { key: storedKey, ...identity } = request;
  if (storedKey !== key || hash(identity) !== key)
    throw new Blocked("cache_corrupt", "historical request integrity mismatch: " + key);
  if (!await exists(base + ".response.json"))
    throw new Blocked("outcome_unknown", "historical request has no durable response; never resend automatically: " + key);
  const record = await read(base + ".response.json"), receipt = await read(base + ".receipt.json");
  if (record.key !== key || hash(record.response) !== record.sha256 || record.response.status !== "completed" ||
      receipt.key !== key || receipt.status !== "completed" || receipt.responseHash !== record.sha256)
    throw new Blocked("cache_corrupt", "historical response/receipt integrity mismatch: " + key);
  return { request, response: record.response, responseHash: record.sha256 };
}
