import { Blocked, hash, jsonClone, list, nullable, object, text, validate, type Schema, type Task, type AttributeDefinition } from "./core.ts";
import { attributeSchema, bindingSchema, extensionCandidateSchema, modelingDecisionSchema, outputSchemas } from "./contracts.ts";
import { definitionFingerprint, uniqueDefinitions, usableDefinitions, type ModelingDecision } from "./modeling-contract.ts";
import type { DataSnapshot } from "./snapshot.ts";
import nativeQuantity from "./knowledge/native-quantity-carrier-20261026.json";

// A model proposes deltas. Only this host module may expand references into the
// existing, fully checked internal contract. Historical full outputs stay historical.
export const MODELING_PROPOSAL_VERSION = "modeling-proposal-v1";
export const QUANTITY_MAPPING_VERSION = "native-quantity-plan-v2";
function without(schema: Schema, keys: string[]) {
  return object(Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => !keys.includes(key))));
}
const quantityProposal = object({
  measure: text("contents_per_package", "sales_unit_count", "other_count"),
  countedObject: text(), countTerms: list(text(), 1),
  relation: text("same", "distinct", "conditional", "unresolved"), reason: text(),
});
export const modelingProposalSchema = object({
  contractVersion: text(MODELING_PROPOSAL_VERSION),
  baselineVersion: nullable(text()),
  reuse: list(object({ attributeId: text(), definitionHash: text() })),
  newAttributes: list(without(attributeSchema, ["valueLevel", "defaultValue"])),
  newBindings: list(without(bindingSchema, ["categoryId", "baselineAttributeId"])),
  newExtensionCandidates: list(object({
    ...without(extensionCandidateSchema, ["activationCriteria"]).properties,
    activationRequirements: list(object({
      kind: text("business_use", "professional_definition", "target_applicability"), question: text(),
    }), 1),
  })),
  decisions: list(object({
    ...without(modelingDecisionSchema, ["admissionBasis", "requirednessBasis", "quantity"]).properties,
    quantity: nullable(quantityProposal),
  })),
  revisionRequests: list(object({
    objectId: text(), kind: text("definition", "binding", "applicability", "candidate"),
    proposal: text(), reason: text(),
  })),
  unresolved: list(text()),
});

export function usesModelingProposal(task: Task) {
  return task.stage === "family-modeling" && (task.candidate as any)?.modelingContractVersion === MODELING_PROPOSAL_VERSION;
}
export function modelOutputSchema(task: Task) {
  const version = (task.candidate as any)?.modelingContractVersion;
  if (task.stage === "family-modeling" && version && version !== MODELING_PROPOSAL_VERSION)
    throw new Blocked("proposal_contract", "unsupported modeling contract version: " + version);
  return usesModelingProposal(task) ? modelingProposalSchema : outputSchemas[task.stage];
}
export function modelingProposalContext(snapshot: DataSnapshot, task: Task) {
  if (!usesModelingProposal(task)) return null;
  const base = snapshot.baseline(task), decisions = base?.decisions ?? [];
  return {
    version: MODELING_PROPOSAL_VERSION,
    baselineReference: base ? { familyId: base.id, version: base.version } : null,
    inheritedAttributeIds: base?.attributes.map(a => a.id) ?? [],
    inheritedCandidateIds: base?.extensionCandidates?.map(c => c.id) ?? [],
    assessmentNeededIds: [...(base?.attributes ?? []), ...(base?.extensionCandidates ?? [])]
      .filter(a => !decisions.some(d => d.objectId === a.id)).map(a => a.id),
    instructions: "只输出增量合同。baselineVersion准确引用后，宿主自动继承全部共同定义、绑定、扩展候选和已有决策。不要在new*或decisions复述已继承对象。缺历史决策的assessmentNeededIds须明确评估，不能假装已经批准。修改共同定义或绑定只写revisionRequests，程序不应用。复用池中非基线定义用reuse及definitionHash，仍须通过目标范围检查；只为新增/池引用填写newBindings。所有结果待人工采用。",
    quantityMapping: { version: QUANTITY_MAPPING_VERSION, ...nativeQuantity.mapping,
      instructions: "只判断数量对象、计数词、measure和relation；后台字段名、分母、重合时复用动作和比较条件由宿主生成。包内数量不默认独立于原生单位组合。不能把unitMin说成数量值。" },
    activation: "扩展启用只列业务用途、专业定义或目标适用性问题；是否强制填写另由requiredNecessity表达，SKU资料可得性只写valueEvidence/unresolved。两者不能作为扩展启用条件。",
  };
}

function quantityPlan(d: any) {
  const q = d.quantity;
  if (!q) return null;
  const denominator = q.measure === "contents_per_package" ? "package" : q.measure === "sales_unit_count" ? "sales_unit" : "other";
  const comparison = "先按CategoryKeyConfig解析实际键；核实销售单位saleUnit（职责别名salesUnit）与候选分母相同、最小计量单位unitMin与候选计数对象和计数词相同，并有明确同口径依据";
  return {
    version: QUANTITY_MAPPING_VERSION, objectId: d.objectId, ownerKey: "unitMin",
    quantityField: "unitMinQua", unitField: "unitMin", salesUnitField: "saleUnit", salesUnitOwnerKey: "salesUnit",
    nativeCarrier: nativeQuantity.mapping,
    bindingStatus: "unresolved_until_category_key_config_and_sku_units_are_read",
    denominator, relation: q.relation,
    overlapRule: "same_denominator_and_counted_object_and_count_term_with_verified_basis",
    execution: "planning_only_requires_verified_sku_units",
    quantity: { ...q, denominator, systemFieldKeys: ["unitMin"],
      sameWhen: ["same", "conditional"].includes(q.relation) ? comparison + "时，由unitMinQua读取数量，复用基础字段" : null,
      differentWhen: q.relation === "conditional" ? "核实saleUnit与候选分母是不同包装层级，或unitMin与候选计数对象/计数词不同，且不存在未经核实的单位换算时，才按独立包内参数处理；单位或层级不明则待核实，不用层数乘除抽/张/片" : null,
      overlapAction: ["same", "conditional"].includes(q.relation) ? "reuse_system_field" : "not_applicable" },
  };
}

const ACTIVATION_LABELS = { business_use: "业务用途", professional_definition: "专业定义", target_applicability: "目标适用性" };
function fail(message: string): never { throw new Blocked("proposal_contract", message); }
export function materializeModelResult(snapshot: DataSnapshot, task: Task, raw: unknown): { result: any; assembly: any } {
  if (!usesModelingProposal(task)) return { result: raw, assembly: null };
  const errors = validate(modelingProposalSchema, raw);
  if (errors.length) fail(errors.join("; "));
  const p = raw as any, base = snapshot.baseline(task);
  if (p.baselineVersion !== (base?.version ?? null)) fail("baselineVersion must exactly reference the applicable frozen baseline");
  const attributes: AttributeDefinition[] = jsonClone(base?.attributes ?? []),
    extensions: any[] = jsonClone(base?.extensionCandidates ?? []),
    decisions: ModelingDecision[] = jsonClone(base?.decisions ?? []),
    pool = usableDefinitions(snapshot.data, task.runId);
  const inheritedIds = new Set([...attributes, ...extensions].map(a => a.id));
  const claimed = new Set(inheritedIds);
  const claim = (id: string) => { if (claimed.has(id)) fail("duplicate/inherited object cannot be repeated: " + id); claimed.add(id); };
  for (const ref of p.reuse) {
    claim(ref.attributeId);
    const found = uniqueDefinitions(pool.filter(a => a.id === ref.attributeId))[0];
    if (!found || definitionFingerprint(found) !== ref.definitionHash) fail("unknown/stale pool definition reference: " + ref.attributeId);
    attributes.push(jsonClone(found)); // scope and all remaining business rules run after expansion
  }
  for (const a of p.newAttributes) {
    claim(a.id);
    if (pool.some(existing => existing.id === a.id)) fail("existing pool ID requires reuse reference, not a copied definition: " + a.id);
    attributes.push({ ...a, valueLevel: "SKU", defaultValue: null });
  }
  for (const c of p.newExtensionCandidates) {
    claim(c.id);
    const { activationRequirements, ...body } = c;
    extensions.push({ ...body, activationCriteria: activationRequirements.map((r: any) =>
      `${ACTIVATION_LABELS[r.kind as keyof typeof ACTIVATION_LABELS]}：${r.question}`).join("；") });
  }
  const bindings = (base?.attributes ?? []).map(a => {
    const b = base!.bindings.find(b => b.attributeId === a.id && b.categoryId === task.categoryId) ??
      base!.bindings.find(b => b.attributeId === a.id && b.categoryId === null);
    if (!b) fail("frozen baseline has no applicable binding: " + a.id);
    return { ...jsonClone(b), categoryId: task.categoryId, baselineAttributeId: a.id };
  });
  for (const b of p.newBindings) {
    if (inheritedIds.has(b.attributeId)) fail("inherited binding changes belong in revisionRequests: " + b.attributeId);
    bindings.push({ ...b, categoryId: task.categoryId, baselineAttributeId: null });
  }
  const quantityMappings: any[] = decisions.flatMap(d => {
    const mapping = quantityPlan(d);
    return mapping ? [{ ...mapping, inherited: true }] : [];
  });
  for (const d of p.decisions) {
    if (decisions.some(existing => existing.objectId === d.objectId)) fail("frozen/duplicate decision cannot be replaced: " + d.objectId);
    const mapping = quantityPlan(d);
    if (mapping) quantityMappings.push(mapping);
    decisions.push({ ...d, admissionBasis: "business_need", requirednessBasis: "business_need", quantity: mapping?.quantity ?? null });
  }
  const knownRevisionIds = new Set([...claimed, ...pool.map(a => a.id)]);
  for (const r of p.revisionRequests) if (!knownRevisionIds.has(r.objectId)) fail("revision must identify an existing/proposed object: " + r.objectId);
  const result = {
    categoryId: task.categoryId, baselineVersion: p.baselineVersion, attributes, bindings,
    extensionCandidates: extensions, decisions,
    unresolved: [...new Set([...(base?.reviewIssues ?? []), ...p.unresolved, ...p.revisionRequests.map((r: any) =>
      `待人工共享修订（未应用） ${r.objectId} / ${r.kind}：${r.proposal}；理由：${r.reason}`)])],
  };
  return { result, assembly: {
    version: MODELING_PROPOSAL_VERSION, proposalHash: hash(raw), resultHash: hash(result),
    baseline: base ? { familyId: base.id, version: base.version, contentHash: hash(base) } : null,
    inheritedAttributeIds: base?.attributes.map(a => a.id) ?? [],
    referencedDefinitions: p.reuse, quantityMappings, revisionRequests: p.revisionRequests,
    appliedRevisionRequests: 0, businessApprovals: 0,
  } };
}
