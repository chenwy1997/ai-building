import {stableJson, validateAttribute, validateSharedDefinitions} from './attribute-contract.mjs';

const identity = p => p.categoryId + ':' + p.key;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const references = v => Array.isArray(v) && v.length > 0 && v.every(r => nonempty(r) || (nonempty(r?.sourceId) && nonempty(r?.locator)));
const fail = (condition, message) => { if (!condition) throw Error(message); };

/** Display-only ranges never become hard value limits. */
export function optionsDisplay(definition) {
  if (definition.type === 'text') return '';
  if (definition.type === 'boolean') return '是 / 否';
  if (definition.type === 'option') return definition.options.join('；');
  const r = definition.referenceRange;
  if (!r || r.kind === 'pending') return '参考范围待核';
  const display = value => String(Number(value.toPrecision(4)));
  const values = r.min === r.max ? display(r.min) : `${display(r.min)}–${display(r.max)}`;
  return `${r.kind === 'sample_observed' ? '样本参考' : r.kind === 'domain_constraint' ? '含义范围' : '建议参考'}：${values}${r.kind === 'model_proposal' ? '（待复核）' : ''}`;
}

/** One shared option vocabulary; category bindings may use an evidenced subset. */
export function bindingOptionsDisplay(definition, proposal) {
  return definition.type === 'option' && proposal.typing?.choice?.allowedValues
    ? proposal.typing.choice.allowedValues.join('；') : optionsDisplay(definition);
}

/** Suggest only complete subtrees inside the explicitly selected scope. No production writes. */
export function inheritancePlan(definitions, categories, scopeComplete = false) {
  const nodes = new Map();
  for (const c of categories) {
    const parts = (c.path ?? '').split('>').filter(Boolean);
    fail(parts.length > 0, 'Category path missing: ' + c.categoryId);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('>');
      if (!nodes.has(p)) nodes.set(p, {path:p, categoryIds:new Set(), isLeaf:false});
      const node = nodes.get(p); node.categoryIds.add(c.categoryId);
      if (i === parts.length) node.isLeaf = true;
    }
  }
  return definitions.map(d => {
    const members = new Set(d.bindings.map(b => b.categoryId)), covered = new Set(), mounts = [];
    for (const node of [...nodes.values()].sort((a,b) => a.path.split('>').length - b.path.split('>').length || a.path.localeCompare(b.path))) {
      if (!scopeComplete && !node.isLeaf) continue;
      if (node.categoryIds.size === 0 || [...node.categoryIds].some(id => !members.has(id) || covered.has(id))) continue;
      const local = d.bindings.filter(b => node.categoryIds.has(b.categoryId));
      if (new Set(local.map(b => stableJson(b.allowedOptions??null))).size > 1) continue;
      mounts.push({path:node.path, mode:node.isLeaf?'leaf_binding':'parent_inheritance', categoryIds:[...node.categoryIds],
        ...(local[0]?.allowedOptions ? {allowedOptions:local[0].allowedOptions} : {}), status:'offline_proposal_pending_directory_version_check'});
      for (const id of node.categoryIds) covered.add(id);
    }
    fail(stableJson([...members].sort()) === stableJson([...covered].sort()), 'Inheritance coverage mismatch: ' + d.id);
    return {definitionId:d.id, mounts, basis:scopeComplete?'complete_selected_scope':'leaf_bindings_only_scope_not_complete'};
  });
}

/** Convert reviewed semantic definitions to shared definitions plus exact category bindings. */
export function materializeSharedCatalog(baseline, catalogs, {scopeComplete = false} = {}) {
  const categoryIds = new Set(baseline.categories.map(c => c.categoryId));
  fail(categoryIds.size === baseline.categories.length, 'Duplicate category ID');
  fail(baseline.proposals.every(p => categoryIds.has(p.categoryId)), 'Baseline binding has unknown category');
  const old = new Map(baseline.proposals.map(p => [identity(p),p]));
  fail(old.size === baseline.proposals.length, 'Duplicate baseline identity');
  const definitions = catalogs.flatMap(c => c.definitions ?? []), ids = new Set(), names = new Map(), seen = new Set(), proposals = [];
  for (const d of definitions) {
    fail(nonempty(d.id) && !ids.has(d.id), 'Missing or duplicate definition ID: ' + d.id); ids.add(d.id);
    fail(['text','number','boolean','option'].includes(d.type), 'Current scope excludes dictionary type: ' + d.id);
    for (const k of ['name','definition','rule','purpose','object','rationale']) fail(nonempty(d[k]), `${d.id}: missing ${k}`);
    fail(Array.isArray(d.options), d.id + ': options must be an array');
    fail(d.type === 'option' || d.options.length === 0, d.id + ': only enums may define options');
    fail(references(d.sourceReferences), d.id + ': missing source/basis references');
    fail(Array.isArray(d.bindings) && d.bindings.length > 0, d.id + ': missing bindings');
    if (!names.has(d.name)) names.set(d.name, []); names.get(d.name).push(d);
    if (d.type === 'number') {
      fail(nonempty(d.unit), d.id + ': number requires a unit');
      const r=d.referenceRange;
      fail(r && ['sample_observed','model_proposal','domain_constraint','pending'].includes(r.kind), d.id + ': reference range status missing');
      fail(r.unit === d.unit && nonempty(r.basis), d.id + ': reference range unit/basis mismatch');
      if (r.kind !== 'pending') {
        fail(Number.isFinite(r.min) && Number.isFinite(r.max) && r.min <= r.max, d.id + ': invalid reference range');
        fail(references(r.sourceReferences), d.id + ': reference range basis is not located');
      }
    } else fail(!d.referenceRange, d.id + ': only numeric attributes have reference ranges');
    for (const b of d.bindings) {
      const key = identity(b), original = old.get(key);
      fail(original && !seen.has(key), 'Unknown or repeated binding: ' + key); seen.add(key);
      fail(original.name === d.name, 'Unexpected rename: ' + key);
      const typing = {version:1, object:d.object, rationale:d.rationale};
      if (d.type === 'text') typing.text = {formatHint:d.rule,minLength:null,maxLength:null};
      if (d.type === 'number') typing.number = {quantityKind:d.object,precision:null,min:null,max:null,constraintReferences:[]};
      if (d.type === 'option') typing.choice = {mode:d.mode,dimension:d.object,rationale:d.rationale,boundaryReferences:d.sourceReferences,minSelections:1,maxSelections:d.mode==='single'?1:(b.allowedOptions??d.options).length,mutuallyExclusive:d.mutuallyExclusive??[],
        ...(d.measurement ? {measurement:d.measurement} : {}), ...(d.enumPolicy ? {enumPolicy:d.enumPolicy} : {}),
        ...(b.allowedOptions ? {allowedValues:b.allowedOptions,applicabilityReferences:b.allowedOptionsReferences} : {})};
      const p = {...original, definitionId:d.id, definitionVersion:'2026-10-30', definition:d.definition, purpose:d.purpose,
        type:d.type,unit:d.unit??null,rules:[d.rule],shortRule:d.rule,enumValues:d.options,scope:'SKU',required:false,
        typing,valueExamples:[b.example??d.example],referenceRange:d.referenceRange??null,
        valueDomain:d.type==='text'?d.rule:optionsDisplay(d),sourceReferences:d.sourceReferences,
        applicabilityNote:b.applicabilityNote??'',splitReason:d.splitReason??null,
        previousDefinition:original,status:'本轮修改待审',v4Disposition:'本轮修改待审',humanDecision:'',userAccepted:null,changeType:'共享定义及类型修订',
        v4Review:{disposition:'本轮修改待审',contentModified:true,basis:'共享定义、类型、单位和规则重整；旧认可只保留在 previousDefinition，不作为新稿批准'},
        historicalRecognition:{scope:'原属性集合及旧内容',reference:'2026-10-29 accepted baseline; new type/definition is pending review'}};
      const issues=validateAttribute(p);fail(!issues.length,d.id+': '+JSON.stringify(issues)); proposals.push(p);
    }
  }
  fail(seen.size===old.size, 'Uncovered baseline attributes: '+[...old.keys()].filter(k=>!seen.has(k)).join(', '));
  for (const [name, sameName] of names) if (sameName.length>1) {
    fail(sameName.every(d=>nonempty(d.splitReason)), 'Repeated name requires genuine semantic distinction: '+name);
    const semantic=new Set(sameName.map(d=>stableJson({type:d.type,unit:d.unit,definition:d.definition,object:d.object,options:d.options,mode:d.mode})));
    fail(semantic.size===sameName.length, 'Duplicate semantic definition under different IDs: '+name);
  }
  const issues=validateSharedDefinitions(proposals);fail(!issues.length,JSON.stringify(issues));
  const order=new Map(baseline.proposals.map((p,i)=>[identity(p),i]));proposals.sort((a,b)=>order.get(identity(a))-order.get(identity(b)));
  const mounts=inheritancePlan(definitions,baseline.categories,scopeComplete);
  return {version:1,attributeContractVersion:1,categories:baseline.categories,definitions,proposals,inheritance:mounts,
    dictionaries:{version:1,dictionaries:[]},programChecks:[],adoption:'pending_human',productionWrites:0,modelRequests:0,
    sourceScope:{categories:baseline.categories.length,bindings:baseline.proposals.length,scopeComplete}};
}
