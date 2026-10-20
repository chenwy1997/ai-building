import { validateClaim, validateEvidenceReference, type FieldDefinition } from '../expansion/rules.ts';
import { evaluateFilledClaim } from '../revision/conditions.ts';
import type { RevisionIssue, RevisionRecord, RevisionStandard } from '../revision/semantic-guards.ts';

/** Execution compatibility only. The source evidence, frozen card, and Codex value are never rewritten. */
export interface CompatibilityIssue extends RevisionIssue {
  originalCheck?: RevisionIssue;
  adaptation?: string;
  parsingWitnesses?: Array<{ evidenceId: string; quote: string }>;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const sameSource = (product: RevisionRecord, id: string | null | undefined, quote: string | null | undefined, visualIds: string[]) =>
  !validateEvidenceReference(product, { evidenceId: id ?? undefined, quote: quote ?? undefined }).length
  && evaluateFilledClaim({ value: 'compatibility-proof', status: 'filled', evidenceId: id, quote }, product, { verifiedVisualEvidenceIds: visualIds }).filled;

/** Insert a parsing boundary only where the original text actually separates an ASCII model and a count. */
export function preserveModelCountBoundary(text: string, unit: string) {
  const witnesses: string[] = [];
  const suffix = /[a-z]$/iu.test(unit) ? '(?![a-zA-Z])' : '';
  const pattern = new RegExp(`(?<![A-Za-z0-9_.-])([A-Za-z][A-Za-z0-9_-]*\\d)(\\s+)(\\d+(?:\\.\\d+)?)(\\s*${escape(unit)}${suffix})`, 'gu');
  const parsed = text.replace(pattern, (all, model: string, whitespace: string, count: string, ending: string) => {
    witnesses.push(all);
    return `${model}${whitespace}·${count}${ending}`;
  });
  return { parsed, witnesses };
}

/** Narrow adapters retain the legacy finding and still require an explicit evidence-backed Codex acceptance. */
export function adaptLegacyQuantityIssue(issue: RevisionIssue, product: RevisionRecord, standard: RevisionStandard, visualIds: string[] = []): CompatibilityIssue {
  // A multiplier outside an explicitly closed carton expression multiplies that
  // whole sales unit. Keep the literal multiplier; never invent a "5箱" quote.
  if (['CALCULATION_INPUT_NOT_QUOTED', 'PACK_MULTIPLICATION_UNIT_MISMATCH', 'PACK_HIERARCHY_REQUIRES_REVIEW'].includes(issue.code)
    && issue.attributeId === 'roll.sales_count') {
    const field = product.fields[issue.attributeId], c = field?.calculation;
    const definition = standard.definitions.find(d => d.id === issue.attributeId);
    const binding = standard.bindings.find(b => b.categoryId === product.categoryId && b.attributeId === issue.attributeId && !b.retired && b.status !== 'retired');
    if (definition && binding && field?.status === 'filled' && field.unit === '卷' && !field.per
      && c?.operation === 'multiply' && c.inputs?.length === 2 && c.outputUnit === '卷' && c.scopeEvidence) {
      const [a, b] = c.inputs;
      if (a && b && a.unit === '卷' && b.unit === '倍' && a.scope && b.scope
        && Number.isSafeInteger(a.value) && a.value > 0 && Number.isSafeInteger(b.value) && b.value > 0
        && Number.isSafeInteger(field.value) && field.value === a.value * b.value
        && [field, a, b, c.scopeEvidence].every(x => x.evidenceId === c.scopeEvidence!.evidenceId && sameSource(product, x.evidenceId, x.quote, visualIds))) {
        const expression = new RegExp(`^\\s*${a.value}\\s*卷\\s*[（(]\\s*整箱销售\\s*[）)]\\s*[×*＊]\\s*${b.value}\\s*$`, 'u');
        const formula = new RegExp(`^\\s*${a.value}\\s*[×*]\\s*${b.value}\\s*=\\s*${field.value}\\s*卷\\s*$`, 'u');
        if (expression.test(c.scopeEvidence.quote) && expression.test(b.quote) && formula.test(c.formula)
          && new RegExp(`^\\s*${a.value}\\s*卷(?:\\s*[（(]整箱销售[）)](?:\\s*[×*＊]\\s*${b.value})?)?\\s*$`, 'u').test(a.quote)) {
          return { ...issue, severity: 'review', originalCheck: { ...issue }, adaptation: 'explicit_carton_expression_multiplier',
            parsingWitnesses: [{ evidenceId: c.scopeEvidence.evidenceId, quote: c.scopeEvidence.quote }],
            message: '原文明确整箱内卷数并在闭合包装表达式外给出倍数；原倍数不伪造成箱单位原文。数值、公式、同SKU同源已核，仍须Codex实证确认无混规格/赠品或版本冲突。' };
        }
      }
    }
    return issue;
  }
  if (!['COUNT_SOURCE_CONFLICT', 'QUANTITY_UNIT_OR_VALUE_MISSING'].includes(issue.code) || !issue.attributeId) return issue;
  const field = product.fields[issue.attributeId], definition = standard.definitions.find(d => d.id === issue.attributeId);
  if (!definition || field?.status !== 'filled' || typeof field.value !== 'number' || field.calculation
    || !sameSource(product, field.evidenceId, field.quote, visualIds)) return issue;
  const unitId = definition.quantity?.unitField ?? definition.dependencies?.find(id => /(?:count|quantity)_unit$/u.test(id));
  const unitField = unitId ? product.fields[unitId] : undefined;
  const unit = unitField?.status === 'filled' && typeof unitField.value === 'string' ? unitField.value : field.countUnit ?? field.unit?.split(/[/／]/u)[0];
  if (typeof unit !== 'string' || !unit) return issue;

  // 米 and m spell the same physical unit. This does not infer per-roll scope
  // or perform cm/mm conversion; the reviewer must still verify that scope.
  if (issue.code === 'QUANTITY_UNIT_OR_VALUE_MISSING' && definition.id === 'roll.length'
    && unit === 'm' && Number.isFinite(field.value) && field.value > 0
    && standard.bindings.some(b => b.categoryId === product.categoryId && b.attributeId === definition.id && !b.retired && b.status !== 'retired')
    && new RegExp(`(?<![A-Za-z0-9_.-])${escape(String(field.value))}\\s*米(?![A-Za-z])`, 'u').test(field.quote!)) {
    return { ...issue, severity: 'review', originalCheck: { ...issue }, adaptation: 'metre_chinese_unit_spelling',
      parsingWitnesses: [{ evidenceId: field.evidenceId!, quote: field.quote! }],
      message: '当前SKU原文米与标准m为同一物理单位的不同写法，数值与原引文未改；仍须Codex核实单卷/总长、卷数及规格冲突，不自动将销售总长当单卷长度。' };
  }

  // Explicit Chinese layer counts are number spellings, not conversions between sheets and layers.
  const layerWords: Record<string, number> = { 单层: 1, 一层: 1, 双层: 2, 二层: 2, 三层: 3, 四层: 4, 五层: 5, 六层: 6 };
  if (issue.code === 'QUANTITY_UNIT_OR_VALUE_MISSING' && definition.id === 'soft.layers'
    && unit === '层' && field.unit === '层' && layerWords[field.quote!.trim()] === field.value) {
    return { ...issue, severity: 'review', originalCheck: { ...issue }, adaptation: 'explicit_chinese_layer_number',
      parsingWitnesses: [{ evidenceId: field.evidenceId!, quote: field.quote! }],
      message: '当前SKU精确引文明确中文层数，按数词记录为数字；保留原文，仍须Codex核对完整来源有无否定、包装层或其他规格并实证接受。' };
  }

  // The old whitespace compactor must not join a model's trailing digits to the next count.
  const witnesses: Array<{ evidenceId: string; quote: string }> = [];
  const shadow: RevisionRecord = { ...product, evidence: product.evidence.map(e => {
    if (e.productId !== product.id || e.skuMatches === false || /ocr/iu.test(e.kind ?? '')) return e;
    const parsed = preserveModelCountBoundary(e.text, unit);
    for (const quote of parsed.witnesses) witnesses.push({ evidenceId: e.id, quote });
    return parsed.witnesses.length ? { ...e, text: parsed.parsed } : e;
  }) };
  const shadowField = { ...field, quote: preserveModelCountBoundary(field.quote!, unit).parsed };
  if (witnesses.length && (issue.code !== 'COUNT_SOURCE_CONFLICT' || witnesses.some(w => issue.evidenceIds?.includes(w.evidenceId)))) {
    const rechecked = validateClaim(definition, shadowField, shadow);
    const conflict = rechecked.find(x => x.code === 'COUNT_SOURCE_CONFLICT');
    if (issue.code === 'COUNT_SOURCE_CONFLICT' && conflict) {
      // A genuine disagreement remains an error, with only the manufactured number removed from its explanation.
      return conflict.message === issue.message ? issue : { ...issue, message: conflict.message, evidenceIds: conflict.evidenceIds, originalCheck: { ...issue }, adaptation: 'model_count_boundary_real_conflict_preserved', parsingWitnesses: witnesses };
    }
    if (!rechecked.some(x => ['QUANTITY_UNIT_OR_VALUE_MISSING', 'COUNT_SOURCE_CONFLICT'].includes(x.code))) return {
      ...issue, severity: 'review', suggestedStatus: 'needs_evidence', originalCheck: { ...issue }, adaptation: 'model_count_whitespace_boundary', parsingWitnesses: witnesses,
      message: '旧解析删除型号与数量之间的真实空白后制造了拼接数字；保留原数字边界重验后该错误消失，仍须Codex凭当前SKU原证据明确接受。',
    };
  }

  // PCS is the only registered case-only unit alias; no Chinese unit or quantity conversion is permitted.
  if (issue.code !== 'QUANTITY_UNIT_OR_VALUE_MISSING' || unit !== 'PCS' || field.unit !== 'PCS' || unitField?.value !== 'PCS' || !unitId) return issue;
  const unitDef = standard.definitions.find(d => d.id === unitId), unitBinding = standard.bindings.find(b => b.categoryId === product.categoryId && b.attributeId === unitId && !b.retired && b.status !== 'retired');
  if (!unitDef?.enum?.includes('PCS') || !unitBinding || unitBinding.allowedValues && !unitBinding.allowedValues.includes('PCS')) return issue;
  const tokenPattern = new RegExp(`(?<![A-Za-z0-9_.-])${escape(String(field.value))}\\s*(pcs)(?![A-Za-z])`, 'giu');
  const rawUnits = [...field.quote!.matchAll(tokenPattern)].map(m => m[1]!);
  const originalUnit = field.originalUnit ?? unitField.originalUnit;
  if (!originalUnit || !rawUnits.includes(originalUnit) || originalUnit === 'PCS' || !sameSource(product, unitField.evidenceId, unitField.quote, visualIds)) return issue;
  const aliases = (unitDef as typeof unitDef & { aliases?: readonly { from: string; to: string }[] }).aliases;
  if (!aliases?.some(alias => alias.from === originalUnit && alias.to === 'PCS')) return issue;
  const normalizeCase = (text: string) => text.replace(/(?<![A-Za-z])pcs(?![A-Za-z])/giu, 'PCS');
  const pcsShadow: RevisionRecord = { ...product, evidence: product.evidence.map(e => ({ ...e, text: normalizeCase(e.text) })) };
  const pcsClaim = { ...field, quote: normalizeCase(field.quote!) };
  const rechecked = validateClaim(definition as FieldDefinition, pcsClaim, pcsShadow);
  if (rechecked.some(x => ['QUANTITY_UNIT_OR_VALUE_MISSING', 'COUNT_SOURCE_CONFLICT'].includes(x.code))) return issue;
  return { ...issue, severity: 'review', suggestedStatus: 'needs_evidence', originalCheck: { ...issue }, adaptation: 'registered_pcs_case_only', parsingWitnesses: [{ evidenceId: field.evidenceId!, quote: field.quote! }], message: '原文pcs/Pcs与已注册PCS仅作ASCII大小写归一，原数及originalUnit保持；仍须Codex核对当前SKU数量和最内包装口径，不映射成张/片/抽。' };
}
