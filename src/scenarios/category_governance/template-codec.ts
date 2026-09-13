import { createHash } from "node:crypto";
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

function scalarText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stableFallbackKey(value: string): string {
  return `attr_${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

function normalizeKey(value: unknown, name: string): string {
  const raw = scalarText(value)?.trim() ?? "";
  const normalized = raw
    .replace(/([a-z])([A-Z])/gu, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLocaleLowerCase();
  return /^[a-z][a-z0-9_]*$/u.test(normalized) ? normalized : stableFallbackKey(name || raw);
}

function normalizeType(value: unknown, options: string[]): PropertyType {
  const raw = scalarText(value)?.trim().toLocaleLowerCase();
  const aliases: Record<string, PropertyType> = {
    string: "text", str: "text", integer: "number", int: "number", float: "number", decimal: "number",
    bool: "boolean", enum: "single", array: "multi", list: "multi", object: "text",
  };
  const type = (raw && aliases[raw]) ?? raw;
  if (type && TYPES.includes(type as PropertyType)) return type as PropertyType;
  return options.length > 0 ? "single" : "text";
}

function normalizeRequired(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = scalarText(value)?.trim().toLocaleLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "*" || text === "必填";
}

function normalizeScope(value: unknown): "shared" | "category" {
  const text = scalarText(value)?.trim().toLocaleLowerCase();
  if (text === "shared" || text === "common" || text === "公共" || text === "通用" || text === "共享") return "shared";
  return "category";
}

function normalizeOptions(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(values.map(scalarText).filter((item): item is string => item !== null && item.length > 0))];
}

function parseProperty(value: unknown): AttributeProperty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("属性必须是对象");
  const p = value as Record<string, unknown>;
  const rawName = scalarText(p.name)?.trim() ?? "";
  const name = rawName || scalarText(p.key)?.trim() || "未命名属性";
  const options = normalizeOptions(p.options);
  const type = normalizeType(p.type, options);
  return {
    key: normalizeKey(p.key, name), name, type, required: normalizeRequired(p.required),
    unit: scalarText(p.unit), options,
    description: scalarText(p.description) ?? "", format: scalarText(p.format),
    example: scalarText(p.example), scope: normalizeScope(p.scope),
  };
}

export function tupleToProperty(value: unknown): AttributeProperty {
  if (!Array.isArray(value) || value.length !== 10) throw new Error("压缩属性必须包含 10 个字段");
  const [key, name, code, required, unit, options, description, format, example, scope] = value;
  const codeText = typeof code === "string" ? code : "";
  const type = TYPES[CODES.indexOf(codeText as typeof CODES[number])] ?? "text";
  return parseProperty({key, name, type, required, unit, options, description, format, example, scope});
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

function dedupeProperties(properties: AttributeProperty[]): AttributeProperty[] {
  const keys = new Set<string>();
  const names = new Set<string>();
  return properties.filter((property) => {
    if (keys.has(property.key) || names.has(property.name)) return false;
    keys.add(property.key);
    names.add(property.name);
    return true;
  });
}

function dedupePropertyParts(shared: AttributeProperty[], properties: AttributeProperty[]): {
  shared: AttributeProperty[];
  properties: AttributeProperty[];
} {
  const cleanShared = dedupeProperties(shared);
  const sharedKeys = new Set(cleanShared.map((property) => property.key));
  const sharedNames = new Set(cleanShared.map((property) => property.name));
  const cleanProperties = dedupeProperties(properties).filter((property) => {
    if (sharedKeys.has(property.key) || sharedNames.has(property.name)) return false;
    sharedKeys.add(property.key);
    sharedNames.add(property.name);
    return true;
  });
  return { shared: cleanShared, properties: cleanProperties };
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
      const parts = dedupePropertyParts(expand(refs[0]), expand(refs[1]));
      normalized.push({ category: {id: node.id, name: node.name, path: node.pathNames}, ...parts, notes: parseNotes(refs[2]) });
    }
  } else {
    const items = data.items;
    if (!Array.isArray(items)) throw new Error("响应必须包含 items 或 a/c 字典");
    for (const item of items) {
      const node = aliases.get(item?.category?.id);
      if (!node) throw new Error(`输出包含非目标类目：${item?.category?.id}`);
      if (!Array.isArray(item.properties)) throw new Error("properties 必须为数组");
      const parts = dedupePropertyParts((item.shared ?? []).map(parseProperty), item.properties.map(parseProperty));
      normalized.push({ category: {id: node.id, name: node.name, path: node.pathNames}, ...parts, notes: parseNotes(item.notes ?? []) });
    }
  }
  const actual = new Set(normalized.map((result) => result.category.id));
  if (actual.size !== targets.length || targets.some((node) => !actual.has(node.id))) throw new Error("类目覆盖不完整或包含重复类目");
  for (const result of normalized) validateProperties([...result.shared, ...result.properties]);
  return normalized;
}

function parseNotes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map(scalarText).filter((note): note is string => note !== null);
}
