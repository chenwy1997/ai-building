import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { mkdtemp, rm, mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { assemble } from "./context.ts";
import {
  canonical,
  hash,
  read,
  jsonClone,
  STAGES,
  type Snapshot,
  type Stage,
} from "./core.ts";
import {
  loadRelease,
  ROOT,
  STANDARD,
  SYSTEM_CONTRACT,
  RULES,
  type Release,
} from "./release.ts";
import { CategoryIndex } from "./catalog.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ToolRegistry } from "./tools.ts";
import { checkResult } from "./checks.ts";
import { Budget } from "./budget.ts";
import { ResponsesClient } from "./responses.ts";
import { runStage, type Limits } from "./runner.ts";
import { main } from "./cli.ts";
import {
  fixtureSnapshot,
  fixtureTask,
  fixtureOutput,
  happyScript,
  scriptedFetch,
  functionCall,
  finalMessage,
  attribute,
  binding,
  prepareFixtureFacts,
  fixtureValues,
} from "./fixtures.ts";

let temp: string,
  release: Release,
  counter = 0;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "governance-v3-"));
  release = await loadRelease();
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
const next = () => join(temp, String(counter++));
async function runMock(
  stage: Stage,
  output: unknown,
  snapshot = fixtureSnapshot(),
  limits: Partial<Limits> = {},
) {
  const dir = next(),
    mock = scriptedFetch([[finalMessage(output)]]),
    budget = new Budget(dir, 0, "offline-zero");
  const client = new ResponsesClient(
    { mode: "offline", transportId: "negative-fixture", fetch: mock.fetch },
    dir,
    budget,
  );
  return {
    artifact: await runStage({
      release,
      snapshot: new DataSnapshot(prepareFixtureFacts(snapshot)),
      task: fixtureTask(stage),
      client,
      outDir: dir,
      limits,
    }),
    mock,
    client,
    dir,
  };
}
async function checked(
  stage: Stage,
  output: unknown,
  snapshot = fixtureSnapshot(),
) {
  const plan = await assemble(
    release,
    new DataSnapshot(prepareFixtureFacts(snapshot)),
    fixtureTask(stage),
  );
  return checkResult(fixtureTask(stage), output, plan.tools);
}
const blocks = (
  report: { status: string; errors: { ruleId: string }[] },
  ruleId: string,
) => {
  expect(report.status).toBe("program_blocked");
  expect(report.errors.some((e) => e.ruleId === ruleId)).toBe(true);
};

describe("actual assembly → Responses HTTP mock → function dispatch → program checks → persistence", () => {
  test("model can search and consume a real next-page cursor over multiple tool rounds", async () => {
    const dir = next(),
      mock = scriptedFetch([
        [
          functionCall(
            "categories_search",
            { query: "卷纸", scopeId: null, limit: 1, cursor: null },
            "search-1",
          ),
        ],
        (request) => {
          const output = JSON.parse(
            request.input.find(
              (i: any) =>
                i.type === "function_call_output" && i.call_id === "search-1",
            ).output,
          );
          expect(output.total).toBe(2);
          expect(output.truncated).toBe(true);
          return [
            functionCall(
              "categories_search",
              {
                query: "卷纸",
                scopeId: null,
                limit: 1,
                cursor: output.nextCursor,
              },
              "search-2",
            ),
          ];
        },
        (request) => {
          const output = JSON.parse(
            request.input.find(
              (i: any) =>
                i.type === "function_call_output" && i.call_id === "search-2",
            ).output,
          );
          expect(output.truncated).toBe(false);
          expect(output.items).toHaveLength(1);
          return [finalMessage(fixtureOutput("family-modeling"))];
        },
      ]),
      client = new ResponsesClient(
        { mode: "offline", transportId: "search-pages", fetch: mock.fetch },
        dir,
        new Budget(dir, 0, "offline-zero"),
      );
    const artifact = await runStage({
      release,
      snapshot: new DataSnapshot(fixtureSnapshot()),
      task: fixtureTask("family-modeling"),
      client,
      outDir: dir,
    });
    expect(artifact.checks.status).toBe("program_pass_pending_human");
    expect(artifact.toolCount).toBe(2);
    expect(client.calls).toBe(3);
  });
  for (const stage of STAGES)
    test(stage, async () => {
      const dir = next(),
        mock = happyScript(stage),
        budget = new Budget(dir, 0, "offline-zero"),
        snapshot = new DataSnapshot(fixtureSnapshot());
      const client = new ResponsesClient(
        { mode: "offline", transportId: stage, fetch: mock.fetch },
        dir,
        budget,
      );
      const result = await runStage({
        release,
        snapshot,
        task: fixtureTask(stage),
        client,
        outDir: dir,
      });
      expect(result.checks.status).toBe("program_pass_pending_human");
      expect(result.adoption).toBe("pending_human");
      expect(result.productionWrites).toBe(0);
      expect(client.calls).toBe(2);
      expect(result.toolCount).toBe(1);
      expect(mock.requests).toHaveLength(2);
      const sent = mock.requests[0],
        input = JSON.parse(sent.input[0].content);
      expect(sent.instructions).toContain(release.skills[stage].body.body);
      expect(sent.instructions).toContain(
        release.skills[stage].references[0]!.body,
      );
      expect(
        input.sharedContext.systemFields.find((f: any) => f.key === "brandId"),
      ).toBeTruthy();
      expect(input.sharedContext.knowledge[0].text).toContain(
        "抽和张不能凭经验等同",
      );
      expect(
        input.sharedContext.knowledge.some(
          (k: any) => k.id === "hardware-fixture",
        ),
      ).toBe(false);
      expect(result.manifest.snapshotVersion).toBe(snapshot.version);
      expect(result.manifest.toolsHash).toBe(hash(sent.tools));
      const saved = await read<any>(
        join(dir, "runs", result.runKey + ".result.json"),
      );
      expect(saved.result).toEqual(result.result);
      const ledger = await budget.status();
      expect(ledger.entries).toHaveLength(2);
      expect(ledger.committedUpperBoundCny).toBe(0);
      // A restarted runner replays durable responses and reconstructs tool-read provenance.
      const resumedClient = new ResponsesClient(
        {
          mode: "offline",
          transportId: stage,
          fetch: async () => {
            throw Error("must not resend");
          },
        },
        dir,
        budget,
      );
      const resumed = await runStage({
        release,
        snapshot,
        task: fixtureTask(stage),
        client: resumedClient,
        outDir: dir,
      });
      expect(resumed.runKey).toBe(result.runKey);
      expect(resumed.result).toEqual(result.result);
      expect(resumedClient.calls).toBe(0);
      expect(resumedClient.cacheHits).toBe(2);
    });
  test("program failure is not eligible for adoption and is durably recorded", async () => {
    const output = fixtureOutput("family-modeling");
    output.attributes.push(
      attribute({ id: "bad-brand", name: "品牌", conceptKey: "common.brand" }),
    );
    const { artifact, dir } = await runMock("family-modeling", output);
    blocks(artifact.checks, "R01");
    expect(artifact.adoption).toBe("not_eligible");
    expect(
      (await read<any>(join(dir, "runs", artifact.runKey + ".result.json")))
        .checks.errors.length,
    ).toBeGreaterThan(0);
  });
});

describe("modeling invariants and the accepted sibling-category correction", () => {
  test("review assistance receives candidate errors and cannot erase them with an empty finding list", async () => {
    const task = fixtureTask("review-assistance");
    (task.candidate as any).result.values[2].value = 999;
    const snapshot = new DataSnapshot(fixtureSnapshot()),
      plan = await assemble(release, snapshot, task);
    blocks(plan.input.candidateProgramChecks!, "R14");
    const output = fixtureOutput("review-assistance");
    output.findings = [];
    const finalChecks = checkResult(task, output, plan.tools);
    blocks(finalChecks, "R14");
    expect(finalChecks.executedChecks).toContain("sku-values");
    expect(finalChecks.executedChecks).toContain("calculation");
  });
  test("cored/coreless both inherit the common 是否无芯 definition", async () => {
    const snap = new DataSnapshot(fixtureSnapshot());
    for (const categoryId of [
      "fixture-cored-category",
      "fixture-coreless-category",
    ]) {
      const task = { ...fixtureTask("family-modeling"), categoryId },
        plan = await assemble(release, snap, task);
      const output = { ...fixtureOutput("family-modeling"), categoryId };
      output.bindings.forEach((b: any) => (b.categoryId = categoryId));
      expect(checkResult(task, output, plan.tools).status).toBe(
        "program_pass_pending_human",
      );
    }
    const bad = fixtureOutput("family-modeling");
    bad.attributes = bad.attributes.filter(
      (a: any) => a.id !== "fixture-coreless",
    );
    blocks(await checked("family-modeling", bad), "R03");
  });
  test("renaming a common attribute or changing its unit is blocked", async () => {
    const output = fixtureOutput("family-modeling");
    output.attributes[1].name = "纸张层数另名";
    output.attributes[1].unit = "张";
    blocks(await checked("family-modeling", output), "R03");
  });
  test("binary requiredness and all-SKU are schema constraints", async () => {
    const output = fixtureOutput("family-modeling");
    output.bindings[0].requiredness = "conditional";
    blocks(await checked("family-modeling", output), "R02");
    output.bindings[0].requiredness = "optional";
    output.attributes[0].valueLevel = "SPU";
    blocks(await checked("family-modeling", output), "R01");
  });
  test("backend capability context is loaded and unsupported indexing is rejected", async () => {
    const plan = await assemble(
      release,
      new DataSnapshot(fixtureSnapshot()),
      fixtureTask("family-modeling"),
    );
    expect(plan.instructions).toContain("STRING+OPTION");
    expect(plan.instructions).toContain("PropertyInstanceOnCategoryInstance");
    const output = fixtureOutput("family-modeling");
    output.bindings[1].searchable = true;
    blocks(await checked("family-modeling", output), "R01");
  });
  test("system ownership excludes basic fields without blanket model-name blacklist", async () => {
    const output = fixtureOutput("family-modeling");
    output.attributes.push(
      attribute({
        id: "native",
        name: "规格名称",
        conceptKey: "x",
      }),
    );
    blocks(await checked("family-modeling", output), "R01");
    output.attributes.pop();
    output.attributes.push(
      attribute({
        id: "fit-model",
        name: "适配分配器型号",
        conceptKey: "fit.dispenser",
        fieldType: "text",
      }),
    );
    output.bindings.push(
      binding("fit-model", {
        categoryId: output.categoryId,
        differenceReason: "独立适配用途",
      }),
    );
    expect((await checked("family-modeling", output)).status).toBe(
      "program_pass_pending_human",
    );
  });
  test("unit-only fields, empty numeric units, duplicate concepts, and invalid multi are blocked", async () => {
    const output = fixtureOutput("family-modeling");
    output.attributes.push(
      attribute({
        id: "unit-only",
        name: "每包数量计量单位",
        conceptKey: "pack.unit",
      }),
    );
    blocks(await checked("family-modeling", output), "R06");
    output.attributes.pop();
    output.attributes[1].unit = null;
    blocks(await checked("family-modeling", output), "R06");
    output.attributes[1].unit = "层";
    output.attributes.push(attribute({ id: "duplicate" }));
    blocks(await checked("family-modeling", output), "R07");
    output.attributes.pop();
    output.attributes[0].multi = true;
    blocks(await checked("family-modeling", output), "R08");
  });
  test("same-run candidates stay pending; other-run drafts are not reusable; in-flight/failed block", async () => {
    const data = fixtureSnapshot();
    data.families[0]!.status = "candidate";
    data.families[0]!.runId = "fixture-batch";
    let snap = new DataSnapshot(data);
    expect(
      snap.families("fixture-cored-category", "fixture-batch")[0]!.availability,
    ).toBe("same_run_pending");
    expect(snap.baseline(fixtureTask("family-modeling"))?.status).toBe(
      "candidate",
    );
    data.families[0]!.runId = "another-batch";
    snap = new DataSnapshot(data);
    expect(snap.baseline(fixtureTask("family-modeling"))).toBeNull();
    expect(
      snap.families("fixture-cored-category", "fixture-batch")[0]!.availability,
    ).toBe("other_run_pending");
    for (const status of ["in_progress", "failed"] as const) {
      data.families[0]!.status = status;
      await expect(
        assemble(
          release,
          new DataSnapshot(data),
          fixtureTask("family-modeling"),
        ),
      ).rejects.toThrow("dependency");
    }
  });
  test("a foreign pending baseline or global pool cannot silently become an SKU contract", async () => {
    const data = fixtureSnapshot();
    data.families[0]!.status = "candidate";
    data.families[0]!.runId = "other-batch";
    await expect(
      assemble(release, new DataSnapshot(data), fixtureTask("sku-filling")),
    ).rejects.toThrow("fixed family contract");
  });
});

describe("facts, state, scope, and arithmetic are connected to final checks", () => {
  test("a preexisting confirmed label cannot bypass fundamental definition checks in filling", async () => {
    const data = fixtureSnapshot();
    data.families[0]!.attributes[0]!.name = "品牌";
    data.families[0]!.attributes[0]!.conceptKey = "common.brand";
    blocks(
      await checked("sku-filling", fixtureOutput("sku-filling"), data),
      "R01",
    );
    const numeric = fixtureSnapshot();
    numeric.families[0]!.attributes[1]!.unit = null;
    blocks(
      await checked("sku-filling", fixtureOutput("sku-filling"), numeric),
      "R06",
    );
  });
  test("known option values cannot expand the fixed enum", async () => {
    const data = fixtureSnapshot(),
      option = attribute({
        id: "fixture-scent",
        name: "香型",
        conceptKey: "paper.scent",
        fieldType: "option",
        enumValues: ["无香", "花香"],
      });
    data.families[0]!.attributes.push(option);
    data.families[0]!.bindings.push(binding(option.id));
    data.attributes.push(option);
    data.sources[0]!.text += "香型无香。";
    data.sources[0]!.facts.push({
      id: "scent",
      conceptKey: "paper.scent",
      value: "无香",
      unit: null,
      scope: "sales-unit",
      quote: "香型无香",
      kind: "direct",
    });
    const output = fixtureOutput("sku-filling");
    output.values.push({
      attributeId: "fixture-scent",
      status: "known",
      value: "不存在的枚举",
      evidence: [
        { sourceId: "fixture-source", factId: "scent", quote: "香型无香" },
      ],
      derivation: null,
      reason: "test",
    });
    blocks(await checked("sku-filling", output, data), "R08");
  });
  test("a matched arithmetic result without factor provenance is blocked", async () => {
    const output = fixtureOutput("sku-filling");
    output.values[2].evidence = [];
    const { artifact } = await runMock("sku-filling", output);
    blocks(artifact.checks, "R14");
  });
  test("wrong target unit, mismatched concept, and changed factor value are blocked", async () => {
    const output = fixtureOutput("sku-filling");
    output.values[2].derivation.targetUnit = "张/销售单位";
    blocks(await checked("sku-filling", output), "R14");
    output.values[2].derivation.targetUnit = "卷/销售单位";
    output.values[2].derivation.inputs[0].factId = "layers";
    blocks(await checked("sku-filling", output), "R14");
    output.values[2].derivation = fixtureValues()[2]!.derivation;
    output.values[2].value = 41;
    blocks(await checked("sku-filling", output), "R14");
  });
  test("caller composition flags without supporting facts cannot authorize calculation", async () => {
    const data = fixtureSnapshot();
    data.sources[0]!.facts = data.sources[0]!.facts.filter(
      (f) => f.conceptKey !== "sales.gifts",
    );
    blocks(
      await checked("sku-filling", fixtureOutput("sku-filling"), data),
      "R14",
    );
    for (const change of ["mixed", "unknown"] as const) {
      const s = fixtureSnapshot();
      s.products[0]!.composition = change;
      blocks(
        await checked("sku-filling", fixtureOutput("sku-filling"), s),
        "R14",
      );
    }
    const wrongAssumptionUnit = fixtureSnapshot();
    wrongAssumptionUnit.sources[0]!.facts.find(
      (f) => f.conceptKey === "sales.gifts",
    )!.unit = "件";
    blocks(
      await checked(
        "sku-filling",
        fixtureOutput("sku-filling"),
        wrongAssumptionUnit,
      ),
      "R14",
    );
  });
  test("read source ID alone does not mean the quote was read", async () => {
    const snap = new DataSnapshot(fixtureSnapshot()),
      task = fixtureTask("sku-filling"),
      tools = new ToolRegistry(snap, release, task);
    await tools.call("sources_read", {
      id: "fixture-source",
      offset: 0,
      length: 2,
    });
    const checks = checkResult(task, fixtureOutput("sku-filling"), tools);
    blocks(checks, "R09");
    blocks(checks, "R14");
  });
  test("quantity division cannot produce fractional counts or divide by zero", async () => {
    for (const divisor of [3, 0]) {
      const data = fixtureSnapshot(),
        source = data.sources[0]!;
      source.text += `每销售单位10卷；每销售单位${divisor}提。`;
      source.facts.push(
        {
          id: "div-a",
          conceptKey: "a",
          value: 10,
          unit: "卷/销售单位",
          scope: "sales-unit",
          quote: "每销售单位10卷",
          kind: "direct",
        },
        {
          id: "div-b",
          conceptKey: "b",
          value: divisor,
          unit: "提/销售单位",
          scope: "sales-unit",
          quote: `每销售单位${divisor}提`,
          kind: "direct",
        },
      );
      data.families[0]!.attributes[2]!.unit = "卷/提";
      data.derivationPolicies.push({
        id: "division-policy",
        version: "fixture-division-1",
        rationale: "构造除法反例",
        operator: "divide",
        targetConceptKey: "paper.total_rolls",
        inputConceptKeys: ["a", "b"],
        targetUnit: "卷/提",
        factors: [
          {
            conceptKey: "a",
            unit: "卷/销售单位",
            kind: "count",
            min: 0,
            max: null,
          },
          {
            conceptKey: "b",
            unit: "提/销售单位",
            kind: "count",
            min: 0,
            max: null,
          },
        ],
        resultKind: "count",
      });
      const output = fixtureOutput("sku-filling");
      output.values[2].derivation = {
        policyId: "division-policy",
        policyVersion: "fixture-division-1",
        operator: "divide",
        inputs: [
          { sourceId: "fixture-source", factId: "div-a" },
          { sourceId: "fixture-source", factId: "div-b" },
        ],
        targetUnit: "卷/提",
      };
      blocks(await checked("sku-filling", output, data), "R14");
    }
  });
  test("registered dimensional conversion works, but 抽/张 conversion is refused", async () => {
    const data = fixtureSnapshot(),
      source = data.sources[0]!;
    source.text += "长度2厘米。";
    source.facts.push({
      id: "length-cm",
      conceptKey: "length",
      value: 2,
      unit: "cm",
      scope: "sales-unit",
      quote: "长度2厘米",
      kind: "direct",
    });
    const target = attribute({
      id: "length-mm",
      name: "长度",
      conceptKey: "length",
      fieldType: "number",
      unit: "mm",
    });
    data.families[0]!.attributes.push(target);
    data.families[0]!.bindings.push(binding(target.id));
    data.derivationPolicies.push({
      id: "length-conversion",
      version: "fixture-convert-1",
      rationale: "构造长度换算",
      operator: "convert",
      targetConceptKey: "length",
      inputConceptKeys: ["length"],
      targetUnit: "mm",
      factors: [
        {
          conceptKey: "length",
          unit: "cm",
          kind: "measurement",
          min: 0,
          max: null,
        },
      ],
      resultKind: "measurement",
    });
    const plan = await assemble(
      release,
      new DataSnapshot(prepareFixtureFacts(data)),
      fixtureTask("sku-filling"),
    );
    const args = {
      attributeId: "length-mm",
      derivation: {
        policyId: "length-conversion",
        policyVersion: "fixture-convert-1",
        operator: "convert",
        inputs: [{ sourceId: "fixture-source", factId: "length-cm" }],
        targetUnit: "mm",
      },
    };
    expect((await plan.tools.call("calculate_value", args)).value).toBe(20);
    source.facts.find((f) => f.id === "length-cm")!.unit = "抽";
    target.unit = "张";
    data.derivationPolicies[1]!.factors[0]!.unit = "抽";
    data.derivationPolicies[1]!.targetUnit = "张";
    const bad = await assemble(
      release,
      new DataSnapshot(prepareFixtureFacts(data)),
      fixtureTask("sku-filling"),
    );
    args.derivation.targetUnit = "张";
    await expect(bad.tools.call("calculate_value", args)).rejects.toThrow(
      "not registered",
    );
  });
  test("foreign SKU evidence is rejected even if source ID exists in snapshot", async () => {
    const data = fixtureSnapshot();
    data.products.push({
      ...jsonClone(data.products[0]!),
      id: "fixture-other-sku",
      salesUnitId: "other-sale",
      sourceIds: ["foreign-source"],
      assumptionSourceIds: [],
    });
    data.sources.push({
      ...jsonClone(data.sources[0]!),
      id: "foreign-source",
      productId: "fixture-other-sku",
      salesUnitId: "other-sale",
    });
    const output = fixtureOutput("sku-filling");
    output.values[0].evidence[0].sourceId = "foreign-source";
    blocks(await checked("sku-filling", output, data), "R09");
  });
  test("false and zero survive, but unknown/NA/conflict must not carry a business value", async () => {
    const data = fixtureSnapshot(),
      fact = data.sources[0]!.facts.find((f) => f.id === "layers")!;
    fact.value = 0;
    fact.quote = "层数0层";
    data.sources[0]!.text = data.sources[0]!.text.replace("层数3层", "层数0层");
    const output = fixtureOutput("sku-filling");
    output.values[1].value = 0;
    output.values[1].evidence[0].quote = "层数0层";
    expect((await checked("sku-filling", output, data)).status).toBe(
      "program_pass_pending_human",
    );
    expect(output.values[0].value).toBe(false);
    output.values[0].status = "unknown";
    blocks(await checked("sku-filling", output, data), "R09");
    output.values[0].value = null;
    output.values[0].evidence = [];
    expect((await checked("sku-filling", output, data)).status).toBe(
      "program_pass_pending_human",
    );
    output.values[0].status = "not_applicable";
    blocks(await checked("sku-filling", output, data), "R09");
    output.values[0].status = "conflict";
    blocks(await checked("sku-filling", output, data), "R12");
  });
  test("fact unit/scope/value must match direct values, not merely quoted words", async () => {
    const output = fixtureOutput("sku-filling");
    output.values[1].value = 4;
    blocks(await checked("sku-filling", output), "R09");
    const data = fixtureSnapshot();
    data.sources[0]!.facts.find((f) => f.id === "layers")!.unit = "张";
    blocks(
      await checked("sku-filling", fixtureOutput("sku-filling"), data),
      "R09",
    );
  });
  test("a derived value cannot overwrite a conflicting direct fact", async () => {
    const data = fixtureSnapshot(),
      source = data.sources[0]!;
    source.text += "销售总卷数41卷。";
    source.facts.push({
      id: "different-total",
      conceptKey: "paper.total_rolls",
      value: 41,
      scope: "sales-unit",
      unit: "卷/销售单位",
      quote: "销售总卷数41卷",
      kind: "direct",
    });
    blocks(
      await checked("sku-filling", fixtureOutput("sku-filling"), data),
      "R12",
    );
  });
  test("bad snapshot evidence, duplicate IDs, and source-version changes are not ignored", () => {
    const bad = fixtureSnapshot();
    bad.sources[0]!.facts[0]!.quote = "never present";
    expect(() => new DataSnapshot(prepareFixtureFacts(bad))).toThrow("quote");
    const duplicate = fixtureSnapshot();
    duplicate.sources.push(duplicate.sources[0]!);
    expect(() => new DataSnapshot(duplicate)).toThrow("duplicate");
    const a = new DataSnapshot(fixtureSnapshot()),
      changed = fixtureSnapshot();
    changed.sources[0]!.version = "revision-2";
    expect(new DataSnapshot(prepareFixtureFacts(changed)).version).not.toBe(
      a.version,
    );
  });
});

describe("tool permissions, request limits, and offline boundary", () => {
  test("tool arguments cannot escape the source or knowledge whitelist; stage cannot calculate arbitrarily", async () => {
    const tools = new ToolRegistry(
      new DataSnapshot(fixtureSnapshot()),
      release,
      fixtureTask("family-modeling"),
    );
    await expect(
      tools.call("knowledge_read", {
        id: "../../private",
        offset: 0,
        length: 20,
      }),
    ).rejects.toThrow("not registered");
    await expect(
      tools.call("sources_read", {
        id: "fixture-source",
        offset: 0,
        length: 20,
      }),
    ).rejects.toThrow("outside");
    await expect(
      tools.call("calculate_value", {
        attributeId: "fixture-total",
        derivation: fixtureValues()[2]!.derivation,
      }),
    ).rejects.toThrow("not allowed");
    const tiny = new ToolRegistry(
      new DataSnapshot(fixtureSnapshot()),
      release,
      fixtureTask("family-modeling"),
      10,
    );
    await expect(
      tiny.call("categories_get", { id: "fixture-root" }),
    ).rejects.toThrow("exceeds");
    expect(tiny.events).toHaveLength(0);
  });
  test("forbidden tool and malformed arguments do not execute", async () => {
    for (const call of [
      functionCall("write_product", { id: "fixture-sku" }),
      functionCall("sources_read", {
        id: "fixture-source",
        offset: 0,
        length: 8000,
        sql: "DROP",
      }),
    ]) {
      const dir = next(),
        mock = scriptedFetch([[call]]),
        client = new ResponsesClient(
          { mode: "offline", transportId: "invalid", fetch: mock.fetch },
          dir,
          new Budget(dir, 0, "offline-zero"),
        );
      await expect(
        runStage({
          release,
          snapshot: new DataSnapshot(fixtureSnapshot()),
          task: fixtureTask("sku-filling"),
          client,
          outDir: dir,
        }),
      ).rejects.toThrow();
      expect(client.calls).toBe(1);
    }
  });
  test("call count/round count/history bytes are host-enforced", async () => {
    for (const limits of [
      { maxToolCalls: 1 },
      { maxRounds: 1 },
      { maxRequestBytes: 100 },
    ]) {
      const dir = next(),
        mock = scriptedFetch([
          [
            functionCall("categories_get", { id: "fixture-root" }, "a"),
            functionCall("categories_get", { id: "fixture-root" }, "b"),
          ],
        ]);
      const client = new ResponsesClient(
        { mode: "offline", transportId: "limited", fetch: mock.fetch },
        dir,
        new Budget(dir, 0, "offline-zero"),
      );
      await expect(
        runStage({
          release,
          snapshot: new DataSnapshot(fixtureSnapshot()),
          task: fixtureTask("family-modeling"),
          client,
          outDir: dir,
          limits,
        }),
      ).rejects.toThrow();
      expect(client.calls).toBe(limits.maxRequestBytes ? 0 : 1);
    }
  });
  test("tool call IDs cannot repeat in a response group", async () => {
    const dir = next(),
      mock = scriptedFetch([
        [
          functionCall("categories_get", { id: "fixture-root" }, "same"),
          functionCall("categories_get", { id: "fixture-root" }, "same"),
        ],
      ]);
    const client = new ResponsesClient(
      { mode: "offline", transportId: "dup", fetch: mock.fetch },
      dir,
      new Budget(dir, 0, "offline-zero"),
    );
    await expect(
      runStage({
        release,
        snapshot: new DataSnapshot(fixtureSnapshot()),
        task: fixtureTask("family-modeling"),
        client,
        outDir: dir,
      }),
    ).rejects.toThrow("reused");
  });
  test("CLI cannot run batch/apply or accept unrecognized flags", async () => {
    for (const command of ["run", "batch", "apply"])
      await expect(main([command])).rejects.toThrow("offline-only");
    await expect(
      main(["offline-acceptance", "--concurrency", "32"]),
    ).rejects.toThrow();
  });
  test("fixture cannot enter network transport; no environment key lookup occurs", async () => {
    const dir = next(),
      client = new ResponsesClient(
        {
          mode: "network",
          allowNetwork: true,
          apiKey: "not-a-real-key",
          transportId: "never-network",
          perRequestUpperBoundCny: 1,
        },
        dir,
        new Budget(dir, 1, "explicit-estimate"),
      );
    await expect(
      runStage({
        release,
        snapshot: new DataSnapshot(fixtureSnapshot()),
        task: fixtureTask("family-modeling"),
        client,
        outDir: dir,
      }),
    ).rejects.toThrow("fixture");
    expect(client.calls).toBe(0);
  });
  test("unreleased/misrouted knowledge fails, and missing coverage is visible", async () => {
    const bad = fixtureSnapshot();
    bad.knowledgeIds = ["not-registered"];
    await expect(
      assemble(release, new DataSnapshot(bad), fixtureTask("family-modeling")),
    ).rejects.toThrow("unreleased");
    const data = fixtureSnapshot();
    data.knowledgeIds = [];
    const plan = await assemble(
      release,
      new DataSnapshot(data),
      fixtureTask("family-modeling"),
    );
    expect(plan.input.sharedContext.knowledgeCoverage).toBe(
      "gap_requires_research_or_human",
    );
    const local = fixtureSnapshot();
    local.kind = "local";
    local.sources = [];
    local.products = [];
    await expect(
      assemble(
        release,
        new DataSnapshot(local),
        fixtureTask("family-modeling"),
      ),
    ).rejects.toThrow("fixture");
  });
});

describe("shared budget, durable recovery, and material versions", () => {
  test("incomplete HTTP responses are retained for diagnosis and cannot be resent automatically", async () => {
    const dir = next(),
      budget = new Budget(dir, 0, "offline-zero");
    await budget.init();
    let sends = 0;
    const client = new ResponsesClient(
      {
        mode: "offline",
        transportId: "incomplete",
        fetch: async () => {
          sends++;
          return new Response(
            JSON.stringify({
              status: "incomplete",
              output: [],
              usage: { output_tokens: 1 },
            }),
          );
        },
      },
      dir,
      budget,
    );
    await expect(
      client.request(
        { input: "fixture" },
        { releaseId: release.id, snapshotVersion: "fixture" },
      ),
    ).rejects.toThrow("completed response");
    await expect(
      client.request(
        { input: "fixture" },
        { releaseId: release.id, snapshotVersion: "fixture" },
      ),
    ).rejects.toThrow("no automatic resend");
    expect(sends).toBe(1);
    const entry = (await budget.status()).entries[0]!;
    expect(
      (
        await read<any>(
          join(dir, "requests", entry.id + ".transport-response.json"),
        )
      ).text,
    ).toContain("incomplete");
  });
  test("concurrent reservations share one cap and cannot raise it on resume", async () => {
    const dir = next(),
      a = new Budget(dir, 1, "explicit-upper-bound"),
      b = new Budget(dir, 1, "explicit-upper-bound");
    await Promise.all([a.init(), b.init()]);
    const result = await Promise.allSettled([
      a.reserve("a", 0.6),
      b.reserve("b", 0.6),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await a.status()).committedUpperBoundCny).toBe(0.6);
    await expect(
      new Budget(dir, 2, "explicit-upper-bound").init(),
    ).rejects.toThrow("cannot change");
  });
  test("unknown response keeps reservation and is not automatically sent again", async () => {
    const dir = next(),
      budget = new Budget(dir, 0, "offline-zero");
    await budget.init();
    let sends = 0;
    const client = new ResponsesClient(
      {
        mode: "offline",
        transportId: "unknown",
        fetch: async () => {
          sends++;
          throw Error("connection lost after send");
        },
      },
      dir,
      budget,
    );
    const body = { instructions: "fixture" },
      identity = { releaseId: release.id, snapshotVersion: "fixture" };
    await expect(client.request(body, identity)).rejects.toThrow(
      "connection lost",
    );
    await expect(client.request(body, identity)).rejects.toThrow(
      "no automatic resend",
    );
    expect(sends).toBe(1);
    expect((await budget.status()).entries[0]!.status).toBe("outcome_unknown");
  });
  test("two concurrent identical requests send exactly once", async () => {
    const dir = next(),
      budget = new Budget(dir, 0, "offline-zero");
    await budget.init();
    const mock = scriptedFetch([[finalMessage({ ok: true })]]);
    const client = new ResponsesClient(
        { mode: "offline", transportId: "concurrent", fetch: mock.fetch },
        dir,
        budget,
      ),
      body = { input: "fixture" },
      identity = { releaseId: release.id, snapshotVersion: "fixture" };
    const results = await Promise.all([
      client.request(body, identity),
      client.request(body, identity),
    ]);
    expect(results[0]!.key).toBe(results[1]!.key);
    expect(client.calls).toBe(1);
    expect(client.cacheHits).toBe(1);
  });
  test("changed snapshot invalidates cached requests; old replies cannot silently carry over", async () => {
    const dir = next(),
      budget = new Budget(dir, 0, "offline-zero");
    await budget.init();
    const mock = scriptedFetch([
      [finalMessage({ version: 1 })],
      [finalMessage({ version: 2 })],
    ]);
    const client = new ResponsesClient(
        { mode: "offline", transportId: "version", fetch: mock.fetch },
        dir,
        budget,
      ),
      body = { input: "fixture" };
    const a = await client.request(body, {
        releaseId: release.id,
        snapshotVersion: "v1",
      }),
      b = await client.request(body, {
        releaseId: release.id,
        snapshotVersion: "v2",
      });
    expect(a.key).not.toBe(b.key);
    expect(client.calls).toBe(2);
  });
  test("material/code drift in an isolated copied release prevents loading", async () => {
    const root = join(next(), "src/scenarios/product_governance_v3");
    await cp(ROOT, root, { recursive: true });
    for (const file of ["../product_governance_v2/runtime/store.ts"]) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await readFile(join(ROOT, file), "utf8"));
    }
    // No v2 docs are present: the copied release must load the v3-owned rules.
    expect(
      await Bun.file(
        join(
          root,
          "../product_governance_v2/docs/governance-standard-draft.md",
        ),
      ).exists(),
    ).toBe(false);
    expect((await loadRelease(root)).id).toBe(release.id);
    await writeFile(
      join(root, "skills/family-modeling/SKILL.md"),
      "changed after freeze",
    );
    await expect(loadRelease(root)).rejects.toThrow("changed");
  });
});

describe("real category-tree algorithm, pagination, and immutable identities", () => {
  test("cross-parent registered family is returned; same parent is not automatic family", async () => {
    const tools = new ToolRegistry(
      new DataSnapshot(fixtureSnapshot()),
      release,
      fixtureTask("family-modeling"),
    );
    const related = await tools.call("find_related_categories", {
      id: "fixture-cored-category",
      limit: 10,
      cursor: null,
    });
    expect(
      related.items.some(
        (r: any) =>
          r.node.id === "fixture-coreless-category" &&
          r.reason === "registered_family",
      ),
    ).toBe(true);
    expect(
      related.items.some((r: any) => r.node.id === "fixture-seat-category"),
    ).toBe(false);
  });
  test("pagination/traversal has explicit coverage; wrong query/tree cursor is rejected", () => {
    const tree = new CategoryIndex(fixtureSnapshot().tree),
      items = tree.descendants("fixture-root", true),
      p1 = tree.page(items, "leaves", 2);
    expect(p1.total).toBe(4);
    expect(p1.truncated).toBe(true);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = tree.page(items, "leaves", 2, p1.nextCursor);
    expect(p2.items).toHaveLength(2);
    expect(p2.truncated).toBe(false);
    expect(() => tree.page(items, "other-query", 2, p1.nextCursor)).toThrow(
      "cursor",
    );
    const changed = fixtureSnapshot().tree;
    (changed.nodes[0] as any).name = "changed";
    expect(() =>
      new CategoryIndex(changed).page(items, "leaves", 2, p1.nextCursor),
    ).toThrow("cursor");
  });
  test("cycles, missing parents, duplicate IDs, and leaf-with-children fail early", () => {
    const raw = fixtureSnapshot().tree;
    for (const change of [
      (r: any) => (r.nodes[0].parentId = "fixture-parent-a"),
      (r: any) => (r.nodes[1].parentId = "absent"),
      (r: any) => r.nodes.push(r.nodes[0]),
      (r: any) => (r.nodes[0].isLeaf = true),
    ]) {
      const r = jsonClone(raw);
      change(r);
      expect(() => new CategoryIndex(r)).toThrow();
    }
  });
  test("text truncation is explicit and later slices allow evidence verification", async () => {
    const tools = new ToolRegistry(
      new DataSnapshot(fixtureSnapshot()),
      release,
      fixtureTask("sku-filling"),
    );
    const first = await tools.call("sources_read", {
      id: "fixture-source",
      offset: 0,
      length: 4,
    });
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(4);
    expect(tools.has("fixture-source", "层数3层")).toBe(false);
    await tools.call("sources_read", {
      id: "fixture-source",
      offset: 4,
      length: 8000,
    });
    expect(tools.has("fixture-source", "层数3层")).toBe(true);
  });
});
