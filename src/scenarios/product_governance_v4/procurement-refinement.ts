import assert from 'node:assert/strict';
import {materializeSharedCatalog, inheritancePlan} from './shared-definitions.mjs';
import {stableJson, validateSharedDefinitions, validateAttribute} from './attribute-contract.mjs';
import {semanticHash, identity} from './core';
import {restorationEligibility, normalizeRestorationName} from './restoration';

const nonempty = (v: any) => typeof v === 'string' && v.trim().length > 0;
const refs = (v: any) => Array.isArray(v) && v.length > 0 && v.every(r => nonempty(r) || (nonempty(r?.sourceId) && nonempty(r?.locator)));
const semanticFields = ['name','type','unit','definition','rule','purpose','object','mode','options','measurement','mutuallyExclusive'];
const sameDefinition = (a: any, b: any) => semanticFields.every(k => stableJson(a[k] ?? null) === stableJson(b[k] ?? null));

/** Offline, incremental composition. Never silently deletes, renames, or reapproves a baseline. */
export function refineProcurement(baseline: any, patches: any[], policy: any, {scopeComplete = false, sourceProfiles}: {scopeComplete?: boolean, sourceProfiles?: string[]} = {}) {
  assert(baseline.attributeContractVersion === 1 && Array.isArray(baseline.definitions), 'Typed shared-definition baseline required');
  const categories = new Map<string, any>(baseline.categories.map((c: any) => [c.categoryId,c]));
  assert(categories.size === baseline.categories.length, 'Duplicate category');
  const old = new Map<string, any>(baseline.proposals.map((p: any) => [identity(p),p]));
  assert(old.size === baseline.proposals.length, 'Duplicate baseline binding');
  const definitions = new Map<string, any>(baseline.definitions.map((d: any) => [d.id,structuredClone(d)]));
  const changed = new Map<string, any>(), reviewed = new Map<string, any>();
  const excluded = [...policy.explicitExcludedNames, ...(policy.rules ?? []).filter((r: any) => r.currentPolicy === 'explicit_business_exclusion').flatMap((r: any) => r.names)].map(normalizeRestorationName);
  const synthetic = structuredClone(baseline);
  for (const patch of patches) {
    assert(patch.version === 1 && Array.isArray(patch.definitions) && Array.isArray(patch.reviewedCategories), 'Invalid procurement patch');
    for (const r of patch.reviewedCategories) {
      assert(categories.has(r.categoryId) && !reviewed.has(r.categoryId), 'Unknown or repeated review category: '+r.categoryId);
      assert(nonempty(r.sourcePriorityReason) && refs(r.sourceReferences) && Array.isArray(r.remainingGaps), 'Review must explain source choice, evidence and gaps');
      assert(nonempty(r.sourceProfile) && (!sourceProfiles || sourceProfiles.includes(r.sourceProfile)), 'Unknown/missing source profile: '+r.sourceProfile);
      assert(Array.isArray(r.procurementQuestions) && r.procurementQuestions.length > 0, 'Procurement questions required');
      reviewed.set(r.categoryId,r);
    }
    for (const d of patch.definitions) {
      assert(nonempty(d.id) && d.bindings?.length, 'Definition ID and bindings required');
      assert(!excluded.includes(normalizeRestorationName(d.name)), 'Explicit business exclusion: '+d.name);
      const eligibility = restorationEligibility(d, policy);
      assert(!eligibility.matched || eligibility.state === 'allowed_optional_candidate', 'Restoration scope unresolved/excluded: '+d.name);
      // Reusing an existing definition is explicit and cannot quietly change its meaning.
      let target: any;
      if (d.reuseDefinitionId) {
        target = definitions.get(d.reuseDefinitionId);
        assert(target && sameDefinition(target,d), 'Reused definition semantic drift: '+d.reuseDefinitionId);
      } else {
        assert(!definitions.has(d.id), 'Existing definition needs explicit reuse: '+d.id);
        if (d.type === 'option') assert(d.enumPolicy, 'New enum needs maintenance policy: '+d.id);
        target = {...structuredClone(d),bindings:[]}; definitions.set(d.id,target);
      }
      for (const binding of d.bindings) {
        const b = structuredClone(binding), id = identity(b), previous = old.get(id);
        assert(categories.has(b.categoryId) && nonempty(b.key) && nonempty(b.reason) && !changed.has(id), 'Invalid/duplicate changed binding: '+id);
        assert(['add','update'].includes(b.action), 'Binding action must be explicit');
        assert(b.action === 'add' ? !previous : previous?.name === d.name, 'Add collision or unexpected update/rename: '+id);
        if (b.action === 'add') {
          const historical = (policy.rules??[]).filter((r:any)=>r.currentPolicy==='scope_verification_required').some((r:any)=>(r.names??[]).map(normalizeRestorationName).includes(normalizeRestorationName(d.name)));
          assert(!historical || eligibility.state==='allowed_optional_candidate', 'Historical field remains excluded: '+d.name);
          assert(!baseline.proposals.some((p: any) => p.categoryId === b.categoryId && p.name === d.name), 'Duplicate category attribute name: '+d.name);
          const example = b.example ?? d.example;
          synthetic.proposals.push({categoryId:b.categoryId,category:categories.get(b.categoryId).category,key:b.key,name:d.name,
            example: example.origin === 'source_normalized' ? example.rawValue : `填写示例（非商品原值）：${JSON.stringify(example.value)}`,
            sourceNames:d.sourceReferences.map((r: any) => typeof r === 'string' ? r : r.sourceId), restorationScope:d.restorationScope,
            sourceSpuCount:null,targetDirectEvidence:false,evidenceKeys:[]});
        } else {
          const priorDefinition = definitions.get(previous.definitionId);
          assert(priorDefinition, 'Baseline definition missing');
          priorDefinition.bindings = priorDefinition.bindings.filter((v: any) => identity(v) !== id);
        }
        // Reference evidence belongs to the binding; do not rewrite old shared meaning or old approvals.
        target.bindings.push({...b,example:b.example??d.example,sourceReferences:d.sourceReferences});
        changed.set(id,{categoryId:b.categoryId,key:b.key,name:d.name,action:b.action,reason:b.reason,definitionId:target.id,
          references:d.sourceReferences,sourceDefinitionId:d.id,declaredEnumPolicy:d.enumPolicy??null});
      }
    }
  }
  assert(reviewed.size === categories.size, 'Missing category procurement review');
  const catalog = {definitions:[...definitions.values()].filter(d => d.bindings.length)};
  const materialized = materializeSharedCatalog(synthetic,[catalog],{scopeComplete});
  materialized.proposals = materialized.proposals.map((p: any) => {
    const change = changed.get(identity(p));
    if (!change) return structuredClone(old.get(identity(p)));
    const original = old.get(identity(p));
    return {...p, ...(change.action === 'add' ? {previousDefinition:null,historicalRecognition:null} : {}),
      sourceReferences:change.references,refinement:{action:change.action,reason:change.reason,definitionId:change.definitionId},
      status:change.action==='add'?'本轮新增待审':'本轮修改待审',v4Disposition:change.action==='add'?'本轮新增待审':'本轮修改待审',
      changeType:change.action==='add'?'采购缺口补充':'选项及类型完善',humanDecision:'',userAccepted:null,
      v4Review:{disposition:'待人工复核',contentModified:true,basis:change.reason},
      ...(original ? {previousDefinition:original} : {})};
  });
  const categoryOrder = new Map(baseline.categories.map((c: any,i: number)=>[c.categoryId,i]));
  materialized.proposals.sort((a: any,b: any)=>(categoryOrder.get(a.categoryId) as number)-(categoryOrder.get(b.categoryId) as number));
  const after = new Map<string,any>(materialized.proposals.map((p: any) => [identity(p),p]));
  for (const [id,p] of old) {
    assert(after.has(id), 'Unexpected removal: '+id);
    if (!changed.has(id)) assert(stableJson(p) === stableJson(after.get(id)), 'Unrequested baseline rewrite: '+id);
  }
  for (const r of reviewed.values()) for (const q of r.procurementQuestions) {
    assert(nonempty(q.question) && nonempty(q.reason) && ['covered','add','revise','defer'].includes(q.decision) && Array.isArray(q.coveredBy), 'Invalid procurement question');
    assert(q.decision === 'defer' || q.coveredBy.length > 0, 'Covered question must resolve to attributes');
    assert(q.coveredBy.every((k: string) => after.has(r.categoryId+':'+k)), 'Question references unknown attribute: '+r.categoryId);
    if (['add','revise'].includes(q.decision)) assert(q.coveredBy.some((k: string) => changed.get(r.categoryId+':'+k)?.action === (q.decision==='add'?'add':'update')), 'Question decision has no matching change');
  }
  const errors = [...validateSharedDefinitions(materialized.proposals),...materialized.proposals.flatMap((p: any) => validateAttribute(p))];
  assert(!errors.length, JSON.stringify(errors));
  const changes = [...changed].map(([id,c]) => ({...c,beforeHash:old.has(id)?semanticHash(old.get(id)):null,afterHash:semanticHash(after.get(id))}));
  return {...materialized,inheritance:inheritancePlan(catalog.definitions,baseline.categories,scopeComplete),
    procurementReview:[...reviewed.values()],refinementChanges:changes,
    sourceScope:{categories:categories.size,bindings:after.size,scopeComplete},
    checkScope:'incremental_procurement_attributes_and_local_enum_scope',candidateDecisionsReevaluated:false,
    summary:{categories:categories.size,attributes:after.size,definitions:catalog.definitions.length,
      added:changes.filter(c=>c.action==='add').length,modified:changes.filter(c=>c.action==='update').length,
      preserved:old.size-changes.filter(c=>c.action==='update').length},
    adoption:'pending_human',productionWrites:0,modelRequests:0};
}
