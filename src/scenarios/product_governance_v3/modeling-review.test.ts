import { expect, test } from "bun:test";
import { modelingReviewSignals } from "./modeling-review.ts";
import { attribute, binding } from "./fixtures.ts";
import { jsonClone } from "./core.ts";

test("availability wording routes a concrete reason to human review, without banning optional or changing the proposal", () => {
  const a = attribute(), p = { categoryId: "a", category: "合成类目", attributes: [a],
    bindings: [binding(a.id, { requirednessReason: "缺失会妨碍适配判断，但能否稳定取得标称值未核实，先选填，待业务确认可稳定取证后再议必填。" })], extensionCandidates: [] };
  const before = jsonClone(p), signals = modelingReviewSignals([p]);
  expect(signals).toHaveLength(1);
  expect(signals[0]!.kind).toBe("requiredness_evidence_language");
  expect(signals[0]!.evidence[0]!.text).toBe(p.bindings[0]!.requirednessReason);
  expect(p).toEqual(before);
  for (const valid of ["强制填写必要性尚未核实，先选填；不按样本覆盖率设必填。",
    "资料是否齐全不是必填判据，强制必要性未确认，先选填。", "缺失不妨碍主要选型，仅用于偏好比较，先选填。"])
    expect(modelingReviewSignals([{ ...p, bindings: [binding(a.id, { requirednessReason: valid })] }])).toEqual([]);
});

test("cross-category disposition comparison retains scope and evidence instead of declaring equivalence or a hard error", () => {
  const a = attribute({ name: "原料", conceptKey: "paper.raw_material", scope: "single-sheet" });
  const p = { categoryId: "a", category: "合成纸A", attributes: [a], bindings: [binding(a.id)], extensionCandidates: [] };
  const extension = { id: "b-material", name: "原料", conceptKey: "paper.material", scope: "folded-sheet", potentialUse: "候选选型偏好",
    deferReason: "需核实对象的独立选型价值", activationCriteria: "查证后另提共享修订", references: [] };
  const q = { categoryId: "b", category: "合成纸B", attributes: [], bindings: [], extensionCandidates: [extension] };
  const signals = modelingReviewSignals([p, q]);
  expect(signals).toHaveLength(1);
  expect(signals[0]!.kind).toBe("different_disposition");
  expect(signals[0]!.evidence.map(e => e.scope)).toEqual(["single-sheet", "folded-sheet"]);
  expect(signals[0]!.evidence.map(e => e.disposition)).toEqual(["attribute", "extension"]);
  // Different names AND different concepts are not guessed to be synonyms.
  expect(modelingReviewSignals([p, { ...q, extensionCandidates: [{ ...extension, name: "其他对象材质" }] }])).toEqual([]);
  expect(modelingReviewSignals([p, { ...p, categoryId: "b" }])).toEqual([]);
});
