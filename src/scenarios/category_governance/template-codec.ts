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

// 常见公共属性统一成跨批次稳定 key，避免模型在不同运行中返回 os/operating_system、ram/ram_capacity 等同义 key。
const CANONICAL_NAME_KEYS: Record<string, string> = {
  "品牌": "brand",
  "型号": "model",
  "颜色": "color",
  "材质": "material",
  "操作系统": "operating_system",
  "运行内存": "ram",
  "网络制式": "network_standard",
  "屏幕尺寸": "screen_size",
  "存储容量": "storage_capacity",
  "电池容量": "battery_capacity",
  "上市日期": "release_date",
  "上市年份": "release_year",
  "长度": "length",
  "宽度": "width",
  "高度": "height",
  "厚度": "thickness",
  "重量": "weight",
  "功率": "power",
  "电压": "voltage",
  "防护等级": "protection_level",
  "执行标准": "standard",
};

function normalizeKey(value: unknown, name: string): string {
  const canonical = CANONICAL_NAME_KEYS[name.trim()];
  if (canonical) return canonical;
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

function looksLikeUnit(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(?:英寸|吋|万像素|像素|Hz|k?Hz|W|kW|mW|mAh|Ah|V|mV|A|mA|mm|cm|m|km|kg|g|mg|GB|TB|MB|KB|GiB|TiB|℃|°C|Pa|kPa|Mbps|Gbps|dB|L|mL|平方米|平方厘米|立方米|个|台|级|%|元)$/iu.test(value.trim());
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
  if (!Array.isArray(value)) throw new Error("压缩属性必须是数组");
  let tuple: unknown[] = value;
  // 兼容模型省略 required 的 9 元组；数字属性的第 3 位若是字符串则视为 unit。
  if (tuple.length === 9 && typeof tuple[8] === "string" && Array.isArray(tuple[4]) && typeof tuple[5] === "string") {
    tuple = [tuple[0], tuple[1], tuple[2], "", tuple[2] === "n" && typeof tuple[3] === "string" ? tuple[3] : null,
      tuple[4], tuple[5], tuple[6], tuple[7], tuple[8]];
  }
  // 兼容模型在 options 后多插入一个空数组的 12 元组。
  if (tuple.length === 12 && typeof tuple[11] === "string" && Array.isArray(tuple[6]) && Array.isArray(tuple[7]) &&
      (tuple[5] === null || typeof tuple[5] === "string") && typeof tuple[8] === "string") {
    tuple = [tuple[0], tuple[1], tuple[2], tuple[3], tuple[5], tuple[6], tuple[8], tuple[9], tuple[10], tuple[11]];
  }
  // 11 元组的同一变体：多余数组位于 description 之前。
  if (tuple.length === 11 && tuple[4] === null && (tuple[5] === null || typeof tuple[5] === "string") &&
      Array.isArray(tuple[6]) && Array.isArray(tuple[7]) && typeof tuple[8] === "string" && typeof tuple[10] === "string") {
    tuple = [tuple[0], tuple[1], tuple[2], tuple[3], tuple[5], tuple[6], tuple[8], tuple[9], null, tuple[10]];
  }
  // 兼容模型偶尔在 unit 前多插入一个 null 的 11 元组：去掉多余占位后按标准十元组解析。
  if (tuple.length === 11 && tuple[4] === null && typeof tuple[5] === "string" && Array.isArray(tuple[6])) {
    tuple = [tuple[0], tuple[1], tuple[2], tuple[3], tuple[5], tuple[6], tuple[7], tuple[8], tuple[9], tuple[10]];
  }
  // 兼容模型把 unit 放到 options，同时把 description/format 向后错一位并追加 scope 的 11 元组。
  if (tuple.length === 11 && tuple[4] === null && typeof tuple[5] === "string" && tuple[6] === null &&
      typeof tuple[7] === "string" && tuple[9] === null && typeof tuple[10] === "string") {
    tuple = [tuple[0], tuple[1], tuple[2], tuple[3], tuple[5], [], tuple[7], null, tuple[8], tuple[10]];
  }
  if (tuple.length !== 10) throw new Error("压缩属性必须包含 10 个字段");
  let [key, name, code, required, unit, options, description, format, example, scope] = tuple;
  // 兼容 number 属性把 unit 错放到 options 位置的 10 元组；只对数字类型修正，避免误伤枚举选项。
  if (code === "n" && unit === null && typeof options === "string") {
    unit = options;
    options = [];
  }
  // 兼容 number 属性把 unit 错放到 format 位置的 10 元组；仅识别常见单位，避免吞掉真正的格式说明。
  if (code === "n" && unit === null && options === null && looksLikeUnit(format)) {
    unit = format;
    format = null;
  }
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

function validateProperties(properties: AttributeProperty[], options: { allowMissingUnits?: boolean } = {}): void {
  if (properties.length === 0) throw new Error("类目属性不能为空");
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const p of properties) {
    if (keys.has(p.key) || names.has(p.name)) throw new Error(`重复属性：${p.key}/${p.name}`);
    // 对有明确量纲的数字属性，要求把单位放入结构化 unit，不能只藏在 description 中。
    // 比值、系数和等级是无量纲数字；名称里可能包含“压力/流量”，不能误判为缺少单位。
    const dimensionless = /比例|比值|压力比|系数|等级|级别/u.test(p.name);
    if (!options.allowMissingUnits && p.type === "number" && !p.unit && !dimensionless && /尺寸|容量|电池|内存|长度|宽度|高度|厚度|重量|电压|功率|速度|频率|直径|面积|体积|温度|压力|流量|距离|像素/u.test(p.name)) {
      throw new Error(`数字属性 ${p.name} 必须填写 unit`);
    }
    keys.add(p.key); names.add(p.name);
  }
}

export function parseGovernanceResponse(text: string, targets: CategoryNode[], options: { allowMissingUnits?: boolean } = {}): GovernanceResult[] {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const data = JSON.parse(clean) as Record<string, unknown>;
  const aliases = new Map(targets.flatMap((node) => [[node.id, node], [shortCategoryId(node.id), node]] as const));
  const normalized: GovernanceResult[] = [];
  if (data.a && data.c) {
    const dictionary = data.a as Record<string, unknown>;
    for (const [id, refs] of Object.entries(data.c as Record<string, unknown>)) {
      if (!Array.isArray(refs) || refs.length !== 3) throw new Error(`类目 ${id} 的引用格式无效`);
      const node = aliases.get(id);
      // 模型偶尔在 c 中附带 __unused__、*_dup 等辅助键；只要目标类目完整，
      // 忽略这些非目标项，避免一条无关键拖垮同批 12 个有效类目。
      if (!node) continue;
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
  for (const result of normalized) validateProperties([...result.shared, ...result.properties], options);
  return normalized;
}

function parseNotes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map(scalarText).filter((note): note is string => note !== null);
}
