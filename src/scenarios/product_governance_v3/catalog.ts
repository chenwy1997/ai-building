import { hash, normalized, Blocked } from "./core.ts";

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  isLeaf: boolean;
  aliases: string[];
}
export class CategoryIndex {
  readonly nodes: CategoryNode[];
  readonly byId = new Map<string, CategoryNode>();
  readonly children = new Map<string, CategoryNode[]>();
  readonly version: string;
  constructor(raw: {
    nodes: unknown[];
    rootId?: string;
    externalParentIds?: string[];
  }) {
    const external = new Set([
      ...(raw.externalParentIds ?? []),
      ...(raw.rootId ? [raw.rootId] : []),
    ]);
    this.nodes = raw.nodes.map((v: any) => {
      if (
        !v ||
        typeof v.id !== "string" ||
        !v.id ||
        typeof v.name !== "string" ||
        !v.name ||
        typeof v.isLeaf !== "boolean" ||
        (v.parentId != null && typeof v.parentId !== "string")
      )
        throw new Error("invalid category node");
      return {
        id: v.id,
        parentId: v.parentId || null,
        name: v.name,
        path: typeof v.path === "string" ? v.path : v.name,
        isLeaf: v.isLeaf,
        aliases: Array.isArray(v.aliases)
          ? v.aliases.filter((x: unknown) => typeof x === "string")
          : [],
      };
    });
    for (const n of this.nodes) {
      if (this.byId.has(n.id)) throw new Error("duplicate category ID " + n.id);
      this.byId.set(n.id, n);
    }
    for (const n of this.nodes) {
      if (n.parentId && !this.byId.has(n.parentId) && !external.has(n.parentId))
        throw new Error("unknown parent " + n.parentId);
      if (n.parentId)
        this.children.set(n.parentId, [
          ...(this.children.get(n.parentId) ?? []),
          n,
        ]);
    }
    for (const n of this.nodes) {
      const seen = new Set<string>();
      let current: CategoryNode | undefined = n;
      while (current) {
        if (seen.has(current.id)) throw new Error("category cycle");
        seen.add(current.id);
        if (seen.size > 512) throw new Error("category depth exceeded");
        current = current.parentId
          ? this.byId.get(current.parentId)
          : undefined;
      }
      if (n.isLeaf && (this.children.get(n.id)?.length ?? 0) > 0)
        throw new Error("leaf has children " + n.id);
    }
    this.version = hash({ nodes: this.nodes, external: [...external].sort() });
  }
  get(id: string) {
    const node = this.byId.get(id);
    if (!node) throw new Blocked("unknown_category", "unknown category " + id);
    return node;
  }
  descendants(id: string, leavesOnly = false) {
    this.get(id);
    const queue = [id],
      result: CategoryNode[] = [];
    for (let i = 0; i < queue.length; i++) {
      const n = this.get(queue[i]!);
      if (!leavesOnly || n.isLeaf) result.push(n);
      queue.push(...(this.children.get(n.id) ?? []).map((x) => x.id));
    }
    return result;
  }
  search(query: string, scopeId: string | null = null) {
    const q = normalized(query);
    if (!q) throw new Error("empty category query");
    const scope = scopeId
      ? new Set(this.descendants(scopeId).map((n) => n.id))
      : null;
    return this.nodes
      .filter(
        (n) =>
          (!scope || scope.has(n.id)) &&
          [n.name, n.path, ...n.aliases].some((s) => normalized(s).includes(q)),
      )
      .sort(
        (a, b) =>
          Number(normalized(b.name) === q) - Number(normalized(a.name) === q) ||
          a.id.localeCompare(b.id),
      );
  }
  related(id: string) {
    const target = this.get(id),
      name = normalized(target.name);
    const grams = new Set(
      Array.from({ length: Math.max(0, name.length - 1) }, (_, i) =>
        name.slice(i, i + 2),
      ),
    );
    return this.nodes
      .filter((n) => n.isLeaf && n.id !== id)
      .map((n) => ({
        node: n,
        score: [...grams].filter((g) => normalized(n.name).includes(g)).length,
      }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  }
  page<T>(items: T[], key: unknown, limit = 20, cursor: string | null = null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("limit must be 1..100");
    const signature = hash({ version: this.version, key });
    let offset = 0;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          parsed.signature !== signature ||
          !Number.isInteger(parsed.offset) ||
          parsed.offset < 0 ||
          parsed.offset > items.length
        )
          throw Error();
        offset = parsed.offset;
      } catch {
        throw new Error("cursor does not match query/version");
      }
    }
    const values = items.slice(offset, offset + limit),
      next = offset + values.length;
    return {
      treeVersion: this.version,
      total: items.length,
      items: values,
      truncated: next < items.length,
      nextCursor:
        next < items.length
          ? Buffer.from(JSON.stringify({ signature, offset: next })).toString(
              "base64url",
            )
          : null,
    };
  }
}
