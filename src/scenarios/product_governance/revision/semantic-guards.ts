import { CLAIM_STATUSES, isPresent, validateCategoryConsistency, validateClaim, validateEvidenceReference, type EvidenceReference, type FieldClaim, type FieldDefinition, type ProductRecord, type RuleIssue } from '../expansion/rules.ts';
import { evaluateFilledClaim, evaluateRequirements, type ConditionalBinding, type ConditionFact, type EvaluationOptions, type FactDefinition, type RequirementGroup } from './conditions.ts';

export const SEMANTIC_GUARD_VERSION = 'revision-semantic-guards-v1';
export type WeightScope = 'per_roll' | 'per_piece' | 'per_inner_pack' | 'sales_unit' | 'unspecified';
export interface RevisionClaim extends FieldClaim {
  weightScope?: WeightScope | string | null;
  originalValue?: number;
  originalUnit?: string;
  /** Exact source span containing one mass declaration and its scope/composition. An arbitrary ID is insufficient. */
  declarationEvidence?: EvidenceReference;
}
export interface MeasurementMetadata {
  kind?: string;
  displayOnly?: boolean;
  allowedUnits?: readonly string[];
  weightScopeEnum?: readonly string[];
  perUnitsByScope?: Readonly<Record<string, readonly string[]>>;
  basisField?: string;
  nominalField?: string;
  sameDeclarationRequired?: boolean;
}
export interface RevisionDefinition extends FieldDefinition { measurement?: MeasurementMetadata; retired?: boolean; status?: string }
export interface RevisionBinding extends ConditionalBinding { allowedValues?: readonly unknown[]; retired?: boolean; status?: string }
export interface RevisionRecord extends Omit<ProductRecord, 'fields'> { fields: Record<string, RevisionClaim> }
export interface RevisionStandard {
  definitions: readonly RevisionDefinition[];
  bindings: readonly RevisionBinding[];
  requirementGroups?: readonly RequirementGroup[];
  conditionFactDefinitions?: readonly FactDefinition[];
  retiredAttributeIds?: readonly string[];
}
export interface RevisionValidationOptions extends EvaluationOptions { facts?: readonly ConditionFact[] }
export interface RevisionIssue extends RuleIssue { relatedAttributeIds?: string[]; origin?: 'legacy_rules' | 'revision_guard' | 'conditions' }

const active = <T extends FieldClaim>(claim: T | undefined): claim is T & { status: 'filled' | 'enum_candidate' } => !!claim && ['filled', 'enum_candidate'].includes(claim.status);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const close = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 16;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
function issue(code: string, attributeId: string, message: string, severity: 'error' | 'review' = 'review', relatedAttributeIds?: string[]): RevisionIssue {
  return { code, ruleId: 'REV-SEM', severity, attributeId, message, suggestedStatus: severity === 'error' ? 'invalid' : 'needs_evidence', origin: 'revision_guard', ...(relatedAttributeIds ? { relatedAttributeIds } : {}) };
}
const refFor = (claim: FieldClaim): Partial<EvidenceReference> => ({ evidenceId: claim.evidenceId ?? undefined, quote: claim.quote ?? undefined });
function referenceIssues(product: ProductRecord, ref: Partial<EvidenceReference>, attributeId: string, options: EvaluationOptions): RevisionIssue[] {
  const issues: RevisionIssue[] = validateEvidenceReference(product, ref).map(i => ({ ...i, attributeId, origin: 'revision_guard' }));
  if (issues.length) return issues;
  // Reuse the independent evidence registry policy without trusting a claim's verified flag.
  const checked = evaluateFilledClaim({ value: 'source-reference', status: 'filled', evidenceId: ref.evidenceId, quote: ref.quote }, product, options);
  return checked.issues.map(i => issue(i.code, attributeId, i.message));
}

interface MassToken { value: number; unit: string; index: number; end: number; areal: boolean }
function massTokens(text: string): MassToken[] {
  const out: MassToken[] = [];
  const regex = /(?<![\d.])([0-9]+(?:\.[0-9]+)?)\s*(市斤|千克|公斤|kg|KG|Kg|kG|斤|克|g|G)(?![a-zA-Z])/gu;
  for (const match of text.matchAll(regex)) {
    const end = match.index! + match[0].length, suffix = text.slice(end).normalize('NFKC').replace(/\s+/gu, '');
    const areal = /^(?:[/／·.]?(?:m(?:\^?2|[-−]2)|平方米|平米)|每(?:平方米|平米)|[/／](?:平方米|平米|cm\^?2))/iu.test(suffix);
    out.push({ value: Number(match[1]), unit: match[2]!, index: match.index!, end, areal });
  }
  return out;
}
function sourceAmount(claim: RevisionClaim): { value: unknown; unit: unknown } {
  return { value: claim.originalValue ?? claim.value, unit: claim.originalUnit ?? claim.unit };
}
function matchingMass(text: string, amount: { value: unknown; unit: unknown }): MassToken[] {
  return massTokens(text).filter(t => t.value === amount.value && t.unit === amount.unit);
}
function massPrefix(text: string, token: MassToken): string {
  const previousEnd = massTokens(text).filter(t => t.end <= token.index).at(-1)?.end ?? 0;
  return text.slice(Math.max(previousEnd, token.index - 48), token.index).split(/[，,。；;\n]/u).at(-1) ?? '';
}
function declarationRefs(claim: RevisionClaim): EvidenceReference[] {
  return [claim.declarationEvidence, ...(typeof claim.evidenceId === 'string' && typeof claim.quote === 'string' ? [{ evidenceId: claim.evidenceId, quote: claim.quote }] : [])].filter((r): r is EvidenceReference => !!r);
}
function scopeProof(text: string, token: MassToken, per: string): boolean {
  const prefix = massPrefix(text, token);
  const suffix = text.slice(token.end, token.end + 20);
  return new RegExp(`(?:每|单)(?:个)?${escape(per)}[^，,。；;\\n]{0,36}$`, 'u').test(prefix) || new RegExp(`^\\s*(?:[/／]|每)${escape(per)}(?:[^\\p{L}]|$)`, 'u').test(suffix);
}

function validateOriginalConversion(claim: RevisionClaim, product: ProductRecord, attributeId: string, options: EvaluationOptions): RevisionIssue[] {
  const amount = sourceAmount(claim);
  if (amount.value === claim.value && amount.unit === claim.unit && !claim.calculation) return [];
  const out: RevisionIssue[] = [], c = claim.calculation;
  if (!positive(claim.originalValue) || typeof claim.originalUnit !== 'string' || !claim.originalUnit) out.push(issue('NOMINAL_MASS_ORIGINAL_REQUIRED', attributeId, '转换声明须保留原始数值和原始质量单位。', 'error'));
  if (!c || c.operation !== 'convert' || !c.formula?.trim() || c.inputs?.length !== 1 || !c.conversionEvidence || !positive(c.factor)) return [...out, issue('NOMINAL_MASS_CONVERSION_TRACE_REQUIRED', attributeId, '标称质量默认保存原数原单位；转换须有单一原始输入、算式、正转换系数及当前SKU明确等值证据。', 'error')];
  const input = c.inputs[0]!;
  out.push(...referenceIssues(product, input, attributeId, options), ...referenceIssues(product, c.conversionEvidence, attributeId, options));
  if (input.value !== amount.value || input.unit !== amount.unit || !matchingMass(input.quote, amount).some(t => !t.areal)) out.push(issue('NOMINAL_MASS_CONVERSION_SOURCE_MISMATCH', attributeId, '计算输入必须等于原值原单位，并共同出现在合法引文中。', 'error'));
  if (!positive(claim.value) || !close(input.value * c.factor!, claim.value)) out.push(issue('NOMINAL_MASS_CONVERSION_ARITHMETIC', attributeId, '转换系数与数值乘积不一致。', 'error'));
  if (c.outputUnit && c.outputUnit !== claim.unit) out.push(issue('NOMINAL_MASS_CONVERSION_OUTPUT_UNIT', attributeId, '计算输出单位与所填质量单位不一致。', 'error'));
  const formula = c.formula.normalize('NFKC').replace(/\s+/gu, '').replace(/×|x|X/gu, '*');
  const parsed = formula.match(/^(\d+(?:\.\d+)?)([*\/])(\d+(?:\.\d+)?)=(\d+(?:\.\d+)?)$/u);
  if (parsed && (!close(Number(parsed[1]), input.value) || !close(Number(parsed[4]), Number(claim.value)) || !close(parsed[2] === '*' ? Number(parsed[1]) * Number(parsed[3]) : Number(parsed[1]) / Number(parsed[3]), Number(parsed[4])))) out.push(issue('NOMINAL_MASS_CONVERSION_FORMULA', attributeId, '记录算式与输入、输出或实际运算不一致。', 'error'));
  const conversion = c.conversionEvidence.quote;
  if (!matchingMass(conversion, amount).some(t => !t.areal) || !matchingMass(conversion, { value: claim.value, unit: claim.unit }).some(t => !t.areal) || !/[=＝]|等于|即为/u.test(conversion) || /不等|≠/u.test(conversion)) out.push(issue('NOMINAL_MASS_EQUIVALENCE_NOT_EXPLICIT', attributeId, '等值引文须明确包含转换前后数值及各自单位；两个无关联质量数字不能代替等式。', 'error'));
  const grams: Record<string, number> = { g: 1, 克: 1, kg: 1000, 千克: 1000, 公斤: 1000, 斤: 500, 市斤: 500 };
  const from = typeof amount.unit === 'string' ? grams[amount.unit] : undefined, to = typeof claim.unit === 'string' ? grams[claim.unit] : undefined;
  if (from && to && !close(c.factor!, from / to)) out.push(issue('NOMINAL_MASS_CONVERSION_FACTOR', attributeId, '转换系数与质量单位关系矛盾。', 'error'));
  // Even a valid unit equation does not establish which object/packaging is covered.
  out.push(issue('NOMINAL_MASS_CONVERSION_REQUIRES_REVIEW', attributeId, '转换结构已检查；仍须Codex确认等式与原质量声明同义且未扩大对象范围，默认保留原数原单位。'));
  return out;
}

/** Display mass is checked independently; the legacy quantity validator must not interpret its placeholder unit. */
export function validateNominalMass(def: RevisionDefinition, claim: RevisionClaim, product: RevisionRecord, options: EvaluationOptions = {}): RevisionIssue[] {
  const id = def.id ?? 'paper.nominal_mass', out: RevisionIssue[] = [], metadata = def.measurement;
  if (!CLAIM_STATUSES.includes(claim.status as typeof CLAIM_STATUSES[number])) return [issue('STATUS_UNKNOWN', id, '取值状态未注册。', 'error')];
  if (!active(claim)) return isPresent(claim.value) ? [issue('UNRESOLVED_VALUE_PRESENT', id, '待补、冲突、无效和不适用的正式值须为空，原值另存。', 'error')] : [];
  if (!positive(claim.value)) out.push(issue('POSITIVE_NUMBER_REQUIRED', id, '标称质量须为有限正数，不能用数字字符串或单位文本代替。', 'error'));
  if (metadata?.kind !== 'nominal_mass' || metadata.displayOnly !== true || !metadata.allowedUnits || !metadata.weightScopeEnum || !metadata.perUnitsByScope) out.push(issue('NOMINAL_MASS_METADATA_REQUIRED', id, '新标称质量须使用measurement中的展示、单位、覆盖范围契约。', 'error'));
  if (typeof claim.unit !== 'string' || !claim.unit.trim()) out.push(issue('NOMINAL_MASS_UNIT_REQUIRED', id, '标称质量必须单独保留原始质量单位。', 'error'));
  else if (/[/／]|㎡|m[²2]|gsm|平方米|平米/iu.test(claim.unit)) out.push(issue('AREAL_MASS_IS_NOT_MASS', id, 'g/㎡、gsm等是面积定量，不是质量或标称质量。', 'error'));
  else if (metadata?.allowedUnits && !metadata.allowedUnits.includes(claim.unit)) out.push(issue('NOMINAL_MASS_UNIT_CANDIDATE', id, '当前质量单位未在新契约登记，保留原单位待复核，不能自动改成g。'));
  if (typeof claim.weightScope !== 'string' || !metadata?.weightScopeEnum?.includes(claim.weightScope)) out.push(issue('NOMINAL_MASS_SCOPE_REQUIRED', id, '覆盖范围须明确为per_roll/per_piece/per_inner_pack/sales_unit/unspecified之一。', 'error'));
  if (claim.weightScope === 'unspecified' && isPresent(claim.per)) out.push(issue('NOMINAL_MASS_UNSPECIFIED_HAS_PER', id, '范围未知只能原数展示，不能补每卷/每包分母。', 'error'));
  if (claim.weightScope && claim.weightScope !== 'unspecified') {
    if (claim.weightScope !== 'sales_unit' && (typeof claim.per !== 'string' || !claim.per)) out.push(issue('NOMINAL_MASS_PER_REQUIRED', id, '单卷、单件或单内包装范围须保留明确per单位。', 'error'));
    if (isPresent(claim.per) && !metadata?.perUnitsByScope?.[claim.weightScope]?.includes(claim.per!)) out.push(issue('NOMINAL_MASS_PER_INVALID', id, 'per单位与所声称覆盖范围不一致。', 'error'));
  }
  const refIssues = referenceIssues(product, refFor(claim), id, options);
  out.push(...refIssues);
  if (claim.declarationEvidence) out.push(...referenceIssues(product, claim.declarationEvidence, id, options));
  out.push(...validateOriginalConversion(claim, product, id, options));
  if (refIssues.length || typeof claim.quote !== 'string') return out;
  const amount = sourceAmount(claim), matches = matchingMass(claim.quote, amount);
  if (!matches.some(t => !t.areal)) {
    if (matches.some(t => t.areal) || /gsm|g\s*[/／]\s*(?:㎡|m[²2])|克\s*[/／每]\s*(?:平方米|平米)/iu.test(claim.quote)) out.push(issue('AREAL_MASS_IS_NOT_MASS', id, '原引文仅证明面积定量，不能截断/㎡并当作g质量。', 'error'));
    else out.push(issue('NOMINAL_MASS_SOURCE_PAIR_MISSING', id, '引文须同时保留对应原数值和原质量单位，不能用别处数字、同义单位或输出单位补证。', 'error'));
    return out;
  }
  if (matches.some(t => /(?:约|大约|不少于|至少|不超过|至多|小于|大于|不满|不高于|不低于|增加|净增|增重|[≥≤<>～~－-])[^0-9]{0,8}$/u.test(claim.quote!.slice(Math.max(0, t.index - 20), t.index)) || /^\s*(?:±|\+\/-|～|~|至|到|起|[-－]\s*\d)/u.test(claim.quote!.slice(t.end, t.end + 16)))) out.push(issue('NOMINAL_MASS_QUALIFIED_AMOUNT_REQUIRES_REVIEW', id, '约数、上下限、区间或增重量不等于精确绝对质量；保留原限定词，由Codex判断是否适合该质量字段。'));
  const scopes = declarationRefs(claim).filter(ref => !referenceIssues(product, ref, id, options).length && ref.quote.includes(claim.quote!));
  if (claim.weightScope && !['unspecified'].includes(claim.weightScope)) {
    const proven = scopes.some(ref => {
      const tokens = matchingMass(ref.quote, amount).filter(t => !t.areal);
      if (claim.weightScope === 'sales_unit') {
        const label = claim.per ? `(?:本|整)${escape(claim.per)}` : '本SKU|本销售单元|当前销售单元|整套|本套';
        return tokens.some(t => new RegExp(`(?:${label})[^，,。；;\\n]{0,40}$`, 'u').test(massPrefix(ref.quote, t)));
      }
      return !!claim.per && tokens.some(t => scopeProof(ref.quote, t, claim.per!));
    });
    if (!proven) out.push(issue('NOMINAL_MASS_SCOPE_REQUIRES_REVIEW', id, '原声明未明确把该质量数值归于所填对象/分母。请核实范围；未知用unspecified，不由纸型或销售总量补每卷。'));
    if (claim.weightScope === 'per_inner_pack' && proven && !scopes.some(ref => /最内|内包装|直接包装/u.test(ref.quote) || product.evidence.find(e => e.id === ref.evidenceId)?.scope === 'inner-pack')) out.push(issue('NOMINAL_MASS_INNER_SCOPE_REQUIRES_REVIEW', id, '每包/每提不必然等于最内层包装，仍须确认内外包装层级。'));
  }
  if (/克重|grammage/iu.test(claim.quote) && !/总重|净重|毛重|质量/u.test(claim.quote)) out.push(issue('MASS_OR_GRAMMAGE_REQUIRES_REVIEW', id, '仅有克重加裸g声明，须核其为质量还是缺面积单位的定量；不默认补g/㎡或净纸重。'));
  return out;
}

interface CompositionProof { paperOnly: boolean; coreIncluded: boolean; packagingExcluded: boolean; packagingIncluded: boolean }
function compositionProof(text: string): CompositionProof {
  const t = text.normalize('NFKC').replace(/\s+/gu, '');
  const exclusions = /(?:不包含|不包括|不含|不计入|未包含|未包括|未含|扣除|去除|剔除)((?:纸芯|卷芯|芯|外包装|包装)(?:(?:及|和|与|、|\/|以及)(?:纸芯|卷芯|芯|外包装|包装))*)/gu;
  const excludedObjects = [...t.matchAll(exclusions)].map(m => m[1]!).join('、');
  const positiveText = t.replace(exclusions, '');
  const excludesCore = /纸芯|卷芯|芯/u.test(excludedObjects), packagingExcluded = /包装/u.test(excludedObjects);
  const coreIncluded = /(?:包含|包括|含)(?:纸芯|卷芯|芯)/u.test(positiveText);
  const packagingIncluded = /(?:包含|包括|含)(?:外包装|包装)/u.test(positiveText);
  return { paperOnly: excludesCore && packagingExcluded, coreIncluded, packagingExcluded, packagingIncluded };
}

export function validateMassBasis(def: RevisionDefinition, claim: RevisionClaim, nominal: RevisionClaim | undefined, product: RevisionRecord, options: EvaluationOptions = {}): RevisionIssue[] {
  const id = def.id ?? 'paper.mass_basis', nominalId = def.measurement?.nominalField ?? 'paper.nominal_mass', out: RevisionIssue[] = [];
  if (!active(claim)) return out;
  out.push(...referenceIssues(product, refFor(claim), id, options));
  if (claim.declarationEvidence) out.push(...referenceIssues(product, claim.declarationEvidence, id, options));
  if (!active(nominal)) return [...out, issue('MASS_BASIS_WITHOUT_NOMINAL_DECLARATION', id, '口径必须关联当前SKU已保留的标称质量声明，不能脱离数值单独声称净纸重口径。', 'error', [nominalId])];
  if (out.length || typeof nominal.quote !== 'string' || typeof claim.quote !== 'string') return out;
  const amount = sourceAmount(nominal);
  const candidates = [...declarationRefs(claim), ...declarationRefs(nominal)].filter(ref => !referenceIssues(product, ref, id, options).length && ref.quote.includes(nominal.quote!) && ref.quote.includes(claim.quote!));
  const linked = candidates.find(ref => massTokens(ref.quote).filter(t => !t.areal).length === 1 && matchingMass(ref.quote, amount).some(t => !t.areal));
  if (!linked) return [...out, issue('MASS_BASIS_DECLARATION_LINK_REQUIRES_REVIEW', id, '两个字段须共同定位一条明确质量声明；仅同证据ID、自造声明ID或含多个质量数值的整段原文不证明同声明。可提供精确declarationEvidence。', 'review', [nominalId])];
  if (/并非|不是|不等于|不得(?:认定|视为|当作)|未知|未注明|未说明|无法确认|尚未确认/u.test(linked.quote)) return [...out, issue('MASS_BASIS_STATEMENT_REQUIRES_REVIEW', id, '声明含否定或未确认表述，不能只因出现某净质量口径词就映射为该口径，须Codex审句义。')];
  const proof = compositionProof(linked.quote);
  const supported = claim.value === '本体净质量（不含芯及包装）' ? proof.paperOnly && !proof.coreIncluded && !proof.packagingIncluded
    : claim.value === '含芯净质量（不含包装）' ? proof.coreIncluded && proof.packagingExcluded && !proof.packagingIncluded
      : claim.value === '含包装质量（毛重）' ? proof.packagingIncluded : false;
  if (!supported) out.push(issue('MASS_BASIS_COMPOSITION_REQUIRES_REVIEW', id, '须逐项审明纸本体、纸芯和包装是否计入。仅净重/毛重或纸型名称不足以自动映射当前完整口径；其他厂商口径保留候选。'));
  return out;
}

export function validateFormConsistency(product: RevisionRecord): RevisionIssue[] {
  const out: RevisionIssue[] = [], dispense = product.fields['paper.dispense'];
  for (const formId of ['face.form', 'kitchen.form']) {
    const form = product.fields[formId];
    if (!active(form)) continue;
    if (form.status === 'filled' && dispense?.status === 'filled' && ((form.value === '平叠单张式' && ['中心抽取', '外圈拉取'].includes(String(dispense.value))) || (form.value === '卷式' && dispense.value === '平叠揭取'))) out.push(issue('FORM_DISPENSE_CONFLICT', formId, '已填组织形态与已填取出路径互相矛盾；平叠单张不配中心/外圈拉卷，卷组织不配平叠揭取。', 'error', ['paper.dispense']));
    if (typeof form.quote !== 'string') continue;
    const quote = form.quote;
    if (/(?:并非|不是|不属于|不能确认|无法确认|未确认|未说明|未注明|未见)(?:为|是|该(?:产品|商品))?(?:卷式|卷筒|平叠|独立单张)|非(?:卷式|卷筒|平叠)/u.test(quote.normalize('NFKC').replace(/\s+/gu, ''))) { out.push(issue('FORM_STATEMENT_REQUIRES_REVIEW', formId, '形态词处在否定或未确认句中，不能按词面出现就填该组织形态；须独立审句义。')); continue; }
    if (/卷式|卷筒|滚筒|卷状|成卷|圆卷|绕卷/u.test(quote) && form.value === '卷式') continue;
    if (/独立(?:成张|单张)|平叠单张|单张平叠/u.test(quote) && /平叠/u.test(quote) && form.value === '平叠单张式') continue;
    if (/干湿|干用|湿用|干式|湿式/u.test(quote)) out.push(issue('FORM_NOT_ESTABLISHED_BY_USAGE', formId, '干湿/用法状态不证明卷式或非卷式，须独立审组织形态证据。'));
    else if (/抽取|抽式|中心抽|外圈/u.test(quote)) out.push(issue('FORM_NOT_ESTABLISHED_BY_ACTION', formId, '抽取动作不反证卷式，也不独立证明平叠单张组织；仅凭该动作引文需复核形态。'));
    else out.push(issue('FORM_EVIDENCE_REQUIRES_REVIEW', formId, '须核当前本体卷组织或独立单张平叠结构；包装类型、卷数或旧枚举不能自动迁移组织形态。'));
  }
  return out;
}

function validateNetMassPromotion(product: RevisionRecord, definitions: readonly RevisionDefinition[]): RevisionIssue[] {
  const out: RevisionIssue[] = [];
  for (const def of definitions.filter(d => /净纸重/u.test(d.name ?? '') || d.operator === 'positive_mass_excluding_core_and_packaging')) {
    if (!def.id) continue;
    const claim = product.fields[def.id];
    if (!active(claim) || typeof claim.quote !== 'string') continue;
    const proof = compositionProof(claim.quote);
    if (proof.coreIncluded || proof.packagingIncluded) out.push(issue('NET_PAPER_MASS_COMPOSITION_CONFLICT', def.id, '原文明确含芯或含包装，不得当作排除纸芯及包装的净纸重。', 'error', ['paper.nominal_mass']));
    else if (!proof.paperOnly) out.push(issue('NET_PAPER_MASS_NOT_PROVEN', def.id, '裸质量、标称质量或仅净重字样不自动证明排除纸芯与包装的净纸重；须Codex另审原口径。', 'review', ['paper.nominal_mass']));
  }
  return out;
}

/** The original three-field contract remains reusable when its companion fields and evidence validate. */
export function validateCountTriad(product: RevisionRecord, bindings: readonly RevisionBinding[]): RevisionIssue[] {
  const ids = ['paper.quantity', 'paper.count_unit', 'paper.inner_unit'];
  if (!ids.every(id => bindings.some(b => b.attributeId === id))) return [];
  const q = product.fields['paper.quantity'], count = product.fields['paper.count_unit'], inner = product.fields['paper.inner_unit'];
  if (!active(q)) return [];
  const out: RevisionIssue[] = [];
  if (count?.status !== 'filled' || inner?.status !== 'filled' || typeof count.value !== 'string' || typeof inner.value !== 'string') return [issue('COUNT_TRIAD_INCOMPLETE', 'paper.quantity', '成品数量、原计数单位和最内包装单位须完整成组；候选或缺项不视为三元完成。', 'review', ids.slice(1))];
  const isPlaceholder = (unit: string | null | undefined): boolean => !unit || /见|随|计数单位|内包装单位|原单位/u.test(unit);
  const rawUnits = [q.countUnit, q.unit].filter((unit): unit is string => !isPlaceholder(unit));
  const parsed = rawUnits.map(unit => unit.match(/^([^/／]+)[/／](.+)$/u));
  const units = rawUnits.map((unit, i) => parsed[i]?.[1] ?? unit), pers = [q.packUnit, q.per, ...parsed.map(parts => parts?.[2])].filter((per): per is string => !!per);
  if (units.some(unit => unit !== count.value)) out.push(issue('COUNT_TRIAD_UNIT_MISMATCH', 'paper.quantity', '数量unit与paper.count_unit不一致；冗余countUnit也必须相同，不能用优先级掩盖抽、张、片矛盾。', 'error', ['paper.count_unit']));
  if (pers.some(per => per !== inner.value)) out.push(issue('COUNT_TRIAD_PER_MISMATCH', 'paper.quantity', '数量per与paper.inner_unit不一致；per、packUnit和unit分母均须相同，不能把外箱/整提范围改作内包装。', 'error', ['paper.inner_unit']));
  const layerInputs = q.calculation?.inputs.some(input => /层/u.test(input.unit));
  if (/层/u.test(count.value) || units.some(unit => /层/u.test(unit)) || (layerInputs && q.calculation?.operation !== 'convert') || /累计层张|层张合计|累计纸层数/u.test(q.quote ?? '')) out.push(issue('LAYER_ACCUMULATION_NOT_FINISHED_COUNT', 'paper.quantity', '层数是单张结构，不能乘入成品张/抽/片数，也不能把层张或其累计数作为成品计数。', 'error', ['paper.count_unit']));
  else if (layerInputs) out.push(issue('LAYER_BASED_COUNT_REQUIRES_REVIEW', 'paper.quantity', '若原文确有层数到成品数的明确换算，须逐SKU核对等式；不得把累计层张本身作为成品量。'));
  return out;
}

/** Pure precheck. It never creates values, derives roll facts from actions, or upgrades display mass to net mass. */
export function validateRevisionRecord(product: RevisionRecord, standard: RevisionStandard, options: RevisionValidationOptions = {}) {
  const facts = options.facts ?? [], evaluationOptions = { ...options, factDefinitions: options.factDefinitions ?? standard.conditionFactDefinitions };
  const isRetired = (binding: RevisionBinding): boolean => !!binding.retired || binding.status === 'retired' || !!standard.definitions.find(d => d.id === binding.attributeId && (d.retired || d.status === 'retired')) || !!standard.retiredAttributeIds?.includes(binding.attributeId);
  const effectiveBindings = standard.bindings.filter(binding => !isRetired(binding));
  const initialRequirements = evaluateRequirements(effectiveBindings, product.fields, standard.requirementGroups ?? [], product, facts, evaluationOptions);
  const issues: RevisionIssue[] = validateCategoryConsistency(product).map(i => ({ ...i, origin: 'legacy_rules' }));
  if (!initialRequirements.excluded) {
    const definitions = new Map(standard.definitions.map(d => [d.id, d]));
    const bindings = standard.bindings.filter(b => !b.categoryId || b.categoryId === product.categoryId);
    for (const [id, claim] of Object.entries(product.fields)) {
      const def = definitions.get(id);
      if (!def) { issues.push(issue('ATTRIBUTE_UNREGISTERED', id, '字段未在当前修订标准中注册。', 'error')); continue; }
      const matches = bindings.filter(b => b.attributeId === id), binding = matches[0];
      if (active(claim) && (matches.length !== 1 || !binding)) { issues.push(issue(matches.length > 1 ? 'ATTRIBUTE_BINDING_AMBIGUOUS' : 'ATTRIBUTE_NOT_BOUND', id, '有效当前类目的active字段必须唯一绑定；旧类目、迁移后未绑定或已移除属性不得参与当前填值。', 'error')); continue; }
      if (!matches.length) continue;
      if (active(claim) && (def.retired || binding?.retired || def.status === 'retired' || binding?.status === 'retired' || standard.retiredAttributeIds?.includes(id))) { issues.push(issue('ATTRIBUTE_RETIRED', id, '当前属性或绑定已退休，保留原始记录不能作为本版本active填值。', 'error')); continue; }
      if (binding && isRetired(binding)) continue;
      const effectiveDefinition = binding?.allowedValues ? { ...def, enum: binding.allowedValues } : def;
      if (active(claim) && binding?.allowedValues) {
        const values = Array.isArray(claim.value) ? claim.value : [claim.value];
        if (values.some(value => !binding.allowedValues!.includes(value))) issues.push(issue(claim.status === 'enum_candidate' ? 'BINDING_VALUE_CANDIDATE' : 'BINDING_VALUE_NOT_ALLOWED', id, '须逐值使用当前类目binding.allowedValues，而非其他类目或全局候选全集。', claim.status === 'enum_candidate' ? 'review' : 'error'));
      }
      if (id === 'paper.nominal_mass' || def.measurement?.kind === 'nominal_mass') issues.push(...validateNominalMass(def, claim, product, evaluationOptions));
      else issues.push(...validateClaim(effectiveDefinition, claim, product).map(i => ({ ...i, origin: 'legacy_rules' as const })));
      if (active(claim)) issues.push(...referenceIssues(product, refFor(claim), id, evaluationOptions));
      if (id === 'paper.mass_basis' || def.measurement?.sameDeclarationRequired) issues.push(...validateMassBasis(def, claim, product.fields[def.measurement?.nominalField ?? 'paper.nominal_mass'], product, evaluationOptions));
    }
    issues.push(...validateFormConsistency(product), ...validateNetMassPromotion(product, standard.definitions), ...validateCountTriad(product, bindings.filter(b => !isRetired(b))));
    const displayIds = new Set(standard.definitions.filter(d => d.measurement?.kind === 'nominal_mass' || d.id === 'paper.nominal_mass').map(d => d.id));
    for (const group of standard.requirementGroups ?? []) for (const attrs of group.paths?.map(p => p.attributes) ?? group.atLeastOne ?? []) for (const id of attrs) if (displayIds.has(id)) issues.push(issue('DISPLAY_MASS_IN_PROCUREMENT_PATH', id, '展示用标称质量不得成为采购计量OR路径，也不得豁免严格净纸重或其他业务核心。', 'error'));
  }
  const distinct = [...new Map(issues.map(i => [`${i.attributeId}:${i.code}:${i.message}`, i])).values()];
  // The requirements engine must not count a structurally/semantically unresolved filled claim as a valid path.
  const guardedFields = Object.fromEntries(Object.entries(product.fields).map(([id, field]) => {
    const own = distinct.filter(i => i.attributeId === id || i.relatedAttributeIds?.includes(id));
    return [id, own.length && field.status === 'filled' ? { ...field, value: null, status: own.some(i => i.severity === 'error') ? 'invalid' : 'needs_evidence' } : field];
  }));
  const requirements = initialRequirements.excluded ? initialRequirements : evaluateRequirements(effectiveBindings, guardedFields, standard.requirementGroups ?? [], { ...product, fields: guardedFields }, facts, evaluationOptions);
  const conditionIssues: RevisionIssue[] = requirements.issues.map(i => ({ code: i.code, ruleId: 'REV-COND', severity: /INVALID|MISMATCH|NOT_FOUND|WRONG_SKU|NOT_EXACT|AMBIGUOUS|NOT_REGISTERED|NOT_BOUND|BOOLEAN_REQUIRED|DUPLICATE/u.test(i.code) ? 'error' : 'review', message: i.message, ...(i.attributeId ? { attributeId: i.attributeId } : {}), origin: 'conditions' }));
  const combined = [...new Map([...distinct, ...conditionIssues].map(i => [`${i.attributeId}:${i.code}:${i.message}`, i])).values()];
  const errors = combined.filter(i => i.severity === 'error'), reviews = combined.filter(i => i.severity === 'review');
  const unresolved = Object.entries(product.fields).filter(([, f]) => ['enum_candidate', 'conflict', 'invalid'].includes(f.status)).map(([attributeId, f]) => ({ attributeId, status: f.status }));
  return { version: SEMANTIC_GUARD_VERSION, excluded: requirements.excluded, exclusionReason: requirements.exclusionReason, passesPrecheck: !requirements.excluded && requirements.complete && !errors.length && !reviews.length && !unresolved.length, needsCodexReview: requirements.excluded || reviews.length > 0 || unresolved.length > 0, issues: combined, errors, reviews, unresolved, requirements, conditionIssues: requirements.issues };
}
