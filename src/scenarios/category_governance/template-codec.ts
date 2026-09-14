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

function normalizeUnit(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0];
  throw new Error("unit 必须是单个单位字符串或 null");
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
    unit: normalizeUnit(p.unit), options,
    description: scalarText(p.description) ?? "", format: scalarText(p.format),
    example: scalarText(p.example), scope: normalizeScope(p.scope),
  };
}

export function tupleToProperty(value: unknown): AttributeProperty {
  if (!Array.isArray(value)) throw new Error("压缩属性必须是数组");
  let tuple: unknown[] = value;
  // 兼容省略 required 的 9 元组；只有第 3 位明确为单位或 null 时才补空位。
  if (tuple.length === 9 && typeof tuple[8] === "string" && Array.isArray(tuple[4]) && typeof tuple[5] === "string" &&
      (tuple[3] === null || looksLikeUnit(tuple[3]))) {
    tuple = [tuple[0], tuple[1], tuple[2], "", tuple[3],
      tuple[4], tuple[5], tuple[6], tuple[7], tuple[8]];
  }
  // 兼容模型在 options 后多插入一个空数组的 12 元组。
  if (tuple.length === 12 && tuple[4] === null && typeof tuple[11] === "string" && Array.isArray(tuple[6]) && Array.isArray(tuple[7]) && tuple[7].length === 0 &&
      (tuple[5] === null || typeof tuple[5] === "string") && typeof tuple[8] === "string") {
    tuple = [tuple[0], tuple[1], tuple[2], tuple[3], tuple[5], tuple[6], tuple[8], tuple[9], tuple[10], tuple[11]];
  }
  // 11 元组的同一变体：多余数组位于 description 之前。
  if (tuple.length === 11 && tuple[4] === null && (tuple[5] === null || typeof tuple[5] === "string") &&
      Array.isArray(tuple[6]) && Array.isArray(tuple[7]) && tuple[7].length === 0 && typeof tuple[8] === "string" && typeof tuple[10] === "string") {
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

export function validateAttributeProperties(properties: AttributeProperty[], options: { allowMissingUnits?: boolean } = {}): void {
  if (properties.length === 0) throw new Error("类目属性不能为空");
  const keys = new Set<string>();
  const names = new Set<string>();
  const errors: string[] = [];
  for (const p of properties) {
    if (keys.has(p.key) || names.has(p.name)) errors.push(`重复属性：${p.key}/${p.name}`);
    // 对有明确量纲的数字属性，要求把单位放入结构化 unit，不能只藏在 description 中。
    // 比值、系数和等级是无量纲数字；名称里可能包含“压力/流量”，不能误判为缺少单位。
    const dimensionless = /比例|比值|压力比|系数|因数|等级|级别/u.test(p.name);
    if (!options.allowMissingUnits && p.type === "number" && !p.unit && !dimensionless && /尺寸|容量|电池|内存|长度|宽度|高度|厚度|重量|电压|功率|速度|频率|直径|面积|体积|温度|压力|流量|距离|像素/u.test(p.name)) {
      errors.push(`数字属性 ${p.name} 必须填写 unit`);
    }
    keys.add(p.key); names.add(p.name);
  }
  if (errors.length > 0) throw new Error(errors.join("；"));
}

// 只修复末尾闭合符号的错配；不补正文、属性、类目 ID 或截断的字符串。
function repairClosingDelimiters(text: string): string | null {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") stack.push("]");
    else if (char === "{") stack.push("}");
    else if (char === "]" || char === "}") {
      if (char !== stack.at(-1)) {
        if (!/^[\s\]}]+$/u.test(text.slice(i))) return null;
        return text.slice(0, i) + stack.reverse().join("");
      }
      stack.pop();
    }
  }
  return null;
}

export interface GovernanceParseResult {
  results: GovernanceResult[];
  errors: Array<{ categoryId: string; error: string }>;
  repairedClosingDelimiters: boolean;
  ignoredCategoryIds: string[];
}

/** 每个类目独立验证；失败的类目继续保留错误，不能凭规则补造属性或单位。 */
export function parseGovernanceResponsePartial(text: string, targets: CategoryNode[], options: { allowMissingUnits?: boolean } = {}): GovernanceParseResult {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let data: Record<string, unknown>;
  let repairedClosingDelimiters = false;
  try {
    data = JSON.parse(clean);
  } catch (error) {
    const repaired = repairClosingDelimiters(clean);
    if (!repaired) throw error;
    try { data = JSON.parse(repaired); } catch { throw error; }
    repairedClosingDelimiters = true;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("响应必须是 JSON 对象");
  const aliases = new Map(targets.flatMap((node) => [[node.id, node], [shortCategoryId(node.id), node]] as const));
  const entries = new Map<string, unknown[]>();
  const ignoredCategoryIds: string[] = [];
  const add = (id: string, value: unknown): void => {
    const node = aliases.get(id);
    if (!node) { ignoredCategoryIds.push(id); return; }
    const values = entries.get(node.id) ?? [];
    values.push(value);
    entries.set(node.id, values);
  };
  const compact = Boolean(data.a && data.c);
  if (compact) {
    if (typeof data.a !== "object" || Array.isArray(data.a) || typeof data.c !== "object" || Array.isArray(data.c)) {
      throw new Error("a/c 必须是字典对象");
    }
    for (const [id, refs] of Object.entries(data.c as Record<string, unknown>)) {
      add(id, refs);
    }
  } else {
    const items = data.items;
    if (!Array.isArray(items)) throw new Error("响应必须包含 items 或 a/c 字典");
    for (const item of items) {
      add(String(item?.category?.id), item);
    }
  }
  const results: GovernanceResult[] = [];
  const errors: GovernanceParseResult["errors"] = [];
  for (const node of targets) {
    try {
      const values = entries.get(node.id) ?? [];
      if (values.length !== 1) throw new Error(values.length === 0 ? "缺少目标类目" : "目标类目重复（完整 ID 与短 ID 也不能同时出现）");
      let parts: ReturnType<typeof dedupePropertyParts>;
      let notes: string[];
      if (compact) {
        const refs = values[0];
        if (!Array.isArray(refs) || refs.length !== 3) throw new Error("类目引用格式无效");
        const dictionary = data.a as Record<string, unknown>;
        const expand = (refs: unknown): AttributeProperty[] => {
          if (!Array.isArray(refs)) throw new Error("属性引用必须为数组");
          return refs.map((key) => {
            if (typeof key !== "string" || !Object.hasOwn(dictionary, key)) throw new Error(`未知属性引用：${key}`);
            return tupleToProperty(dictionary[key]);
          });
        };
        parts = dedupePropertyParts(expand(refs[0]), expand(refs[1]));
        notes = parseNotes(refs[2]);
      } else {
        const item = values[0] as Record<string, unknown>;
        if (!Array.isArray(item.properties) || (item.shared != null && !Array.isArray(item.shared))) throw new Error("properties/shared 必须为数组");
        parts = dedupePropertyParts(((item.shared ?? []) as unknown[]).map(parseProperty), item.properties.map(parseProperty));
        notes = parseNotes(item.notes);
      }
      validateAttributeProperties([...parts.shared, ...parts.properties], options);
      results.push({ category: { id: node.id, name: node.name, path: node.pathNames }, ...parts, notes });
    } catch (error) {
      errors.push({ categoryId: node.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, errors, repairedClosingDelimiters, ignoredCategoryIds };
}

export function parseGovernanceResponse(text: string, targets: CategoryNode[], options: { allowMissingUnits?: boolean } = {}): GovernanceResult[] {
  const parsed = parseGovernanceResponsePartial(text, targets, options);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((item) => `${item.categoryId}: ${item.error}`).join("；"));
  return parsed.results;
}

function parseNotes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map(scalarText).filter((note): note is string => note !== null);
}
