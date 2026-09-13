import type { AttributeProperty, GovernanceResult } from "./types.ts";

function propertySignature(property: AttributeProperty): string {
  return `${property.key}|${property.type}|${property.unit ?? ""}|${(property.options ?? []).join("|")}`;
}

function mergeProperties(results: GovernanceResult[], field: "shared" | "properties"): AttributeProperty[] {
  const groups = new Map<string, { count: number; values: AttributeProperty[] }>();
  for (const result of results) {
    for (const property of result[field] ?? []) {
      const signature = propertySignature(property);
      const group = groups.get(signature) ?? { count: 0, values: [] };
      group.count += 1;
      group.values.push(property);
      groups.set(signature, group);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.values[0]!.key.localeCompare(b.values[0]!.key))
    .map((group) => {
      const first = group.values[0]!;
      return {
        ...first,
        required: group.values.filter((property) => property.required).length * 2 >= group.values.length,
      };
    });
}

export function mergeGovernanceResults(results: GovernanceResult[]): GovernanceResult {
  if (results.length === 0) throw new Error("没有可合并的治理结果");
  return {
    category: results[0]!.category,
    shared: mergeProperties(results, "shared"),
    properties: mergeProperties(results, "properties"),
    notes: [...new Set(results.flatMap((result) => result.notes ?? []))].slice(0, 10),
    meta: { attempts: results.length, mergedAt: new Date().toISOString() },
  };
}
