import type { DraftDocument, DraftCategory, KnowledgeProperty, PropertyOrigin } from "./types.ts";
import { stableJson } from "./build.ts";

type CRow = [number,number[],number[],number[],string[],DraftCategory["treatment"],number[],number[],number[]];
export interface CompactDraft {
  schema: "sanheng-attribute-std-v1";
  legend: { nodes: string; categories: string; required: string; notes: string };
  edition: string;
  categoryVersion: string;
  nodes: Array<[string,string,number]>;
  attributes: KnowledgeProperty[];
  origins: PropertyOrigin[];
  texts: string[];
  categories: CRow[];
}
function dictionary<T>() {
  const values: T[] = []; const index = new Map<string,number>();
  return { values, add(value: T) { const key = stableJson(value); let id = index.get(key); if (id === undefined) { id = values.length; index.set(key,id); values.push(value); } return id; } };
}

/** Model-readable, dictionary-based compression; no gzip/base64 or irreversible summarisation. */
export function toStdText(document: DraftDocument): string {
  const a = dictionary<KnowledgeProperty>(), o = dictionary<PropertyOrigin>(), t = dictionary<string>();
  const nodes: CompactDraft["nodes"] = [], nodeIndices = new Map<string,number>();
  const rows: CRow[] = [];
  for (const c of document.categories) {
    let parent = -1;
    c.category.path.forEach((name,i) => {
      const pathKey = stableJson(c.category.path.slice(0,i+1));
      const key = i === c.category.path.length-1 ? c.category.id : pathKey;
      let index = nodeIndices.get(key);
      if (index === undefined) { index = nodes.length; nodeIndices.set(key,index); nodes.push([i === c.category.path.length-1 ? c.category.id : "",name,parent]); }
      parent = index;
    });
    rows.push([parent,c.shared.map(p=>a.add(p)),c.properties.map(p=>a.add(p)),[...c.shared,...c.properties].map(p=>o.add(c.provenance[p.key]!)),c.knowledgePacks,c.treatment,c.changes.map(x=>t.add(x)),c.cautions.map(x=>t.add(x)),c.notes.map(x=>t.add(x))]);
  }
  const compact: CompactDraft = { schema:"sanheng-attribute-std-v1",legend:{ nodes:"[leafID or empty, original name, parent index; -1=root]",categories:"[leaf node, shared attribute indices, category attribute indices, aligned origin indices, knowledge pack IDs, treatment, change text indices, caution text indices, note text indices]",required:"attribute.required=true is a proposed entry requirement; condition specifies applicability; requiredWhenApplicable=true requires a value only when the condition holds; origin.reviews records applied author decisions and formatting normalization, not supplier certification",notes:"candidate values are suggestions from historical drafts, never a closed enumeration or verified JD values" },edition:document.edition,categoryVersion:document.categoryVersion,nodes,attributes:a.values,origins:o.values,texts:t.values,categories:rows };
  return JSON.stringify(compact);
}
export function fromStdText(text: string): DraftDocument {
  const c = JSON.parse(text) as CompactDraft;
  if (c.schema !== "sanheng-attribute-std-v1") throw new Error("不支持的属性压缩格式");
  const pathFor = (index: number): string[] => { const path: string[] = [], visited = new Set<number>(); while (index !== -1) { if (visited.has(index)) throw new Error("类目压缩文本含环"); visited.add(index); const node = c.nodes[index]; if (!node) throw new Error("无效父节点索引"); path.unshift(node[1]); index=node[2]; } return path; };
  return { schema:"sanheng-attribute-draft-v1",edition:c.edition,categoryVersion:c.categoryVersion,categories:c.categories.map(([ni,si,pi,oi,packs,treatment,changes,cautions,notes]) => {
    const n = c.nodes[ni]; if (!n || !n[0]) throw new Error("无效末级类目索引");
    const attr = (i: number) => { const p = c.attributes[i]; if (!p) throw new Error("无效属性索引"); return structuredClone(p); };
    const shared = si.map(attr), properties = pi.map(attr);
    if (oi.length !== shared.length+properties.length) throw new Error("属性与来源数量不一致");
    const provenance = Object.fromEntries([...shared,...properties].map((p,i) => { const o = c.origins[oi[i]!]; if (!o) throw new Error("无效来源索引"); return [p.key,structuredClone(o)]; }));
    const txt = (i: number) => { const v = c.texts[i]; if (v === undefined) throw new Error("无效文本索引"); return v; };
    return { category:{ id:n[0],name:n[1],path:pathFor(ni) },shared,properties,notes:notes.map(txt),provenance,knowledgePacks:packs,treatment,changes:changes.map(txt),cautions:cautions.map(txt) };
  }) };
}
