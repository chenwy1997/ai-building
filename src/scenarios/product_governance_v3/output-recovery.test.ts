import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import recording from "./fixtures/output-truncation-20261026.json";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { read, jsonClone } from "./core.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import { Budget } from "./budget.ts";
import { fixtureSnapshot, fixtureTask, fixtureOutput, finalMessage } from "./fixtures.ts";
import { DataSnapshot } from "./snapshot.ts";
import { outputTokens, outputReservation, outputTimeoutMs, BATCH_PRICING_ID } from "./response-capacity.ts";
import { prepareBatch, CLEAN_PAPER_ID } from "./batch.ts";
import { main } from "./cli.ts";
import { progressLogger } from "./progress.ts";

let temp: string, release: Release, seq = 0;
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-output-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const next = () => join(temp, String(++seq));
const client = (dir: string, fetch: FetchLike) => new ResponsesClient({ mode: "offline", transportId: "output-fixture", fetch }, dir, new Budget(dir, 0, "offline-zero"));
const run = (dir: string, c: ResponsesClient, maxRounds = 6, recover = false) => runStage({ release,
  task: fixtureTask("family-modeling"), snapshot: new DataSnapshot(fixtureSnapshot()), client: c, outDir: dir,
  model: { model: "deepseek-flash", reasoningEffort: "low" }, limits: { maxRounds, maxOutputTokens: 24000 },
  corrections: BATCH_CORRECTIONS, ...(recover ? { outputRecovery: { maxOutputTokens: 65536 } } : {}) });

test("a confirmed truncation records usage/request key without auto retry or admitting the partial JSON", async () => {
  const dir = next(), c = client(dir, async () => Response.json(recording.response));
  await expect(run(dir, c)).rejects.toThrow("max_output_tokens");
  expect(c.calls).toBe(1);
  const e = (await c.budget.status()).entries[0]!;
  expect(e.status).toBe("incomplete"); expect(e.usage).toEqual(recording.response.usage);
  const blocked = await read(join(dir, "runs", (await readdir(join(dir, "runs"))).find(f => f.endsWith(".blocked.json"))!));
  expect(blocked.requestKeys).toEqual([e.id]); expect(blocked.feedback).toEqual([]);
  expect(blocked.adoption).toBe("not_eligible");
  await expect(run(dir, c)).rejects.toThrow("max_output_tokens"); expect(c.calls).toBe(1);
});

test("explicit recovery keeps original input/tools and low, ignores incomplete calls, and retains the original round/correction budgets", async () => {
  const dir = next(), requests: any[] = [], response = jsonClone(recording.response);
  response.output = [{ type: "function_call", call_id: "partial-danger", name: "not_registered", arguments: "{" }] as any;
  const c = client(dir, async (_u, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return requests.length === 1 ? Response.json(response) : Response.json({ status: "completed", output: [finalMessage(fixtureOutput("family-modeling"))] });
  });
  const result = await run(dir, c, 6, true);
  expect(requests).toHaveLength(2); expect(requests.map(r => r.max_output_tokens)).toEqual([24000, 65536]);
  expect(requests.every(r => r.reasoning.effort === "low")).toBe(true);
  expect(requests[1].input.slice(0, requests[0].input.length)).toEqual(requests[0].input);
  expect(requests[1].tools).toEqual(requests[0].tools);
  expect(requests[1].input.some((i: any) => i.call_id === "partial-danger")).toBe(false);
  expect(result.feedback).toHaveLength(0); expect(result.toolCount).toBe(0); expect(result.capacityRecoveries).toHaveLength(1);
  expect(result.checks.errors).toEqual([]);
});

test("last-round truncation, repeated truncation and content filtering do not start unlimited recovery requests", async () => {
  for (const [rounds, reason, expectedCalls] of [[1, "max_output_tokens", 1], [6, "max_output_tokens", 2], [6, "content_filter", 1]] as const) {
    const dir = next(), response = jsonClone(recording.response); response.incomplete_details.reason = reason;
    const c = client(dir, async () => Response.json(response));
    await expect(run(dir, c, rounds, true)).rejects.toThrow(reason);
    expect(c.calls).toBe(expectedCalls);
    await expect(run(dir, c, rounds, true)).rejects.toThrow(reason); expect(c.calls).toBe(expectedCalls);
  }
});

test("output capacity is configurable, validated against output rather than context capacity, and changes reservation/timeout", async () => {
  expect(() => outputTokens(1_048_576)).toThrow("393216");
  for (const n of [0, -1, NaN, 2.5]) expect(() => outputTokens(n)).toThrow();
  expect(outputTokens(393216)).toBe(393216);
  expect(outputReservation(24000, 1.3, 65536, BATCH_PRICING_ID)).toBe(1.8);
  expect(outputReservation(24000, 1.3, 12000, BATCH_PRICING_ID)).toBe(1.3);
  expect(() => outputReservation(24000, 1.3, 65536, "unknown-price")).toThrow("unregistered");
  expect(outputTimeoutMs(24000)).toBe(240000); expect(outputTimeoutMs(65536)).toBe(600000);
  const dir = next(), treePath = join(ROOT, "profiles/clean-paper-tree.json"),
    options = { categoryId: CLEAN_PAPER_ID, runId: "capacity-test", concurrency: 1, treePath };
  const defaults = await prepareBatch({ ...options, outDir: join(dir, "default") }, release);
  expect(defaults.limits.maxOutputTokens).toBe(65536); expect(defaults.reserveCny).toBe(1.8);
  const changed = await main(["batch", "--category-id", CLEAN_PAPER_ID, "--tree", treePath,
    "--out", join(dir, "explicit"), "--max-output-tokens", "98304"]);
  expect(changed.limits.maxOutputTokens).toBe(98304); expect(changed.networkCalls).toBe(0);
  await expect(main(["batch-continue", "--max-output-tokens", "65536"])).rejects.toThrow("仅用于");
  const lines: string[] = []; progressLogger("human", s => lines.push(s))({ event: "output-capacity-recovery", maxOutputTokens: 65536 });
  expect(lines[0]).toContain("输出截断续跑"); expect(lines[0]).not.toContain("已有方案");
});
