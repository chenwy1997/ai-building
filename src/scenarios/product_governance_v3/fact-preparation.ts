import {
  hash,
  canonical,
  jsonClone,
  assertSchema,
  factPreparationHash,
  object,
  text,
  list,
  bool,
  type BusinessValue,
  type Finding,
  type Source,
  type Task,
} from "./core.ts";
import { outputSchemas } from "./contracts.ts";
import { valueConstraintErrors, strictDate } from "./native-contract.ts";
import type { ToolRegistry } from "./tools.ts";
import { DataSnapshot } from "./snapshot.ts";

export interface FactCandidate {
  id: string;
  attributeId: string;
  sourceId: string;
  sourceVersion: string;
  start: number;
  end: number;
  quote: string;
  value: BusinessValue;
  normalization: "identity" | "kg-to-g" | "cm-to-mm" | "m-to-mm";
  rationale: string;
}
export interface FactExtraction {
  categoryId: string;
  productId: string;
  candidates: FactCandidate[];
  unresolved: string[];
}

// A token/constraint check is deliberately narrower than semantic verification.
export function extractionErrors(
  task: Task,
  result: FactExtraction,
  tools: ToolRegistry,
): Finding[] {
  const errors: Finding[] = [],
    seen = new Set<string>();
  const add = (id: string, message: string) =>
    errors.push({ ruleId: "R09", objectId: id, message });
  if (result.productId !== task.productId)
    add(result.productId, "extraction SKU differs from task");
  const attrs = tools.snapshot.attributes(task);
  for (const c of result.candidates) {
    if (seen.has(c.id)) add(c.id, "duplicate candidate ID");
    seen.add(c.id);
    const a = attrs.find((a) => a.id === c.attributeId);
    if (!a) {
      add(c.id, "candidate attribute outside fixed contract");
      continue;
    }
    try {
      const s = tools.snapshot.source(c.sourceId, task);
      if (s.version !== c.sourceVersion) add(c.id, "stale source version");
      if (
        c.end <= c.start ||
        s.text.slice(c.start, c.end) !== c.quote ||
        !tools.has(c.sourceId, c.quote)
      )
        add(c.id, "quote/span not exactly located in an actually read source");
    } catch {
      add(c.id, "source outside task SKU");
    }
    if (c.value === null)
      add(c.id, "unknowns belong in unresolved, not direct facts");
    for (const error of valueConstraintErrors(a, c.value)) add(c.id, error);
    if (a.fieldType === "number") {
      if (typeof c.value !== "number") {
        add(c.id, "numeric fact requires numeric value");
        continue;
      }
      const conversions = {
        "kg-to-g": ["kg", "g", 1000],
        "cm-to-mm": ["cm", "mm", 10],
        "m-to-mm": ["m", "mm", 1000],
      } as const;
      const conversion =
        c.normalization === "identity" ? null : conversions[c.normalization];
      if (conversion && a.unit !== conversion[1])
        add(c.id, "normalization target unit differs from definition");
      const inputUnit = conversion?.[0] ?? a.unit,
        scale = conversion?.[2] ?? 1;
      const tokens = [
        ...c.quote.matchAll(
          /(?<![\w.\-+])([0-9]+(?:\.[0-9]+)?)\s*(kg|cm|mm|g|m|层|节|张|卷)(?![A-Za-z])/g,
        ),
      ].filter(
        (m) =>
          !/^\s*[\/／]\s*(?:mm|cm|m)(?:²|\^2|2)/.test(
            c.quote.slice(m.index! + m[0].length),
          ),
      );
      const labeledLayer =
        c.normalization === "identity" &&
        a.conceptKey === "paper.layers" &&
        a.unit === "层" &&
        new RegExp(`层数[:：]\\s*${c.value}(?![\\d.])`).test(c.quote);
      if (
        !labeledLayer &&
        !tokens.some(
          (m) =>
            m[2] === inputUnit &&
            Math.abs(Number(m[1]) * scale - (c.value as number)) < 1e-9,
        )
      )
        add(
          c.id,
          "value/unit not supported by a direct numeric token; arithmetic is not extraction",
        );
    } else {
      if (c.normalization !== "identity")
        add(c.id, "unit conversion requires numeric definition");
      if (a.fieldType === "boolean") {
        if (typeof c.value !== "boolean")
          add(c.id, "boolean fact requires boolean value");
        // Core structure is the only lexical boolean normalizer registered for this pilot.
        const lexicon: Record<string, { yes: string[]; no: string[] }> = {
          "paper.coreless": {
            yes: ["无芯", "是否无芯：是"],
            no: ["有芯", "是否无芯：否"],
          },
          "paper.printed": {
            yes: ["是否印花:是", "是否印花：是"],
            no: ["是否印花:否", "是否印花：否"],
          },
          "paper.embossed": { yes: ["压花"], no: ["无压花"] },
        };
        const words = lexicon[a.conceptKey];
        const positive = words?.yes.some((w) => c.quote.includes(w)),
          negative = words?.no.some((w) => c.quote.includes(w));
        if (!words || (c.value ? !positive || negative : !negative))
          add(
            c.id,
            "boolean meaning has no registered explicit lexical evidence",
          );
      } else if (
        typeof c.value !== "string" ||
        !c.quote.includes(c.value) ||
        (a.fieldType === "option" && !a.enumValues.includes(c.value))
      )
        add(c.id, "text/option value must occur verbatim and match contract");
    }
  }
  return errors;
}
export function extractionConflicts(
  result: FactExtraction,
  tools: ToolRegistry,
) {
  const attrs = tools.snapshot.attributes(tools.task);
  return attrs.flatMap((a) => {
    const candidates = result.candidates.filter((c) => c.attributeId === a.id);
    return new Set(candidates.map((c) => canonical(c.value))).size > 1
      ? [
          {
            attributeId: a.id,
            candidateIds: candidates.map((c) => c.id),
            issue: "同一合同口径候选冲突；人工核实前不得选值",
          },
        ]
      : [];
  });
}
export function preparationBundle(
  task: Task,
  result: FactExtraction,
  tools: ToolRegistry,
) {
  assertSchema(outputSchemas["fact-extraction"], result, "fact extraction");
  const errors = extractionErrors(task, result, tools);
  if (errors.length)
    throw Error(
      "extraction not eligible: " + errors.map((e) => e.message).join("; "),
    );
  const bundle = {
    format: 1 as const,
    kind: "fact_preparation_candidate" as const,
    task,
    snapshotVersion: tools.snapshot.version,
    releaseId: tools.release.id,
    contractHash: hash(tools.snapshot.attributes(task)),
    sourceHashes: Object.fromEntries(
      tools.snapshot
        .product(task.productId!)
        .sourceIds.map((id) => [id, hash(tools.snapshot.source(id, task))]),
    ),
    candidates: result.candidates.map((c) => ({
      ...c,
      candidateHash: hash(c),
      semanticStatus: "pending_human" as const,
    })),
    conflicts: extractionConflicts(result, tools),
    unresolved: result.unresolved,
    humanChecks: [
      "概念与原文字段含义一致",
      "计量对象/单卷与整包口径一致",
      "单位与归一化正确",
      "所有冲突已查看并解释处理",
    ],
    adoption: "pending_human" as const,
  };
  return { ...bundle, bundleHash: hash(bundle) };
}
export type PreparationBundle = ReturnType<typeof preparationBundle>;
const reviewSchema = object({
  bundleHash: text(),
  reviewer: text(),
  reviewedAt: text(),
  decisions: list(
    object({
      candidateId: text(),
      candidateHash: text(),
      decision: text("accept", "reject", "defer"),
      conceptConfirmed: bool,
      scopeConfirmed: bool,
      unitConfirmed: bool,
      conflictsChecked: bool,
      note: text(),
    }),
  ),
});
export interface FactReview {
  bundleHash: string;
  reviewer: string;
  reviewedAt: string;
  decisions: {
    candidateId: string;
    candidateHash: string;
    decision: "accept" | "reject" | "defer";
    conceptConfirmed: boolean;
    scopeConfirmed: boolean;
    unitConfirmed: boolean;
    conflictsChecked: boolean;
    note: string;
  }[];
}

// Pure local transformation. No caller can turn all agent candidates into reviewed facts with a flag.
export async function importFactReview(
  snapshot: DataSnapshot,
  bundle: PreparationBundle,
  review: FactReview,
) {
  assertSchema(reviewSchema, review, "human fact review");
  const { bundleHash, ...body } = bundle;
  if (
    hash(body) !== bundleHash ||
    review.bundleHash !== bundleHash ||
    snapshot.version !== bundle.snapshotVersion ||
    hash(snapshot.attributes(bundle.task)) !== bundle.contractHash
  )
    throw Error("review bundle/source/contract drift");
  const { loadRelease } = await import("./release.ts"),
    release = await loadRelease();
  if (bundle.releaseId !== release.id)
    throw Error(
      "review release/knowledge/skill changed; regenerate review material",
    );
  const { assemble } = await import("./context.ts"),
    plan = await assemble(release, snapshot, bundle.task);
  const extraction: FactExtraction = {
    categoryId: bundle.task.categoryId,
    productId: bundle.task.productId!,
    candidates: bundle.candidates.map(
      ({ candidateHash, semanticStatus, ...c }) => c,
    ),
    unresolved: bundle.unresolved,
  };
  if (
    preparationBundle(bundle.task, extraction, plan.tools).bundleHash !==
    bundleHash
  )
    throw Error("candidate bundle failed current extraction checks");
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(review.reviewedAt) ||
    !strictDate(review.reviewedAt.slice(0, 10)) ||
    Number(review.reviewedAt.slice(11, 13)) > 23 ||
    Number(review.reviewedAt.slice(14, 16)) > 59 ||
    Number(review.reviewedAt.slice(17, 19)) > 59 ||
    !Number.isFinite(Date.parse(review.reviewedAt))
  )
    throw Error("review time must be explicit valid UTC");
  const data = jsonClone(snapshot.data),
    seen = new Set<string>(),
    accepted = new Map<string, FactCandidate[]>();
  for (const d of review.decisions) {
    const c = bundle.candidates.find((c) => c.id === d.candidateId);
    if (!c || seen.has(d.candidateId) || d.candidateHash !== c.candidateHash)
      throw Error("unknown, duplicate or stale candidate review");
    seen.add(d.candidateId);
    if (d.decision !== "accept") continue;
    if (
      ![
        d.conceptConfirmed,
        d.scopeConfirmed,
        d.unitConfirmed,
        d.conflictsChecked,
      ].every(Boolean)
    )
      throw Error("accepted fact needs explicit semantic checks");
    for (const previous of [...accepted.values()].flat())
      if (
        previous.attributeId === c.attributeId &&
        canonical(previous.value) !== canonical(c.value)
      )
        throw Error("cannot accept conflicting same-scope facts");
    const source = snapshot.source(c.sourceId, bundle.task);
    if (source.facts.length || source.factPreparation.status === "reviewed")
      throw Error(
        "existing prepared source needs an explicit revision workflow; initial fact import cannot overwrite it",
      );
    if (
      hash(source) !== bundle.sourceHashes[source.id] ||
      source.version !== c.sourceVersion ||
      source.text.slice(c.start, c.end) !== c.quote
    )
      throw Error("source changed before human import");
    accepted.set(source.id, [...(accepted.get(source.id) ?? []), c]);
  }
  const recordId = "human-review:" + hash(review);
  for (const [sourceId, candidates] of accepted) {
    const s = data.sources.find((s) => s.id === sourceId)!;
    s.facts = candidates.map((c) => {
      const a = snapshot
        .attributes(bundle.task)
        .find((a) => a.id === c.attributeId)!;
      return {
        id: c.id,
        conceptKey: a.conceptKey,
        value: c.value,
        unit: a.unit,
        scope: a.scope,
        quote: c.quote,
        kind: "direct" as const,
      };
    });
    s.factPreparation = {
      status: "reviewed",
      kind: "human",
      recordId,
      contentHash: "pending",
    };
    s.factPreparation.contentHash = factPreparationHash(s);
  }
  data.version = "review:" + hash({ previous: snapshot.version, review });
  return {
    snapshot: new DataSnapshot(data),
    receipt: {
      recordId,
      bundleHash,
      review,
      acceptedFacts: [...accepted.values()].flat().length,
      reviewedCandidates: seen.size,
      remainingCandidates: bundle.candidates.length - seen.size,
      productionWrites: 0,
    },
  };
}
