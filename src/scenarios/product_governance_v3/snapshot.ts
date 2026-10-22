import {
  assertSchema,
  object,
  text,
  list,
  nullable,
  numeric,
  bool,
  STAGES,
  freeze,
  jsonClone,
  hash,
  factPreparationHash,
  REQUIRED_SYSTEM_OWNERS,
  normalized,
  Blocked,
  type Snapshot,
  type Task,
  type Family,
} from "./core.ts";
import { attributeSchema, bindingSchema, valueSchema } from "./contracts.ts";
import { CategoryIndex } from "./catalog.ts";

const strings = list(text()),
  sourceSchema = object(
    {
      id: text(),
      productId: text(),
      salesUnitId: text(),
      version: text(),
      text: text(),
      facts: list(
        object({
          id: text(),
          conceptKey: text(),
          value: valueSchema,
          unit: nullable(text()),
          scope: text(),
          quote: text(),
          kind: text("direct"),
        }),
      ),
      origin: object({
        sourceId: text(),
        productId: text(),
        productInstanceId: text(),
        governanceCategoryId: text(),
        standardCategoryId: text(),
        categoryInstanceId: nullable(text()),
        stableMountedCategoryId: nullable(text()),
        propertyId: text(),
        propertyInstanceId: text(),
        propertyValueInstanceId: text(),
        jsonPointer: text(),
        capturePath: text(),
        captureHash: text(),
        rawValueHash: text(),
        capturedAt: text(),
        sourceKind: text(),
        derivedText: bool,
      }),
      factPreparation: object({
        status: text("candidate", "reviewed"),
        kind: text("fixture", "human", "agent"),
        recordId: text(),
        contentHash: text(),
      }),
    },
    [
      "id",
      "productId",
      "salesUnitId",
      "version",
      "text",
      "facts",
      "factPreparation",
    ],
  );
const snapshotSchema = object({
  format: { type: "integer", enum: [2] },
  version: text(),
  kind: text("fixture", "local"),
  tree: object(
    {
      nodes: list({ type: "object" }),
      rootId: text(),
      externalParentIds: strings,
    },
    ["nodes"],
  ),
  systemFields: list(
    object({ key: text(), names: strings, conceptKeys: strings }),
  ),
  systemFieldCoverage: object({
    version: text(),
    source: text(),
    sourceHash: text(),
    status: text("complete", "partial"),
    coveredKeys: strings,
  }),
  families: list(
    object({
      id: text(),
      version: text(),
      members: strings,
      status: text("confirmed", "candidate", "in_progress", "failed"),
      runId: nullable(text()),
      attributes: list(attributeSchema),
      bindings: list(bindingSchema),
    }),
  ),
  attributes: list(attributeSchema),
  sources: list(sourceSchema),
  products: list(
    object({
      id: text(),
      categoryId: text(),
      salesUnitId: text(),
      composition: text("homogeneous", "mixed", "unknown"),
      giftState: text("none", "present", "unknown"),
      assumptionSourceIds: strings,
      sourceIds: strings,
    }),
  ),
  knowledgeIds: strings,
  knowledgeRequirements: list(
    object({
      id: text(),
      categoryIds: list(text(), 1),
      stages: list(text(...STAGES), 1),
      knowledgeIds: list(text(), 1),
      reason: text(),
    }),
  ),
  derivationPolicies: list(
    object({
      id: text(),
      version: text(),
      rationale: text(),
      operator: text("multiply", "divide", "convert"),
      targetConceptKey: text(),
      inputConceptKeys: strings,
      targetUnit: text(),
      factors: list(
        object({
          conceptKey: text(),
          unit: text(),
          kind: text("count", "measurement"),
          min: nullable(numeric),
          max: nullable(numeric),
        }),
        1,
      ),
      resultKind: text("count", "measurement"),
    }),
  ),
});
function ids(items: { id: string }[], label: string) {
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new Error("duplicate " + label);
}
export class DataSnapshot {
  readonly data: Snapshot;
  readonly tree: CategoryIndex;
  readonly version: string;
  constructor(input: unknown) {
    assertSchema(snapshotSchema, input, "snapshot");
    const data = jsonClone(input as Snapshot);
    this.tree = new CategoryIndex(data.tree);
    ids(data.families, "families");
    ids(data.attributes, "attributes");
    ids(data.sources, "sources");
    ids(data.products, "products");
    ids(data.derivationPolicies, "derivation policies");
    ids(data.knowledgeRequirements, "knowledge requirements");
    if (
      new Set(data.systemFields.map((f) => f.key)).size !==
      data.systemFields.length
    )
      throw Error("duplicate system field keys");
    const coverage = data.systemFieldCoverage;
    const requiredOwners = REQUIRED_SYSTEM_OWNERS;
    if (
      coverage.status !== "complete" ||
      data.systemFields.length === 0 ||
      requiredOwners.some(
        (owner) =>
          !coverage.coveredKeys.includes(owner.key) ||
          !data.systemFields.some(
            (f) =>
              f.key === owner.key &&
              owner.names.every((n) =>
                f.names.some((v) => normalized(v) === normalized(n)),
              ) &&
              owner.conceptKeys.every((k) =>
                f.conceptKeys.some((v) => normalized(v) === normalized(k)),
              ),
          ),
      ) ||
      data.systemFields.some(
        (f) =>
          !f.names.length ||
          !f.conceptKeys.length ||
          !coverage.coveredKeys.includes(f.key),
      ) ||
      coverage.coveredKeys.some(
        (key) => !data.systemFields.some((f) => f.key === key),
      )
    )
      throw new Blocked(
        "system_field_coverage",
        "complete, versioned system field responsibilities are required, including brandId/supplierId/salesUnit/specName",
      );
    if (coverage.sourceHash !== hash(data.systemFields))
      throw new Blocked(
        "system_field_coverage",
        "system field coverage hash does not match responsibilities",
      );
    for (const r of data.knowledgeRequirements)
      r.categoryIds.forEach((id) => this.tree.get(id));
    for (const p of data.derivationPolicies) {
      if (
        p.factors.length !== p.inputConceptKeys.length ||
        p.factors.some(
          (f, i) =>
            f.conceptKey !== p.inputConceptKeys[i] ||
            (f.min !== null && f.max !== null && f.min > f.max),
        ) ||
        p.factors.length !== (p.operator === "convert" ? 1 : 2)
      )
        throw Error("invalid derivation policy factors");
    }
    for (const f of data.families) {
      f.members.forEach((id) => this.tree.get(id));
      ids(f.attributes, "family attributes");
      const bindingKeys = f.bindings.map(
        (b) => `${b.attributeId}|${b.categoryId ?? "*"}`,
      );
      if (
        new Set(bindingKeys).size !== bindingKeys.length ||
        f.bindings.some(
          (b) =>
            !f.attributes.some((a) => a.id === b.attributeId) ||
            (b.categoryId !== null && !f.members.includes(b.categoryId)),
        )
      )
        throw Error("invalid/duplicate family binding");
      if (
        f.attributes.some(
          (a) =>
            !f.bindings.some(
              (b) => b.attributeId === a.id && b.categoryId === null,
            ),
        )
      )
        throw Error("family definition needs a template binding");
      if (f.status === "candidate" && !f.runId)
        throw Error("candidate needs runId");
    }
    for (const p of data.products) {
      this.tree.get(p.categoryId);
      for (const id of [...p.sourceIds, ...p.assumptionSourceIds])
        if (
          !data.sources.some(
            (s) =>
              s.id === id &&
              s.productId === p.id &&
              s.salesUnitId === p.salesUnitId,
          )
        )
          throw Error("invalid product source binding");
    }
    for (const s of data.sources) {
      if (s.origin) {
        const marker = "\n原文：",
          start = s.text.indexOf(marker),
          p = data.products.find((p) => p.id === s.productId),
          node = data.tree.nodes.find(
            (n: any) => n.id === s.origin!.governanceCategoryId,
          ) as any;
        if (
          s.origin.derivedText ||
          start < 0 ||
          hash(s.text.slice(start + marker.length)) !== s.origin.rawValueHash ||
          s.origin.governanceCategoryId !== p?.categoryId ||
          (node?.standardCategoryId &&
            node.standardCategoryId !== s.origin.standardCategoryId)
        )
          throw new Blocked(
            "source_origin_content",
            "native source body/category differs from its captured raw value; transformed sources need a separate verified adapter",
          );
      }
      if (
        s.origin &&
        (s.origin.sourceId !== s.id ||
          s.origin.productId !== s.productId ||
          s.version !== hash(s.origin))
      )
        throw new Blocked(
          "source_origin_drift",
          "source identity/provenance differs from its frozen version",
        );
      if (
        s.factPreparation.status === "reviewed" &&
        s.factPreparation.kind === "agent"
      )
        throw new Blocked(
          "unreviewed_agent_facts",
          "agent preparation cannot authorize reviewed facts",
        );
      if (s.factPreparation.contentHash !== factPreparationHash(s))
        throw new Blocked(
          "fact_preparation_drift",
          "facts changed after preparation record or source context drifted",
        );
      if (data.kind === "local" && s.factPreparation.kind === "fixture")
        throw new Blocked(
          "fixture_facts",
          "fixture facts cannot enter local business data",
        );
      if (
        !data.products.some(
          (p) =>
            p.id === s.productId &&
            p.salesUnitId === s.salesUnitId &&
            p.sourceIds.includes(s.id),
        )
      )
        throw Error("source outside SKU/sales unit");
      ids(s.facts, "source facts");
      for (const f of s.facts)
        if (!s.text.includes(f.quote))
          throw Error("fact quote absent from source");
    }
    this.version = hash(data);
    this.data = freeze(data);
  }
  product(id: string) {
    const p = this.data.products.find((p) => p.id === id);
    if (!p) throw new Blocked("unknown_product", "unknown SKU " + id);
    return p;
  }
  source(id: string, task: Task) {
    const s = this.data.sources.find((s) => s.id === id);
    if (
      !s ||
      !task.productId ||
      s.productId !== task.productId ||
      !this.product(task.productId).sourceIds.includes(id)
    )
      throw new Blocked("source_scope", "source outside task SKU");
    return s;
  }
  families(categoryId: string, runId: string) {
    this.tree.get(categoryId);
    return this.data.families
      .filter((f) => f.members.includes(categoryId))
      .map((f) => ({
        ...f,
        availability:
          f.status === "confirmed"
            ? "confirmed"
            : f.status === "candidate"
              ? f.runId === runId
                ? "same_run_pending"
                : "other_run_pending"
              : f.status,
        usable:
          f.status === "confirmed" ||
          (f.status === "candidate" && f.runId === runId),
      }));
  }
  baseline(task: Task): Family | null {
    const families = this.families(task.categoryId, task.runId);
    if (
      families.some(
        (f) => f.availability === "in_progress" || f.availability === "failed",
      )
    )
      throw new Blocked(
        "family_dependency",
        "family context is in progress/failed; resolve dependency before modeling",
      );
    const usable = families.filter((f) => f.usable);
    if (usable.length > 1)
      throw new Blocked(
        "ambiguous_baseline",
        "multiple applicable baselines require explicit resolution",
      );
    return usable[0] ?? null;
  }
  attributes(task: Task) {
    const baseline = this.baseline(task);
    if (!baseline || !baseline.attributes.length)
      throw new Blocked(
        "missing_contract",
        "SKU filling/calculation requires an applicable fixed family contract; the global pool is not a contract",
      );
    return baseline.attributes.map((a) => ({
      ...a,
      binding: {
        ...(baseline.bindings.find(
          (b) => b.attributeId === a.id && b.categoryId === task.categoryId,
        ) ??
          baseline.bindings.find(
            (b) => b.attributeId === a.id && b.categoryId === null,
          )!),
        categoryId: task.categoryId,
      },
    }));
  }
  knowledgeRequirements(task: Task) {
    const stages = [task.stage];
    const candidateStage = (task.candidate as { stage?: string } | null)?.stage;
    if (
      task.stage === "review-assistance" &&
      ["family-modeling", "sku-filling"].includes(candidateStage ?? "")
    )
      stages.push(candidateStage as Task["stage"]);
    return this.data.knowledgeRequirements.filter(
      (r) =>
        r.categoryIds.includes(task.categoryId) &&
        r.stages.some((s) => stages.includes(s)),
    );
  }
  assertTask(task: Task) {
    if (!task.runId || !task.question)
      throw Error("task runId/question required");
    const node = this.tree.get(task.categoryId);
    if (!node.isLeaf)
      throw new Blocked(
        "leaf_required",
        "task needs an existing leaf category",
      );
    if (
      task.productId &&
      this.product(task.productId).categoryId !== task.categoryId
    )
      throw new Blocked("product_category", "SKU category does not match task");
    if (
      ["sku-filling", "fact-extraction"].includes(task.stage) &&
      !task.productId
    )
      throw new Blocked("product_required", "sku-filling needs productId");
  }
}
