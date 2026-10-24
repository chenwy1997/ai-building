import {test, expect} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Budget, effectiveBudgetLimit} from "./budget.ts";
import {read, save, hash, jsonClone} from "./core.ts";
import {main} from "./cli.ts";

test("explicit remaining allowance preserves historical reservations and is idempotent after later use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pgv3-budget-"));
  try {
    const b = new Budget(dir, 200, "conservative-test"); await b.init();
    await b.reserve("historical", 180.7); await b.finish("historical", "outcome_unknown", {input_tokens: 42});
    const before = await read(b.path), raised = await b.setRemaining(100, "user-20261024", "用户要求剩余预留额度100元");
    expect(raised.limitCny).toBe(280.7); expect(raised.remainingReservationCny).toBe(100);
    expect((await read(b.path)).limitCny).toBe(200); expect(raised.entries).toEqual(before.entries);
    await new Budget(dir, 200, "conservative-test").init();
    await b.reserve("later", 1.3); const after = await read(b.path);
    await b.setRemaining(100, "user-20261024", "用户要求剩余预留额度100元");
    expect(await read(b.path)).toEqual(after); expect((await b.status()).remainingReservationCny).toBe(98.7);
    await expect(b.reserve("too-much", 99)).rejects.toThrow("exceeds limit");
    await expect(b.setRemaining(101, "user-20261024", "用户要求剩余预留额度100元")).rejects.toThrow("different authorization");
    await expect(new Budget(dir, 280.7, "conservative-test").init()).rejects.toThrow("implicitly");
    const damaged = jsonClone(after); damaged.entries[0].reservedCny = 0;
    expect(() => effectiveBudgetLimit(damaged)).toThrow("journal");
    damaged.entries[0].reservedCny = 180.7; damaged.adjustments[0].limitCny += 100;
    expect(() => effectiveBudgetLimit(damaged)).toThrow("journal");
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test("budget CLI adjusts only an explicitly identified root, never dispatches or refills on repetition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pgv3-budget-cli-"));
  try {
    const identity = {format: 1, runId: "constructed-budget-test"}, id = hash(identity);
    await save(join(dir, "batch.identity.json"), {id, ...identity});
    await save(join(dir, "execution.identity.json"), {batchId: id, budgetCny: 1, pricingId: "offline-test"});
    const b = new Budget(dir, 1, "offline-test"); await b.init(); await b.reserve("existing", 0.5);
    const args = ["budget-set-remaining", "--out", dir, "--remaining-cny", "100", "--adjustment-id", "explicit-user", "--reason", "test authorization"];
    const result: any = await main(args);
    expect(result.modelRequests).toBe(0); expect(result.limitCny).toBe(100.5);
    await expect(main([...args, "--execute"])).rejects.toThrow("不会执行模型");
    await expect(main(["batch", "--remaining-cny", "100"])).rejects.toThrow("只用于");
    const before = hash(await read(b.path)); await main(args); expect(hash(await read(b.path))).toBe(before);
    await save(join(dir, "batch.identity.json"), {id, ...identity, accounting: {directory: dir}});
    await expect(main(args)).rejects.toThrow("原始批次根目录");
  } finally { await rm(dir, {recursive: true, force: true}); }
});
