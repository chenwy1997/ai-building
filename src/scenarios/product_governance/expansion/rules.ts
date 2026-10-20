import catalog from './rule-catalog.json';

export const ruleCatalog = catalog;
export const CLAIM_STATUSES = ['filled', 'needs_evidence', 'conflict', 'invalid', 'enum_candidate', 'not_applicable'] as const;
export type ClaimStatus = typeof CLAIM_STATUSES[number];
export type RuleSeverity = 'error' | 'review';

export interface RuleIssue {
  code: string;
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  suggestedStatus?: ClaimStatus;
  evidenceIds?: string[];
  attributeId?: string;
}

export interface EvidenceReference { evidenceId: string; quote: string }
export interface ProductEvidence {
  id: string;
  productId?: string;
  text: string;
  kind?: string;
  source?: string;
  sourceRef?: string;
  /** This is evidence metadata established by collection/review, not a model claim. */
  scope?: 'inner-pack' | 'single-sheet' | 'body' | 'packaging' | 'pattern' | 'sale-unit' | string;
  skuMatches?: boolean;
}
export interface CalculationInput extends EvidenceReference {
  value: number;
  unit: string;
  scope: string;
  role?: 'total' | 'packs' | 'part' | 'source';
}
export interface EvidenceAssertion extends EvidenceReference { value: boolean }
export interface ClaimCalculation {
  operation: 'divide' | 'sum' | 'convert' | 'multiply';
  formula: string;
  inputs: CalculationInput[];
  scopeEvidence?: EvidenceReference;
  homogeneous?: EvidenceAssertion;
  giftsExcluded?: EvidenceAssertion;
  conversionEvidence?: EvidenceReference;
  factor?: number;
  outputUnit?: string;
}
export interface FieldDefinition {
  id?: string;
  name?: string;
  type?: string;
  fieldType?: string;
  unit?: string | null;
  operator?: string;
  enum?: readonly unknown[];
  selection?: string;
  dictionary?: string;
  dependencies?: readonly string[];
  required?: boolean;
  semantic?: 'quantity' | 'dimensions' | 'brand' | 'model' | 'pack' | 'color' | 'scent' | 'substrate' | 'lock' | 'includes_paper' | 'alcohol' | 'lotion' | string;
  quantity?: { unit?: string; per?: string; unitField?: string; perField?: string; units?: readonly string[]; perUnits?: readonly string[] };
  dimensionCount?: 2 | 3;
  applicable?: boolean;
  booleanEvidence?: { true?: readonly string[]; false?: readonly string[] };
}
export interface FieldClaim {
  value: unknown;
  status: string;
  evidenceId?: string | null;
  quote?: string | null;
  calculation?: ClaimCalculation | null;
  supportingEvidence?: EvidenceReference[];
  /** Original units may live on the claim or in definition.quantity's companion fields. */
  unit?: string | null;
  per?: string | null;
  countUnit?: string | null;
  packUnit?: string | null;
  reason?: string;
  required?: boolean;
  applicability?: EvidenceAssertion;
}
export interface CategoryDecision {
  status: string;
  targetId?: string | null;
  targetName?: string | null;
  targetPath?: string | null;
  targetConfirmed?: boolean;
  inRate?: boolean;
  crossCategory?: boolean;
  combinationPolicy?: string | null;
}
export interface ProductRecord {
  id: string;
  categoryId?: string;
  category?: CategoryDecision;
  evidence: ProductEvidence[];
  fields?: Record<string, FieldClaim>;
  crossCategory?: boolean;
  combination?: { crossCategory: boolean; policy?: string | null; primaryCategoryId?: string };
  components?: Array<{ categoryId?: string }>;
}

export const isPresent = (value: unknown): boolean => value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);

/** Comparison only: this must never be used to replace source values or map enums. */
export function normalizeForComparison(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (!isPresent(v)) return null;
    if (typeof v === 'string') return v.normalize('NFKC').trim();
    if (Array.isArray(v)) {
      const unique = [...new Set(v.map(item => JSON.stringify(normalize(item))))].sort();
      const items = unique.map(item => JSON.parse(item));
      return items.length === 1 ? items[0] : items;
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, normalize(item)]));
    if (typeof v === 'number' && !Number.isFinite(v)) return { invalidNumber: String(v) };
    return v;
  };
  return JSON.stringify(normalize(value));
}

function issue(code: string, ruleId: string, severity: RuleSeverity, message: string, suggestedStatus?: ClaimStatus, evidenceIds?: string[]): RuleIssue {
  return { code, ruleId, severity, message, ...(suggestedStatus ? { suggestedStatus } : {}), ...(evidenceIds?.length ? { evidenceIds } : {}) };
}
const error = (code: string, ruleId: string, message: string, status: ClaimStatus = 'invalid', ids?: string[]) => issue(code, ruleId, 'error', message, status, ids);
const review = (code: string, ruleId: string, message: string, status: ClaimStatus = 'needs_evidence', ids?: string[]) => issue(code, ruleId, 'review', message, status, ids);
const compact = (s: string): string => s.normalize('NFKC').replace(/\s+/gu, '');
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const numeric = '(?:\\d+(?:\\.\\d+)?)';
const numberEqual = (a: number, b: number): boolean => Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 16;

function semantics(def: FieldDefinition): string {
  if (def.semantic) return def.semantic;
  const key = `${def.id ?? ''} ${def.name ?? ''}`;
  if (/尺寸|规格尺寸|dimensions|\.size(?:\s|$)/iu.test(key) || /dimensions/iu.test(def.operator ?? '')) return 'dimensions';
  if (/颜色|colour|color/iu.test(key)) return 'color';
  if (/香型|气味|scent/iu.test(key)) return 'scent';
  if (/基布|substrate/iu.test(key)) return 'substrate';
  if (/带锁|\.lock(?:\s|$)/iu.test(key)) return 'lock';
  if (/含纸|includes_paper/iu.test(key)) return 'includes_paper';
  if (/酒精|alcohol/iu.test(key)) return 'alcohol';
  if (/乳霜|保湿添加|lotion/iu.test(key)) return 'lotion';
  if (/品牌|\.brand(?:\s|$)/iu.test(key)) return 'brand';
  if (/型号|货号|\.model(?:\s|$)/iu.test(key)) return 'model';
  if (/包装组成|\.pack(?:\s|$)/iu.test(key)) return 'pack';
  if (/计数值|quantity/iu.test(key) || /with_count_and_container_unit/u.test(def.operator ?? '')) return 'quantity';
  return '';
}

function quantityDefinition(def: FieldDefinition, claim?: FieldClaim, product?: ProductRecord): { unit: string; per?: string } | null {
  const companion = (id?: string): string | undefined => {
    const field = id ? product?.fields?.[id] : undefined;
    return field && ['filled', 'enum_candidate'].includes(field.status) && typeof field.value === 'string' ? field.value : undefined;
  };
  const rawUnit = claim?.countUnit ?? claim?.unit ?? '', rawClaimUnit = isUnitPlaceholder(rawUnit) ? '' : rawUnit, claimParts = rawClaimUnit.match(/^([^/／]+)[/／](.+)$/u);
  const unitField = def.quantity?.unitField ?? def.dependencies?.find(id => /(?:count|quantity)_unit$/u.test(id));
  const perField = def.quantity?.perField ?? def.dependencies?.find(id => /(?:inner|pack|container)_unit$/u.test(id));
  const dynamicUnit = companion(unitField) ?? claimParts?.[1] ?? rawClaimUnit;
  const dynamicPer = companion(perField) ?? claim?.packUnit ?? claim?.per ?? claimParts?.[2];
  if (def.quantity) {
    const unit = def.quantity.unit ?? dynamicUnit;
    return unit ? { unit, ...(def.quantity.per ?? dynamicPer ? { per: def.quantity.per ?? dynamicPer! } : {}) } : null;
  }
  const unit = (def.unit ?? '').trim();
  if (semantics(def) === 'quantity' && (!unit || /随|原单位|计数单位|数量单位|[、|]/u.test(unit))) return dynamicUnit ? { unit: dynamicUnit, ...(dynamicPer ? { per: dynamicPer } : {}) } : null;
  if (!unit || semantics(def) === 'dimensions') return null;
  const per = unit.match(/^([^/／]+)[/／](?:每)?(包|袋|盒|卷|筒|提|箱|桶|瓶|罐|支|个|件|套|条)$/u);
  return per ? { unit: per[1]!, per: per[2]! } : { unit };
}
const isUnitPlaceholder = (unit: string): boolean => /见|随|原单位|计数单位|数量单位|内包装单位|[、|]/u.test(unit);

/** A substring check stays exact; normalization is deliberately confined to comparison/parsing. */
export function validateEvidenceReference(product: ProductRecord, ref: Partial<EvidenceReference>): RuleIssue[] {
  if (typeof ref.evidenceId !== 'string' || !ref.evidenceId) return [error('EVIDENCE_REQUIRED', 'E01', '已填值或枚举候选必须引用原始证据。')];
  const matches = product.evidence.filter(e => e.id === ref.evidenceId);
  if (!matches.length) return [error('EVIDENCE_NOT_FOUND', 'E01', '证据 ID 不存在。', 'invalid', [ref.evidenceId])];
  if (matches.length > 1) return [error('EVIDENCE_ID_AMBIGUOUS', 'E01', '证据 ID 重复，无法唯一定位原文。', 'invalid', [ref.evidenceId])];
  const e = matches[0]!;
  if (e.productId !== product.id) return [error('EVIDENCE_WRONG_SKU', 'E01', '证据未归属于当前 SKU，不可借用其他商品或未核实的同款证据。', 'invalid', [e.id])];
  if (e.skuMatches === false) return [error('EVIDENCE_SKU_MISMATCH', 'E01', '该证据已确认与当前 SKU 不对应。', 'conflict', [e.id])];
  if (typeof ref.quote !== 'string' || !ref.quote || !e.text.includes(ref.quote)) return [error('QUOTE_NOT_EXACT', 'E01', '引文必须逐字出现在原证据中，不能改写、拼接或补单位。', 'invalid', [e.id])];
  return [];
}

function referencedEvidence(product: ProductRecord, ref: Partial<EvidenceReference>): ProductEvidence | undefined {
  return product.evidence.find(e => e.id === ref.evidenceId && e.productId === product.id);
}

function quantityValues(text: string, unit: string): number[] {
  const t = compact(text), rawUnit = compact(unit), u = escapeRegExp(rawUnit) + (/[a-z]$/iu.test(rawUnit) ? '(?![a-zA-Z])' : '');
  const values = [...t.matchAll(new RegExp(`(${numeric})${u}`, 'gu'))].map(m => Number(m[1]));
  // A shared unit is explicit for every term in “10+6片”; its scope still requires evidence.
  for (const m of t.matchAll(new RegExp(`(${numeric}(?:[+＋]${numeric})+)${u}`, 'gu'))) values.push(...m[1]!.split(/[+＋]/u).map(Number));
  if (new RegExp(`单${u}装`, 'u').test(t)) values.push(1);
  return [...new Set(values)];
}

function hasDirectPackBasis(text: string, unit: string, per: string, value: number, e?: ProductEvidence): boolean {
  const t = compact(text), u = escapeRegExp(compact(unit)), p = escapeRegExp(compact(per));
  if (!quantityValues(t, unit).includes(value)) return false;
  if (e?.scope === 'inner-pack') return true;
  const n = escapeRegExp(String(value));
  return [
    new RegExp(`(?:每|单)(?:个)?${p}[^，。；;]{0,8}${n}${u}`, 'u'),
    new RegExp(`${n}${u}(?:[/／]${p}|每${p})`, 'u'),
    new RegExp(`${n}${u}(?:装)?[×xX*＊]${numeric}${p}`, 'u'),
    new RegExp(`${numeric}${p}[×xX*＊]${n}${u}`, 'u'),
    ...(value === 1 ? [new RegExp(`单${u}装`, 'u')] : []),
  ].some(re => re.test(t));
}

function explicitSinglePack(text: string, per: string): boolean {
  return new RegExp(`(?:每|单)(?:个)?${escapeRegExp(per)}|单个内包装|同一内包装`, 'u').test(compact(text));
}

function validAssertion(product: ProductRecord, assertion: EvidenceAssertion | undefined, regex: RegExp, code: string, label: string): RuleIssue[] {
  if (!assertion || assertion.value !== true || typeof assertion.evidenceId !== 'string') return [error(code, 'Q03', `${label}必须由可定位的原文证明，布尔声明不能代替证据。`, 'needs_evidence')];
  const issues = validateEvidenceReference(product, assertion);
  if (!regex.test(assertion.quote)) issues.push(review(code, 'Q03', `${label}引文未明确表达所需前提。`));
  return issues;
}

function validateCalculation(def: FieldDefinition, claim: FieldClaim, product: ProductRecord): { issues: RuleIssue[]; result?: number } {
  const c = claim.calculation!, q = quantityDefinition(def, claim, product), issues: RuleIssue[] = [];
  if (!q) return { issues: [error('CALCULATION_UNIT_UNDEFINED', 'Q03', '计算字段缺少明确的计量单位。', 'needs_evidence')] };
  if (!c || typeof c !== 'object' || !Array.isArray(c.inputs) || !c.inputs.length || typeof c.formula !== 'string' || !c.formula.trim()) return { issues: [error('CALCULATION_TRACE_REQUIRED', 'Q03', '计算须记录运算、原始输入、计算式及对应证据。', 'needs_evidence')] };
  for (const input of c.inputs) {
    issues.push(...validateEvidenceReference(product, input));
    if (!Number.isFinite(input.value) || input.value <= 0) issues.push(error('CALCULATION_INPUT_INVALID', 'Q03', '计算输入必须为有限正数。'));
    if (typeof input.unit !== 'string' || !input.unit || typeof input.scope !== 'string' || !input.scope) issues.push(error('CALCULATION_SCOPE_REQUIRED', 'Q03', '每个计算输入都须记录明确单位及计量范围。', 'needs_evidence'));
    if (typeof input.quote === 'string' && typeof input.unit === 'string' && !quantityValues(input.quote, input.unit).includes(input.value)) issues.push(error('CALCULATION_INPUT_NOT_QUOTED', 'Q03', '计算输入的数值和单位必须共同保留在引文中。'));
  }
  if (c.outputUnit && compact(c.outputUnit) !== compact(`${q.unit}${q.per ? `/${q.per}` : ''}`)) issues.push(error('CALCULATION_OUTPUT_UNIT_MISMATCH', 'Q03', '计算输出单位与字段标准单位不一致。', 'needs_evidence'));
  if (c.scopeEvidence) issues.push(...validateEvidenceReference(product, c.scopeEvidence));
  if (issues.some(i => i.severity === 'error')) return { issues };
  let result: number | undefined;
  if (c.operation === 'divide') {
    const total = c.inputs.find(i => i.role === 'total') ?? c.inputs[0], packs = c.inputs.find(i => i.role === 'packs') ?? c.inputs[1];
    if (!total || !packs || total === packs || c.inputs.length !== 2 || !q.per) return { issues: [...issues, error('DIVISION_INPUTS_REQUIRED', 'Q03', '总量除包装数需要总量与包装数两个输入及目标单包装单位。', 'needs_evidence')] };
    if (total.unit !== q.unit || packs.unit !== q.per) issues.push(error('QUANTITY_UNIT_MISMATCH', 'Q01', '总量、包装数和目标字段单位必须一致；抽、张、片、层不可默认换算。', 'needs_evidence'));
    if (!total.scope || total.scope !== packs.scope) issues.push(error('CALCULATION_SCOPE_MISMATCH', 'Q03', '总量和包装数必须处于同一销售单元。', 'needs_evidence'));
    if (!c.scopeEvidence) issues.push(error('SALE_SCOPE_EVIDENCE_REQUIRED', 'Q03', '同一销售单元需要原始证据，不接受仅填写相同 scope 标签。', 'needs_evidence'));
    else if (!/同一销售|销售单元|本组|本箱|本套|整箱|整组|整套/u.test(c.scopeEvidence.quote)) issues.push(review('SALE_SCOPE_NOT_EXPLICIT', 'Q03', '引文未明确总量和包装数所属的同一销售单元。'));
    issues.push(...validAssertion(product, c.homogeneous, /同规格|每(?:包|盒|卷).*相同|统一规格|同款同量/u, 'HOMOGENEITY_EVIDENCE_REQUIRED', '同规格'));
    issues.push(...validAssertion(product, c.giftsExcluded, /无赠品|不含赠品|赠品已剔除|赠品另计|仅正装/u, 'GIFT_BOUNDARY_EVIDENCE_REQUIRED', '赠品边界'));
    if (!Number.isSafeInteger(total.value) || !Number.isSafeInteger(packs.value) || total.value % packs.value !== 0) issues.push(error('NON_INTEGER_DIVISION', 'Q03', '总量除包装数必须在安全整数范围整除，不能四舍五入。', 'needs_evidence'));
    result = total.value / packs.value;
  } else if (c.operation === 'sum') {
    if (c.inputs.length < 2) issues.push(error('SUM_INPUTS_REQUIRED', 'Q03', '加量求和至少需要两个有证据的输入。', 'needs_evidence'));
    if (c.inputs.some(i => i.unit !== q.unit)) issues.push(error('QUANTITY_UNIT_MISMATCH', 'Q01', '加量各项必须与目标字段使用同一计量单位。', 'needs_evidence'));
    if (new Set(c.inputs.map(i => i.scope)).size !== 1) issues.push(error('CALCULATION_SCOPE_MISMATCH', 'Q03', '加量各项必须处于同一个计量范围。', 'needs_evidence'));
    if (q.per && (!c.scopeEvidence || !explicitSinglePack(c.scopeEvidence.quote, q.per))) issues.push(error('SINGLE_PACK_EVIDENCE_REQUIRED', 'Q02', '“10+6”求和必须证明两项处于同一个内包装，不能把组合包数或混合规格相加。', 'needs_evidence'));
    result = c.inputs.reduce((sum, input) => sum + input.value, 0);
  } else if (c.operation === 'multiply') {
    const perContainer = c.inputs[0], containers = c.inputs[1];
    if (!perContainer || !containers || c.inputs.length !== 2) return { issues: [...issues, error('MULTIPLICATION_INPUTS_REQUIRED', 'Q03', '包装层级相乘需要每包装数量与该包装数两个输入。', 'needs_evidence')] };
    if (perContainer.unit !== q.unit || !['包','袋','盒','卷','提','箱','组','套'].includes(containers.unit)) issues.push(error('PACK_MULTIPLICATION_UNIT_MISMATCH', 'Q03', '第一项单位须等于销售总量单位，第二项须是对应包装单位。', 'needs_evidence'));
    if (!c.scopeEvidence) issues.push(error('PACK_HIERARCHY_EVIDENCE_REQUIRED', 'Q03', '包装层级须由当前SKU原文证明，不可仅凭两个数字相乘。', 'needs_evidence'));
    else {
      const a=escapeRegExp(String(perContainer.value)),u=escapeRegExp(perContainer.unit),b=escapeRegExp(String(containers.value)),v=escapeRegExp(containers.unit),t=compact(c.scopeEvidence.quote);
      const direct=new RegExp(`${a}${u}(?:[/／]${v}|每${v})?(?:[×xX*＊]|装?[,，;；])${b}${v}`,'u').test(t)
        || new RegExp(`每${v}[^，。；]{0,4}${a}${u}[^。；]{0,12}${b}${v}`,'u').test(t)
        || new RegExp(`${a}${u}[/／]${v}[^。；]{0,8}${b}${v}`,'u').test(t);
      if(!direct)issues.push(review('PACK_HIERARCHY_REQUIRES_REVIEW','Q03','原文尚未直接证明每包装数量与销售包装数的嵌套关系。'));
    }
    if(!Number.isSafeInteger(perContainer.value)||!Number.isSafeInteger(containers.value)||!Number.isSafeInteger(perContainer.value*containers.value))issues.push(error('MULTIPLICATION_INTEGER_REQUIRED','Q03','包装计数及相乘结果须是安全整数。'));
    result=perContainer.value*containers.value;
  } else if (c.operation === 'convert') {
    const source = c.inputs[0];
    if (!source || c.inputs.length !== 1 || !c.conversionEvidence || typeof c.factor !== 'number' || !Number.isFinite(c.factor) || c.factor <= 0) return { issues: [...issues, error('EXPLICIT_CONVERSION_REQUIRED', 'Q01', '单位换算需要一个原值、正换算系数及明确换算关系原文。', 'needs_evidence')] };
    issues.push(...validateEvidenceReference(product, c.conversionEvidence));
    const from = escapeRegExp(source.unit), to = escapeRegExp(q.unit), conversion = compact(c.conversionEvidence.quote).match(new RegExp(`(${numeric})${from}(?:=|等于|折合)(${numeric})${to}`, 'u'));
    if (!conversion || !numberEqual(Number(conversion[2]) / Number(conversion[1]), c.factor)) issues.push(error('CONVERSION_NOT_SUPPORTED', 'Q01', '换算系数必须来自明确的单位等式，不能用常识把抽、张、片、层互换。', 'needs_evidence'));
    if (q.per && (!c.scopeEvidence || !explicitSinglePack(c.scopeEvidence.quote, q.per))) issues.push(error('SINGLE_PACK_EVIDENCE_REQUIRED', 'Q02', '换算仍须证明来源数量属于目标的单包装范围。', 'needs_evidence'));
    result = source.value * c.factor;
  } else issues.push(error('CALCULATION_OPERATION_UNKNOWN', 'Q03', '只允许有证据的除法、加量求和、包装层级相乘或显式单位换算。'));
  if (result !== undefined && typeof claim.value === 'number' && !numberEqual(result, claim.value)) issues.push(error('CALCULATION_RESULT_MISMATCH', 'Q03', '计算结果与填写值不一致。'));
  // Validate the recorded arithmetic, rather than merely checking that a formula exists.
  if (result !== undefined) {
    const arithmetic = c.formula.normalize('NFKC').replace(/\s+/gu, '').match(/^(\d+(?:\.\d+)?)([+÷/×*])(\d+(?:\.\d+)?)(?:[+](\d+(?:\.\d+)?))*=(\d+(?:\.\d+)?)$/u);
    if (!arithmetic) issues.push(review('FORMULA_NOT_MACHINE_CHECKABLE', 'Q03', '计算式应另存为纯数字算式，例如 480/6=80；单位保留在输入和输出单位中。'));
    else {
      const [left, right] = c.formula.normalize('NFKC').replace(/\s+/gu, '').split('=');
      const expression = left!.replace(/÷/gu, '/').replace(/×/gu, '*');
      const terms = expression.split(/[+/*]/u).map(Number), op = expression.includes('+') ? '+' : expression.includes('/') ? '/' : '*';
      const computed = op === '+' ? terms.reduce((a, b) => a + b, 0) : op === '/' ? terms[0]! / terms[1]! : terms[0]! * terms[1]!;
      const expectedTerms = c.operation === 'convert' ? [c.inputs[0]!.value, c.factor!] : c.operation === 'divide' ? [(c.inputs.find(i => i.role === 'total') ?? c.inputs[0])!.value, (c.inputs.find(i => i.role === 'packs') ?? c.inputs[1])!.value] : c.inputs.map(i => i.value);
      if (!numberEqual(computed, Number(right)) || !numberEqual(Number(right), result) || terms.length !== expectedTerms.length || terms.some((v, i) => !numberEqual(v, expectedTerms[i]!)) || (c.operation === 'divide' && op !== '/') || (c.operation === 'sum' && op !== '+') || (['convert','multiply'].includes(c.operation) && op !== '*')) issues.push(error('CALCULATION_FORMULA_MISMATCH', 'Q03', '计算式必须与运算类型、证据输入和结果完全一致。'));
    }
  }
  return { issues, result };
}

interface Dimension { values: number[]; units: string[]; text: string; cylinder: boolean }
const lengthFactor: Record<string, number> = { mm: 1, 毫米: 1, cm: 10, 厘米: 10, m: 1000, 米: 1000 };
function parseDimensions(text: string): Dimension[] {
  const t = compact(text).toLowerCase().replace(/毫米/gu, 'mm').replace(/厘米/gu, 'cm'), result: Dimension[] = [];
  const re = /(?:长|宽|高|直径|径|φ|Φ|ø|Ø)?(\d+(?:\.\d+)?)(mm|cm|m|米)?[×xX*＊](?:长|宽|高|直径|径|φ|Φ|ø|Ø)?(\d+(?:\.\d+)?)(mm|cm|m|米)?(?:[×xX*＊](?:长|宽|高|直径|径)?(\d+(?:\.\d+)?)(mm|cm|m|米)?)?/gu;
  for (const m of t.matchAll(re)) {
    const values = [Number(m[1]), Number(m[3]), ...(m[5] ? [Number(m[5])] : [])];
    const rawUnits = [m[2], m[4], ...(m[5] ? [m[6]] : [])], shared = rawUnits.at(-1);
    const units = rawUnits.map(u => u ?? shared ?? '');
    result.push({ values, units, text: m[0], cylinder: /直径|φ|Φ|ø|Ø/u.test(m[0]) && /高/u.test(m[0]) });
  }
  if (!result.length) {
    const axes = [...t.matchAll(/(长|宽|高|直径)(\d+(?:\.\d+)?)(mm|cm|m|米)/gu)];
    if (axes.length >= 2) result.push({ values: axes.map(m => Number(m[2])), units: axes.map(m => m[3]!), text: axes.map(m => m[0]).join(''), cylinder: axes.some(m => m[1] === '直径') && axes.some(m => m[1] === '高') });
  }
  return result;
}

function validateDimensions(def: FieldDefinition, claim: FieldClaim, quote: string, e: ProductEvidence): RuleIssue[] {
  const issues: RuleIssue[] = [], source = parseDimensions(quote), target = typeof claim.value === 'string' ? parseDimensions(claim.value) : [];
  if (/包装尺寸|外箱尺寸|装箱尺寸|纸箱尺寸|包装长|外包装/u.test(quote) || e.scope === 'packaging') issues.push(error('DIMENSION_WRONG_OBJECT', 'D01', '本体或纸张尺寸不能取外包装/外箱尺寸。', 'needs_evidence'));
  if (/厚度|厚\s*[:：]?\s*\d/u.test(quote)) issues.push(review('DIMENSION_THICKNESS_AMBIGUOUS', 'D01', '引文含厚度，须核对二维/三维所用的轴，不能把厚度充作长宽高。'));
  if (!source.length) return [...issues, review('DIMENSION_AXES_MISSING', 'D01', '缺少可定位的两个或三个长度轴。')];
  if (source.some(d => d.units.some(u => !u))) issues.push(error('DIMENSION_UNIT_MISSING', 'D01', '原证据尺寸未注明长度单位，不能由填写值或字段标准单位补出 mm/cm。', 'needs_evidence'));
  if (!target.length) return [...issues, error('DIMENSION_VALUE_UNPARSEABLE', 'D01', '尺寸值必须保留可核对的轴和明确长度单位。', 'needs_evidence')];
  const required = def.dimensionCount ?? (/3d|三维|盒体|容器|长宽高/u.test(`${def.operator ?? ''} ${def.name ?? ''}`) ? 3 : 2);
  const allowed = (d: Dimension) => d.values.length === required || (required === 3 && /cylinder/u.test(def.operator ?? '') && d.cylinder && d.values.length === 2);
  if (!source.some(allowed) || !target.every(allowed)) issues.push(error('DIMENSION_AXES_INCOMPLETE', 'D01', `标准要求${required}维尺寸，缺轴应待补；仅明确直径与高度且标准允许时可用圆柱口径。`, 'needs_evidence'));
  if (target.some(d => d.values.some(v => v <= 0) || d.units.some(u => !u))) issues.push(error('DIMENSION_VALUE_INVALID', 'D01', '尺寸各轴须为带单位的正长度。'));
  const comparable = (d: Dimension) => d.values.map((v, i) => v * (lengthFactor[d.units[i]!] ?? NaN));
  if (!target.every(d => source.some(s => s.values.length === d.values.length && comparable(d).every((v, i) => numberEqual(v, comparable(s)[i]!))))) issues.push(error('DIMENSION_VALUE_UNSUPPORTED', 'D01', '尺寸数值或轴序不能由原文及明确长度单位换算得到。', 'needs_evidence'));
  return issues;
}

function booleanSupport(def: FieldDefinition, value: boolean, quote: string): boolean {
  const configured = def.booleanEvidence?.[String(value) as 'true' | 'false'];
  if (configured?.some(s => quote.includes(s))) return true;
  const pairs: Record<string, [RegExp, RegExp]> = {
    lock: [/(?<!不|未)带锁|(?<!没)有锁|配备锁|配(?:有|备)?钥匙|(?<!不)含钥匙|(?<!无)锁具/u, /无锁|不带锁|没有锁|无锁具/u],
    includes_paper: [/(?<!不|未)(?:含纸|带纸|附带纸)|附赠[^，。；]{0,8}(?:抽纸|卷纸|纸巾)|(?<!不|未)含[^，。；]{0,6}(?:抽纸|卷纸|纸巾)/u, /不含纸|不带纸|空盒|仅售?盒(?:体)?|纸品需另购/u],
    alcohol: [/(?<!不|无|未)(?:含|添加)(?:有)?酒精|酒精(?:含量|浓度)?[:：]?\s*[1-9]\d*(?:\.\d+)?\s*%/u, /无酒精|不含酒精|未添加酒精|0\s*酒精|酒精(?:含量)?[:：]?\s*0\s*%/u],
    lotion: [/(?<!无|非)乳霜纸|(?<!未|不)添加[^，。；]{0,10}(?:乳霜|保湿|润肤)|(?<!无)保湿(?:因子|成分)/u, /无乳霜|不含乳霜|未添加(?:乳霜|保湿成分)|无保湿添加/u],
  };
  const pair = pairs[semantics(def)];
  if (pair) return pair[value ? 0 : 1].test(quote) && !pair[value ? 1 : 0].test(quote);
  const name = (def.name ?? '').replace(/^是否/u, '');
  if (!name) return false;
  return value ? quote.includes(`${name}：是`) || quote.includes(`${name}:是`) : quote.includes(`${name}：否`) || quote.includes(`${name}:否`) || quote.includes(`不${name}`);
}

function validateSemantics(def: FieldDefinition, claim: FieldClaim, quote: string, e: ProductEvidence): RuleIssue[] {
  const semantic = semantics(def), values = Array.isArray(claim.value) ? claim.value : [claim.value], issues: RuleIssue[] = [];
  if (typeof claim.value === 'boolean' && !booleanSupport(def, claim.value, quote)) issues.push(review('BOOLEAN_NOT_EXPLICIT', 'S01', '是否字段缺少对应的明确肯定或否定原文；防盗、未提含纸等线索不能替代事实。'));
  if (semantic === 'scent') {
    if (values.some(v => typeof v === 'string' && !quote.includes(v))) issues.push(error('SCENT_VALUE_UNSUPPORTED', 'S02', '香型须保留具体原值；茶花香不能强归茶香等相近选项。', claim.status === 'enum_candidate' ? 'enum_candidate' : 'needs_evidence'));
    if (values.includes('无香') && /无香精|未添加香精/u.test(quote) && !/无香(?:型|味)|无气味/u.test(quote)) issues.push(review('SCENT_NOT_FRAGRANCE_FREE', 'S02', '无香精只说明添加物，不能单独证明商品无气味。'));
  }
  if (semantic === 'color') {
    const wrongObject = values.some(v => typeof v === 'string' && new RegExp(`(?:包装|图案|背景|印花|装饰)[^，。；\\n]{0,12}${escapeRegExp(v)}`, 'u').test(quote));
    if (e.scope === 'packaging' || e.scope === 'pattern' || wrongObject) issues.push(error('COLOR_WRONG_OBJECT', 'S03', '本体颜色不能取包装、装饰图案或背景颜色。', 'needs_evidence'));
    if (values.some(v => typeof v !== 'string' || !quote.includes(v) || !/色|透明|本色|随机/u.test(v))) issues.push(review('COLOR_NOT_EXPLICIT', 'S03', '本体颜色须有明确颜色词及对象证据；系列名或桃花微风等图案名不能推成粉色。'));
    if (values.every(v => typeof v === 'string' && quote.includes(v)) && !/本体|盒体|纸张|纸巾本身|商品颜色|颜色\s*[:：]|色系\s*[:：]/u.test(quote) && e.scope !== 'body' && !/颜色|colour|color/iu.test(e.kind ?? '')) issues.push(review('COLOR_OBJECT_UNCONFIRMED', 'S03', '颜色词已定位，但尚未证明描述的是本体，需核对文字或视觉对象。'));
  }
  if (semantic === 'substrate' && (values.some(v => typeof v !== 'string' || !/无纺布|棉|粘胶|涤纶|聚酯|木浆|竹纤维|水刺|纤维素|丙纶|纸浆/u.test(v)) || !/无纺布|棉|粘胶|涤纶|聚酯|木浆|竹纤维|水刺|纤维素|丙纶|纸浆/u.test(quote))) issues.push(review('SUBSTRATE_NOT_EXPLICIT', 'S04', '草本、纯水、植物精华或柔软触感不能证明基布材质。'));
  if (semantic === 'brand') {
    if (values.some(v => typeof v !== 'string' || /^(?:国产|通用|未知|无|N\/?A|不详)$/iu.test(v))) issues.push(error('BRAND_PLACEHOLDER', 'S05', '产地、通用或未知占位符不是品牌。', 'needs_evidence'));
    if (/适配|适用.{0,8}(?:品牌|机型)|兼容|供应商|店铺/u.test(quote)) issues.push(review('BRAND_ROLE_UNCONFIRMED', 'S05', '需证明品牌描述当前商品自身，不能取适配设备、供应商或店铺品牌。'));
  }
  if (semantic === 'model' && (/平台(?:SKU|编码)|京东(?:SKU|编码)|条码|上游(?:SKU|编码)/iu.test(quote) || values.some(v => typeof v === 'string' && !quote.includes(v)))) issues.push(review('MODEL_NOT_EXPLICIT', 'S05', '型号须来自厂商型号/货号原文，不能从平台编码或数量中截取。'));
  return issues;
}

/** Detect explicit alternative counts across sources; do not silently prefer a title or image. */
function quantityConflicts(def: FieldDefinition, product: ProductRecord, claim?: FieldClaim): { values: number[]; ids: string[] } | null {
  const q = quantityDefinition(def, claim, product);
  if (!q?.per) return null;
  const observations = product.evidence.filter(e => e.productId === product.id && e.skuMatches !== false && !/ocr/iu.test(e.kind ?? '')).flatMap(e => {
    // Sum terms are not separate package sizes. Only a proven single-package sum is comparable.
    const text = compact(e.text).replace(new RegExp(`(${numeric}(?:[+＋]${numeric})+)${escapeRegExp(q.unit)}`, 'gu'), (_all, terms: string) => explicitSinglePack(e.text, q.per!) ? `${terms.split(/[+＋]/u).map(Number).reduce((a, b) => a + b, 0)}${q.unit}` : '');
    const values = quantityValues(text, q.unit).filter(v => hasDirectPackBasis(text, q.unit, q.per!, v, e) || (/image.*(?:verified|transcription)|visual/iu.test(e.kind ?? '') && compact(text) === `${v}${q.unit}`));
    return values.map(value => ({ value, id: e.id }));
  });
  const values = [...new Set(observations.map(o => o.value))];
  return values.length > 1 ? { values, ids: [...new Set(observations.map(o => o.id))] } : null;
}

function validateTextQuantityFacts(claim: FieldClaim, quotes: string[]): RuleIssue[] {
  if (typeof claim.value !== 'string') return [];
  const facts = [...compact(claim.value).matchAll(/(\d+(?:\.\d+)?)(抽|张|片|层|包|盒|卷|提|箱|袋|瓶|支|个|枚|米|克|千克|毫升|升|mm|cm)/gu)];
  const unsupported = facts.filter(m => !quotes.some(q => quantityValues(q, m[2]!).includes(Number(m[1]))));
  return unsupported.length ? [error('TEXT_QUANTITY_NOT_SUPPORTED', 'Q01', '文字值新增了证据引文中没有共同出现的数量和单位；不能补单位、拼接总量或丢失数量口径。', 'needs_evidence')] : [];
}

/** Independent, side effect free checks. A review issue also prevents automatic publication. */
export function validateClaim(def: FieldDefinition, claim: FieldClaim, product: ProductRecord): RuleIssue[] {
  const issues: RuleIssue[] = [], status = claim.status as ClaimStatus;
  if (!CLAIM_STATUSES.includes(status)) return [error('STATUS_UNKNOWN', 'V01', '取值状态未注册。')];
  const active = status === 'filled' || status === 'enum_candidate';
  if (!active && isPresent(claim.value)) issues.push(error('UNRESOLVED_VALUE_PRESENT', 'V01', '待补、冲突、无效和不适用的正式值须为空；原始候选应单独保存。', status));
  const excluded = product.category && ['wrong', 'uncertain'].includes(product.category.status);
  if (excluded && status !== 'not_applicable') issues.push(error('CATEGORY_FIELD_NOT_APPLICABLE', 'C01', '错挂或归属待确认不适用原类目模板，不计入填充分母。', 'not_applicable'));
  if (status === 'not_applicable' && !excluded && def.applicable !== false) {
    if (!claim.applicability || claim.applicability.value !== false) issues.push(review('NOT_APPLICABLE_UNSUPPORTED', 'V01', '不适用需要类目/绑定规则或明确适用性证据；未说明不能归为不适用。'));
    else issues.push(...validateEvidenceReference(product, claim.applicability));
  }
  if (!active) return issues.map(i => ({ ...i, ...(def.id ? { attributeId: def.id } : {}) }));
  if (!isPresent(claim.value)) issues.push(error('VALUE_REQUIRED', 'V01', '已填值和枚举候选必须保留非空原值。', status === 'enum_candidate' ? 'enum_candidate' : 'needs_evidence'));
  const type = def.type ?? def.fieldType;
  if (type === '是否' && typeof claim.value !== 'boolean') issues.push(error('BOOLEAN_TYPE_REQUIRED', 'V02', '是否字段只能使用 true/false，字符串“否”和未知均不能冒充布尔值。'));
  if (type === '数值') {
    if (typeof claim.value !== 'number' || !Number.isFinite(claim.value) || claim.value <= 0) issues.push(error('POSITIVE_NUMBER_REQUIRED', 'V02', '数值字段必须为有限正数，单位文本不能代替数值。'));
    else if (/integer|pieces_per_pack/u.test(def.operator ?? '') && !Number.isSafeInteger(claim.value)) issues.push(error('POSITIVE_INTEGER_REQUIRED', 'V02', '计数字段必须为安全范围内的正整数。'));
  }
  if ((type === '文本' || type === '日期') && typeof claim.value !== 'string') issues.push(error('TEXT_TYPE_REQUIRED', 'V02', '文本或日期字段必须为字符串。'));
  if (type === '日期' && (typeof claim.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(claim.value) || Number.isNaN(Date.parse(`${claim.value}T00:00:00Z`)) || new Date(`${claim.value}T00:00:00Z`).toISOString().slice(0, 10) !== claim.value)) issues.push(error('DATE_INVALID', 'V02', '日期须为真实存在的 YYYY-MM-DD，不补猜缺失年月日。'));
  if (type === '选项' && def.enum && (def.enum.length > 0 || !def.dictionary)) {
    const values = Array.isArray(claim.value) ? claim.value : [claim.value];
    if (def.selection === '单选' && values.length !== 1) issues.push(error('SINGLE_SELECTION_REQUIRED', 'V02', '单选字段只能保留一个值。'));
    if (values.some(v => !def.enum!.includes(v)) && status !== 'enum_candidate') issues.push(error('ENUM_OUTSIDE_DICTIONARY', 'V03', '枚举外原值应保留为候选，不能强归相近选项。', 'enum_candidate'));
    if (values.every(v => def.enum!.includes(v)) && status === 'enum_candidate') issues.push(review('ENUM_CANDIDATE_ALREADY_KNOWN', 'V03', '候选已在枚举中，需核对其候选原因或调整状态。'));
  }
  const ref = { evidenceId: claim.evidenceId ?? undefined, quote: claim.quote ?? undefined }, evidenceIssues = validateEvidenceReference(product, ref);
  issues.push(...evidenceIssues);
  for (const support of claim.supportingEvidence ?? []) issues.push(...validateEvidenceReference(product, support));
  if (!evidenceIssues.length) {
    const quote = claim.quote!, e = referencedEvidence(product, ref)!;
    if (/ocr/iu.test(e.kind ?? '')) issues.push(review('OCR_REQUIRES_VERIFICATION', 'E02', 'OCR 仅是候选文字；关键取值需要视觉或同 SKU 结构化证据核验。'));
    if (/image|visual/iu.test(e.kind ?? '') && type !== '数值') {
      for (const unit of ['片', '抽', '张']) {
        const conflicts = quantityConflicts({ unit: `${unit}/包` }, product);
        if (conflicts?.ids.includes(e.id)) {
          issues.push(review('IMAGE_SKU_RECONCILIATION_REQUIRED', 'E03', '图像包装数量与当前 SKU 文字冲突，图内配方、封口等属性需先核对同 SKU。', 'needs_evidence', conflicts.ids));
          break;
        }
      }
    }
    if (semantics(def) === 'dimensions') issues.push(...validateDimensions(def, claim, quote, e));
    else if (type === '数值' && typeof claim.value === 'number') {
      const q = quantityDefinition(def, claim, product);
      const rawStructuredUnit = claim.countUnit ?? claim.unit, structuredUnit = rawStructuredUnit && !isUnitPlaceholder(rawStructuredUnit) ? rawStructuredUnit : undefined;
      const structuredParts = structuredUnit?.match(/^([^/／]+)[/／](包|袋|盒|卷|筒|提|箱|桶|瓶|罐|支|个|件|套|条)$/u);
      const claimedUnit = structuredParts?.[1] ?? structuredUnit, claimedPer = claim.packUnit ?? claim.per ?? structuredParts?.[2];
      if (q && ((claimedUnit && claimedUnit !== q.unit) || (claimedPer && claimedPer !== q.per))) issues.push(error('STRUCTURED_UNIT_MISMATCH', 'Q01', '结构化单位与公共定义或伴随单位字段不一致；不能暗中改单位。', 'needs_evidence'));
      if (claim.calculation) issues.push(...validateCalculation(def, claim, product).issues);
      else if (q) {
        if (!quantityValues(quote, q.unit).includes(claim.value)) issues.push(error('QUANTITY_UNIT_OR_VALUE_MISSING', 'Q01', '引文必须同时保留对应数值与原始计量单位；字段单位不能代替证据单位。', 'needs_evidence'));
        else if (q.per && !hasDirectPackBasis(quote, q.unit, q.per, claim.value, e)) issues.push(review('SINGLE_PACK_BASIS_MISSING', 'Q02', '有数量但缺少每包/每盒/每卷口径，需单个内包装证据；整组总量不可直接填写。'));
      } else issues.push(review('QUANTITY_UNIT_UNDEFINED', 'Q01', '数值字段尚无可核对的标准单位或口径。'));
      const conflicts = quantityConflicts(def, product, claim);
      if (conflicts) issues.push(error('COUNT_SOURCE_CONFLICT', 'E03', `当前 SKU 的标题、规格或已核验图像存在不同单包装数量：${conflicts.values.join('、')}，须保留冲突。`, 'conflict', conflicts.ids));
    }
    issues.push(...validateSemantics(def, claim, quote, e));
    if (semantics(def) !== 'dimensions') issues.push(...validateTextQuantityFacts(claim, [quote, ...(claim.supportingEvidence ?? []).filter(s => !validateEvidenceReference(product, s).length).map(s => s.quote)]));
    if ((type === '文本' || type === '选项') && !['dimensions', 'pack', 'color', 'scent', 'model'].includes(semantics(def))) {
      const values = Array.isArray(claim.value) ? claim.value : [claim.value];
      if (values.some(v => typeof v === 'string' && !quote.includes(v))) issues.push(review('SEMANTIC_MAPPING_REQUIRES_REVIEW', 'S06', '取值并非引文原值，需人工或语义复核明确映射依据。'));
    }
  }
  return issues.map(i => ({ ...i, ...(def.id ? { attributeId: def.id } : {}) }));
}

export function validateCategoryConsistency(product: ProductRecord): RuleIssue[] {
  const c = product.category, issues: RuleIssue[] = [];
  if (!c) return [review('CATEGORY_MISSING', 'C01', '商品缺少类目归属裁定。')];
  if (!['matched', 'wrong', 'uncertain'].includes(c.status)) issues.push(error('CATEGORY_STATUS_UNKNOWN', 'C01', '类目状态只能为 matched、wrong、uncertain。'));
  if (c.targetConfirmed !== undefined && typeof c.targetConfirmed !== 'boolean') issues.push(error('CATEGORY_CONFIRMATION_TYPE', 'C01', 'targetConfirmed 必须是布尔值。'));
  if (c.status === 'matched') {
    if (c.targetConfirmed === false) issues.push(error('MATCHED_TARGET_UNCONFIRMED', 'C01', '归属匹配与目标待确认不能同时作为终审状态。'));
    if (!c.targetId || c.targetConfirmed === undefined) issues.push(review('MATCHED_TARGET_CONFIRMATION_MISSING', 'C01', '终审匹配须明确目标类目 ID 和 targetConfirmed=true。'));
    if (product.categoryId && c.targetId && c.targetId !== product.categoryId) issues.push(error('MATCHED_TARGET_DIFFERENT', 'C01', 'matched 的目标类目必须等于当前挂载类目。'));
  }
  if (c.status === 'wrong' && c.targetConfirmed === true && (!c.targetId || (product.categoryId && c.targetId === product.categoryId))) issues.push(error('WRONG_TARGET_INCONSISTENT', 'C01', '已确认的迁移目标必须存在且不同于错挂的原类目。'));
  if (c.status === 'uncertain' && c.targetConfirmed === true) issues.push(error('UNCERTAIN_TARGET_CONFIRMED', 'C01', '待确认归属不能同时标为目标已确认。'));
  if (c.targetConfirmed === true && (!c.targetId || !c.targetName || !c.targetPath)) issues.push(error('CONFIRMED_TARGET_INCOMPLETE', 'C01', '已确认目标必须同时记录 ID、名称和完整路径。'));
  if (c.inRate === true && c.status !== 'matched') issues.push(error('INELIGIBLE_CATEGORY_IN_RATE', 'C01', '错挂及待确认商品必须排除原类目填充分母。'));
  const componentCategories = new Set((product.components ?? []).map(x => x.categoryId).filter(Boolean));
  const crossCategory = product.crossCategory || c.crossCategory || product.combination?.crossCategory || componentCategories.size > 1;
  const policy = product.combination?.policy ?? c.combinationPolicy;
  if (crossCategory) {
    if (!policy || !['split', 'primary_item', 'dedicated_category', 'manual_review'].includes(policy)) issues.push(error('COMBINATION_POLICY_REQUIRED', 'C02', '跨类组合须明确拆分、主件归类、组合专类或人工复核策略，不能直接套一个类目属性模板。', 'needs_evidence'));
    else if (policy === 'manual_review' && c.status !== 'uncertain') issues.push(error('COMBINATION_AWAITING_CATEGORY', 'C02', '跨类组合采用人工复核策略时，归属应保持待确认。', 'needs_evidence'));
    else if (policy === 'primary_item' && !product.combination?.primaryCategoryId) issues.push(review('PRIMARY_CATEGORY_REQUIRED', 'C02', '主件策略须记录已判定的主件类目 ID。'));
    else if (policy === 'primary_item' && c.targetId && product.combination?.primaryCategoryId !== c.targetId) issues.push(error('PRIMARY_CATEGORY_MISMATCH', 'C02', '主件归类目标与主件类目不一致。'));
  }
  return issues;
}

export function validateRecord(product: ProductRecord, definitions: readonly FieldDefinition[]): RuleIssue[] {
  const issues = validateCategoryConsistency(product), map = new Map(definitions.map(d => [d.id, d]));
  for (const [id, claim] of Object.entries(product.fields ?? {})) {
    const def = map.get(id);
    if (!def) issues.push(error('ATTRIBUTE_UNREGISTERED', 'V01', `字段 ${id} 未在公共定义中注册。`));
    else issues.push(...validateClaim(def, claim, product));
  }
  return issues;
}

export function isClaimPublishable(def: FieldDefinition, claim: FieldClaim, product: ProductRecord): boolean {
  return claim.status === 'filled' && validateClaim(def, claim, product).length === 0;
}

/** Definitions enable validated fill counts; without them this preserves the legacy status-based metric. */
export function metrics(rows: ProductRecord[], definitions?: readonly FieldDefinition[]) {
  const map = new Map((definitions ?? []).map(d => [d.id, d]));
  const eligible = rows.filter(r => r.category?.status === 'matched' && r.category.targetConfirmed !== false && !validateCategoryConsistency(r).some(i => i.severity === 'error'));
  const slots = eligible.flatMap(row => Object.entries(row.fields ?? {}).filter(([, claim]) => claim.status !== 'not_applicable').map(([id, claim]) => ({ row, id, claim })));
  const filled = ({ row, id, claim }: typeof slots[number]) => claim.status === 'filled' && (!definitions || (map.has(id) && isClaimPublishable(map.get(id)!, claim, row)));
  const required = slots.filter(x => x.claim.required ?? map.get(x.id)?.required ?? false);
  return {
    sample: rows.length, eligible: eligible.length,
    wrong: rows.filter(r => r.category?.status === 'wrong').length,
    uncertain: rows.filter(r => r.category?.status === 'uncertain').length,
    slots: slots.length, filled: slots.filter(filled).length,
    required: required.length, requiredFilled: required.filter(filled).length,
    enumCandidates: slots.filter(x => x.claim.status === 'enum_candidate').length,
    fillRate: slots.length ? slots.filter(filled).length / slots.length : null,
    requiredFillRate: required.length ? required.filter(filled).length / required.length : null,
    complete: eligible.filter(row => required.filter(x => x.row === row).every(filled)).length,
  };
}
