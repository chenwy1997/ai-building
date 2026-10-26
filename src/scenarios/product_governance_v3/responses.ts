import { join } from "node:path";
import { hash, save, read, exists, lock, Blocked, canonical } from "./core.ts";
import { Budget } from "./budget.ts";
import { assertTerminalResponse, type TerminalStatus } from "./response-outcome.ts";
import { readTerminalRequest } from "./request-journal.ts";

export type InputItem = Record<string, any>;
export interface ResponseBody {
  status: string;
  output: InputItem[];
  usage?: unknown;
  incomplete_details?: { reason: string } | null;
  error?: { code: string; message: string } | null;
}
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect?: "error";
  },
) => Promise<Response>;
type Config = { timeoutMs?: number } & (
  | { mode: "offline"; transportId: string; fetch: FetchLike }
  | {
      mode: "network";
      allowNetwork: true;
      apiKey: string;
      transportId: string;
      perRequestUpperBoundCny: number;
    });

export class ResponsesClient {
  readonly mode: "offline" | "network";
  readonly transportId: string;
  private fetcher: FetchLike;
  private apiKey: string;
  readonly reserveCny: number;
  readonly timeoutMs: number;
  calls = 0;
  cacheHits = 0;
  constructor(
    private config: Config,
    readonly dir: string,
    readonly budget: Budget,
  ) {
    this.mode = config.mode;
    this.transportId = config.transportId;
    this.timeoutMs = config.timeoutMs ?? 30000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 600000)
      throw Error("timeoutMs must be 1000..600000");
    if (!config.transportId)
      throw Error("transportId required for cache separation");
    if (config.mode === "network") {
      if (
        config.allowNetwork !== true ||
        !config.apiKey ||
        !Number.isFinite(config.perRequestUpperBoundCny) ||
        config.perRequestUpperBoundCny <= 0
      )
        throw Error(
          "network requires explicit authorization, key and cost upper bound",
        );
      this.fetcher = (url, init) => fetch(url, init);
      this.apiKey = config.apiKey;
      this.reserveCny = config.perRequestUpperBoundCny;
    } else {
      if (typeof config.fetch !== "function")
        throw Error("offline mode requires injected mock HTTP");
      this.fetcher = config.fetch;
      this.apiKey = "offline-no-credential";
      this.reserveCny = 0;
    }
  }
  async request(
    body: Record<string, unknown>,
    identity: { releaseId: string; snapshotVersion: string },
  ) {
    const key = hash({
        body,
        identity,
        transportId: this.transportId,
        mode: this.mode,
      }),
      base = join(this.dir, "requests", key),
      responsePath = base + ".response.json",
      receiptPath = base + ".receipt.json";
    return lock(base + ".lock", async () => {
      if (await exists(responsePath) || await exists(receiptPath)) {
        const record = await readTerminalRequest(this.dir, key);
        if (record.legacyTransportHash) await save(base + ".outcome-resolution.json", {
          key, status: record.response.status, responseHash: record.responseHash,
          transportHash: record.legacyTransportHash, previousReceiptHash: hash(await read(receiptPath)),
          reason: record.response.incomplete_details?.reason, usage: record.response.usage,
          originalReceiptPreserved: true, newModelRequests: 0,
        });
        await this.budget.finish(
          key,
          record.response.status as TerminalStatus,
          record.response.usage ?? null,
        );
        this.cacheHits++;
        return { key, response: record.response, cached: true };
      }
      await this.budget.reserve(key, this.reserveCny);
      await save(base + ".request.json", {
        key,
        identity,
        mode: this.mode,
        transportId: this.transportId,
        body,
      });
      await save(receiptPath, {
        key,
        status: "reserved",
        reservationCny: this.reserveCny,
      });
      try {
        this.calls++;
        const response = await this.fetcher(
          "https://api.deepseek.com/responses",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + this.apiKey,
            },
            body: canonical(body),
            signal: AbortSignal.timeout(this.timeoutMs),
            redirect: "error",
          },
        );
        const responseText = await response.text();
        if (Buffer.byteLength(responseText) > 2_000_000)
          throw new Blocked(
            "response_too_large",
            "response exceeds local byte limit",
          );
        await save(base + ".transport-response.json", {
          key,
          httpStatus: response.status,
          text: responseText,
          sha256: hash(responseText),
        });
        if (!response.ok)
          throw new Blocked(
            "http_error",
            `Responses HTTP ${response.status}; inspect receipt before explicit retry`,
          );
        const raw: unknown = JSON.parse(responseText);
        assertTerminalResponse(raw);
        await save(responsePath, { key, response: raw, sha256: hash(raw) });
        await this.budget.finish(key, raw.status as TerminalStatus, raw.usage ?? null);
        await save(receiptPath, {
          key,
          status: raw.status,
          responseHash: hash(raw),
        });
        return { key, response: raw, cached: false };
      } catch (error) {
        await this.budget.finish(key, "outcome_unknown");
        await save(receiptPath, {
          key,
          status: "outcome_unknown",
          error: String(error),
        });
        throw error;
      }
    });
  }
}
