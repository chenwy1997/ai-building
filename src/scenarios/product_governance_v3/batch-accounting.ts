import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { exists, read, hash, Blocked } from "./core.ts";
import { readTerminalRequest } from "./request-journal.ts";

// Caller holds the original root execution lock. No writes, keys, or HTTP.
export async function validateBatchAccounting(directory: string) {
  for (const name of ["batch.identity.json", "execution.identity.json", "budget.json"])
    if (!await exists(join(directory, name))) throw new Blocked("rerun_root", "--out请指定已执行批次的原始根目录，不能传review、corrections或新目录：" + directory);
  const source = await read(join(directory, "batch.identity.json")), { id: sourceId, ...sourceIdentity } = source,
    execution = await read(join(directory, "execution.identity.json")), ledger = await read(join(directory, "budget.json"));
  if (source.format !== 1 || source.accounting || sourceId !== hash(sourceIdentity) || hash(source.snapshot) !== source.inputVersion ||
      execution.batchId !== sourceId || ledger.format !== 1 || ledger.limitCny !== execution.budgetCny || ledger.pricingId !== execution.pricingId)
    throw new Blocked("rerun_source_corrupt", "use the original batch root with intact input, execution and cumulative budget identities");
  const keys = (await readdir(join(directory, "requests"))).filter((f) => f.endsWith(".request.json")).map((f) => f.slice(0, -13)),
    entryIds = ledger.entries.map((e: any) => e.id);
  if (new Set(entryIds).size !== entryIds.length || hash([...keys].sort()) !== hash([...entryIds].sort()))
    throw new Blocked("budget_change", "request inventory differs from cumulative reservations");
  for (const entry of ledger.entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.id) || !Number.isFinite(entry.reservedCny) || entry.reservedCny < 0)
      throw new Blocked("budget_change", "invalid historical request reservation");
    const record = await readTerminalRequest(directory, entry.id), { request } = record;
    if (entry.status !== record.response.status && !(record.legacyTransportHash && entry.status === "outcome_unknown"))
      throw new Blocked("outcome_unknown", "unresolved paid outcome disagrees with durable terminal response: " + entry.id);
    if (request.mode !== execution.mode || request.transportId !== execution.transportId)
      throw new Blocked("cache_corrupt", "historical request identity changed");
  }
  return { source, sourceId, execution, ledger, keys };
}
