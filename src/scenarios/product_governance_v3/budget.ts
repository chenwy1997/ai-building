import { join } from "node:path";
import { save, read, exists, lock, hash, Blocked } from "./core.ts";

interface Entry {
  id: string;
  reservedCny: number;
  status: "reserved" | "completed" | "outcome_unknown";
  usage: unknown;
}
export interface Ledger {
  format: 1;
  limitCny: number;
  pricingId: string;
  entries: Entry[];
  adjustments?: Adjustment[];
}
interface Adjustment {
  id: string;
  at: string;
  reason: string;
  remainingCny: number;
  previousLimitCny: number;
  limitCny: number;
  reservationCount: number;
  reservationHash: string;
  previousHash: string | null;
  hash: string;
}
const money = (n: number) => Math.round(n * 100) / 100;
const reservationIdentity = (entries: Entry[]) => entries.map(({id, reservedCny}) => ({id, reservedCny}));
export function effectiveBudgetLimit(ledger: Ledger) {
  let limit = ledger.limitCny, previousHash: string | null = null, previousCount = 0;
  const ids = new Set<string>();
  if (!Number.isFinite(limit) || limit < 0 || new Set(ledger.entries.map(e => e.id)).size !== ledger.entries.length ||
      ledger.entries.some(e => !Number.isFinite(e.reservedCny) || e.reservedCny < 0))
    throw new Blocked("budget_change", "invalid original budget or reservations");
  for (const a of ledger.adjustments ?? []) {
    const {hash: digest, ...record} = a;
    const entries = ledger.entries.slice(0, a.reservationCount);
    if (ids.has(a.id) || !a.id || !a.reason?.trim() || !Number.isFinite(a.remainingCny) || a.remainingCny < 0 ||
        !Number.isInteger(a.reservationCount) || a.reservationCount < previousCount || a.reservationCount > ledger.entries.length ||
        a.previousLimitCny !== limit || a.previousHash !== previousHash || digest !== hash(record) ||
        a.reservationHash !== hash(reservationIdentity(entries)) || a.limitCny < limit ||
        a.limitCny !== money(entries.reduce((sum, e) => sum + e.reservedCny, 0) + a.remainingCny))
      throw new Blocked("budget_change", "budget adjustment journal or historical reservations changed");
    ids.add(a.id); limit = a.limitCny; previousHash = digest; previousCount = a.reservationCount;
  }
  return limit;
}
// A batch keeps the same directory across reruns/revisions. Reservations survive unknown outcomes.
export class Budget {
  readonly path: string;
  constructor(
    dir: string,
    readonly limitCny: number,
    readonly pricingId: string,
  ) {
    if (!Number.isFinite(limitCny) || limitCny < 0 || !pricingId)
      throw Error("explicit non-negative budget and pricing identity required");
    this.path = join(dir, "budget.json");
  }
  private assertIdentity(ledger: Ledger) {
    if (ledger.limitCny !== this.limitCny || ledger.pricingId !== this.pricingId)
      throw new Blocked("budget_change", "existing batch budget/pricing cannot change implicitly");
    effectiveBudgetLimit(ledger);
  }
  async init() {
    await lock(this.path + ".lock", async () => {
      if (await exists(this.path)) {
        const current = await read<Ledger>(this.path);
        this.assertIdentity(current);
      } else
        await save(this.path, {
          format: 1,
          limitCny: this.limitCny,
          pricingId: this.pricingId,
          entries: [],
        });
    });
  }
  async reserve(id: string, amount: number) {
    await lock(this.path + ".lock", async () => {
      const ledger = await read<Ledger>(this.path);
      this.assertIdentity(ledger);
      if (ledger.entries.some((e) => e.id === id))
        throw new Blocked(
          "duplicate_reservation",
          "request already reserved; inspect receipt before resend",
        );
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        ledger.entries.reduce((s, e) => s + e.reservedCny, 0) + amount >
          effectiveBudgetLimit(ledger)
      )
        throw new Blocked(
          "budget_exhausted",
          "batch cumulative reservation exceeds limit",
        );
      ledger.entries.push({
        id,
        reservedCny: amount,
        status: "reserved",
        usage: null,
      });
      await save(this.path, ledger);
    });
  }
  async finish(id: string, status: Entry["status"], usage: unknown = null) {
    await lock(this.path + ".lock", async () => {
      const ledger = await read<Ledger>(this.path),
        entry = ledger.entries.find((e) => e.id === id);
      if (!entry) throw Error("missing request reservation");
      this.assertIdentity(ledger);
      entry.status = status;
      entry.usage = usage;
      await save(this.path, ledger);
    });
  }
  // Explicit, idempotent authorization. The original identity and every reservation remain intact.
  async setRemaining(remainingCny: number, adjustmentId: string, reason: string) {
    if (!Number.isFinite(remainingCny) || remainingCny < 0 || money(remainingCny) !== remainingCny || !adjustmentId.trim() || !reason.trim())
      throw Error("explicit adjustment ID, reason and non-negative CNY amount with at most two decimals required");
    await lock(this.path + ".lock", async () => {
      const ledger = await read<Ledger>(this.path), limit = effectiveBudgetLimit(ledger);
      if (ledger.limitCny !== this.limitCny || ledger.pricingId !== this.pricingId)
        throw new Blocked("budget_change", "original budget/pricing identity differs");
      const previous = ledger.adjustments?.find(a => a.id === adjustmentId);
      if (previous) {
        if (previous.remainingCny !== remainingCny || previous.reason !== reason)
          throw new Blocked("budget_change", "adjustment ID already used with different authorization");
        return; // Repeating the command never replenishes money already reserved since this event.
      }
      const nextLimit = money(ledger.entries.reduce((sum, e) => sum + e.reservedCny, 0) + remainingCny);
      if (nextLimit < limit) throw new Blocked("budget_change", "this command only increases the remaining allowance");
      const record = {id: adjustmentId, at: new Date().toISOString(), reason, remainingCny,
        previousLimitCny: limit, limitCny: nextLimit, reservationCount: ledger.entries.length,
        reservationHash: hash(reservationIdentity(ledger.entries)), previousHash: ledger.adjustments?.at(-1)?.hash ?? null};
      ledger.adjustments = [...(ledger.adjustments ?? []), {...record, hash: hash(record)}];
      await save(this.path, ledger);
    });
    return this.status();
  }
  async status() {
    const ledger = await read<Ledger>(this.path);
    this.assertIdentity(ledger);
    return {
      ...ledger,
      originalLimitCny: ledger.limitCny,
      limitCny: effectiveBudgetLimit(ledger),
      remainingReservationCny: money(effectiveBudgetLimit(ledger) - ledger.entries.reduce((s, e) => s + e.reservedCny, 0)),
      committedUpperBoundCny: ledger.entries.reduce(
        (s, e) => s + e.reservedCny,
        0,
      ),
      accounting: "conservative reservations; not an invoice",
    };
  }
}
