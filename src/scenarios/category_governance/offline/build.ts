import { createHash } from "node:crypto";
import type { AttributeProperty, CategoryNode } from "../types.ts";
import { commonDefinitions, packs, platformOnlyFields } from "./knowledge.ts";
import type { BoundPack, DraftCategory, DraftDocument, InputSnapshot, KnowledgePack, KnowledgeProperty, PropertyOrigin } from "./types.ts";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}
export const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const pathMatches = (node: CategoryNode, path: string[]) => path.every((part, i) => node.pathNames[i + 1] === part);

export function bindKnowledge(input: InputSnapshot, definitions: KnowledgePack[] = packs): BoundPack[] {
  const leaves = input.tree.nodes.filter(n => n.isLeaf);
  const ids = new Set<string>();
  return definitions.map(pack => {
    if (ids.has(pack.id)) throw new Error(`重复知识包 ID：${pack.id}`);
    ids.add(pack.id);
    for (const path of pack.paths ?? []) if (!input.tree.nodes.some(n => n.pathNames.length === path.length + 1 && pathMatches(n,path))) throw new Error(`知识包 ${pack.id} 的路径不存在：${JSON.stringify(path)}`);
    const targets = leaves.filter(n => (!pack.paths || pack.paths.some(p => pathMatches(n,p))) && (!pack.leafNames || pack.leafNames.includes(n.name)) && !pack.excludeNames?.includes(n.name));
    for (const name of pack.leafNames ?? []) {
      const matches = targets.filter(n => n.name === name);
      if (!matches.length) throw new Error(`知识包 ${pack.id} 的末级类目不存在：${name}`);
      if (!pack.paths && matches.length > 1) throw new Error(`类目 ${name} 有多个路径，请显式绑定路径`);
    }
    if (!targets.length) throw new Error(`知识包 ${pack.id} 没有匹配类目`);
    return { pack, targets };
  });
}

function projectCandidate(p: AttributeProperty, changes: string[]): KnowledgeProperty {
  const out: KnowledgeProperty = structuredClone(p);
  out.options ??= [];
  out.unit ??= null;
  // A sample list is not proof that a value space is complete. Preserve it outside the enforced enum.
  if (out.type === "single" || out.type === "multi") {
    const wasMulti = out.type === "multi";
    out.suggestedValues = [...out.options];
    out.type = "text";
    out.options = [];
    out.format = wasMulti ? "开放多值文本；多项用分号分隔，允许新增值" : "开放文本；按实际规格填写";
    changes.push(`${out.name}：候选枚举改为开放${wasMulti ? "多值" : ""}文本；原选项保留供追溯`);
  } else if (out.options.length) {
    out.suggestedValues = [...out.options]; out.options = [];
    changes.push(`${out.name}：将非选择类型上的候选选项移出约束`);
  }
  if (out.type === "boolean") {
    out.unit = null;
    out.format = "true/false；未知留空，不能按 false 处理";
  }
  const common = commonDefinitions.find(d => d.names.includes(out.name));
  if (common) {
    const next = { ...out, ...structuredClone(common.property), required: out.required, scope: out.scope };
    // We are editing a template, not converting product measurements or numerical examples.
    if (common.property.key === "net_weight" && out.unit) next.unit = out.unit;
    if (common.property.key === "brand" || common.property.key === "model") next.example = null;
    if (stableJson(next) !== stableJson(out)) changes.push(`${out.name}：采用共用属性定义`);
    return next;
  }
  return out;
}

export function buildDraft(input: InputSnapshot, edition: string, definitions: KnowledgePack[] = packs): { document: DraftDocument; bindings: BoundPack[] } {
  const bindings = bindKnowledge(input, definitions);
  const selected = new Map<string, KnowledgePack[]>();
  for (const { pack, targets } of bindings) for (const n of targets) selected.set(n.id, [...selected.get(n.id) ?? [], pack]);
  const candidates = new Map(input.candidates.categories.map(c => [c.category.id,c]));
  if (candidates.size !== input.candidates.categories.length) throw new Error("候选模板存在重复类目 ID");
  const evidence = new Map<string, InputSnapshot["evidence"]["categories"]>();
  const ids = new Set(input.tree.nodes.filter(n => n.isLeaf).map(n => n.id));
  for (const e of input.evidence.categories) for (const id of e.targetIds ?? []) if (ids.has(id)) evidence.set(id, [...evidence.get(id) ?? [], e]);
  const results: DraftCategory[] = [];
  for (const node of input.tree.nodes.filter(n => n.isLeaf)) {
    const base = candidates.get(node.id);
    const assigned = selected.get(node.id) ?? [];
    if (!base && !assigned.some(p => p.mode === "replace")) throw new Error(`缺少原始候选模板：${node.pathNames.join(" > ")}；不可用品牌等占位字段冒充完整模板`);
    const changes: string[] = [];
    let properties: KnowledgeProperty[] = [];
    let provenance: Record<string,PropertyOrigin> = {};
    const cautions: string[] = [];
    // Full replacement packs do not inherit historical values or validation errors.
    if (!assigned.some(p => p.mode === "replace")) {
      for (const p of [...base!.shared ?? [], ...base!.properties]) {
        if (platformOnlyFields.includes(p.name)) { changes.push(`${p.name}：平台运营信息不作为商品属性`); continue; }
        const projected = projectCandidate(p, changes);
        if (properties.some(a => a.name === projected.name)) { changes.push(`${projected.name}：相同名称保留首个定义，原候选保存在输入快照`); continue; }
        // Repeated English keys with different meanings remain distinct, with a traceable deterministic key.
        if (properties.some(a => a.key === projected.key)) { projected.key = `${projected.key}_${digest(projected.name).slice(0,8)}`; changes.push(`${projected.name}：为冲突属性键分配稳定后缀`); }
        properties.push(projected);
        provenance[projected.key] = { kind: "historical-candidate", sources: ["historical-input"] };
      }
    }
    for (const pack of assigned) {
      if (pack.mode === "replace") { properties = []; provenance = {}; changes.push(`Codex 按知识包 ${pack.title} 重新编制模板`); }
      if (pack.scopeNote) cautions.push(pack.scopeNote);
      for (const name of pack.removeNames ?? []) {
        for (const p of properties.filter(p => p.name === name)) { delete provenance[p.key]; changes.push(`${name}：由知识包中的独立定义替代`); }
        properties = properties.filter(p => p.name !== name);
      }
      for (const spec of pack.properties) {
        for (const old of properties.filter(p => p.key === spec.key || p.name === spec.name)) delete provenance[old.key];
        properties = properties.filter(p => p.key !== spec.key && p.name !== spec.name);
        const p = { ...structuredClone(spec), scope: spec.key === "brand" || spec.key === "model" ? "shared" as const : "category" as const };
        properties.push(p);
        provenance[p.key] = { kind: "curated", packId: pack.id, sources: spec.sources ?? ["codex-domain"] };
      }
    }
    for (const p of properties) {
      const found = (evidence.get(node.id) ?? []).flatMap(e => e.attributes.filter(a => a.name === p.name).map(a => ({ evidenceId: e.id ?? "", name: a.name, observed: a.observed })));
      if (found.length) provenance[p.key]!.jdFields = found;
    }
    const treatment = assigned.some(p => p.mode === "replace") ? "curated-template" : assigned.length ? "curated-core" : "historical-draft";
    if (treatment !== "curated-template") cautions.push("包含历史候选字段，尚未逐类确认业务适用性；格式检查通过不等于行业验收。");
    const notes = assigned.length ? assigned.map(p => p.reason) : [];
    results.push({ category: { id: node.id, name: node.name, path: [...node.pathNames] }, shared: properties.filter(p => p.scope === "shared"), properties: properties.filter(p => p.scope !== "shared"), notes,
      provenance,knowledgePacks: assigned.map(p => p.id),treatment,changes:[...new Set(changes)],cautions:[...new Set(cautions)] });
  }
  const document: DraftDocument = { schema: "sanheng-attribute-draft-v1", categoryVersion: input.tree.version, edition, categories: results };
  validateDraft(document, input);
  return { document, bindings };
}

export function validateDraft(document: DraftDocument, input: InputSnapshot): void {
  const leaves = new Map(input.tree.nodes.filter(n => n.isLeaf).map(n => [n.id,n]));
  if (document.categories.length !== leaves.size) throw new Error("输出未覆盖全部末级类目");
  for (const c of document.categories) {
    const n = leaves.get(c.category.id);
    if (!n || n.name !== c.category.name || stableJson(n.pathNames) !== stableJson(c.category.path)) throw new Error(`原类目被改动或重复：${c.category.id}`);
    leaves.delete(n.id);
    const keys = new Set<string>(), names = new Set<string>();
    const props = [...c.shared,...c.properties];
    if (!props.length) throw new Error(`空模板：${n.name}`);
    for (const p of props) {
      if (!p.key || !p.name || keys.has(p.key) || names.has(p.name)) throw new Error(`属性定义冲突：${n.name}/${p.name}`);
      keys.add(p.key); names.add(p.name);
      if (!["text","number","boolean","single","multi","date","file"].includes(p.type)) throw new Error(`未知属性类型：${n.name}/${p.name}`);
      if ((p.type === "single" || p.type === "multi") && !p.options?.length) throw new Error(`空枚举：${n.name}/${p.name}`);
      if (p.type !== "single" && p.type !== "multi" && p.options?.length) throw new Error(`非枚举字段含限制选项：${n.name}/${p.name}`);
      if (p.condition && p.required) throw new Error(`条件属性不可无条件必填：${n.name}/${p.name}`);
      if (p.requiredWhenApplicable && !p.condition?.trim()) throw new Error(`条件必填缺少适用条件：${n.name}/${p.name}`);
      if (!c.provenance[p.key]) throw new Error(`属性缺少来源：${n.name}/${p.name}`);
    }
  }
}
