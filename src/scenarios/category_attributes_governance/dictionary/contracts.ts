import { createHash } from "node:crypto";

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

export interface Unit { id: string; symbol: string; quantity: string }
/**
 * `range` 是区间值：一对数值构成闭区间 [min..max]，共用一个单位，对应 ETIM 的 R 型与 eCl@ss 的 min/max level。
 * 区间是一个值而不是两条属性——分成上下限两条时，类目只挂一半在结构上是合法的，语义上却缺一半。
 */
export interface Property {
  id: string; revision: number; name: string; definition: string; object: string;
  type: "text" | "number" | "boolean" | "integer" | "range";
  quantity: string | null; unitIds: string[]; aliases: string[];
  qualifications: string[]; excludedMeanings: string[];
  basis: Array<{ kind: "unit-reference" | "domain-reference" | "project-definition"; ref: string }>;
}
export interface Dictionary { schema: "sanheng-property-dictionary-v1"; units: Unit[]; properties: Property[] }
export interface Selection {
  propertyId: string; revision: number; unitId?: string;
  requirement: "required" | "optional" | "conditional";
  condition?: string; rationale: string;
}

export function validateDictionary(d: Dictionary): void {
  const units = new Map(d.units.map(u=>[u.id,u]));
  if (units.size!==d.units.length) throw new Error("重复单位ID");
  const ids = new Set<string>();
  for (const p of d.properties) {
    const key = `${p.id}@${p.revision}`;
    if(ids.has(key)) throw new Error(`重复属性版本 ${key}`); ids.add(key);
    if(!p.name.trim() || !p.definition.trim() || !p.object.trim() || !Number.isInteger(p.revision) || p.revision<1) throw new Error(`属性定义不完整 ${key}`);
    if((p.type==='text'||p.type==='boolean') && (p.quantity!==null || p.unitIds.length)) throw new Error(`非数值属性不能指定物理量 ${key}`);
    if((p.type==='number'||p.type==='integer'||p.type==='range') && (!p.quantity || !p.unitIds.length)) throw new Error(`数值属性缺少量纲/标度 ${key}`);
    for (const id of p.unitIds) if (!units.has(id) || units.get(id)!.quantity!==p.quantity) throw new Error(`单位物理量不匹配 ${key}: ${id}`);
  }
}

/** Mechanical compilation only: category applicability still requires semantic evaluation. */
export function compileSelections(d: Dictionary, selections: Selection[]) {
  validateDictionary(d);
  const allowed = new Set(['propertyId','revision','unitId','requirement','condition','rationale']);
  const used = new Set<string>();
  return selections.map(s=>{
    for(const k of Object.keys(s)) if(!allowed.has(k)) throw new Error(`不允许覆盖标准定义字段: ${k}`);
    const p = d.properties.find(p=>p.id===s.propertyId && p.revision===s.revision);
    if(!p) throw new Error(`未知属性版本: ${s.propertyId}@${s.revision}`);
    if(used.has(p.id)) throw new Error(`重复选择属性: ${p.id}`); used.add(p.id);
    if(!['required','optional','conditional'].includes(s.requirement) || typeof s.rationale!=='string' || !s.rationale.trim()) throw new Error('缺少类目适用性/必填策略理由');
    if(s.requirement==='conditional' && !s.condition?.trim()) throw new Error('条件必填必须有适用条件');
    if(s.requirement!=='conditional' && s.condition!==undefined) throw new Error('非条件必填不能附带隐含条件');
    const unitId = s.unitId ?? p.unitIds[0] ?? null;
    if(unitId!==null && !p.unitIds.includes(unitId)) throw new Error(`属性不允许该单位: ${p.id}: ${unitId}`);
    return { ...structuredClone(p), selectedUnitId:unitId, requirement:s.requirement, condition:s.condition??null, rationale:s.rationale };
  });
}

/** Positional rows with explicit column legends. No semantic summarisation or lost metadata. */
export function toStdText(d: Dictionary): string {
  validateDictionary(d);
  const columns: Array<keyof Property> = ['id','revision','name','definition','object','type','quantity','unitIds','aliases','qualifications','excludedMeanings','basis'];
  return JSON.stringify({schema:d.schema,columns,units:d.units,rows:d.properties.map(p=>columns.map(k=>p[k]))});
}
export function fromStdText(text: string): Dictionary {
  const c = JSON.parse(text);
  if(c.schema!=='sanheng-property-dictionary-v1') throw new Error('未知属性字典格式');
  const d: Dictionary = {schema:c.schema,units:c.units,properties:c.rows.map((r:unknown[])=>{
    if(r.length!==c.columns.length) throw new Error('压缩行长度错误');
    return Object.fromEntries(c.columns.map((k:string,i:number)=>[k,r[i]]));
  })};
  validateDictionary(d); return d;
}
