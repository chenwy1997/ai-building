import type { AttributeProperty, CategoryNode, GovernanceResult, PropertyType } from "./types.ts";
import { shortCategoryId } from "./util.ts";

const TYPES: PropertyType[] = ["text", "number", "boolean", "single", "multi", "date", "file"];
const CODES = ["t", "n", "b", "s", "m", "d", "f"] as const;
export type AttributeTuple = [string, string, string, string, string | null, string[], string, string | null, string | null, string];
export interface CompactTemplates {
  v: 1;
  a: Record<string, AttributeTuple>;
  c: Record<string, [string[], string[], string[]]>;
}

export function propertyToTuple(property: AttributeProperty): AttributeTuple {
  return [property.key, property.name, CODES[TYPES.indexOf(property.type)]!, property.required ? "*" : "",
    property.unit ?? null, property.options ?? [], property.description ?? "", property.format ?? null,
    property.example ?? null, property.scope ?? "category"];
}

function parseProperty(value: unknown): AttributeProperty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("属性必须是对象");
  const p = value as Record<string, unknown>;
  if (typeof p.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(p.key)) throw new Error(`无效属性 key：${String(p.key)}`);
  if (typeof p.name !== "string" || !p.name.trim()) throw new Error(`属性 ${p.key} 缺少名称`);
  if (!TYPES.includes(p.type as PropertyType)) throw new Error(`属性 ${p.key} 的类型无效`);
  if (typeof p.required !== "boolean") throw new Error(`属性 ${p.key} 必须声明 required`);
  const options = p.options ?? [];
  if (!Array.isArray(options) || !options.every((x) => typeof x === "string")) throw new Error(`属性 ${p.key} 枚举必须为字符串数组`);
  if (options.length > 0 && p.type !== "single" && p.type !== "multi") throw new Error(`属性 ${p.key} 的类型不支持枚举`);
  for (const field of ["unit", "description", "format", "example"] as const) {
    if (p[field] !== undefined && p[field] !== null && typeof p[field] !== "string") throw new Error(`属性 ${p.key}.${field} 必须为文本`);
  }
  if (p.scope !== undefined && p.scope !== "shared" && p.scope !== "category") throw new Error(`属性 ${p.key} 的 scope 无效`);
  return {
    key: p.key, name: p.name, type: p.type as PropertyType, required: p.required,
    unit: p.unit as string | null ?? null, options: [...new Set(options)],
    description: p.description as string ?? "", format: p.format as string | null ?? null,
    example: p.example as string | null ?? null, scope: p.scope as "shared" | "category" ?? "category",
  };
}

export function tupleToProperty(value: unknown): AttributeProperty {
  if (!Array.isArray(value) || value.length !== 10) throw new Error("压缩属性必须包含 10 个字段");
  const [key, name, code, required, unit, options, description, format, example, scope] = value;
  if (required !== "" && required !== "*") throw new Error("必填标记只能是 * 或空字符串");
  return parseProperty({key, name, type: TYPES[CODES.indexOf(code)], required: required === "*", unit, options, description, format, example, scope});
}

/** 去重完全相同的属性定义；字段差异会保留为独立定义，不会在压缩时丢弃。 */
export function compactTemplates(results: GovernanceResult[]): CompactTemplates {
  const a: CompactTemplates["a"] = {};
  const c: CompactTemplates["c"] = {};
  const signatures = new Map<string, string>();
  const reference = (property: AttributeProperty): string => {
    const tuple = propertyToTuple(property);
    const signature = JSON.stringify(tuple);
    const existing = signatures.get(signature);
    if (existing) return existing;
    const id = `a${signatures.size.toString(36)}`;
    signatures.set(signature, id);
    a[id] = tuple;
    return id;
  };
  for (const result of results) {
    if (c[result.category.id]) throw new Error(`重复类目：${result.category.id}`);
    c[result.category.id] = [result.shared.map(reference), result.properties.map(reference), result.notes];
  }
  return { v: 1, a, c };
}

function validateProperties(properties: AttributeProperty[]): void {
  if (properties.length === 0) throw new Error("类目属性不能为空");
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const p of properties) {
    if (keys.has(p.key) || names.has(p.name)) throw new Error(`重复属性：${p.key}/${p.name}`);
    keys.add(p.key); names.add(p.name);
  }
}

export function parseGovernanceResponse(text: string, targets: CategoryNode[]): GovernanceResult[] {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const data = JSON.parse(clean) as Record<string, unknown>;
  const aliases = new Map(targets.flatMap((node) => [[node.id, node], [shortCategoryId(node.id), node]] as const));
  const normalized: GovernanceResult[] = [];
  if (data.a && data.c) {
    const dictionary = data.a as Record<string, unknown>;
    for (const [id, refs] of Object.entries(data.c as Record<string, unknown>)) {
      if (!Array.isArray(refs) || refs.length !== 3) throw new Error(`类目 ${id} 的引用格式无效`);
      const node = aliases.get(id);
      if (!node) throw new Error(`输出包含非目标类目：${id}`);
      const expand = (values: unknown): AttributeProperty[] => {
        if (!Array.isArray(values)) throw new Error("属性引用必须为数组");
        return values.map((key) => {
          if (typeof key !== "string" || !Object.hasOwn(dictionary, key)) throw new Error(`未知属性引用：${key}`);
          return tupleToProperty(dictionary[key]);
        });
      };
      normalized.push({ category: {id: node.id, name: node.name, path: node.pathNames}, shared: expand(refs[0]), properties: expand(refs[1]), notes: parseNotes(refs[2]) });
    }
  } else {
    const items = data.items;
    if (!Array.isArray(items)) throw new Error("响应必须包含 items 或 a/c 字典");
    for (const item of items) {
      const node = aliases.get(item?.category?.id);
      if (!node) throw new Error(`输出包含非目标类目：${item?.category?.id}`);
      if (!Array.isArray(item.properties)) throw new Error("properties 必须为数组");
      normalized.push({ category: {id: node.id, name: node.name, path: node.pathNames}, shared: (item.shared ?? []).map(parseProperty), properties: item.properties.map(parseProperty), notes: parseNotes(item.notes ?? []) });
    }
  }
  const actual = new Set(normalized.map((result) => result.category.id));
  if (actual.size !== normalized.length || actual.size !== targets.length || targets.some((node) => !actual.has(node.id))) throw new Error("类目覆盖不完整或包含重复类目");
  for (const result of normalized) validateProperties([...result.shared, ...result.properties]);
  return normalized;
}

function parseNotes(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((note) => typeof note === "string")) throw new Error("notes 必须为字符串数组");
  return value;
}
