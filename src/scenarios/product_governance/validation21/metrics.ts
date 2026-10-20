import type { TruthValue } from '../revision/conditions.ts';
export interface MetricField {
  attributeId: string; inRate: boolean; filledForMetric: boolean; independentRequiredInRate: boolean; independentRequiredFilled: boolean;
  applicabilityState: TruthValue; requirednessState: TruthValue; conditionalRequirednessUnknown?: boolean;
  requirednessMode: string; missingReasonCode: string; missingReason: string; requiredMissingReasonCode?: string; requiredMissingReason?: string;
  [key: string]: any;
}
export interface MetricRow {
  key: string; categoryId: string; category: { status: string; targetConfirmed?: boolean }; excluded: boolean;
  fieldRecords: MetricField[]; groupRecords: Array<{ groupId: string; inRate: boolean; complete: boolean; applicabilityState: TruthValue; missingReason?: string }>;
  completeRequired: boolean; allConditionsResolved: boolean; categoryIssueType?: string; [key: string]: any;
}
const rate = (n: number, d: number) => d ? n / d : null;
export function missingBreakdown(fields: MetricField[], requiredOnly = false) {
  const slots = fields.filter(f => requiredOnly ? f.independentRequiredInRate : f.inRate);
  const missing = slots.filter(f => !(requiredOnly ? f.independentRequiredFilled : f.filledForMetric));
  const map = new Map<string, { reasonCode: string; reason: string; count: number }>();
  for (const f of missing) { const code = requiredOnly ? f.requiredMissingReasonCode ?? f.missingReasonCode : f.missingReasonCode, reason = requiredOnly ? f.requiredMissingReason ?? f.missingReason : f.missingReason; const item = map.get(code) ?? { reasonCode: code, reason, count: 0 }; item.count++; map.set(code, item); }
  return [...map.values()].sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode)).map(x => ({ ...x, shareOfMissingSlots: rate(x.count, missing.length), shareOfAllSlots: rate(x.count, slots.length) }));
}
export function summarizeMetrics(rows: MetricRow[]) {
  const eligible = rows.filter(r => !r.excluded && r.category.status === 'matched' && r.category.targetConfirmed === true);
  const fields = eligible.flatMap(r => r.fieldRecords), all = fields.filter(f => f.inRate), required = fields.filter(f => f.independentRequiredInRate), groups = eligible.flatMap(r => r.groupRecords).filter(g => g.inRate);
  const filled = all.filter(f => f.filledForMetric).length, requiredFilled = required.filter(f => f.independentRequiredFilled).length, groupsComplete = groups.filter(g => g.complete).length;
  return {
    sample: rows.length, eligible: eligible.length, wrong: rows.filter(r => r.category.status === 'wrong').length, uncertain: rows.filter(r => r.category.status === 'uncertain').length,
    overallFields: { filled, slots: all.length, missing: all.length - filled, rate: rate(filled, all.length) },
    independentRequiredFields: { filled: requiredFilled, slots: required.length, missing: required.length - requiredFilled, rate: rate(requiredFilled, required.length), confirmedSlots: required.filter(f => f.requirednessState === true).length, unknownSlots: required.filter(f => f.requirednessState === 'unknown').length },
    orGroups: { complete: groupsComplete, slots: groups.length, missing: groups.length - groupsComplete, rate: rate(groupsComplete, groups.length), unknownApplicability: groups.filter(g => g.applicabilityState === 'unknown').length },
    completeRequiredProducts: eligible.filter(r => r.completeRequired).length, allConditionsResolvedProducts: eligible.filter(r => r.allConditionsResolved).length,
    unknown: { applicabilitySlots: fields.filter(f => f.inRate && f.applicabilityState === 'unknown').length, conditionalRequirednessSlots: fields.filter(f => f.inRate && f.conditionalRequirednessUnknown).length },
    categoryIssues: Object.fromEntries([...new Set(rows.map(r => r.categoryIssueType ?? 'none'))].map(code => [code, rows.filter(r => (r.categoryIssueType ?? 'none') === code).length])),
  };
}
export function samplingSummary(context: { products: Array<{ categoryId: string }>; standard: { categories: Array<{ id: string; name: string }> }; manifests: Record<string, any> }) {
  const shortfallSources = Object.values(context.manifests).flatMap(m => m?.shortfallSource?.categories ?? []);
  const shortfalls = context.standard.categories.map(c => { const actual = context.products.filter(p => p.categoryId === c.id).length, source = shortfallSources.find((s: any) => s.categoryId === c.id); return { categoryId: c.id, category: c.name, planned: 50, actual, shortfall: Math.max(0, 50 - actual), population: source?.population ?? null, reason: source ? '当前在售总体不足，已全取' : actual < 50 ? '该cohort尚未全部冻结或采样不足，见manifest' : '' }; }).filter(c => c.shortfall);
  return { planned: context.standard.categories.length * 50, actual: context.products.length, targetPerCategory: 50, shortfalls, scopeNote: '本批为按类目分层定额样本；总体不足的类目全取。字段槽指标及类目指标仅描述本批，不外推21类商品总体数量或总体填充率。' };
}
