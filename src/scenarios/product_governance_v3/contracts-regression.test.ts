import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import {
  hash,
  jsonClone,
  STAGES,
  type Snapshot,
  type Stage,
  type AttributeDefinition,
} from "./core.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ToolRegistry } from "./tools.ts";
import {
  loadRelease,
  RULE_REGISTRY,
  STAGE_RULES,
  ROOT,
  type Release,
} from "./release.ts";
import { projectNative } from "./native-contract.ts";
import {
  attribute,
  binding,
  fixtureSnapshot,
  fixtureTask,
  fixtureOutput,
  fixtureValues,
  prepareFixtureFacts,
  scriptedFetch,
  functionCall,
  finalMessage,
} from "./fixtures.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { runStage } from "./runner.ts";

let release: Release,
  temp: string,
  serial = 0;
beforeAll(async () => {
  release = await loadRelease();
  temp = await mkdtemp(join(tmpdir(), "pgv3-contracts-"));
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
async function plan(stage: Stage, data = fixtureSnapshot()) {
  return assemble(release, new DataSnapshot(data), fixtureTask(stage));
}
async function checked(
  stage: Stage,
  output: unknown,
  data = fixtureSnapshot(),
) {
  return checkResult(
    fixtureTask(stage),
    output,
    (await plan(stage, data)).tools,
  );
}
function blocked(
  report: ReturnType<typeof checkResult>,
  rule: string,
  message?: string,
) {
  expect(report.status).toBe("program_blocked");
  expect(
    report.errors.some(
      (e) => e.ruleId === rule && (!message || e.message.includes(message)),
    ),
  ).toBe(true);
}
function citation(id = "clean-paper-fixture") {
  const k = release.knowledge[id]!;
  return {
    kind: "knowledge" as const,
    id,
    version: k.sha256,
    quote: k.body.split("\n").find((s) => s.trim() && !s.startsWith("#"))!,
  };
}
function addValueFixture(a: AttributeDefinition, rawValue: any) {
  const data = fixtureSnapshot(),
    output = fixtureOutput("sku-filling");
  data.families[0]!.attributes.push(a);
  data.families[0]!.bindings.push(binding(a.id));
  const source = data.sources[0]!,
    quote = `构造${a.name}：${JSON.stringify(rawValue)}`;
  source.text += quote;
  source.facts.push({
    id: "extra-fact",
    kind: "direct",
    conceptKey: a.conceptKey,
    value: rawValue,
    unit: a.unit,
    scope: a.scope,
    quote,
  });
  prepareFixtureFacts(data);
  output.values.push({
    attributeId: a.id,
    status: "known",
    value: rawValue,
    evidence: [{ sourceId: source.id, factId: "extra-fact", quote }],
    derivation: null,
    reason: "构造资料明示",
  });
  return { data, output };
}
async function runMock(
  stage: Stage,
  mock: ReturnType<typeof scriptedFetch>,
  data = fixtureSnapshot(),
) {
  const dir = join(temp, String(serial++)),
    budget = new Budget(dir, 0, "offline-zero");
  const client = new ResponsesClient(
    { mode: "offline", transportId: "contracts-regression", fetch: mock.fetch },
    dir,
    budget,
  );
  const artifact = await runStage({
    release,
    snapshot: new DataSnapshot(data),
    task: fixtureTask(stage),
    client,
    outDir: dir,
  });
  return { artifact, client, budget, dir };
}

describe("rule registry: real stage responsibilities and loaded material", () => {
  test("all 26 rules map sections, artifacts, concrete checks or deferred work and human examples", async () => {
    expect(new Set(RULE_REGISTRY.map((r) => r.id)).size).toBe(26);
    for (const r of RULE_REGISTRY) {
      expect(r.human.length).toBeGreaterThan(0);
      expect(r.artifacts.length).toBeGreaterThan(0);
      expect(r.examples.positive).not.toBe(r.examples.negative);
      for (const heading of r.sections)
        expect(release.standard.body).toContain(heading);
      for (const p of r.program) {
        expect(p.evidence).toMatch(/\.test\.ts:/);
        const [testFile, testCase] = p.evidence.split(":");
        expect(await readFile(join(ROOT, testFile!), "utf8")).toContain(
          testCase!,
        );
        const [file, symbol] = p.entry.split(":");
        expect(await readFile(join(ROOT, file!), "utf8")).toContain(symbol!);
      }
    }
    expect(RULE_REGISTRY.find((r) => r.id === "R02")!.human[0]).toContain(
      "必填理由",
    );
    expect(RULE_REGISTRY.find((r) => r.id === "R25")!.sections).toContain(
      "### 6.1 SKU填写与销售展示",
    );
  });
  test("previously omitted adoption, closure, verification, rollback and cost sections enter actual HTTP instructions", async () => {
    const mock = scriptedFetch([
      [finalMessage(fixtureOutput("review-assistance"))],
    ]);
    const { artifact } = await runMock("review-assistance", mock);
    const sent = mock.requests[0],
      input = JSON.parse(sent.input[0].content);
    for (const heading of [
      "### 9.2 问题分级与结果采用",
      "### 9.5 本批交付的结束条件",
      "### 11.4 写后核验与生效状态",
      "### 11.5 部分成功与回退",
      "### 11.6 成本与迭代上限",
    ])
      expect(sent.instructions).toContain(heading);
    expect(sent.instructions).not.toContain("具体工具及跨批次协调尚未实现");
    expect(sent.instructions).not.toContain("本轮没有建立v3执行入口");
    expect(input.sharedContext.ruleResponsibilities).toEqual(RULE_REGISTRY);
    expect(artifact.manifest.ruleRegistryHash).toBe(hash(RULE_REGISTRY));
    expect(artifact.checks.humanReviewRules).toContain("R02");
    expect(artifact.adoption).toBe("pending_human");
  });
  test("every source rule section is reachable by at least one stage; all four load their skill and declared references", async () => {
    const plans = await Promise.all(STAGES.map((s) => plan(s)));
    for (const r of RULE_REGISTRY)
      for (const heading of r.sections)
        expect(plans.some((p) => p.instructions.includes(heading))).toBe(true);
    for (const [i, p] of plans.entries()) {
      const stage = STAGES[i]!;
      expect(p.instructions).toContain(release.skills[stage].body.body);
      for (const ref of release.skills[stage].references)
        expect(p.instructions).toContain(ref.body);
      expect(p.manifest.ruleIds).toEqual(STAGE_RULES[stage]);
    }
  });
});

describe("system ownership and fact preparation prerequisites", () => {
  test("system ownership cannot be disabled by an empty or incomplete responsibility table", () => {
    const empty = fixtureSnapshot();
    empty.systemFields = [];
    empty.systemFieldCoverage.sourceHash = hash([]);
    expect(() => new DataSnapshot(empty)).toThrow("responsibilities");
    const missing = fixtureSnapshot();
    missing.systemFields = missing.systemFields.filter(
      (f) => f.key !== "specName",
    );
    missing.systemFieldCoverage.sourceHash = hash(missing.systemFields);
    expect(() => new DataSnapshot(missing)).toThrow("responsibilities");
    const partial = fixtureSnapshot();
    partial.systemFieldCoverage.status = "partial";
    expect(() => new DataSnapshot(partial)).toThrow("responsibilities");
    const drift = fixtureSnapshot();
    drift.systemFields[0]!.names.push("别名");
    expect(() => new DataSnapshot(drift)).toThrow("hash does not match");
    const disguised = fixtureSnapshot();
    disguised.systemFields[0]!.names = ["无关名称"];
    disguised.systemFieldCoverage.sourceHash = hash(disguised.systemFields);
    expect(() => new DataSnapshot(disguised)).toThrow("responsibilities");
    expect(new DataSnapshot(fixtureSnapshot()).data.systemFields).toHaveLength(
      4,
    );
  });
  test("old flat format and stale fact preparation fail explicitly", () => {
    const old = { ...fixtureSnapshot(), format: 1 };
    expect(() => new DataSnapshot(old)).toThrow("format");
    const changed = fixtureSnapshot();
    changed.sources[0]!.facts[0]!.value = true;
    expect(() => new DataSnapshot(changed)).toThrow(
      "facts changed after preparation",
    );
    const local = fixtureSnapshot();
    local.kind = "local";
    expect(() => new DataSnapshot(local)).toThrow("fixture facts");
  });
  test("candidate facts remain readable but cannot authorize known values or calculations", async () => {
    const data = fixtureSnapshot();
    data.sources[0]!.factPreparation.status = "candidate";
    const p = await plan("sku-filling", data),
      out = fixtureOutput("sku-filling");
    expect(p.input.evidence[0].factPreparation.status).toBe("candidate");
    blocked(
      checkResult(fixtureTask("sku-filling"), out, p.tools),
      "R09",
      "candidate facts",
    );
    await expect(
      p.tools.call("calculate_value", {
        attributeId: "fixture-total",
        derivation: fixtureValues()[2]!.derivation,
      }),
    ).rejects.toThrow("candidate facts");
  });
});

describe("binding differences preserve shared definitions", () => {
  test("binding differences with a business reason are accepted and remain pending human review", async () => {
    const output = fixtureOutput("family-modeling");
    output.bindings[1].requiredness = "required";
    output.bindings[1].requirednessReason = "构造：缺层数会妨碍本类关键选型";
    output.bindings[1].differenceReason =
      "构造：本类采购任务需要层数比较，待人工确认";
    output.bindings[1].displayInTitle = true;
    expect((await checked("family-modeling", output)).status).toBe(
      "program_pass_pending_human",
    );
    output.bindings[1].differenceReason = null;
    blocked(await checked("family-modeling", output), "R03", "binding change");
    const keySpec = fixtureOutput("family-modeling");
    Object.assign(keySpec.bindings[0], {
      isKeySpec: true,
      uses: ["display"],
      differenceReason: "构造规格选购用途，待人工确认",
    });
    blocked(await checked("family-modeling", keySpec), "R07");
    keySpec.bindings[0].uses.push("selection");
    expect((await checked("family-modeling", keySpec)).status).toBe(
      "program_pass_pending_human",
    );
  });
  test("a reason cannot authorize a unilateral change to a common name, unit or numeric precision", async () => {
    for (const change of [
      (a: any) => (a.name = "单卷标称重量"),
      (a: any) => (a.unit = "张"),
      (a: any) => (a.numberConfig.precision = 2),
    ]) {
      const output = fixtureOutput("family-modeling");
      output.bindings[1].differenceReason = "有理由也应另提共享修订";
      change(output.attributes[1]);
      blocked(
        await checked("family-modeling", output),
        "R03",
        "shared definition changed",
      );
    }
  });
  test("leaf bindings resolve independently; wrong leaf, duplicate or absent bindings are rejected", async () => {
    const data = fixtureSnapshot();
    data.families[0]!.bindings.push(
      binding("fixture-layers", {
        categoryId: "fixture-cored-category",
        requiredness: "required",
        differenceReason: "构造局部必要性",
      }),
    );
    const snap = new DataSnapshot(data);
    expect(
      snap.attributes(fixtureTask("sku-filling"))[1]!.binding.requiredness,
    ).toBe("required");
    expect(
      snap.attributes({
        ...fixtureTask("sku-filling"),
        categoryId: "fixture-coreless-category",
      })[1]!.binding.requiredness,
    ).toBe("optional");
    for (const mutate of [
      (o: any) => o.bindings.pop(),
      (o: any) => o.bindings.push(o.bindings[0]),
      (o: any) => (o.bindings[0].categoryId = "fixture-seat-category"),
    ]) {
      const o = fixtureOutput("family-modeling");
      mutate(o);
      blocked(await checked("family-modeling", o), "CONTRACT");
    }
  });
  test("scoped attribute pool prefetch retrieves concepts without matching the complete leaf name", async () => {
    const p = await plan("family-modeling");
    expect(
      (p.input.sharedContext as any).attributePool.items.some(
        (a: any) => a.name === "层数",
      ),
    ).toBe(true);
    expect(
      p.tools.events.find((e) => e.name === "search_attribute_pool")!.arguments,
    ).toEqual({
      query: null,
      categoryId: "fixture-cored-category",
      limit: 20,
      cursor: null,
    });
    await expect(
      p.tools.call("search_attribute_pool", {
        query: null,
        limit: 10,
        cursor: null,
      }),
    ).rejects.toThrow("categoryId");
  });
});

describe("native configuration contract is exercised in persisted stage output", () => {
  test("native configuration survives model output, checks and stored projection with no defaults or production writes", async () => {
    const data = fixtureSnapshot(),
      output = fixtureOutput("family-modeling");
    data.families = [];
    output.baselineVersion = null;
    output.bindings.forEach((b: any) => (b.baselineAttributeId = null));
    output.attributes[1].numberConfig = {
      isInt: false,
      precision: 2,
      min: -5,
      max: 100,
    };
    Object.assign(output.bindings[1], {
      displayInTitle: true,
      displayInList: true,
      sortIndex: 7,
    });
    const { artifact, dir } = await runMock(
      "family-modeling",
      scriptedFetch([[finalMessage(output)]]),
      data,
    );
    expect(artifact.checks.status).toBe("program_pass_pending_human");
    const p = artifact.nativeProjections[1]!;
    expect(p.fields).toMatchObject({
      valueType: "NUMBER",
      asSpec: true,
      required: false,
      isKeySpec: false,
      displayInTitle: true,
      displayInList: true,
      sortIndex: 7,
      metaNumberPrecision: 2,
      metaNumberMinValue: -5,
      metaNumberMaxValue: 100,
      metaNumberDefault: null,
    });
    const saved = JSON.parse(
      await readFile(
        join(dir, "runs", artifact.runKey + ".result.json"),
        "utf8",
      ),
    );
    expect(saved.nativeProjections).toEqual(artifact.nativeProjections);
    expect(saved.productionWrites).toBe(0);
    expect(saved.adoption).toBe("pending_human");
  });
  test("text preset and option arrays project to actual native fields and newline protocol", () => {
    const s = attribute({
      fieldType: "text",
      textConfig: {
        format: "NUMBER_LETTER_DASH",
        minLength: 2,
        maxLength: 32,
        displayMethod: "longtext",
        trim: true,
      },
    });
    expect(projectNative(s, binding(s.id)).fields).toMatchObject({
      valueType: "STRING",
      metaStringRegex: "NUMBER_LETTER_DASH",
      metaStringMinLength: 2,
      metaStringMaxLength: 32,
      metaStringDisplayMethod: "longtext",
      needToTrim: true,
    });
    const o = attribute({
      fieldType: "option",
      enumValues: ["A", "B", "C"],
      multi: true,
      optionConfig: { minCount: 1, maxCount: 2 },
    });
    expect(projectNative(o, binding(o.id)).fields).toMatchObject({
      metaOptionItems: "A\nB\nC",
      metaOptionIsMulti: true,
      metaOptionMinCount: 1,
      metaOptionMaxCount: 2,
      metaOptionDefault: null,
    });
  });
  test("arbitrary regex, mismatched config, invalid ranges, default values and single-option counts fail", async () => {
    for (const a of [
      attribute({
        fieldType: "text",
        textConfig: {
          format: "^.*$",
          minLength: null,
          maxLength: null,
          displayMethod: null,
          trim: true,
        },
      }),
      attribute({
        fieldType: "number",
        unit: "g",
        numberConfig: { isInt: true, precision: 2, min: 0, max: 10 },
      }),
      attribute({
        fieldType: "number",
        unit: "g",
        numberConfig: { isInt: false, precision: 2, min: 20, max: 10 },
      }),
      attribute({
        fieldType: "boolean",
        numberConfig: { isInt: true, precision: null, min: 0, max: 10 },
      }),
      attribute({
        fieldType: "option",
        enumValues: ["A", "B"],
        optionConfig: { minCount: 1, maxCount: 2 },
      }),
    ]) {
      const o = fixtureOutput("family-modeling");
      o.attributes[0] = a;
      blocked(await checked("family-modeling", o), "R08");
      expect(() => projectNative(a, binding(a.id))).toThrow();
    }
    const o = fixtureOutput("family-modeling");
    o.attributes[0].defaultValue = false;
    blocked(await checked("family-modeling", o), "R10");
  });
});

describe("calendar and constraints validate known values without rewriting evidence", () => {
  for (const [value, valid] of [
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["2026-02-28", true],
    ["2026-02-31", false],
    ["1900-02-29", false],
    ["0000-01-01", false],
    ["2026-13-01", false],
  ] as const)
    test(`strict calendar ${value}`, async () => {
      const { data, output } = addValueFixture(
        attribute({
          id: "fixture-date",
          name: "构造日期",
          conceptKey: "fixture.date",
          fieldType: "date",
        }),
        value,
      );
      const r = await checked("sku-filling", output, data);
      if (valid) expect(r.status).toBe("program_pass_pending_human");
      else blocked(r, "R08", "calendar");
    });
  test("configured numeric precision/range/int, text trim/length/preset and option counts all reach final checks", async () => {
    const cases = [
      {
        a: attribute({
          id: "precision",
          name: "构造数值",
          conceptKey: "fixture.number",
          fieldType: "number",
          unit: "g",
          numberConfig: { isInt: false, precision: 2, min: 0, max: 10 },
        }),
        good: 1.23,
        bad: [1.234, -1, 11],
      },
      {
        a: attribute({
          id: "integer",
          name: "构造计数",
          conceptKey: "fixture.count",
          fieldType: "number",
          unit: "个",
          numberConfig: { isInt: true, precision: null, min: 0, max: 10 },
        }),
        good: 0,
        bad: [1.5],
      },
      {
        a: attribute({
          id: "text",
          name: "构造代码",
          conceptKey: "fixture.code",
          fieldType: "text",
          textConfig: {
            format: "NUMBER_LETTER",
            minLength: 2,
            maxLength: 4,
            displayMethod: null,
            trim: true,
          },
        }),
        good: "A12",
        bad: ["A", "A12345", " A12", "A-1"],
      },
      {
        a: attribute({
          id: "options",
          name: "构造选项",
          conceptKey: "fixture.options",
          fieldType: "option",
          enumValues: ["A", "B", "C"],
          multi: true,
          optionConfig: { minCount: 1, maxCount: 2 },
        }),
        good: ["A", "B"],
        bad: [
          ["A", "B", "C"],
          ["A", "A"],
        ],
      },
    ];
    for (const c of cases) {
      const good = addValueFixture(c.a, c.good);
      expect(
        (await checked("sku-filling", good.output, good.data)).status,
      ).toBe("program_pass_pending_human");
      for (const bad of c.bad) {
        const f = addValueFixture(c.a, bad);
        blocked(await checked("sku-filling", f.output, f.data), "R08");
      }
    }
  });
  test("multi-option order is not a false source conflict", async () => {
    const { data, output } = addValueFixture(
      attribute({
        id: "multi-set",
        name: "构造共存选项",
        conceptKey: "fixture.set",
        fieldType: "option",
        enumValues: ["A", "B"],
        multi: true,
      }),
      ["A", "B"],
    );
    output.values.at(-1).value = ["B", "A"];
    expect((await checked("sku-filling", output, data)).status).toBe(
      "program_pass_pending_human",
    );
  });
});

describe("knowledge discovery and versioned modeling citations", () => {
  test("knowledge citations work without SKU evidence; unread, wrong-version and wrong-kind references fail", async () => {
    const output = fixtureOutput("family-modeling");
    output.attributes[0].references = [citation()];
    expect((await checked("family-modeling", output)).status).toBe(
      "program_pass_pending_human",
    );
    for (const ref of [
      { ...citation(), version: "stale" },
      { ...citation(), quote: "not present" },
      { ...citation("hardware-fixture") },
      { ...citation(), kind: "sku-source" },
    ]) {
      output.attributes[0].references = [ref];
      blocked(await checked("family-modeling", output), "R11");
    }
    const sku = fixtureOutput("sku-filling");
    sku.values[0].evidence[0].sourceId = "clean-paper-fixture";
    blocked(await checked("sku-filling", sku), "R09");
  });
  test("an off-route whitelisted knowledge package can be discovered, read and cited through actual tool responses", async () => {
    const mock = scriptedFetch([
      [
        functionCall(
          "knowledge_list",
          { query: null, limit: 100, cursor: null },
          "inventory",
        ),
      ],
      (request) => {
        const inventory = JSON.parse(
          request.input.find(
            (i: any) =>
              i.call_id === "inventory" && i.type === "function_call_output",
          ).output,
        );
        const m = inventory.items.find((i: any) => !i.routingMatch);
        expect(m.id).toBe("hardware-fixture");
        expect(m.requiredForTask).toBe(false);
        return [
          functionCall(
            "knowledge_read",
            { id: m.id, offset: 0, length: 8000 },
            "read-extra",
          ),
        ];
      },
      (request) => {
        const m = JSON.parse(
          request.input.find(
            (i: any) =>
              i.call_id === "read-extra" && i.type === "function_call_output",
          ).output,
        );
        const output = fixtureOutput("family-modeling");
        output.attributes[0].references = [
          {
            kind: "knowledge",
            id: m.id,
            version: m.version,
            quote: m.text
              .split("\n")
              .find((s: string) => s.trim() && !s.startsWith("#")),
          },
        ];
        return [finalMessage(output)];
      },
    ]);
    const { artifact, client } = await runMock("family-modeling", mock);
    expect(artifact.checks.status).toBe("program_pass_pending_human");
    expect(client.calls).toBe(3);
    expect(artifact.toolCount).toBe(2);
    expect(
      artifact.toolEvents.some(
        (e) => e.name === "knowledge_read" && e.origin === "model",
      ),
    ).toBe(true);
    expect(
      artifact.actualReads.knowledge.some(
        (k) =>
          k.id === "hardware-fixture" &&
          k.version === release.knowledge["hardware-fixture"]!.sha256,
      ),
    ).toBe(true);
  });
  test("required knowledge overrides routing hints and a missing requirement or package blocks dependent candidates", async () => {
    const rerouted = fixtureSnapshot();
    rerouted.knowledgeRequirements[0]!.knowledgeIds = ["hardware-fixture"];
    expect(
      (await plan("family-modeling", rerouted)).tools.knowledgeReadIds.has(
        "hardware-fixture",
      ),
    ).toBe(true);
    for (const mutate of [
      (s: Snapshot) => (s.knowledgeIds = []),
      (s: Snapshot) => (s.knowledgeRequirements = []),
      (s: Snapshot) =>
        (s.knowledgeRequirements[0]!.knowledgeIds = [
          "missing-professional-package",
        ]),
    ]) {
      const data = fixtureSnapshot();
      mutate(data);
      const output = fixtureOutput("family-modeling");
      output.unresolved = [];
      blocked(
        await checked("family-modeling", output, data),
        "R11",
        "knowledge prerequisite",
      );
    }
    const local = fixtureSnapshot();
    local.kind = "local";
    local.sources = [];
    local.products = [];
    local.knowledgeIds = [];
    blocked(
      await checked("family-modeling", fixtureOutput("family-modeling"), local),
      "R11",
    );
  });
  test("domain research can record a gap, but cannot silently report no questions", async () => {
    const data = fixtureSnapshot();
    data.knowledgeIds = [];
    const output = fixtureOutput("domain-research");
    output.knowledgeIdsConsulted = [];
    expect((await checked("domain-research", output, data)).status).toBe(
      "program_pass_pending_human",
    );
    output.questions = [];
    output.unresolved = [];
    blocked(
      await checked("domain-research", output, data),
      "R17",
      "explicit unresolved",
    );
  });
  test("missing required knowledge stops dependent stages before even a mock HTTP request", async () => {
    const data = fixtureSnapshot();
    data.knowledgeIds = [];
    const dir = join(temp, String(serial++)),
      mock = scriptedFetch([[finalMessage(fixtureOutput("family-modeling"))]]);
    const client = new ResponsesClient(
      { mode: "offline", transportId: "no-knowledge-send", fetch: mock.fetch },
      dir,
      new Budget(dir, 0, "offline-zero"),
    );
    await expect(
      runStage({
        release,
        snapshot: new DataSnapshot(data),
        task: fixtureTask("family-modeling"),
        client,
        outDir: dir,
      }),
    ).rejects.toThrow("route to research/preparation");
    expect(client.calls).toBe(0);
    expect(mock.requests).toHaveLength(0);
  });
});

describe("calculation policy discovery and factor/assumption regression", () => {
  test("all eleven registered tools dispatch and return paired results in the actual function loop", async () => {
    const calls = [
      functionCall(
        "categories_search",
        { query: "卷纸", scopeId: null, limit: 10, cursor: null },
        "all-search",
      ),
      functionCall(
        "categories_get",
        { id: "fixture-cored-category" },
        "all-node",
      ),
      functionCall(
        "categories_children",
        { id: "fixture-root", mode: "leaves", limit: 100, cursor: null },
        "all-children",
      ),
      functionCall(
        "find_related_categories",
        { id: "fixture-cored-category", limit: 10, cursor: null },
        "all-related",
      ),
      functionCall(
        "get_family_context",
        { categoryId: "fixture-cored-category", limit: 10, cursor: null },
        "all-family",
      ),
      functionCall(
        "search_attribute_pool",
        { query: "层数", categoryId: null, limit: 10, cursor: null },
        "all-pool",
      ),
      functionCall(
        "knowledge_list",
        { query: null, limit: 10, cursor: null },
        "all-knowledge-list",
      ),
      functionCall(
        "knowledge_read",
        { id: "clean-paper-fixture", offset: 0, length: 8000 },
        "all-knowledge",
      ),
      functionCall(
        "sources_read",
        { id: "fixture-source", offset: 0, length: 8000 },
        "all-source",
      ),
      functionCall(
        "calculation_policies",
        { attributeId: "fixture-total", limit: 10, cursor: null },
        "all-policy",
      ),
      functionCall(
        "calculate_value",
        {
          attributeId: "fixture-total",
          derivation: fixtureValues()[2]!.derivation,
        },
        "all-calculate",
      ),
    ];
    const mock = scriptedFetch([
      calls,
      (request) => {
        const returned = request.input.filter(
          (i: any) => i.type === "function_call_output",
        );
        expect(returned).toHaveLength(calls.length);
        for (const call of calls)
          expect(returned.some((r: any) => r.call_id === call.call_id)).toBe(
            true,
          );
        expect(
          JSON.parse(
            returned.find((r: any) => r.call_id === "all-children").output,
          ).total,
        ).toBe(4);
        return [finalMessage(fixtureOutput("sku-filling"))];
      },
    ]);
    const { artifact } = await runMock("sku-filling", mock);
    expect(artifact.toolCount).toBe(11);
    expect(artifact.checks.status).toBe("program_pass_pending_human");
    expect(artifact.productionWrites).toBe(0);
  });
  test("model discovers policy and fact references from actual requests/tool output, calculates and persists the verified result", async () => {
    const data = fixtureSnapshot();
    data.derivationPolicies[0]!.id = "different-policy-id";
    data.derivationPolicies[0]!.version = "different-policy-version";
    let derivation: any;
    const mock = scriptedFetch([
      (request) => {
        const input = JSON.parse(request.input[0].content);
        expect(input.sharedContext.calculationPolicies[0].items[0].id).toBe(
          "different-policy-id",
        );
        return [
          functionCall(
            "calculation_policies",
            {
              attributeId: input.contractAttributes.find(
                (a: any) => a.conceptKey === "paper.total_rolls",
              ).id,
              limit: 10,
              cursor: null,
            },
            "policies",
          ),
        ];
      },
      (request) => {
        const input = JSON.parse(request.input[0].content),
          p = JSON.parse(
            request.input.find(
              (i: any) =>
                i.type === "function_call_output" && i.call_id === "policies",
            ).output,
          ).items[0];
        derivation = {
          policyId: p.id,
          policyVersion: p.version,
          operator: p.operator,
          targetUnit: p.targetUnit,
          inputs: p.factors.map((f: any) => {
            const source = input.evidence.find((s: any) =>
              s.facts.some((x: any) => x.conceptKey === f.conceptKey),
            );
            return {
              sourceId: source.id,
              factId: source.facts.find(
                (x: any) => x.conceptKey === f.conceptKey,
              ).id,
            };
          }),
        };
        return [
          functionCall(
            "calculate_value",
            { attributeId: "fixture-total", derivation },
            "compute",
          ),
        ];
      },
      (request) => {
        const result = JSON.parse(
          request.input.find(
            (i: any) =>
              i.type === "function_call_output" && i.call_id === "compute",
          ).output,
        );
        expect(result.policyVersion).toBe("different-policy-version");
        const output = fixtureOutput("sku-filling");
        output.values[2].value = result.value;
        output.values[2].derivation = derivation;
        return [finalMessage(output)];
      },
    ]);
    const { artifact, budget } = await runMock("sku-filling", mock, data);
    expect(artifact.checks.status).toBe("program_pass_pending_human");
    expect(artifact.toolCount).toBe(2);
    expect(artifact.checks.executedChecks).toContain("calculation");
    expect((await budget.status()).committedUpperBoundCny).toBe(0);
  });
  test("calculation factors reject negative and fractional counts, out-of-range values and stale policy versions", async () => {
    for (const [a, b, max] of [
      [-10, -4, null],
      [0.5, 80, null],
      [10, 4, 5],
    ] as const) {
      const data = fixtureSnapshot(),
        source = data.sources[0]!;
      source.facts.find((f) => f.id === "per-bundle")!.value = a;
      source.facts.find((f) => f.id === "bundles")!.value = b;
      data.derivationPolicies[0]!.factors[0]!.max = max;
      // Quotes are updated as well: this test must not pass solely because provenance broke.
      source.text = source.text
        .replace("每提10卷", `每提${a}卷`)
        .replace("每销售单位4提", `每销售单位${b}提`);
      source.facts.find((f) => f.id === "per-bundle")!.quote = `每提${a}卷`;
      source.facts.find((f) => f.id === "bundles")!.quote = `每销售单位${b}提`;
      prepareFixtureFacts(data);
      const output = fixtureOutput("sku-filling");
      output.values[2].value = a * b;
      output.values[2].evidence[0].quote = `每提${a}卷`;
      output.values[2].evidence[1].quote = `每销售单位${b}提`;
      blocked(
        await checked("sku-filling", output, data),
        "R14",
        "factor violates",
      );
    }
    const output = fixtureOutput("sku-filling");
    output.values[2].derivation.policyVersion = "stale";
    blocked(await checked("sku-filling", output), "R14", "policy");
  });
  test("calculation assumptions check contradictory gifts/composition and conflicting factor facts, not just one supporting statement", async () => {
    for (const [conceptKey, value, unit] of [
      ["sales.gifts", "present", null],
      ["sales.composition", "mixed", null],
      ["paper.rolls_per_bundle", 12, "卷/提"],
    ] as const) {
      const data = fixtureSnapshot(),
        source = data.sources[0]!,
        quote = `构造冲突${conceptKey}:${value}`;
      source.text += quote;
      source.facts.push({
        id: "contradiction",
        conceptKey,
        value,
        unit,
        scope: "sales-unit",
        quote,
        kind: "direct",
      });
      prepareFixtureFacts(data);
      blocked(
        await checked("sku-filling", fixtureOutput("sku-filling"), data),
        "R14",
        conceptKey.startsWith("sales.") ? "assumptions conflict" : "factor",
      );
    }
    const p = await plan("sku-filling");
    expect(
      (
        await p.tools.call("calculate_value", {
          attributeId: "fixture-total",
          derivation: fixtureValues()[2]!.derivation,
        })
      ).value,
    ).toBe(40);
  });
  test("an unrelated scope does not conflict; signed measurements are not falsely treated as counts", async () => {
    const data = fixtureSnapshot(),
      source = data.sources[0]!;
    source.text += "其他口径有赠品；相对偏移-2厘米";
    source.facts.push(
      {
        id: "unrelated-gift",
        conceptKey: "sales.gifts",
        value: "present",
        unit: null,
        scope: "other-object",
        quote: "其他口径有赠品",
        kind: "direct",
      },
      {
        id: "offset",
        conceptKey: "fixture.offset",
        value: -2,
        unit: "cm",
        scope: "sales-unit",
        quote: "相对偏移-2厘米",
        kind: "direct",
      },
    );
    const a = attribute({
      id: "fixture-offset",
      name: "相对偏移",
      conceptKey: "fixture.offset",
      fieldType: "number",
      unit: "mm",
    });
    data.families[0]!.attributes.push(a);
    data.families[0]!.bindings.push(binding(a.id));
    data.derivationPolicies.push({
      id: "offset-policy",
      version: "offset-v1",
      rationale: "构造有符号相对位置量",
      operator: "convert",
      targetConceptKey: a.conceptKey,
      targetUnit: "mm",
      inputConceptKeys: [a.conceptKey],
      factors: [
        {
          conceptKey: a.conceptKey,
          unit: "cm",
          kind: "measurement",
          min: -10,
          max: 10,
        },
      ],
      resultKind: "measurement",
    });
    prepareFixtureFacts(data);
    const p = await plan("sku-filling", data);
    expect(
      (
        await p.tools.call("calculate_value", {
          attributeId: "fixture-total",
          derivation: fixtureValues()[2]!.derivation,
        })
      ).value,
    ).toBe(40);
    expect(
      (
        await p.tools.call("calculate_value", {
          attributeId: a.id,
          derivation: {
            policyId: "offset-policy",
            policyVersion: "offset-v1",
            operator: "convert",
            inputs: [{ sourceId: source.id, factId: "offset" }],
            targetUnit: "mm",
          },
        })
      ).value,
    ).toBe(-20);
  });
});

describe("cross-slice quote reads are accurate and sent to the model", () => {
  test("adjacent reads merge; boundary-spanning fact and full quote reach the second result and final checks", async () => {
    const data = fixtureSnapshot(),
      source = data.sources[0]!;
    source.text = "x".repeat(7997) + source.text.replace("构造资料：", "");
    prepareFixtureFacts(data);
    const tools = new ToolRegistry(
      new DataSnapshot(data),
      release,
      fixtureTask("sku-filling"),
    );
    const first = await tools.call("sources_read", {
      id: source.id,
      offset: 0,
      length: 8000,
    });
    expect(first.facts.some((f: any) => f.id === "coreless")).toBe(false);
    expect(tools.has(source.id, "是否无芯：否")).toBe(false);
    const second = await tools.call("sources_read", {
      id: source.id,
      offset: 8000,
      length: 8000,
    });
    expect(second.facts.find((f: any) => f.id === "coreless").quote).toBe(
      "是否无芯：否",
    );
    expect(tools.has(source.id, "是否无芯：否")).toBe(true);
    const p = await plan("sku-filling", prepareFixtureFacts(data));
    expect(
      p.input.evidence.some((s) =>
        s.facts.some((f: any) => f.id === "coreless"),
      ),
    ).toBe(true);
    expect(
      checkResult(
        fixtureTask("sku-filling"),
        fixtureOutput("sku-filling"),
        p.tools,
      ).status,
    ).toBe("program_pass_pending_human");
  });
  test("a gap is not a read; over-budget results do not advance evidence provenance", async () => {
    const data = fixtureSnapshot(),
      source = data.sources[0]!;
    source.text = "x".repeat(7997) + source.text.replace("构造资料：", "");
    prepareFixtureFacts(data);
    const tools = new ToolRegistry(
      new DataSnapshot(data),
      release,
      fixtureTask("sku-filling"),
    );
    await tools.call("sources_read", {
      id: source.id,
      offset: 0,
      length: 7999,
    });
    await tools.call("sources_read", {
      id: source.id,
      offset: 8001,
      length: 8000,
    });
    expect(tools.has(source.id, "是否无芯：否")).toBe(false);
    await tools.call("sources_read", {
      id: source.id,
      offset: 7999,
      length: 2,
    });
    expect(tools.has(source.id, "是否无芯：否")).toBe(true);
    const tiny = new ToolRegistry(
      new DataSnapshot(data),
      release,
      fixtureTask("sku-filling"),
      10,
    );
    await expect(
      tiny.call("sources_read", { id: source.id, offset: 7997, length: 6 }),
    ).rejects.toThrow("exceeds budget");
    expect(tiny.sourceReads.size).toBe(0);
    expect(tiny.events).toHaveLength(0);
  });
});
