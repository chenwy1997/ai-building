import { test, expect, beforeAll } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixtureSnapshot,
  fixtureTask,
  fixtureOutput,
  attribute,
  prepareFixtureFacts,
  binding,
} from "./fixtures.ts";
import {
  hash,
  jsonClone,
  factPreparationHash,
  save,
  read,
  type Task,
} from "./core.ts";
import { DataSnapshot } from "./snapshot.ts";
import { loadRelease, type Release } from "./release.ts";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import {
  extractionErrors,
  preparationBundle,
  importFactReview,
  type FactReview,
  type FactExtraction,
} from "./fact-preparation.ts";
import {
  captureRollPilot,
  validateReadRequest,
  ROLL_CATEGORIES,
  type ReadTransport,
} from "./scm-readonly.ts";
import {
  parsePrismaFields,
  fieldRole,
  systemFieldsFromInventory,
} from "./scm-field-inventory.ts";
import {
  rollDefinitions,
  rollBindings,
  prepareRollPilot,
} from "./roll-pilot.ts";
let release: Release;
beforeAll(async () => {
  release = await loadRelease();
});
async function sample(text?: string) {
  const data = fixtureSnapshot();
  data.sources[0]!.facts = [];
  data.sources[0]!.factPreparation.status = "candidate";
  if (text) {
    data.sources[0]!.text = text;
    data.sources[0]!.facts = [];
    prepareFixtureFacts(data);
  }
  prepareFixtureFacts(data);
  const snap = new DataSnapshot(data),
    task = fixtureTask("fact-extraction"),
    plan = await assemble(release, snap, task),
    result = fixtureOutput("fact-extraction") as FactExtraction;
  return { data, snap, task, plan, result };
}
test("new extraction skill and its cases, required knowledge, raw source and fixed contract reach actual context", async () => {
  const { plan } = await sample();
  expect(plan.manifest.skill).toHaveLength(2);
  expect(plan.instructions).toContain("UTF-16");
  expect(plan.input.contractAttributes).toHaveLength(3);
  expect(plan.input.evidence).not.toHaveLength(0);
  expect(plan.tools.definitions.some((t) => t.name === "calculate_value")).toBe(
    false,
  );
});
test("exact extraction returns candidate bundle, never automatically reviewed facts", async () => {
  const { plan, task, result } = await sample(),
    b = preparationBundle(task, result, plan.tools);
  expect(b.adoption).toBe("pending_human");
  expect(b.candidates[0]!.semanticStatus).toBe("pending_human");
  expect(b.bundleHash.length).toBe(64);
});
for (const [label, edit] of [
  ["wrong SKU", (r: any) => (r.productId = "another-sku")],
  ["wrong source", (r: any) => (r.candidates[0].sourceId = "absent")],
  ["stale version", (r: any) => (r.candidates[0].sourceVersion = "stale")],
  ["wrong span", (r: any) => r.candidates[0].start++],
  ["invented quote", (r: any) => (r.candidates[0].quote = "99层")],
  ["wrong numeric value", (r: any) => (r.candidates[0].value = 9)],
  ["foreign attribute", (r: any) => (r.candidates[0].attributeId = "brand")],
  ["duplicates", (r: any) => r.candidates.push({ ...r.candidates[0] })],
  ["unknown as direct fact", (r: any) => (r.candidates[0].value = null)],
] as const)
  test("extraction blocks " + label, async () => {
    const { plan, task, result } = await sample();
    edit(result);
    expect(checkResult(task, result, plan.tools).errors.length).toBeGreaterThan(
      0,
    );
  });
test("read gaps cannot support a quotation even if source contains it", async () => {
  const { snap, task, result } = await sample();
  const { ToolRegistry } = await import("./tools.ts");
  const t = new ToolRegistry(snap, release, task);
  await t.call("sources_read", {
    id: result.candidates[0]!.sourceId,
    offset: 0,
    length: 1,
  });
  expect(
    extractionErrors(task, result, t).some((e) => e.message.includes("span")),
  ).toBe(true);
});
test("kg-to-g conversion is replayable, but g/m² is not g and arithmetic is not extraction", async () => {
  const data = fixtureSnapshot(),
    a = attribute({
      id: "fixture-mass",
      conceptKey: "paper.declared_mass",
      name: "单卷标称质量",
      fieldType: "number",
      unit: "g",
      scope: "single-roll-declared-mass",
    });
  data.families[0]!.attributes = [a];
  data.families[0]!.bindings = [binding(a.id)];
  data.attributes = [a];
  data.sources[0]!.text = "单卷标称质量0.14kg；定量14g/m²";
  data.sources[0]!.facts = [];
  prepareFixtureFacts(data);
  const snap = new DataSnapshot(data),
    task = fixtureTask("fact-extraction"),
    plan = await assemble(release, snap, task);
  const quote = "单卷标称质量0.14kg",
    r: FactExtraction = {
      categoryId: task.categoryId,
      productId: task.productId!,
      candidates: [
        {
          id: "mass",
          attributeId: a.id,
          sourceId: data.sources[0]!.id,
          sourceVersion: data.sources[0]!.version,
          start: 0,
          end: quote.length,
          quote,
          value: 140,
          normalization: "kg-to-g",
          rationale: "单位归一候选，语义仍需人工",
        },
      ],
      unresolved: [],
    };
  expect(extractionErrors(task, r, plan.tools)).toEqual([]);
  r.candidates[0]!.value = 14;
  expect(extractionErrors(task, r, plan.tools).length).toBeGreaterThan(0);
  r.candidates[0] = {
    ...r.candidates[0]!,
    quote: "定量14g/m²",
    start: quote.length + 1,
    end: data.sources[0]!.text.length,
    normalization: "identity",
    value: 14,
  };
  expect(extractionErrors(task, r, plan.tools).length).toBeGreaterThan(0);
});
test("same-scope contradictory candidates are retained as a conflict and cannot both be adopted", async () => {
  const { snap, task, plan, result } = await sample("层数3层；层数4层"),
    s = snap.data.sources[0]!;
  result.candidates = [3, 4].map((n, i) => ({
    id: "candidate-" + n,
    attributeId: "fixture-layers",
    sourceId: s.id,
    sourceVersion: s.version,
    start: i * 5,
    end: i * 5 + 4,
    quote: "层数" + n + "层",
    value: n,
    normalization: "identity",
    rationale: "保留相反原文",
  }));
  const b = preparationBundle(task, result, plan.tools);
  expect(b.conflicts).toHaveLength(1);
  const review: FactReview = {
    bundleHash: b.bundleHash,
    reviewer: "synthetic-test-reviewer",
    reviewedAt: "2026-10-22T10:00:00Z",
    decisions: b.candidates.map((c) => ({
      candidateId: c.id,
      candidateHash: c.candidateHash,
      decision: "accept",
      conceptConfirmed: true,
      scopeConfirmed: true,
      unitConfirmed: true,
      conflictsChecked: true,
      note: "构造测试意见",
    })),
  };
  await expect(importFactReview(snap, b, review)).rejects.toThrow(
    "conflicting",
  );
});
async function reviewFixture() {
  const s = await sample(),
    bundle = preparationBundle(s.task, s.result, s.plan.tools),
    c = bundle.candidates[0]!;
  const review: FactReview = {
    bundleHash: bundle.bundleHash,
    reviewer: "synthetic-test-reviewer",
    reviewedAt: "2026-10-22T10:00:00Z",
    decisions: [
      {
        candidateId: c.id,
        candidateHash: c.candidateHash,
        decision: "accept",
        conceptConfirmed: true,
        scopeConfirmed: true,
        unitConfirmed: true,
        conflictsChecked: true,
        note: "构造测试，非真实人审",
      },
    ],
  };
  return { ...s, bundle, review };
}
test("explicit semantic review is imported locally and only its accepted fact authorizes known filling", async () => {
  const { snap, bundle, review } = await reviewFixture(),
    imported = await importFactReview(snap, bundle, review);
  expect(imported.receipt.acceptedFacts).toBe(1);
  expect(imported.receipt.productionWrites).toBe(0);
  const task = fixtureTask("sku-filling"),
    plan = await assemble(release, imported.snapshot, task),
    r = fixtureOutput("sku-filling");
  r.values = r.values.map((v: any) =>
    v.attributeId === "fixture-layers"
      ? {
          ...v,
          evidence: [
            {
              sourceId: "fixture-source",
              factId: bundle.candidates[0]!.id,
              quote: bundle.candidates[0]!.quote,
            },
          ],
        }
      : {
          ...v,
          status: "unknown",
          value: null,
          evidence: [],
          derivation: null,
        },
  );
  expect(checkResult(task, r, plan.tools).errors).toEqual([]);
});
for (const [label, edit] of [
  [
    "missing semantic confirmation",
    (r: any) => (r.decisions[0].scopeConfirmed = false),
  ],
  ["stale candidate", (r: any) => (r.decisions[0].candidateHash = "wrong")],
  ["duplicate review", (r: any) => r.decisions.push({ ...r.decisions[0] })],
  ["unidentified reviewer", (r: any) => (r.reviewer = "")],
  ["missing review time", (r: any) => (r.reviewedAt = "")],
  [
    "impossible calendar date",
    (r: any) => (r.reviewedAt = "2026-02-31T10:00:00Z"),
  ],
] as const)
  test("human import refuses " + label, async () => {
    const { snap, bundle, review } = await reviewFixture();
    edit(review);
    await expect(importFactReview(snap, bundle, review)).rejects.toThrow();
  });
test("defer/reject do not become reviewed facts; changed raw text or knowledge release invalidates old opinions", async () => {
  const { snap, bundle, review } = await reviewFixture();
  review.decisions[0]!.decision = "defer";
  expect(
    (await importFactReview(snap, bundle, review)).receipt.acceptedFacts,
  ).toBe(0);
  const changed = jsonClone(snap.data);
  changed.sources[0]!.text += "补充";
  prepareFixtureFacts(changed);
  await expect(
    importFactReview(new DataSnapshot(changed), bundle, review),
  ).rejects.toThrow("drift");
  const b = jsonClone(bundle);
  b.releaseId = "old";
  const { bundleHash, ...body } = b;
  b.bundleHash = hash(body);
  review.bundleHash = b.bundleHash;
  await expect(importFactReview(snap, b, review)).rejects.toThrow("release");
});
test("agent cannot self-certify facts as reviewed", () => {
  const data = fixtureSnapshot();
  data.sources[0]!.factPreparation.kind = "agent";
  expect(() => new DataSnapshot(data)).toThrow("agent preparation");
});
test("complete source inventory detects newly added scalar fields and distinguishes evidence carriers", () => {
  const rows = parsePrismaFields(
    "model Product {\n  id String @id\n  title String // 商品名称\n  parameter String? // 参数证据\n  newUnknown String?\n}\n",
    "Product",
  );
  expect(rows.map((f) => f.role)).toEqual([
    "technical",
    "base_business",
    "evidence_container",
    "unresolved",
  ]);
  expect(fieldRole("WEIGHT")).toBe("base_business");
  expect(fieldRole("paper.single_roll_mass")).toBe("unresolved");
  expect(fieldRole("OTHER_ATTR")).toBe("evidence_container");
});
test("declared inventory covers every scalar responsibility and native aliases without excluding single-roll mass", async () => {
  const inv = JSON.parse(
      await readFile(
        join(import.meta.dir, "scm-field-responsibilities.json"),
        "utf8",
      ),
    ),
    fields = systemFieldsFromInventory(inv, [
      {
        key: "SPEC_UNITS",
        title: "售卖单位",
        propertyInstanceId: "native",
        role: "base_business",
      },
    ]);
  expect(inv.unknown).toEqual([]);
  expect(inv.fields.length).toBe(233);
  expect(inv.sources.length).toBe(12);
  for (const f of inv.fields.filter((f: any) => f.role === "base_business"))
    expect(fields.some((x) => x.key === f.key)).toBe(true);
  expect(fields.some((f) => f.names.includes("单卷重量"))).toBe(false);
  expect(fields.some((f) => f.names.includes("售卖单位"))).toBe(true);
});
test("two real family leaves share all proposed definitions and optional bindings, with registered professional references", async () => {
  const attrs = await rollDefinitions();
  expect(attrs).toHaveLength(7);
  expect(attrs.some((a) => ["roll.printed", "roll.embossed"].includes(a.id))).toBe(false);
  expect(attrs.some((a) => a.name === "是否无芯")).toBe(true);
  expect(rollBindings(attrs).every((b) => b.requiredness === "optional")).toBe(
    true,
  );
  expect(attrs.every((a) => a.references[0]!.kind === "knowledge")).toBe(true);
  expect(attrs.some((a) => a.name === "销售总卷数")).toBe(false);
});
test("read guard rejects mall IDs, broad pagination, extra write arguments and non-read actions", () => {
  const c = ROLL_CATEGORIES[0],
    body = { stdCategoryIds: [c.standardCategoryId], page: 1, pageSize: 3 };
  expect(() =>
    validateReadRequest("getProductListByStdCategoryIds", body),
  ).not.toThrow();
  for (const b of [
    { ...body, stdCategoryIds: [c.id] },
    { ...body, page: 2 },
    { ...body, pageSize: 4 },
    { ...body, save: true },
  ])
    expect(() =>
      validateReadRequest("getProductListByStdCategoryIds", b),
    ).toThrow();
  expect(() => validateReadRequest("saveProduct" as any, {})).toThrow();
  expect(() =>
    validateReadRequest("getProductInfo", { skus: ["f".repeat(36)] }),
  ).toThrow();
});
const ids = [
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
];
const mockRead =
  (detail: any = null): ReadTransport =>
  async (action, body: any) =>
    action === "getProductInfo"
      ? (detail ?? body.skus.map((sku: string) => ({ sku })))
      : {
          total: 1,
          items: [
            {
              id: ids[
                ROLL_CATEGORIES.findIndex(
                  (c) => c.standardCategoryId === body.stdCategoryIds[0],
                )
              ]!,
              productInstanceId:
                body.stdCategoryIds[0] === ROLL_CATEGORIES[0].standardCategoryId
                  ? "cccccccc-cccc-cccc-cccc-cccccccccccc"
                  : "dddddddd-dddd-dddd-dddd-dddddddddddd",
              standardCategoryId: body.stdCategoryIds[0],
              standardCategory: {
                id: body.stdCategoryIds[0],
                name: ROLL_CATEGORIES.find(
                  (c) => c.standardCategoryId === body.stdCategoryIds[0],
                )!.name,
              },
              secret: "should-not-save",
            },
          ],
        };
test("bounded collector records exact reads and redacts secrets without any write-capable action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pgv3-read-")),
    r = await captureRollPilot(dir, mockRead(), 1);
  expect(r.selectedIds).toEqual(ids);
  expect(r.captures).toHaveLength(3);
  expect(r.productionWrites).toBe(0);
  const capture = await readFile(
    join(dir, "raw", ROLL_CATEGORIES[0].id + ".json"),
    "utf8",
  );
  expect(capture).not.toContain("should-not-save");
  expect(capture).toContain("REDACTED");
});
test("collector rejects missing/duplicate detail SKUs and out-of-scope list responses", async () => {
  for (const details of [
    [],
    [{ sku: ids[0] }, { sku: ids[0] }],
    [{ sku: "unexpected" }],
  ])
    await expect(
      captureRollPilot(
        await mkdtemp(join(tmpdir(), "pgv3-bad-read-")),
        mockRead(details),
        1,
      ),
    ).rejects.toThrow();
  const wrong: ReadTransport = async () => ({
    total: 1,
    items: [
      {
        id: ids[0],
        productInstanceId: ids[1],
        standardCategoryId: "wrong",
        standardCategory: { id: "wrong", name: "wrong" },
      },
    ],
  });
  await expect(
    captureRollPilot(
      await mkdtemp(join(tmpdir(), "pgv3-wrong-category-")),
      wrong,
    ),
  ).rejects.toThrow("category");
});
test("native capture bridge preserves original text/JSON location and rejects namespace or byte drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pgv3-bridge-")),
    captureDir = join(dir, "capture"),
    prepared = join(dir, "prepared"),
    treePath = join(dir, "tree.json");
  const tree = {
    rootId: "root",
    nodes: [
      {
        id: "root",
        name: "卫生纸",
        path: "卫生纸",
        parentId: null,
        isLeaf: false,
      },
      ...ROLL_CATEGORIES.map((c) => ({
        id: c.id,
        standardCategoryId: c.standardCategoryId,
        name: c.name,
        path: "卫生纸>" + c.name,
        parentId: "root",
        isLeaf: true,
      })),
    ],
  };
  await save(treePath, tree);
  const transport: ReadTransport = async (action, body: any) => {
    if (action === "getProductInfo")
      return body.skus.map((sku: string) => ({
        sku,
        title: "合成样例3层",
        saleSpec: "测试",
      }));
    const envelope: any = await mockRead()(action, body),
      item = envelope.items[0];
    item.categoryInstanceId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    item.categoryInstance = {
      categoryId: ROLL_CATEGORIES.find(
        (c) => c.standardCategoryId === body.stdCategoryIds[0],
      )!.id,
    };
    item.propertyValueInstanceOnProductInstances = [
      {
        propertyValueInstance: {
          id: "test-value",
          stringValue: "合成样例3层",
          propertyInstance: {
            id: "test-property-instance",
            propertyId: "test-property",
            key: "title",
            title: "商品名称",
            valueType: "STRING",
            asSpec: false,
          },
        },
      },
    ];
    return envelope;
  };
  await captureRollPilot(captureDir, transport, 1);
  await prepareRollPilot(captureDir, prepared, treePath);
  const snapshot = new DataSnapshot(
      await read(join(prepared, "snapshot.raw.json")),
    ),
    p = snapshot.data.products[0]!,
    task = {
      ...fixtureTask("fact-extraction"),
      runId: "roll-real-pilot-20261022",
      categoryId: p.categoryId,
      productId: p.id,
    },
    plan = await assemble(release, snapshot, task);
  const source = snapshot.data.sources[0]!;
  expect(source.facts).toEqual([]);
  expect(source.factPreparation).toMatchObject({
    kind: "agent",
    status: "candidate",
  });
  expect(source.origin!.jsonPointer).toEndWith("/stringValue");
  expect(source.text).toEndWith("合成样例3层");
  const rewritten = jsonClone(snapshot.data);
  rewritten.sources[0]!.text += "伪造";
  rewritten.sources[0]!.factPreparation.contentHash = factPreparationHash(
    rewritten.sources[0]!,
  );
  expect(() => new DataSnapshot(rewritten)).toThrow("captured raw value");
  expect((plan.input.evidence[0] as any).origin.productInstanceId).toBe(
    source.origin!.productInstanceId,
  );
  expect(
    plan.input.sharedContext.knowledge.some(
      (k) => k.id === "scm-field-responsibilities-20261022",
    ),
  ).toBe(true);
  const changed = jsonClone(tree);
  Object.assign(changed.nodes[1]!, {
    standardCategoryId: ROLL_CATEGORIES[0].id,
  });
  await save(treePath, changed);
  await expect(
    prepareRollPilot(captureDir, prepared, treePath),
  ).rejects.toThrow("mapping");
  await save(treePath, tree);
  const path = join(captureDir, "raw", ROLL_CATEGORIES[0].id + ".json"),
    cap = await read<any>(path);
  cap.response.items[0].id = "tampered";
  await save(path, cap);
  await expect(
    prepareRollPilot(captureDir, prepared, treePath),
  ).rejects.toThrow("corrupted");
});
test("capture failures preserve a sanitized incomplete receipt and cannot overwrite a completed capture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pgv3-failed-read-"));
  await expect(
    captureRollPilot(
      dir,
      async () => {
        throw Error("credential-like secret should not be printed");
      },
      1,
    ),
  ).rejects.toThrow();
  const failed = await readFile(join(dir, "capture-failed.json"), "utf8");
  expect(failed).not.toContain("credential-like");
  expect(JSON.parse(failed).automaticRetries).toBe(0);
  const fresh = await mkdtemp(join(tmpdir(), "pgv3-repeat-read-"));
  await captureRollPilot(fresh, mockRead(), 1);
  await expect(captureRollPilot(fresh, mockRead(), 1)).rejects.toThrow(
    "already fixed",
  );
});
