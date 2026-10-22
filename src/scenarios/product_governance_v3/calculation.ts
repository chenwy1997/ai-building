import {
  Blocked,
  canonical,
  type Attribute,
  type Fact,
  type Task,
} from "./core.ts";
import type { Derivation } from "./contracts.ts";
import type { DataSnapshot } from "./snapshot.ts";

export interface EvidenceReads {
  has(sourceId: string, quote: string): boolean;
}
export function resolveFact(
  snapshot: DataSnapshot,
  task: Task,
  ref: { sourceId: string; factId: string },
  reads: EvidenceReads,
) {
  const source = snapshot.source(ref.sourceId, task),
    fact = source.facts.find((f) => f.id === ref.factId);
  if (!fact || !reads.has(source.id, fact.quote))
    throw new Blocked(
      "unread_fact",
      "factor must reference a frozen fact in actually read source text",
    );
  return fact;
}
const dimensions: Record<string, { dimension: string; scale: number }> = {
  mm: { dimension: "length", scale: 1 },
  cm: { dimension: "length", scale: 10 },
  m: { dimension: "length", scale: 1000 },
  g: { dimension: "mass", scale: 1 },
  kg: { dimension: "mass", scale: 1000 },
};
export function calculate(
  snapshot: DataSnapshot,
  task: Task,
  attribute: Attribute,
  derivation: Derivation,
  reads: EvidenceReads,
) {
  const facts = derivation.inputs.map((ref) =>
    resolveFact(snapshot, task, ref, reads),
  );
  const policy = snapshot.data.derivationPolicies.find(
    (p) =>
      p.operator === derivation.operator &&
      p.targetConceptKey === attribute.conceptKey &&
      p.targetUnit === derivation.targetUnit &&
      canonical(p.inputConceptKeys) ===
        canonical(facts.map((f) => f.conceptKey)),
  );
  if (!policy || attribute.unit !== derivation.targetUnit)
    throw new Blocked(
      "calculation_policy",
      "no frozen semantic factor policy for target",
    );
  if (
    facts.some(
      (f) =>
        typeof f.value !== "number" ||
        !Number.isFinite(f.value) ||
        f.scope !== attribute.scope,
    )
  )
    throw new Blocked(
      "factor_scope",
      "numeric factors must share the target measurement scope",
    );
  const values = facts.map((f) => f.value as number);
  let value: number;
  if (derivation.operator === "convert") {
    if (facts.length !== 1)
      throw new Blocked("factor_count", "conversion needs one factor");
    const from = dimensions[facts[0]!.unit ?? ""],
      to = dimensions[derivation.targetUnit];
    if (!from || !to || from.dimension !== to.dimension)
      throw new Blocked("unit_mismatch", "conversion not registered");
    value = (values[0]! * from.scale) / to.scale;
  } else {
    if (facts.length !== 2)
      throw new Blocked(
        "factor_count",
        "quantity calculation needs two factors",
      );
    const product = snapshot.product(task.productId!);
    const assumption = (conceptKey: string, expected: string) =>
      product.assumptionSourceIds.some((id) => {
        const source = snapshot.source(id, task);
        return source.facts.some(
          (f) =>
            f.conceptKey === conceptKey &&
            f.value === expected &&
            f.scope === attribute.scope &&
            reads.has(id, f.quote),
        );
      });
    if (
      product.composition !== "homogeneous" ||
      product.giftState !== "none" ||
      !assumption("sales.composition", "homogeneous") ||
      !assumption("sales.gifts", "none")
    )
      throw new Blocked(
        "sales_assumptions",
        "uniform combination/no-gift assumptions need frozen source facts",
      );
    const a = (facts[0]!.unit ?? "").split("/"),
      b = (facts[1]!.unit ?? "").split("/");
    if (a.length !== 2 || b.length !== 2)
      throw new Blocked(
        "unit_mismatch",
        "quantity factor units must be ratios",
      );
    let computedUnit: string;
    if (derivation.operator === "multiply") {
      if (a[1] !== b[0])
        throw new Blocked("unit_mismatch", "factor units do not cancel");
      computedUnit = `${a[0]}/${b[1]}`;
      value = values[0]! * values[1]!;
    } else {
      if (a[1] !== b[1] || values[1] === 0)
        throw new Blocked("unit_mismatch", "division scope/zero denominator");
      computedUnit = `${a[0]}/${b[0]}`;
      value = values[0]! / values[1]!;
    }
    if (computedUnit !== derivation.targetUnit)
      throw new Blocked(
        "unit_mismatch",
        "calculation does not produce target unit",
      );
    if (!Number.isInteger(value) || value < 0)
      throw new Blocked(
        "invalid_count",
        "count must be a non-negative integer",
      );
  }
  if (!Number.isFinite(value))
    throw new Blocked("invalid_calculation", "non-finite result");
  return {
    value,
    unit: attribute.unit,
    scope: attribute.scope,
    policyId: policy.id,
    factors: derivation.inputs,
    sourceSnapshot: snapshot.version,
  };
}
