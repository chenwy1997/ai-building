import {
  assertSchema,
  object,
  text,
  list,
  nullable,
  numeric,
  freeze,
  jsonClone,
  hash,
  Blocked,
  type Snapshot,
  type Task,
  type Family,
} from "./core.ts";
import { attributeSchema, valueSchema } from "./contracts.ts";
import { CategoryIndex } from "./catalog.ts";

const strings = list(text()),
  sourceSchema = object({
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
  });
const snapshotSchema = object({
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
  families: list(
    object({
      id: text(),
      version: text(),
      members: strings,
      status: text("confirmed", "candidate", "in_progress", "failed"),
      runId: nullable(text()),
      attributes: list(attributeSchema),
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
  derivationPolicies: list(
    object({
      id: text(),
      operator: text("multiply", "divide", "convert"),
      targetConceptKey: text(),
      inputConceptKeys: strings,
      targetUnit: text(),
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
    for (const f of data.families) {
      f.members.forEach((id) => this.tree.get(id));
      ids(f.attributes, "family attributes");
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
    return baseline.attributes;
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
    if (task.stage === "sku-filling" && !task.productId)
      throw new Blocked("product_required", "sku-filling needs productId");
  }
}
