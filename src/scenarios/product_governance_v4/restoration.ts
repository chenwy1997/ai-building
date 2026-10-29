export const normalizeRestorationName = (name: string) => name.replace(/\s|【|】/g, '').replace(/^商品/, '');

// Candidate permission and a completed attribute definition are separate decisions.
// A source field called "weight" or "size" does not identify its measurement object.
export function restorationEligibility(record: any, policy: any) {
  const approval = policy.restorationPolicy;
  const excludedObjects = (approval.allowedScopedCandidates ?? []).flatMap((r: any) => r.excludedObjects ?? []);
  if (excludedObjects.includes(record.restorationScope?.object)) return { state: 'excluded_by_user', matched: true, concept: null, reason: '该来源已明确为包装或物流测量对象，保持排除，不能归入商品本体参数。' };
  const names = [record.name, record.sourceName, record.candidateName, record.canonicalName]
    .filter(Boolean).flatMap(n => [n, n.split(/[:：]/).at(-1)]).map(normalizeRestorationName);
  const matches = (values: string[] = []) => values.some(n => names.includes(normalizeRestorationName(n)));
  if (matches(approval.excludedNames)) return { state: 'excluded_by_user', matched: true, concept: null, reason: approval.excludedReason };
  if (matches(approval.allowedOptionalNames)) return { state: 'allowed_optional_candidate', matched: true, concept: 'shelf_life', reason: '用户已允许恢复为选填候选；是否采用及商品值仍须分别核实。' };
  for (const rule of approval.allowedScopedCandidates ?? []) {
    if (!matches(rule.names)) continue;
    const scope = record.restorationScope;
    const resolved = scope?.object === rule.object && typeof scope.basis === 'string' && scope.basis.trim().length > 0;
    return { state: resolved ? 'allowed_optional_candidate' : 'allowed_scope_pending', matched: true, concept: rule.concept,
      reason: resolved ? rule.resolvedReason : rule.pendingReason };
  }
  return approval.otherHistoricallyExcludedFields === 'keep_excluded'
    ? { state: 'excluded_by_user', matched: false, concept: null, reason: approval.excludedReason }
    : { state: 'pending_user', matched: false, concept: null, reason: '其他历史职责排除项尚待用户选择。' };
}

export function optionalRestorationAllowed(proposal: any, oldDecision: any, policy: any) {
  if (/不要|排除/.test(oldDecision.humanReview ?? '')) return false;
  const source = restorationEligibility(oldDecision, policy);
  const target = restorationEligibility(proposal, policy);
  // An explicitly excluded shipping field cannot be renamed to an allowed body measurement.
  if (source.state === 'excluded_by_user') return false;
  if (source.concept && target.concept !== source.concept) return false;
  return target.state === 'allowed_optional_candidate' && proposal.required === false;
}
