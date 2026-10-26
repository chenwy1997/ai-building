import { join } from "node:path";
import { read, exists, hash, Blocked } from "./core.ts";
import type { ResponseBody } from "./responses.ts";
import { assertTerminalResponse } from "./response-outcome.ts";

export interface RecordedRequest {
  request: { key: string; body: Record<string, any>; identity: { releaseId: string; snapshotVersion: string };
    mode: "offline" | "network"; transportId: string };
  response: ResponseBody;
  responseHash: string;
  legacyTransportHash?: string;
}
// Read-only, independent of category/stage/batch. A completed response and its
// receipt must agree; missing/unknown outcomes never license a resend.
export async function readCompletedRequest(dir: string, key: string): Promise<RecordedRequest> {
  const result = await readTerminalRequest(dir, key);
  if (result.response.status !== "completed")
    throw new Blocked("incomplete_response", "historical response is terminal but not completed: " + key);
  return result;
}
// Also recognizes the old host's misclassified HTTP-200, explicit truncation.
// The original receipt/transport stay intact. No guessed network outcome or
// incomplete JSON payload can become a completed response through this reader.
export async function readTerminalRequest(dir: string, key: string): Promise<RecordedRequest> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("invalid historical request key");
  const base = join(dir, "requests", key), request = await read(base + ".request.json"),
    { key: storedKey, ...identity } = request;
  if (storedKey !== key || hash(identity) !== key)
    throw new Blocked("cache_corrupt", "historical request integrity mismatch: " + key);
  if (!await exists(base + ".response.json")) {
    const unknown = () => new Blocked("outcome_unknown", "unresolved paid outcome: no verified terminal response; no automatic resend: " + key);
    if (!await exists(base + ".transport-response.json") || !await exists(base + ".receipt.json")) throw unknown();
    const transport = await read(base + ".transport-response.json"), receipt = await read(base + ".receipt.json");
    if (transport.key !== key || receipt.key !== key || transport.sha256 !== hash(transport.text))
      throw new Blocked("cache_corrupt", "historical transport/receipt integrity mismatch: " + key);
    if (transport.httpStatus !== 200 || receipt.status !== "outcome_unknown") throw unknown();
    let response: ResponseBody;
    try { response = JSON.parse(transport.text); assertTerminalResponse(response); } catch { throw unknown(); }
    if (response.status !== "incomplete" || !response.usage || typeof response.usage !== "object") throw unknown();
    return { request, response, responseHash: hash(response), legacyTransportHash: transport.sha256 };
  }
  const record = await read(base + ".response.json"), receipt = await read(base + ".receipt.json");
  if (record.key !== key || hash(record.response) !== record.sha256 ||
      receipt.key !== key || receipt.status !== record.response.status || receipt.responseHash !== record.sha256)
    throw new Blocked("cache_corrupt", "historical response/receipt integrity mismatch: " + key);
  assertTerminalResponse(record.response);
  return { request, response: record.response, responseHash: record.sha256 };
}
