import type {
  CategoryNode,
  CategoryRawRecord,
  CategoryTreeDocument,
} from "./types.ts";

const asText = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const first = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = asText(value);
    if (text !== null) return text;
  }
  return null;
};

function extractRows(input: unknown): CategoryRawRecord[] {
  if (Array.isArray(input)) return input.filter(isRecord) as CategoryRawRecord[];
  if (!isRecord(input)) throw new Error("类目 JSON 必须是数组或对象");
  for (const key of ["items", "nodes", "data", "list", "categoryList"]) {
    const value = input[key];
    if (Array.isArray(value)) return value.filter(isRecord) as CategoryRawRecord[];
    if (isRecord(value)) {
      const nested = extractRows(value);
      if (nested.length > 0) return nested;
    }
  }
  return [input as CategoryRawRecord];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FlatRecord {
  id: string;
  parentId: string | null;
  name: string;
  categoryId: string | null;
  enabled: boolean;
  payload: CategoryRawRecord;
  order: number;
}

function flattenNested(
  rows: CategoryRawRecord[],
  result: FlatRecord[],
  parentId: string | null = null,
  counter = { value: 0 },
): void {
  for (const row of rows) {
    const id = first(row.id, row.categoryInstanceId, row.code);
    const givenName = first(row.name, row.title, row.label, row.category);
    if (!id) continue;
    // 接口返回的根节点偶尔没有 name；嵌套 children 只有 id 的占位记录则跳过，避免把占位符误当成真实类目。
    if (!givenName && parentId !== null) continue;
    const name = givenName ?? "标准类目";
    const actualParentId = first(row.fatherId, row.parentId, row.parent_id) ?? parentId;
    result.push({
      id,
      parentId: actualParentId,
      name,
      categoryId: first(row.categoryId, row.category_id),
      enabled: row.isEnable !== false && row.enabled !== false && row.isEnabled !== false,
      payload: row,
      order: counter.value++,
    });
    const children = Array.isArray(row.children)
      ? row.children.filter(isRecord) as CategoryRawRecord[]
      : [];
    if (children.length > 0) flattenNested(children, result, id, counter);
  }
}

export function normalizeCategories(input: unknown, version = "v1"): CategoryTreeDocument {
  const flat: FlatRecord[] = [];
  flattenNested(extractRows(input), flat);
  const byId = new Map<string, FlatRecord>();
  for (const row of flat) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, row);
  }

  const children = new Map<string, string[]>();
  for (const row of byId.values()) {
    if (row.parentId && byId.has(row.parentId)) {
      const siblings = children.get(row.parentId) ?? [];
      siblings.push(row.id);
      children.set(row.parentId, siblings);
    }
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (byId.get(a)!.order - byId.get(b)!.order));

  const roots = [...byId.values()]
    .filter((row) => !row.parentId || !byId.has(row.parentId))
    .sort((a, b) => a.order - b.order)
    .map((row) => row.id);
  const nodes: CategoryNode[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const walk = (id: string, parentPathIds: string[], parentPathNames: string[]): void => {
    if (visiting.has(id)) throw new Error(`类目树存在循环引用：${id}`);
    if (visited.has(id)) return;
    const row = byId.get(id);
    if (!row) return;
    visiting.add(id);
    const pathIds = [...parentPathIds, id];
    const pathNames = [...parentPathNames, row.name];
    const childIds = children.get(id) ?? [];
    nodes.push({
      id: row.id,
      parentId: row.parentId && byId.has(row.parentId) ? row.parentId : null,
      name: row.name,
      level: pathIds.length,
      pathIds,
      pathNames,
      categoryId: row.categoryId,
      isLeaf: childIds.length === 0,
      enabled: row.enabled,
      payload: row.payload,
    });
    for (const childId of childIds) walk(childId, pathIds, pathNames);
    visiting.delete(id);
    visited.add(id);
  };
  for (const root of roots) walk(root, [], []);
  // Orphan records are retained as roots so the import remains lossless.
  for (const row of byId.values()) if (!visited.has(row.id)) walk(row.id, [], []);
  nodes.sort((a, b) => a.pathIds.join("/").localeCompare(b.pathIds.join("/")));
  return {
    version,
    nodes,
    roots: nodes.filter((node) => node.parentId === null).map((node) => node.id),
    leafCount: nodes.filter((node) => node.isLeaf).length,
  };
}

export function categoryById(document: CategoryTreeDocument): Map<string, CategoryNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

export function descendantsOf(
  document: CategoryTreeDocument,
  rootId: string,
): CategoryNode[] {
  return document.nodes.filter((node) => node.pathIds.includes(rootId));
}
