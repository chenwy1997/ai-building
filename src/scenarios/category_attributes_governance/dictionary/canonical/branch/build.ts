import type { Database } from 'bun:sqlite';
import type { Dictionary, Property, Selection } from '../../contracts.ts';
import type { BranchTemplate, Finding, GuidanceIndex, LeafDelta, ResolvedLeaf } from '../mounting.ts';
import { candidates, inspectLeaf, resolveLeaf } from '../mounting.ts';
import type { BranchSpec } from './spec.ts';

/** One historical attribute name as it appears on one leaf, folded across duplicate rows. */
export interface HistoricalAttribute {
  name: string;
  descriptions: string[];
  options: string[];
}
export interface LeafEvidence {
  leafId: string;
  leafName: string;
  historical: HistoricalAttribute[];
}
export interface BranchEvidence {
  branchPath: string[];
  leaves: LeafEvidence[];
  /** Historical names on this branch that the dictionary has no mapping for. */
  unmappedNames: string[];
}

const trim = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit)}…`);

/**
 * Reads the branch straight from the candidate library. Rows are folded by (leaf, name)
 * because the same name recurs with reworded descriptions; the distinct descriptions are
 * kept rather than merged, since a name carrying two meanings is exactly what the mounting
 * step has to notice.
 */
export function collectBranch(db: Database, spec: BranchSpec, mappedNames: Set<string>): BranchEvidence {
  const depth = spec.branchPath.length;
  const rows = db
    .query(
      `SELECT category_id, category_name, path, name, property FROM candidates_v1
       WHERE namespace = 'sanheng' AND json_extract(path, '$[${depth}]') = ?
       ORDER BY category_name, name`,
    )
    .all(spec.branchPath.at(-1)!) as Array<{ category_id: string; category_name: string; path: string; name: string; property: string }>;

  const wanted = spec.branchPath.join('/');
  const leaves = new Map<string, LeafEvidence>();
  const unmapped = new Set<string>();
  for (const row of rows) {
    const path = JSON.parse(row.path) as string[];
    if (path.slice(1, -1).join('/') !== wanted) continue;
    let leaf = leaves.get(row.category_id);
    if (!leaf) leaves.set(row.category_id, (leaf = { leafId: row.category_id, leafName: row.category_name, historical: [] }));
    if (!mappedNames.has(row.name)) unmapped.add(row.name);
    let attribute = leaf.historical.find((item) => item.name === row.name);
    if (!attribute) leaf.historical.push((attribute = { name: row.name, descriptions: [], options: [] }));
    const property = JSON.parse(row.property) as { description?: string | null; options?: string[] | null };
    const description = (property.description ?? '').trim();
    if (description && !attribute.descriptions.includes(description)) attribute.descriptions.push(description);
    for (const option of property.options ?? []) if (option && !attribute.options.includes(option)) attribute.options.push(option);
  }
  if (!leaves.size) throw new Error(`分支下没有末级类目: ${wanted}`);
  return {
    branchPath: spec.branchPath,
    leaves: [...leaves.values()].sort((a, b) => (a.leafName < b.leafName ? -1 : 1)),
    unmappedNames: [...unmapped].sort(),
  };
}

export interface Candidate {
  propertyId: string;
  revision: number;
  dimension: string;
  name: string;
  object: string;
  definition: string;
  type: Property['type'];
  units: string[];
  selectWhen: string;
  mustNotMean: string[];
  alternativeOf?: string[];
  companions?: string[];
}

/** Latest revision of each property, so a caller never pins a superseded definition. */
function current(dictionary: Dictionary): Map<string, Property> {
  const latest = new Map<string, Property>();
  for (const property of dictionary.properties) {
    const seen = latest.get(property.id);
    if (!seen || property.revision > seen.revision) latest.set(property.id, property);
  }
  return latest;
}

export function shortlist(dictionary: Dictionary, guidance: GuidanceIndex, spec: BranchSpec): Candidate[] {
  const latest = current(dictionary);
  const units = new Map(dictionary.units.map((unit) => [unit.id, unit.symbol]));
  return candidates(guidance, spec.facets).map((entry) => {
    const property = latest.get(entry.propertyId);
    if (!property) throw new Error(`候选属性不在字典中: ${entry.propertyId}`);
    return {
      propertyId: property.id,
      revision: property.revision,
      dimension: entry.dimension,
      name: property.name,
      object: property.object,
      definition: trim(property.definition, 220),
      type: property.type,
      units: property.unitIds.map((id) => units.get(id) ?? id),
      selectWhen: entry.selectWhen,
      mustNotMean: property.excludedMeanings,
      ...(entry.alternativeOf ? { alternativeOf: entry.alternativeOf } : {}),
      ...(entry.companions ? { companions: entry.companions } : {}),
    };
  });
}

/** Context shared by every request in the branch, and therefore the cached prefix. */
export function branchContext(spec: BranchSpec, evidence: BranchEvidence, list: Candidate[], dictionaryHash: string) {
  return {
    分支: spec.branchPath.join(' › '),
    字典哈希: dictionaryHash,
    须覆盖维度: spec.requiredDimensions,
    候选属性: list,
    末级类目: evidence.leaves.map((leaf) => ({
      id: leaf.leafId,
      名称: leaf.leafName,
      历史属性: leaf.historical.map((item) => ({
        名称: item.name,
        历史说明: item.descriptions.map((text) => trim(text, 110)).slice(0, 3),
        ...(item.options.length ? { 历史取值样本: item.options.slice(0, 8) } : {}),
      })),
    })),
    证据性质:
      '历史属性来自历史模板的忠实聚合。历史上有不代表该有，没有不代表不该有，出现频次不证明必填。同名不代表同义。',
  };
}

export interface Gap {
  need: string;
  object: string;
  why: string;
  historicalNames: string[];
  leaves: string[];
}
interface RawSelection {
  propertyId?: unknown;
  requirement?: unknown;
  condition?: unknown;
  rationale?: unknown;
  unitId?: unknown;
}

const requirements = new Set(['required', 'optional', 'conditional']);

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

/**
 * Parses one model-proposed selection. The revision is filled from the dictionary rather
 * than taken from the model: pinning definitions is the program's job, and a model that
 * guesses a revision would either fail the compiler or silently pin a stale definition.
 */
/**
 * Properties the dictionary holds but the branch shortlist left out, and the model asked for
 * anyway. Accepting them keeps the guarantee that matters — an id must exist in the frozen
 * dictionary, so nothing is invented — while treating the shortlist as the thing at fault.
 * Since facet labels are now derived per branch rather than hand-picked, a shortlist that came
 * out too narrow would otherwise kill the whole branch over a property that plainly belongs.
 */
export interface RecallMiss {
  propertyId: string;
  where: string;
}

function selection(
  raw: RawSelection,
  allowed: Map<string, Candidate>,
  label: string,
  outside?: { revisions: Map<string, number>; record: RecallMiss[] },
): Selection {
  const propertyId = text(raw.propertyId, `${label} propertyId`);
  let candidate = allowed.get(propertyId);
  if (!candidate) {
    const revision = outside?.revisions.get(propertyId);
    if (revision === undefined) throw new Error(`${label} 选了字典里没有的属性: ${propertyId}`);
    outside!.record.push({ propertyId, where: label });
    candidate = { propertyId, revision } as Candidate;
  }
  const requirement = text(raw.requirement, `${label} requirement`);
  if (!requirements.has(requirement)) throw new Error(`${label} 未知必填策略: ${requirement}`);
  const condition = typeof raw.condition === 'string' && raw.condition.trim() ? raw.condition.trim() : undefined;
  if (requirement === 'conditional' && !condition) throw new Error(`${label} 条件必填缺少 condition: ${propertyId}`);
  return {
    propertyId,
    revision: candidate.revision,
    requirement: requirement as Selection['requirement'],
    ...(requirement === 'conditional' ? { condition } : {}),
    ...(typeof raw.unitId === 'string' && raw.unitId.trim() ? { unitId: raw.unitId.trim() } : {}),
    rationale: text(raw.rationale, `${label} rationale`),
  };
}

function gaps(value: unknown, fallbackLeaf?: string): Gap[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('gaps 必须是数组');
  return value.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    return {
      need: text(item.need, `gaps[${index}].need`),
      object: typeof item.object === 'string' ? item.object.trim() : '',
      why: text(item.why, `gaps[${index}].why`),
      historicalNames: Array.isArray(item.historicalNames) ? item.historicalNames.map(String) : [],
      leaves: Array.isArray(item.leaves) && item.leaves.length ? item.leaves.map(String) : fallbackLeaf ? [fallbackLeaf] : [],
    };
  });
}

/** Models sometimes wrap JSON in a fence despite instructions; unwrap, never repair. */
export function parseJson(reply: string): unknown {
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}

export function parseBase(
  reply: string,
  list: Candidate[],
  revisions?: Map<string, number>,
): { base: Selection[]; gaps: Gap[]; recallMisses: RecallMiss[] } {
  const parsed = parseJson(reply) as { base?: unknown; gaps?: unknown };
  if (!Array.isArray(parsed.base) || !parsed.base.length) throw new Error('base 必须是非空数组');
  const allowed = new Map(list.map((item) => [item.propertyId, item]));
  const recallMisses: RecallMiss[] = [];
  const outside = revisions ? { revisions, record: recallMisses } : undefined;
  const base = parsed.base.map((raw, index) => selection(raw as RawSelection, allowed, `base[${index}]`, outside));
  const seen = new Set<string>();
  for (const item of base) {
    if (seen.has(item.propertyId)) throw new Error(`基础集重复选择属性: ${item.propertyId}`);
    seen.add(item.propertyId);
  }
  return { base, gaps: gaps(parsed.gaps), recallMisses };
}

/**
 * `base` is needed only to drop no-op overrides. `resolveLeaf` rejects them, and rightly
 * so — a hand-authored delta that changes nothing is a real defect. But a model restating
 * the inherited policy is noise, not a data error, so it is absorbed here and reported in
 * `dropped` rather than either throwing or vanishing.
 */
export function parseLeaf(
  reply: string,
  leaf: LeafEvidence,
  list: Candidate[],
  base: Selection[] = [],
  revisions?: Map<string, number>,
): { delta: LeafDelta; gaps: Gap[]; dropped: string[]; recallMisses: RecallMiss[] } {
  const parsed = parseJson(reply) as { add?: unknown; remove?: unknown; override?: unknown; gaps?: unknown };
  const allowed = new Map(list.map((item) => [item.propertyId, item]));
  const inherited = new Map(base.map((item) => [item.propertyId, item]));
  const dropped: string[] = [];
  const recallMisses: RecallMiss[] = [];
  const outside = revisions ? { revisions, record: recallMisses } : undefined;
  const label = leaf.leafName;
  // An `add` naming a property the base already carries is the model restating inheritance.
  // Where it restates the same policy it is a no-op; where the policy differs it is an
  // override in everything but name, and converting it preserves the intent that dropping
  // it would lose.
  const promoted: Array<{ propertyId: string; requirement: Selection['requirement']; condition?: string; reason: string }> = [];
  const add = (Array.isArray(parsed.add) ? parsed.add : [])
    .map((raw, i) => selection(raw as RawSelection, allowed, `${label} add[${i}]`, outside))
    .filter((item) => {
      const current = inherited.get(item.propertyId);
      if (!current) return true;
      if (current.requirement === item.requirement && current.condition === item.condition) {
        dropped.push(`add ${item.propertyId} 已在基础集且策略一致（${item.requirement}），未构成差异，已忽略`);
        return false;
      }
      promoted.push({ propertyId: item.propertyId, requirement: item.requirement, ...(item.condition ? { condition: item.condition } : {}), reason: item.rationale });
      dropped.push(`add ${item.propertyId} 已在基础集但策略不同，按改必填策略处理（${current.requirement}→${item.requirement}）`);
      return false;
    });
  const removeRequested = Array.isArray(parsed.remove)
    ? parsed.remove.map((raw, i) => {
        const item = raw as Record<string, unknown>;
        return { propertyId: text(item.propertyId, `${label} remove[${i}] propertyId`), reason: text(item.reason, `${label} remove[${i}] reason`) };
      })
    : [];
  const override = [...(Array.isArray(parsed.override) ? parsed.override : []), ...promoted]
    .map((raw, i) => {
      const item = raw as Record<string, unknown>;
      const requirement = text(item.requirement, `${label} override[${i}] requirement`);
      if (!requirements.has(requirement)) throw new Error(`${label} override[${i}] 未知必填策略: ${requirement}`);
      const condition = typeof item.condition === 'string' && item.condition.trim() ? item.condition.trim() : undefined;
      if (requirement === 'conditional' && !condition) throw new Error(`${label} override[${i}] 条件必填缺少 condition`);
      const propertyId = text(item.propertyId, `${label} override[${i}] propertyId`);
      // A requirement change with no stated reason cannot be reviewed, so it is dropped rather
      // than accepted — which leaves the inherited policy in force, the conservative outcome.
      // Waiving the reason instead would be the one thing that lets drift back in silently.
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      if (!reason) {
        dropped.push(`override ${propertyId} 没写理由，无法复核，已丢弃并沿用基础集策略`);
        return null;
      }
      return { propertyId, requirement: requirement as Selection['requirement'], ...(requirement === 'conditional' ? { condition } : {}), reason };
    })
    .filter((change): change is { propertyId: string; requirement: Selection['requirement']; condition?: string; reason: string } => {
      if (!change) return false;
      const current = inherited.get(change.propertyId);
      if (current && current.requirement === change.requirement && current.condition === change.condition) {
        dropped.push(`override ${change.propertyId} 与基础集策略一致（${change.requirement}），未构成差异，已忽略`);
        return false;
      }
      // resolveLeaf rightly rejects an override of a property the base does not carry. When the
      // leaf is not also removing it, what the model meant was an add, and the base policy it
      // claims to be changing does not exist — so the change is meaningless and dropped.
      if (!current) {
        dropped.push(`override ${change.propertyId} 不在基础集，无策略可改，已丢弃`);
        return false;
      }
      return true;
    });

  // A leaf that both removes a property and rewrites its requirement has reasoned past its
  // own first answer; the override is the refined one. Keeping it also fails safe: a
  // conditional property that never applies is noise, while a removed property that should
  // have been there is a defect in the template.
  const rewritten = new Set(override.map((change) => change.propertyId));
  const remove = removeRequested.filter((removal) => {
    if (!rewritten.has(removal.propertyId)) return true;
    const change = override.find((item) => item.propertyId === removal.propertyId)!;
    dropped.push(`同一属性 ${removal.propertyId} 既要删除又要改策略，按改为${change.requirement}处理；删除理由存档：${removal.reason}`);
    return false;
  });

  return { delta: { leafId: leaf.leafId, leafName: leaf.leafName, add, remove, override }, gaps: gaps(parsed.gaps, leaf.leafName), dropped, recallMisses };
}

/** A gap after semantic consolidation, carrying the raw reports it absorbed. */
export interface MergedGap {
  need: string;
  object: string;
  type: 'text' | 'number' | 'integer' | 'boolean' | 'range';
  quantity: string | null;
  units: string[];
  why: string;
  /** Indices into the raw reports, so a merge can always be traced back and undone. */
  from: number[];
  note: string;
  /** Leaves derived by the program from the raw reports, never taken from the model. */
  leaves: string[];
  historicalNames: string[];
}

/**
 * A report the consolidator judged is already covered by an existing property. This is a
 * different defect from a missing property and must not be filed as one: the property is
 * in the dictionary, but its guidance did not lead the leaf to pick it.
 */
export interface NotGap {
  from: number[];
  coveredBy: string;
  why: string;
  reports: Array<{ need: string; object: string; leaves: string[] }>;
  /** The consolidator also argued this is a real gap. Grounds for adding the property instead. */
  contested?: string;
}

/**
 * A report a standing ruling already disposed of. Distinct from both other buckets because
 * the action is to add nothing: the dictionary decided against it, and re-filing it as a gap
 * would quietly overturn that decision one branch at a time.
 */
export interface RuledOut {
  from: number[];
  ruling: string;
  why: string;
  reports: Array<{ need: string; object: string; leaves: string[] }>;
  /** The consolidator also argued this is a real gap. Grounds for reopening the ruling. */
  contested?: string;
}

const valueTypes = new Set(['text', 'number', 'integer', 'boolean', 'range']);

/** Raw reports as sent to the consolidator: a stable index, because `need` is not unique. */
export const numberedGaps = (raw: Gap[]) => raw.map((gap, index) => ({ 序号: index + 1, ...gap }));

function indices(value: unknown, limit: number, label: string): number[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} from 必须是非空序号数组`);
  return value.map((item) => {
    const index = Number(item);
    if (!Number.isInteger(index) || index < 1 || index > limit) throw new Error(`${label} 引用了不存在的申报序号: ${String(item)}`);
    return index;
  });
}

/**
 * Parses the consolidation reply. Leaf coverage and historical names are recomputed from
 * the raw reports rather than read from the model: the model decides which reports are the
 * same need, but how many leaves that need touches is arithmetic, and a merged gap whose
 * `from` misses a report would silently understate its impact.
 */
export function parseMergedGaps(
  reply: string,
  raw: Gap[],
  propertyIds?: Set<string>,
  rulingIds?: Set<string>,
): { gaps: MergedGap[]; notGaps: NotGap[]; ruledOut: RuledOut[] } {
  const parsed = parseJson(reply) as { gaps?: unknown; notGaps?: unknown; ruledOut?: unknown };
  if (!Array.isArray(parsed.gaps)) throw new Error('归并结果 gaps 必须是数组');
  let merged = parsed.gaps.map((item, index) => {
    const gap = item as Record<string, unknown>;
    const label = `归并gaps[${index}]`;
    const type = text(gap.type, `${label}.type`);
    if (!valueTypes.has(type)) throw new Error(`${label} 未知值类型: ${type}`);
    const quantity = typeof gap.quantity === 'string' && gap.quantity.trim() ? gap.quantity.trim() : null;
    const units = Array.isArray(gap.units) ? gap.units.map(String).filter(Boolean) : [];
    if ((type === 'number' || type === 'integer' || type === 'range') && (!quantity || !units.length))
      throw new Error(`${label} 数值型缺口必须给物理量与单位: ${text(gap.need, 'need')}`);
    if ((type === 'text' || type === 'boolean') && (quantity || units.length))
      throw new Error(`${label} 非数值缺口不得带物理量或单位: ${text(gap.need, 'need')}`);
    const from = indices(gap.from, raw.length, label);
    const absorbed = from.map((position) => raw[position - 1]!);
    return {
      need: text(gap.need, `${label}.need`),
      object: text(gap.object, `${label}.object`),
      type: type as MergedGap['type'],
      quantity,
      units,
      why: text(gap.why, `${label}.why`),
      from,
      note: typeof gap.note === 'string' ? gap.note.trim() : '',
      leaves: [...new Set(absorbed.flatMap((report) => report.leaves))].sort(),
      historicalNames: [...new Set(absorbed.flatMap((report) => report.historicalNames))].sort(),
    };
  });

  const notGapsRaw = (Array.isArray(parsed.notGaps) ? parsed.notGaps : []).map((item, index) => {
    const entry = item as Record<string, unknown>;
    const label = `归并notGaps[${index}]`;
    const from = indices(entry.from, raw.length, label);
    const coveredBy = text(entry.coveredBy, `${label}.coveredBy`);
    // A ruling id here means the model meant ruledOut and used the wrong bucket. Rerouting is
    // safe because both buckets add nothing to the dictionary; only the follow-up differs.
    if (rulingIds?.has(coveredBy)) return { reroute: { from, ruling: coveredBy, why: text(entry.why, `${label}.why`) } };
    if (propertyIds && !propertyIds.has(coveredBy)) throw new Error(`${label} coveredBy 指向不存在的属性: ${coveredBy}`);
    return {
      from,
      coveredBy,
      why: text(entry.why, `${label}.why`),
      reports: from.map((position) => {
        const report = raw[position - 1]!;
        return { need: report.need, object: report.object, leaves: report.leaves };
      }),
    };
  });

  const notGaps = notGapsRaw.filter((entry): entry is NotGap => !('reroute' in entry));

  const ruledOut: RuledOut[] = (Array.isArray(parsed.ruledOut) ? parsed.ruledOut : []).map((item, index) => {
    const entry = item as Record<string, unknown>;
    const label = `归并ruledOut[${index}]`;
    const from = indices(entry.from, raw.length, label);
    const ruling = text(entry.ruling, `${label}.ruling`);
    if (rulingIds && !rulingIds.has(ruling)) throw new Error(`${label} ruling 指向不存在的裁定: ${ruling}`);
    return {
      from,
      ruling,
      why: text(entry.why, `${label}.why`),
      reports: from.map((position) => {
        const report = raw[position - 1]!;
        return { need: report.need, object: report.object, leaves: report.leaves };
      }),
    };
  });
  for (const entry of notGapsRaw) {
    if (!('reroute' in entry) || !entry.reroute) continue;
    const { from, ruling, why } = entry.reroute;
    ruledOut.push({
      from,
      ruling,
      why,
      reports: from.map((position) => {
        const report = raw[position - 1]!;
        return { need: report.need, object: report.object, leaves: report.leaves };
      }),
    });
  }

  // Within gaps a report may be cited twice, because a leaf sometimes files two needs as one
  // line — 防寒服 reported 充绒量 and 含绒量 together, and they are different properties. That
  // does not inflate coverage: the leaf really does need both.
  //
  // A report claimed as both a gap and already ruled out is the consolidator being genuinely
  // torn, and that is something the reviewer should see rather than something to resolve here.
  // The ruling holds by default — it was adjudicated with reasons — and the gap argument is
  // attached as the grounds for reopening it. Failing the whole run instead would throw away
  // a dozen leaf calls to report an ambivalence a person can settle in one glance.
  const settled = new Set(ruledOut.flatMap((entry) => entry.from));
  const contestedGaps = merged.filter((gap) => gap.from.some((position) => settled.has(position)));
  for (const entry of ruledOut) {
    const arguing = contestedGaps.filter((gap) => gap.from.some((position) => entry.from.includes(position)));
    if (arguing.length) entry.contested = arguing.map((gap) => `${gap.need}：${gap.why}`).join('；');
  }
  merged = merged.filter((gap) => !contestedGaps.includes(gap) || gap.from.some((position) => !settled.has(position)));
  for (const gap of merged) gap.from = gap.from.filter((position) => !settled.has(position));

  // A report claimed as both a missing property and as covered by an existing one gets the
  // same treatment for the same reason: prefer the outcome that adds nothing, and carry the
  // gap argument along so a person can overrule it. Adding a property the dictionary already
  // covers is the expensive mistake — it is what makes a dictionary grow without gaining
  // meaning — while a widened selectWhen that turns out unnecessary costs one line of prose.
  const covered = new Set(notGaps.flatMap((entry) => entry.from));
  for (const entry of notGaps) {
    const arguing = merged.filter((gap) => gap.from.some((position) => entry.from.includes(position)));
    if (arguing.length) entry.contested = arguing.map((gap) => `${gap.need}：${gap.why}`).join('；');
  }
  merged = merged.filter((gap) => gap.from.some((position) => !covered.has(position)));
  for (const gap of merged) gap.from = gap.from.filter((position) => !covered.has(position));

  const seen = new Map<number, string>();
  for (const entry of merged) for (const position of entry.from) seen.set(position, 'gaps');
  for (const position of covered) seen.set(position, 'notGaps');
  for (const position of settled) seen.set(position, 'ruledOut');
  const orphans = raw.map((_, index) => index + 1).filter((position) => !seen.has(position));
  if (orphans.length) throw new Error(`归并漏掉了原始申报，不得丢弃: ${orphans.map((position) => `${position}.${raw[position - 1]!.need}`).join('、')}`);

  return { gaps: merged.sort((a, b) => b.leaves.length - a.leaves.length), notGaps, ruledOut };
}

export interface MountedBranch {
  template: BranchTemplate;
  resolved: ResolvedLeaf[];
  findings: Finding[];
  gaps: Gap[];
}

/**
 * Composes the template and runs both checks. `resolveLeaf` is the contract gate — an
 * unreasoned delta or an illegal unit throws here, so a leaf cannot quietly drift from its
 * siblings. `inspectLeaf` is advisory: its findings go to review and never edit anything.
 */
export function mount(dictionary: Dictionary, guidance: GuidanceIndex, spec: BranchSpec, base: Selection[], deltas: LeafDelta[], collected: Gap[]): MountedBranch {
  const template: BranchTemplate = { schema: 'sanheng-branch-template-v1', branchPath: spec.branchPath, base, leaves: deltas };
  const resolved = deltas.map((delta) => resolveLeaf(dictionary, template, delta));
  const findings = resolved.flatMap((leaf) => inspectLeaf(guidance, leaf, spec.requiredDimensions));

  const merged = new Map<string, Gap>();
  for (const gap of collected) {
    const key = `${gap.need}|${gap.object}`;
    const seen = merged.get(key);
    if (!seen) merged.set(key, { ...gap, historicalNames: [...gap.historicalNames], leaves: [...gap.leaves] });
    else {
      for (const name of gap.historicalNames) if (!seen.historicalNames.includes(name)) seen.historicalNames.push(name);
      for (const leaf of gap.leaves) if (!seen.leaves.includes(leaf)) seen.leaves.push(leaf);
    }
  }
  return { template, resolved, findings, gaps: [...merged.values()].sort((a, b) => b.leaves.length - a.leaves.length) };
}

/** Sibling agreement on the mounted result, comparable to the same measure on history. */
export function consistency(resolved: ResolvedLeaf[]): { meanJaccard: number; minJaccard: number; sharedByAll: string[] } {
  const sets = resolved.map((leaf) => new Set(leaf.selections.map((selection) => selection.propertyId)));
  const scores: number[] = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const union = new Set([...sets[i]!, ...sets[j]!]);
      let shared = 0;
      for (const id of sets[i]!) if (sets[j]!.has(id)) shared++;
      scores.push(union.size ? shared / union.size : 1);
    }
  const shared = [...(sets[0] ?? [])].filter((id) => sets.every((set) => set.has(id))).sort();
  return {
    meanJaccard: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 1,
    minJaccard: scores.length ? Math.min(...scores) : 1,
    sharedByAll: shared,
  };
}
