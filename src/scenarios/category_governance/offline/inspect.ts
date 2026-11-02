import { resolve } from "node:path";
import type { InputSnapshot } from "./types.ts";
import type { CategoryTreeDocument } from "../types.ts";

// Read-only research helper, reusable by an engineer or a future agent. No network imports.
export async function inspectCategories(tree: CategoryTreeDocument, query = "", evidence?: InputSnapshot["evidence"]) {
  const selected = tree.nodes.filter(n => n.isLeaf && (!query || n.pathNames.some(x => x.includes(query))));
  const byParent = new Map<string, typeof selected>();
  for (const n of selected) { const key = n.pathNames.slice(1, -1).join(" > "); const list = byParent.get(key) ?? []; list.push(n); byParent.set(key, list); }
  for (const [path, leaves] of byParent) {
    console.log(path);
    console.log(leaves.map(n => `${n.name} [${n.id}]`).join("\n"));
  }
  if (evidence) {
    const ids = new Set(selected.map(n => n.id));
    for (const e of evidence.categories.filter(c => c.targetIds?.some(id => ids.has(id)))) {
      console.log(JSON.stringify({ jdCategoryId: e.id, path: e.path, skus: e.sampleSkuIds, fields: e.attributes }, null, 2));
    }
  }
  return selected.length;
}
if (import.meta.main) {
  const workspace = resolve(import.meta.dir, "../workspace");
  const tree = await Bun.file(resolve(workspace, "context/v1/category-tree.json")).json();
  const query = Bun.argv.slice(2).find(x => !x.startsWith("--")) ?? "";
  const evidence = Bun.argv.includes("--evidence") ? await Bun.file(resolve(workspace, "context/v1/jd-attribute-evidence.json")).json() : undefined;
  console.log(`末级类目 ${await inspectCategories(tree, query, evidence)}`);
}
