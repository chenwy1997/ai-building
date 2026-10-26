import type { AttributeDefinition } from "./core.ts";

// Recall only. These related terms neither merge identities nor grant target scope.
export const ATTRIBUTE_SEARCH_TERMS = [
  ["单张尺寸", "纸张尺寸", "单张长度", "单张宽度", "纸张规格"],
  ["材质", "原料", "基材", "纤维"],
  ["每包数量", "每包抽数", "每包张数", "包内数量"],
] as const;
const normalize = (s: string) => s.normalize("NFKC").toLowerCase();
export function attributeSearchMatch(a: AttributeDefinition, query: string | null) {
  if (!query) return { kind: "scoped_inventory", terms: [] as string[] };
  const q = normalize(query), fields = [a.name, a.conceptKey, a.definition, a.scope].map(normalize);
  if (fields.some(s => s.includes(q))) return { kind: "literal", terms: [query] };
  const terms = ATTRIBUTE_SEARCH_TERMS.filter(group => group.some(term => normalize(term) === q))
    .flatMap(group => [...group]).filter(term => fields.some(s => s.includes(normalize(term))));
  return terms.length ? { kind: "related_term_candidate_only", terms: [...new Set(terms)] } : null;
}
