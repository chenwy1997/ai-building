// HISTORICAL: requires contracts at commit 3ad6fa3041; observations are frozen.
// Current fixes are asserted in ../../contracts-regression.test.ts. Do not run this old schema against format 2.
// Read-only implementation audit. Observations are diagnostics, not regression tests
// asserting that current defects should be retained. No paid transport is used.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assemble } from "../../context.ts";
import { checkResult } from "../../checks.ts";
import {
  canonical,
  hash,
  STAGES,
  type Stage,
  type Snapshot,
  type Task,
} from "../../core.ts";
import { loadRelease } from "../../release.ts";
import { DataSnapshot } from "../../snapshot.ts";
import { Budget } from "../../budget.ts";
import { ResponsesClient } from "../../responses.ts";
import { runStage } from "../../runner.ts";
import {
  fixtureSnapshot,
  fixtureTask,
  fixtureOutput,
  fixtureValues,
  attribute,
  scriptedFetch,
  functionCall,
  finalMessage,
} from "../../fixtures.ts";

const outputDir = resolve(
  Bun.argv[2] ?? "outputs/product-governance-v3/implementation-audit-20261022",
);
await mkdir(outputDir, { recursive: true });
const release = await loadRelease();
const observations: { id: string; subject: string; observed: unknown }[] = [];
const record = (id: string, subject: string, observed: unknown) =>
  observations.push({ id, subject, observed });
let networkAttempts = 0;
const originalFetch = globalThis.fetch;
const denyNetwork = (): never => {
  networkAttempts++;
  throw new Error("audit prohibits network transport");
};
globalThis.fetch = Object.assign(async () => denyNetwork(), {
  preconnect: denyNetwork,
});

async function checked(
  stage: Stage,
  result: unknown,
  raw = fixtureSnapshot(),
  task: Task = fixtureTask(stage),
) {
  const plan = await assemble(release, new DataSnapshot(raw), task);
  return { checks: checkResult(task, result, plan.tools), plan };
}

try {
  const stagePlans = await Promise.all(
    STAGES.map(async (stage) => {
      const plan = await assemble(
        release,
        new DataSnapshot(fixtureSnapshot()),
        fixtureTask(stage),
      );
      return { stage, plan };
    }),
  );
  record(
    "P01",
    "Actual rules, skill bodies/references, schemas and tool lists",
    stagePlans.map(({ stage, plan }) => ({
      stage,
      ruleIds: plan.manifest.ruleIds,
      standard: plan.manifest.standard,
      systemContract: plan.manifest.systemContract,
      skillBodyPresent: plan.instructions.includes(
        release.skills[stage].body.body,
      ),
      allDeclaredReferencesPresent: release.skills[stage].references.every(
        (r) => plan.instructions.includes(r.body),
      ),
      tools: plan.tools.definitions.map((t) => t.name),
      knowledge: plan.manifest.knowledge,
    })),
  );

  const requiredHeadings = [
    "### 9.2 问题分级与结果采用",
    "### 9.5 本批交付的结束条件",
    "### 11.4 写后核验与生效状态",
    "### 11.5 部分成功与回退",
    "### 11.6 成本与迭代上限",
  ];
  record(
    "P02",
    "Approved sections missing from all stage instructions",
    requiredHeadings.map((heading) => ({
      heading,
      loadedBy: stagePlans
        .filter((p) => p.plan.instructions.includes(heading))
        .map((p) => p.stage),
    })),
  );

  const skuPlan = stagePlans.find((p) => p.stage === "sku-filling")!.plan;
  record(
    "P03",
    "Calculation policies exist only on host, without context/tool discovery",
    {
      policiesInSnapshot: skuPlan.tools.snapshot.data.derivationPolicies,
      policyIdVisibleInInput: canonical(skuPlan.input).includes(
        "fixture-total-policy",
      ),
      policyObjectVisibleInInput: canonical(skuPlan.input).includes(
        "inputConceptKeys",
      ),
      policyReadTool: skuPlan.tools.definitions.some((t) =>
        /policy|policies/.test(t.name),
      ),
    },
  );

  const pool = await skuPlan.tools.call("search_attribute_pool", {
    query: "层数",
    limit: 20,
    cursor: null,
  });
  record(
    "P04",
    "Mandatory pool query uses leaf name rather than target concepts",
    {
      prefetch: skuPlan.tools.events.find(
        (e) => e.name === "search_attribute_pool" && e.origin === "prefetch",
      ),
      conceptQueryHits: pool.total,
    },
  );

  const rawNoKnowledge = fixtureSnapshot();
  rawNoKnowledge.kind = "local";
  rawNoKnowledge.knowledgeIds = [];
  const noKnowledgeOutput = fixtureOutput("family-modeling");
  noKnowledgeOutput.unresolved = [];
  const noKnowledge = await checked(
    "family-modeling",
    noKnowledgeOutput,
    rawNoKnowledge,
  );
  record(
    "P05",
    "Missing professional knowledge is a marker, not a required stop/research state",
    {
      coverage: noKnowledge.plan.input.sharedContext.knowledgeCoverage,
      unresolved: noKnowledgeOutput.unresolved,
      checks: noKnowledge.checks,
    },
  );

  const withKnowledgeCitation = fixtureOutput("family-modeling");
  withKnowledgeCitation.attributes[0].sourceIds = ["clean-paper-fixture"];
  record(
    "P06",
    "Modeling cannot structurally cite a loaded knowledge document as sourceId",
    (await checked("family-modeling", withKnowledgeCitation)).checks,
  );

  const noFacts = fixtureSnapshot();
  noFacts.sources[0]!.facts = [];
  const rawTextValues = fixtureOutput("sku-filling");
  rawTextValues.values.forEach((v: any) =>
    v.evidence.forEach((e: any) => (e.factId = null)),
  );
  record(
    "P07",
    "Raw source text has no extraction-to-frozen-fact bridge",
    (await checked("sku-filling", rawTextValues, noFacts)).checks,
  );

  const noOwnership = fixtureSnapshot();
  noOwnership.systemFields = [];
  const brand = fixtureOutput("family-modeling");
  brand.attributes.push(
    attribute({
      id: "audit-brand",
      name: "品牌",
      conceptKey: "common.brand",
      fieldType: "text",
      differenceReason: "audit duplicate",
    }),
  );
  record(
    "P08",
    "Missing system field ownership can let a brand attribute pass",
    (await checked("family-modeling", brand, noOwnership)).checks,
  );

  const contradictoryGift = fixtureSnapshot(),
    giftSource = contradictoryGift.sources[0]!;
  giftSource.text += "另有同一销售组合赠品1卷。";
  giftSource.facts.push({
    id: "gifts-present",
    conceptKey: "sales.gifts",
    value: "present",
    unit: null,
    scope: "sales-unit",
    quote: "同一销售组合赠品1卷",
    kind: "direct",
  });
  const conflictingGift = await checked(
    "sku-filling",
    fixtureOutput("sku-filling"),
    contradictoryGift,
  );
  record("P09", "Conflicting assumptions do not block quantity arithmetic", {
    checks: conflictingGift.checks,
    calculation: await conflictingGift.plan.tools.call("calculate_value", {
      attributeId: "fixture-total",
      derivation: fixtureValues()[2]!.derivation,
    }),
  });

  const negative = fixtureSnapshot(),
    negativeSource = negative.sources[0]!;
  for (const [id, value, quote] of [
    ["per-bundle", -10, "每提-10卷"],
    ["bundles", -4, "每销售单位-4提"],
  ] as const) {
    const fact = negativeSource.facts.find((f) => f.id === id)!;
    negativeSource.text = negativeSource.text.replace(fact.quote, quote);
    fact.quote = quote;
    fact.value = value;
  }
  const negativeOutput = fixtureOutput("sku-filling");
  for (const e of negativeOutput.values[2].evidence)
    e.quote = negativeSource.facts.find((f) => f.id === e.factId)!.quote;
  record(
    "P10",
    "Two negative count factors produce a positive result accepted by the checker",
    (await checked("sku-filling", negativeOutput, negative)).checks,
  );

  const binding = fixtureOutput("family-modeling");
  binding.attributes[0].requiredness = "required";
  binding.attributes[0].differenceReason =
    "audit: leaf has an independently justified requiredness";
  record(
    "P11",
    "Leaf binding requiredness cannot differ from baseline even with a reason",
    (await checked("family-modeling", binding)).checks,
  );

  const long = fixtureSnapshot(),
    longSource = long.sources[0]!;
  const quote = longSource.facts[0]!.quote;
  longSource.text =
    "x".repeat(7997) + quote + longSource.text.replace(quote, "");
  const longResult = await checked(
    "sku-filling",
    fixtureOutput("sku-filling"),
    long,
  );
  record(
    "P12",
    "A quote crossing adjacent source chunks is treated as unread",
    {
      reads: longResult.plan.tools.sourceReads.get("fixture-source"),
      quoteRead: longResult.plan.tools.has("fixture-source", quote),
      checks: longResult.checks,
    },
  );

  const config = fixtureOutput("family-modeling");
  config.attributes[1].metaNumberPrecision = 2;
  config.attributes[1].displayInTitle = true;
  record(
    "P13",
    "Needed numeric/title configuration cannot enter the generation contract",
    (await checked("family-modeling", config)).checks,
  );

  const newFamily = fixtureSnapshot();
  newFamily.families = [];
  const newFamilyOutput = fixtureOutput("family-modeling");
  newFamilyOutput.baselineVersion = null;
  newFamilyOutput.attributes.forEach(
    (a: any) => (a.baselineAttributeId = null),
  );
  const newModel = await checked("family-modeling", newFamilyOutput, newFamily);
  let fillingError = "";
  try {
    await assemble(
      release,
      new DataSnapshot(newFamily),
      fixtureTask("sku-filling"),
    );
  } catch (error) {
    fillingError = String(error);
  }
  record(
    "P14",
    "Successful modeling output is not consumed as a downstream SKU contract",
    {
      modelingChecks: newModel.checks,
      subsequentSkuAssemblyError: fillingError,
    },
  );

  const dir = join(outputDir, "all-nine-tools");
  const calls: [string, unknown][] = [
    [
      "categories_search",
      { query: "卷纸", scopeId: null, limit: 10, cursor: null },
    ],
    ["categories_get", { id: "fixture-cored-category" }],
    [
      "categories_children",
      { id: "fixture-root", mode: "leaves", limit: 10, cursor: null },
    ],
    [
      "find_related_categories",
      { id: "fixture-cored-category", limit: 10, cursor: null },
    ],
    [
      "get_family_context",
      { categoryId: "fixture-cored-category", limit: 10, cursor: null },
    ],
    ["search_attribute_pool", { query: "层数", limit: 10, cursor: null }],
    ["knowledge_read", { id: "clean-paper-fixture", offset: 0, length: 8000 }],
    ["sources_read", { id: "fixture-source", offset: 0, length: 8000 }],
    [
      "calculate_value",
      {
        attributeId: "fixture-total",
        derivation: fixtureValues()[2]!.derivation,
      },
    ],
  ];
  const mock = scriptedFetch([
    calls.map(([name, args], i) => functionCall(name, args, "audit-" + i)),
    (request) => {
      const results = request.input.filter(
        (i: any) => i.type === "function_call_output",
      );
      if (results.length !== 9) throw Error("missing actual tool returns");
      return [finalMessage(fixtureOutput("sku-filling"))];
    },
  ]);
  const client = new ResponsesClient(
    { mode: "offline", transportId: "audit-all-nine-tools", fetch: mock.fetch },
    dir,
    new Budget(dir, 0, "offline-zero"),
  );
  const allTools = await runStage({
    release,
    snapshot: new DataSnapshot(fixtureSnapshot()),
    task: fixtureTask("sku-filling"),
    client,
    outDir: dir,
  });
  record(
    "P15",
    "All nine registered tools actually dispatch and return through the Responses loop",
    {
      status: allTools.checks.status,
      mockRequests: client.calls,
      cachedResponses: client.cacheHits,
      modelCalls: allTools.toolEvents
        .filter((e) => e.origin === "model")
        .map((e) => e.name),
      returnedCalls:
        mock.requests[1]?.input?.filter(
          (i: any) => i.type === "function_call_output",
        ).length ?? (client.cacheHits ? "replayed" : 0),
    },
  );

  const changedAssumptionsEvidence = fixtureSnapshot();
  const source = changedAssumptionsEvidence.sources[0]!;
  source.facts[0]!.value = true; // same quote now disagrees with structured value.
  const changedOutput = fixtureOutput("sku-filling");
  changedOutput.values[0].value = true;
  record(
    "P16",
    "Quote existence does not validate the semantic correctness of curated facts",
    (await checked("sku-filling", changedOutput, changedAssumptionsEvidence))
      .checks,
  );

  const research = fixtureOutput("domain-research");
  research.proposedFamilyIds = ["audit-proposed-new-family"];
  record(
    "P17",
    "Research output cannot represent a genuinely new family proposal",
    (await checked("domain-research", research)).checks,
  );

  const a = new Budget(join(outputDir, "ledger-a"), 0.6, "audit-estimate"),
    b = new Budget(join(outputDir, "ledger-b"), 0.6, "audit-estimate");
  await Promise.all([a.init(), b.init()]);
  const priorA = await a.status(),
    priorB = await b.status();
  if (!priorA.entries.length) await a.reserve("same-batch-stage-a", 0.6);
  if (!priorB.entries.length) await b.reserve("same-batch-stage-b", 0.6);
  record(
    "P18",
    "Budget cap is directory-local; runId has no enforced shared ledger identity",
    {
      eachLimit: 0.6,
      committedA: (await a.status()).committedUpperBoundCny,
      committedB: (await b.status()).committedUpperBoundCny,
      actualMoneySpent: 0,
    },
  );

  const isoDate = fixtureSnapshot(),
    date = attribute({
      id: "audit-date",
      name: "日期",
      conceptKey: "date",
      fieldType: "date",
    });
  isoDate.families[0]!.attributes.push(date);
  isoDate.sources[0]!.text += "日期2026-02-31。";
  isoDate.sources[0]!.facts.push({
    id: "date",
    conceptKey: "date",
    value: "2026-02-31",
    unit: null,
    scope: "sales-unit",
    quote: "日期2026-02-31",
    kind: "direct",
  });
  const dateOutput = fixtureOutput("sku-filling");
  dateOutput.values.push({
    attributeId: "audit-date",
    status: "known",
    value: "2026-02-31",
    evidence: [
      { sourceId: "fixture-source", factId: "date", quote: "日期2026-02-31" },
    ],
    derivation: null,
    reason: "audit invalid date",
  });
  record(
    "P19",
    "Calendar-invalid ISO-shaped dates are accepted",
    (await checked("sku-filling", dateOutput, isoDate)).checks,
  );

  record(
    "P20",
    "Canonical JSON sorts SKU evidence before the purported shared family prefix",
    {
      inputKeyOrder: Object.keys(JSON.parse(canonical(skuPlan.input))),
      instructionsHash: hash(skuPlan.instructions),
      sharedContextIncludesCurrentCategory: true,
    },
  );

  const result = {
    kind: "implementation_audit_observations_not_business_acceptance",
    auditedReleaseId: release.id,
    snapshotKind: "constructed_only",
    networkAttempts,
    paidModelCalls: 0,
    productionWrites: 0,
    observations,
  };
  await writeFile(
    join(outputDir, "observations.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      releaseId: release.id,
      observations: observations.length,
      networkAttempts,
      output: join(outputDir, "observations.json"),
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
}
