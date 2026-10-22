import {
  canonical,
  validate,
  normalized,
  type Attribute,
  type CheckReport,
  type Task,
  type Finding,
} from "./core.ts";
import { outputSchemas, type FilledValue } from "./contracts.ts";
import { RULES, STAGE_RULES } from "./release.ts";
import type { ToolRegistry } from "./tools.ts";
import { calculate, resolveFact } from "./calculation.ts";

// These checks establish structural consistency and provenance, not the truth of domain judgments.
export function checkResult(
  task: Task,
  result: unknown,
  tools: ToolRegistry,
): CheckReport {
  const errors: Finding[] = [],
    add = (ruleId: string, objectId: string, message: string) =>
      errors.push({ ruleId, objectId, message });
  const schemaErrors = validate(outputSchemas[task.stage], result);
  for (const error of schemaErrors)
    add(
      error.includes("requiredness")
        ? "R02"
        : error.includes("valueLevel")
          ? "R01"
          : "CONTRACT",
      task.categoryId,
      error,
    );
  if (schemaErrors.length) return report();
  const value = result as any,
    snapshot = tools.snapshot;
  if (value.categoryId !== task.categoryId)
    add(
      "CONTRACT",
      task.categoryId,
      "output category must equal task category",
    );
  const readEvidence = (
    e: { sourceId: string; quote: string; factId: string | null },
    objectId: string,
  ) => {
    try {
      const s = snapshot.source(e.sourceId, task);
      if (!tools.has(e.sourceId, e.quote))
        throw Error("quote not in actually read source range");
      if (e.factId) {
        const f = resolveFact(
          snapshot,
          task,
          { sourceId: e.sourceId, factId: e.factId },
          tools,
        );
        if (f.quote !== e.quote)
          throw Error("quote does not identify frozen fact");
        return f;
      }
    } catch (error) {
      add("R09", objectId, String(error));
    }
    return null;
  };
  if (task.stage === "family-modeling") {
    const baseline = snapshot.baseline(task),
      attributes = value.attributes as Attribute[];
    if (value.baselineVersion !== (baseline?.version ?? null))
      add("R05", task.categoryId, "wrong/absent baseline version");
    checkDefinitions(attributes);
    for (const a of attributes) {
      for (const sourceId of a.sourceIds)
        try {
          snapshot.source(sourceId, task);
          if (!tools.sourceReads.has(sourceId)) throw Error();
        } catch {
          add("R11", a.id, "unread/out-of-scope source " + sourceId);
        }
      if (
        a.baselineAttributeId &&
        !baseline?.attributes.some((b) => b.id === a.baselineAttributeId)
      )
        add("R03", a.id, "unknown inherited attribute");
      if (
        baseline &&
        !baseline.attributes.some((b) => b.id === a.id) &&
        !a.differenceReason
      )
        add("R03", a.id, "leaf addition needs a business difference reason");
    }
    for (const b of baseline?.attributes ?? []) {
      const a = attributes.find((a) => a.id === b.id);
      if (!a) {
        add("R03", b.id, "applicable family attribute omitted");
        continue;
      }
      const fields: (keyof Attribute)[] = [
        "name",
        "conceptKey",
        "definition",
        "scope",
        "fieldType",
        "unit",
        "enumValues",
        "multi",
        "requiredness",
        "valueLevel",
        "isKeySpec",
        "isPublic",
        "searchable",
      ];
      if (
        fields.some((f) => canonical(a[f]) !== canonical(b[f])) ||
        a.baselineAttributeId !== b.id
      )
        add(
          "R03",
          a.id,
          "shared definition changed; propose a baseline revision separately",
        );
    }
  } else if (task.stage === "sku-filling") {
    if (value.productId !== task.productId)
      add("R09", String(value.productId), "output SKU must equal task SKU");
    const attributes = snapshot.attributes(task),
      values = value.values as FilledValue[],
      seen = new Set<string>();
    checkDefinitions(attributes);
    for (const v of values) {
      const a = attributes.find((a) => a.id === v.attributeId);
      if (!a) {
        add("CONTRACT", v.attributeId, "attribute not in fixed contract");
        continue;
      }
      if (seen.has(a.id)) add("CONTRACT", a.id, "duplicate value");
      seen.add(a.id);
      const facts = v.evidence
        .map((e) => readEvidence(e, a.id))
        .filter((f) => f !== null);
      if (v.status !== "known") {
        if (v.value !== null || v.derivation !== null)
          add(
            "R09",
            a.id,
            "unknown/not-applicable/conflict has null business value and no calculation",
          );
        if (v.status === "not_applicable" && !v.evidence.length)
          add(
            "R09",
            a.id,
            "not applicable requires evidence; otherwise unknown",
          );
        if (
          v.status === "conflict" &&
          new Set(
            v.evidence.map((e) => canonical([e.sourceId, e.factId, e.quote])),
          ).size < 2
        )
          add("R12", a.id, "conflict needs distinct evidence references");
        continue;
      }
      const typeOK = a.multi
        ? Array.isArray(v.value) &&
          v.value.length > 0 &&
          v.value.every(
            (x) => typeof x === "string" && a.enumValues.includes(x),
          )
        : a.fieldType === "number"
          ? typeof v.value === "number" && Number.isFinite(v.value)
          : a.fieldType === "boolean"
            ? typeof v.value === "boolean"
            : typeof v.value === "string" && v.value.trim().length > 0;
      if (
        !typeOK ||
        (a.fieldType === "option" &&
          !a.multi &&
          !a.enumValues.includes(v.value as string))
      )
        add("R08", a.id, "value type/option outside fixed contract");
      if (
        a.fieldType === "date" &&
        (typeof v.value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(v.value) ||
          Number.isNaN(Date.parse(v.value)))
      )
        add("R08", a.id, "invalid ISO date");
      if (!v.evidence.length) add("R09", a.id, "known value needs evidence");
      const conflicting = snapshot.data.sources
        .filter((s) => s.productId === task.productId)
        .flatMap((s) =>
          s.facts.filter(
            (f) =>
              f.value !== null &&
              f.conceptKey === a.conceptKey &&
              f.scope === a.scope &&
              f.unit === a.unit &&
              tools.has(s.id, f.quote) &&
              canonical(f.value) !== canonical(v.value),
          ),
        );
      if (conflicting.length)
        add(
          "R12",
          a.id,
          "read same-scope facts disagree; preserve conflict instead of choosing or calculating over them",
        );
      if (v.derivation) {
        try {
          const computed = calculate(snapshot, task, a, v.derivation, tools);
          if (v.value !== computed.value)
            add(
              "R14",
              a.id,
              "submitted value differs from verified factor calculation",
            );
          for (const ref of v.derivation.inputs)
            if (
              !v.evidence.some(
                (e) => e.sourceId === ref.sourceId && e.factId === ref.factId,
              )
            )
              add(
                "R14",
                a.id,
                "calculation factor missing from output evidence",
              );
        } catch (error) {
          add("R14", a.id, String(error));
        }
      } else if (
        !facts.some(
          (f) =>
            f.conceptKey === a.conceptKey &&
            f.scope === a.scope &&
            f.unit === a.unit &&
            canonical(f.value) === canonical(v.value),
        )
      ) {
        add(
          "R09",
          a.id,
          "known value must match a read frozen fact with same concept, scope, unit and value; otherwise propose unknown",
        );
      }
    }
    for (const a of attributes)
      if (!seen.has(a.id))
        add("CONTRACT", a.id, "missing value/status for contract attribute");
  } else if (task.stage === "review-assistance") {
    const candidate = task.candidate as {
      stage?: unknown;
      result?: unknown;
    } | null;
    if (
      !candidate ||
      !["family-modeling", "sku-filling"].includes(String(candidate.stage)) ||
      !Object.hasOwn(candidate, "result")
    )
      add("CONTRACT", task.categoryId, "review needs a typed candidate");
    else
      errors.push(
        ...checkResult(
          {
            ...task,
            stage: candidate.stage as "family-modeling" | "sku-filling",
            candidate: null,
          },
          candidate.result,
          tools,
        ).errors,
      );
    for (const f of value.findings) {
      if (!RULES.some((r) => r[0] === f.ruleId))
        add("CONTRACT", f.objectId, "unknown rule ID");
      for (const id of f.sourceIds)
        if (!tools.sourceReads.has(id))
          add("R09", f.objectId, "unread review evidence");
    }
  } else {
    for (const id of value.knowledgeIdsConsulted)
      if (!tools.knowledgeReadIds.has(id))
        add("R11", id, "knowledge was not read");
    const available = new Set(
      snapshot.data.families
        .filter((f) => f.members.includes(task.categoryId))
        .map((f) => f.id),
    );
    for (const id of value.proposedFamilyIds)
      if (!available.has(id))
        add("R04", id, "family ID not found in task context");
    for (const q of value.questions)
      for (const id of q.sourceIds)
        if (!tools.sourceReads.has(id))
          add("R11", id, "unread research evidence");
  }
  return report();
  function checkDefinitions(attributes: Attribute[]) {
    const ids = new Set<string>(),
      concepts = new Set<string>(),
      names = new Set<string>();
    for (const a of attributes) {
      const concept = normalized(a.conceptKey) + "|" + normalized(a.scope),
        name = normalized(a.name) + "|" + normalized(a.scope);
      if (ids.has(a.id) || concepts.has(concept) || names.has(name))
        add("R07", a.id, "duplicate ID/concept/name within measurement scope");
      ids.add(a.id);
      concepts.add(concept);
      names.add(name);
      const owner = snapshot.data.systemFields.find(
        (f) =>
          f.conceptKeys.some(
            (k) => normalized(k) === normalized(a.conceptKey),
          ) || f.names.some((n) => normalized(n) === normalized(a.name)),
      );
      if (owner)
        add("R01", a.id, "concept already owned by system field " + owner.key);
      if (a.fieldType === "number" && !a.unit)
        add("R06", a.id, "numeric attribute needs a fixed unit");
      if (
        /(计量单位|计数单位|数量单位)$/.test(a.name) ||
        a.conceptKey.endsWith(".unit")
      )
        add("R06", a.id, "unit must belong to its quantity definition");
      if (a.fieldType !== "number" && a.unit)
        add(
          "R06",
          a.id,
          "unit only belongs to numeric definition; use one normalized text for genuinely variable units",
        );
      if (a.multi && a.fieldType !== "option")
        add("R08", a.id, "multi requires a bounded option definition");
      if (
        a.fieldType === "option" &&
        (a.enumValues.length < 2 ||
          new Set(a.enumValues.map(normalized)).size !== a.enumValues.length)
      )
        add(
          "R08",
          a.id,
          "option values must be bounded, distinct, and meaningful",
        );
      if (a.fieldType !== "option" && a.enumValues.length)
        add("R08", a.id, "non-option must not carry an enum");
      if (a.searchable && !["text", "option"].includes(a.fieldType))
        add(
          "R01",
          a.id,
          "current keyword indexing supports text/option only; do not claim numeric/boolean filtering is already supported",
        );
      if (
        (a.searchable && !a.uses.includes("search")) ||
        (a.isPublic && !a.uses.includes("display"))
      )
        add("R07", a.id, "search/public capability needs its stated use");
    }
  }
  function report(): CheckReport {
    return {
      status: errors.length ? "program_blocked" : "program_pass_pending_human",
      errors,
      humanReviewRules: STAGE_RULES[task.stage].filter(
        (id) => RULES.find((r) => r[0] === id)?.[2] !== "program",
      ),
    };
  }
}
