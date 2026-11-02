import type { Dictionary, Property, Unit } from '../contracts.ts';
import { validateDictionary } from '../contracts.ts';
import { seed } from '../seed.ts';
import type { NameEvidence } from './extract.ts';

export interface Target { propertyId: string; when?: string }
export interface Deferral { scope: string; reason: string }
export interface Decision {
  name: string;
  action: 'map' | 'split' | 'defer';
  targets?: Target[];
  defer?: Deferral[];
  reason?: string;
  note?: string;
}
export interface DecisionFile {
  schema: 'sanheng-canonical-decisions-v1';
  batch: number;
  ranks: [number, number];
  author: string;
  note?: string;
  newUnits?: Unit[];
  amendUnitIds?: Array<{ propertyId: string; unitIds: string[]; reason: string }>;
  newProperties?: Array<Omit<Property, 'revision' | 'quantity' | 'aliases' | 'basis'> &
    Partial<Pick<Property, 'quantity' | 'aliases' | 'basis'>>>;
  decisions: Decision[];
}

const project = { kind: 'project-definition' as const, ref: 'dictionary/canonical/归并规程.md' };

/**
 * Applies one batch of model or architect decisions onto the accumulated dictionary.
 *
 * Every semantic judgement — which names denote one concept, what the described
 * object is, which distinctions must stay apart — arrives in the decision file.
 * This function only enforces the contracts: units resolve to a single quantity,
 * amendments bump the revision instead of rewriting a stored one, targets exist,
 * and each in-scope name is decided exactly once.
 */
export function applyDecisions(
  base: Dictionary,
  file: DecisionFile,
  scope: NameEvidence[],
): { dictionary: Dictionary; coverage: Coverage } {
  if (file.schema !== 'sanheng-canonical-decisions-v1') throw new Error('未知归并决定格式');

  const units = [...base.units];
  for (const unit of file.newUnits ?? []) {
    const existing = units.find((candidate) => candidate.id === unit.id);
    if (existing) {
      if (existing.symbol !== unit.symbol || existing.quantity !== unit.quantity) {
        throw new Error(`单位ID不可被重定义: ${unit.id}`);
      }
      continue;
    }
    units.push(unit);
  }

  const properties = [...base.properties];
  const latest = (id: string) =>
    properties.filter((property) => property.id === id).sort((a, b) => b.revision - a.revision)[0];

  // Widening an existing property's unit list is a definition change, so it becomes a
  // new revision; the stored revision stays byte-identical and remains referenceable.
  for (const amendment of file.amendUnitIds ?? []) {
    const current = latest(amendment.propertyId);
    if (!current) throw new Error(`要修订的属性不存在: ${amendment.propertyId}`);
    if (!amendment.reason.trim()) throw new Error(`单位修订缺少理由: ${amendment.propertyId}`);
    const added = amendment.unitIds.filter((id) => !current.unitIds.includes(id));
    if (!added.length) throw new Error(`单位修订没有实际变化: ${amendment.propertyId}`);
    properties.push({
      ...structuredClone(current),
      revision: current.revision + 1,
      unitIds: amendment.unitIds,
      qualifications: [...current.qualifications, `单位范围修订：${amendment.reason}`],
    });
  }

  for (const proposal of file.newProperties ?? []) {
    if (latest(proposal.id)) throw new Error(`标准属性ID已存在，新增须换ID或走修订: ${proposal.id}`);
    const quantity =
      proposal.quantity ?? (proposal.unitIds.length ? units.find((u) => u.id === proposal.unitIds[0])?.quantity ?? null : null);
    properties.push({
      aliases: [],
      ...proposal,
      revision: 1,
      quantity,
      basis: proposal.basis?.length ? proposal.basis : [project],
    });
  }

  const dictionary: Dictionary = { schema: base.schema, units, properties };
  validateDictionary(dictionary);

  const inScope = new Map(scope.map((entry) => [entry.name, entry]));
  const decided = new Set<string>();
  for (const decision of file.decisions) {
    if (!inScope.has(decision.name)) throw new Error(`决定的属性名不在本批范围内: ${decision.name}`);
    if (decided.has(decision.name)) throw new Error(`同一属性名被决定两次: ${decision.name}`);
    decided.add(decision.name);

    if (decision.action === 'defer') {
      if (!decision.reason?.trim()) throw new Error(`defer必须说明理由: ${decision.name}`);
      if (decision.targets?.length) throw new Error(`defer不能同时给出映射目标: ${decision.name}`);
      continue;
    }
    const targets = decision.targets ?? [];
    if (!targets.length) throw new Error(`${decision.action}必须给出映射目标: ${decision.name}`);
    if (decision.action === 'map' && targets.length !== 1) {
      throw new Error(`map只能有一个目标，多义或复合写法请用split: ${decision.name}`);
    }
    if (decision.action === 'split' && targets.length < 2) {
      throw new Error(`split至少要有两个目标: ${decision.name}`);
    }
    const seen = new Set<string>();
    for (const target of targets) {
      if (!latest(target.propertyId)) throw new Error(`映射目标不存在: ${decision.name} -> ${target.propertyId}`);
      if (seen.has(target.propertyId)) throw new Error(`同一目标重复出现: ${decision.name} -> ${target.propertyId}`);
      seen.add(target.propertyId);
      if (decision.action === 'split' && !target.when?.trim()) {
        throw new Error(`split的每个目标必须说明适用情形: ${decision.name} -> ${target.propertyId}`);
      }
    }
    for (const deferral of decision.defer ?? []) {
      if (!deferral.scope.trim() || !deferral.reason.trim()) throw new Error(`部分留待处理必须写清范围与理由: ${decision.name}`);
    }
  }
  const missing = scope.filter((entry) => !decided.has(entry.name));
  if (missing.length) throw new Error(`本批有 ${missing.length} 个属性名未决定，例如 ${missing.slice(0, 5).map((m) => m.name).join('、')}`);

  return { dictionary, coverage: measure(file, scope) };
}

export interface Coverage {
  names: number;
  leafCategories: number;
  mapped: { names: number; leafCategories: number };
  split: { names: number; leafCategories: number };
  deferred: { names: number; leafCategories: number };
  variantsCollapsed: number;
}

function measure(file: DecisionFile, scope: NameEvidence[]): Coverage {
  const byName = new Map(scope.map((entry) => [entry.name, entry]));
  const bucket = () => ({ names: 0, leafCategories: 0 });
  const coverage: Coverage = {
    names: scope.length,
    leafCategories: scope.reduce((sum, entry) => sum + entry.leafCategories, 0),
    mapped: bucket(),
    split: bucket(),
    deferred: bucket(),
    variantsCollapsed: 0,
  };
  for (const decision of file.decisions) {
    const entry = byName.get(decision.name)!;
    const target = decision.action === 'map' ? coverage.mapped : decision.action === 'split' ? coverage.split : coverage.deferred;
    target.names += 1;
    target.leafCategories += entry.leafCategories;
    if (decision.action !== 'defer') coverage.variantsCollapsed += entry.variantsTotal;
  }
  return coverage;
}

export interface MappingRow {
  name: string;
  action: Decision['action'];
  leafCategories: number;
  variantsTotal: number;
  propertyId: string | null;
  propertyName: string | null;
  when: string | null;
  note: string | null;
}

/** Flat mapping from historical attribute name to canonical property, one row per target. */
export function mappingRows(file: DecisionFile, dictionary: Dictionary, scope: NameEvidence[]): MappingRow[] {
  const byName = new Map(scope.map((entry) => [entry.name, entry]));
  const rows: MappingRow[] = [];
  for (const decision of file.decisions) {
    const entry = byName.get(decision.name)!;
    const base = {
      name: decision.name,
      action: decision.action,
      leafCategories: entry.leafCategories,
      variantsTotal: entry.variantsTotal,
      note: decision.note ?? decision.reason ?? null,
    };
    if (decision.action === 'defer') {
      rows.push({ ...base, propertyId: null, propertyName: null, when: null });
      continue;
    }
    for (const target of decision.targets!) {
      const property = dictionary.properties
        .filter((candidate) => candidate.id === target.propertyId)
        .sort((a, b) => b.revision - a.revision)[0]!;
      rows.push({ ...base, propertyId: property.id, propertyName: property.name, when: target.when ?? null });
    }
  }
  return rows;
}

export const baseDictionary = seed;
