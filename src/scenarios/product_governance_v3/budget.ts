import { join } from "node:path";
import { save, read, exists, lock, Blocked } from "./core.ts";

interface Entry {
  id: string;
  reservedCny: number;
  status: "reserved" | "completed" | "outcome_unknown";
  usage: unknown;
}
interface Ledger {
  format: 1;
  limitCny: number;
  pricingId: string;
  entries: Entry[];
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
  async init() {
    await lock(this.path + ".lock", async () => {
      if (await exists(this.path)) {
        const current = await read<Ledger>(this.path);
        if (
          current.limitCny !== this.limitCny ||
          current.pricingId !== this.pricingId
        )
          throw new Blocked(
            "budget_change",
            "existing batch budget/pricing cannot change implicitly",
          );
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
      if (ledger.entries.some((e) => e.id === id))
        throw new Blocked(
          "duplicate_reservation",
          "request already reserved; inspect receipt before resend",
        );
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        ledger.entries.reduce((s, e) => s + e.reservedCny, 0) + amount >
          ledger.limitCny
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
      entry.status = status;
      entry.usage = usage;
      await save(this.path, ledger);
    });
  }
  async status() {
    const ledger = await read<Ledger>(this.path);
    return {
      ...ledger,
      committedUpperBoundCny: ledger.entries.reduce(
        (s, e) => s + e.reservedCny,
        0,
      ),
      accounting: "conservative reservations; not an invoice",
    };
  }
}
