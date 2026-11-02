/** Category knowledge is semantic guidance, not evidence or verified fact. */
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(nonempty) && new Set(v).size === v.length;

export function validateExtractionKnowledge(knowledge: any, contract?: any): void {
  if (!object(knowledge) || knowledge.version !== 1 || !Array.isArray(knowledge.packs)) throw Error('Extraction knowledge needs version=1 and packs');
  const categories = new Map<string, any[]>();
  if (contract) {
    if (!Array.isArray(contract.proposals)) throw Error('Contract proposals required');
    for (const p of contract.proposals) { const rows = categories.get(p.categoryId) ?? []; rows.push(p); categories.set(p.categoryId, rows); }
  }
  const ids = new Set<string>();
  for (const pack of knowledge.packs) {
    if (!object(pack) || !nonempty(pack.id) || ids.has(pack.id) ||
      !((nonempty(pack.version)) || (Number.isInteger(pack.version) && pack.version > 0)) || !strings(pack.categoryIds) ||
      !Array.isArray(pack.rules) || !pack.rules.length) throw Error('Invalid or duplicate extraction knowledge pack');
    ids.add(pack.id);
    if (contract && pack.categoryIds.some((id: string) => !categories.has(id))) throw Error(`Knowledge pack ${pack.id} has unknown category`);
    const ruleIds = new Set<string>();
    for (const rule of pack.rules) {
      if (!object(rule) || !nonempty(rule.id) || ruleIds.has(rule.id) || !nonempty(rule.description) || !strings(rule.definitionIds)) throw Error(`Invalid rule in pack ${pack.id}`);
      ruleIds.add(rule.id);
      if (contract && rule.definitionIds.some((id: string) => !pack.categoryIds.some((cat: string) => categories.get(cat)?.some(p => p.definitionId === id)))) {
        throw Error(`Knowledge rule ${pack.id}/${rule.id} has unknown definition`);
      }
    }
  }
  if (knowledge.enumExtensions !== undefined && !Array.isArray(knowledge.enumExtensions)) throw Error('enumExtensions must be an array');
  for (const ext of knowledge.enumExtensions ?? []) {
    if (!object(ext) || !nonempty(ext.definitionId) || !strings(ext.categoryIds) || !strings(ext.values) || !nonempty(ext.reason) || ext.adoption !== 'pending_human') throw Error('Invalid enum extension');
    if (contract && ext.categoryIds.some((id: string) => !categories.get(id)?.some(p => p.definitionId === ext.definitionId && p.type === 'option'))) throw Error(`Enum extension ${ext.definitionId} has unknown category/definition`);
  }
}

export function queryExtractionKnowledge(knowledge: any, options: { categoryIds?: string[]; definitionIds?: string[]; text?: string } = {}) {
  validateExtractionKnowledge(knowledge);
  const cats = options.categoryIds ? new Set(options.categoryIds) : null, definitions = options.definitionIds ? new Set(options.definitionIds) : null;
  const packs = knowledge.packs.flatMap((pack: any) => {
    const categoryIds = cats ? pack.categoryIds.filter((id: string) => cats.has(id)) : pack.categoryIds;
    if (!categoryIds.length) return [];
    const rules = pack.rules.filter((r: any) => (!definitions || r.definitionIds.some((id: string) => definitions.has(id))) &&
      (!options.text || JSON.stringify(r).includes(options.text) || JSON.stringify({ id: pack.id, name: pack.name }).includes(options.text)));
    return rules.length ? [{ ...pack, categoryIds, rules }] : [];
  });
  return { version: 1, packs };
}
