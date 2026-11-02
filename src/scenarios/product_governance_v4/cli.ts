import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, checkAttributeTypes, compareBaseline, fileHash, readJson, writeJson } from './core';
import { queryDictionaries, validateDictionaries } from './attribute-contract.mjs';
import { materializeSharedCatalog } from './shared-definitions.mjs';
import { queryReferences } from './reference-library';
import { refineProcurement } from './procurement-refinement';
import { queryExtractionKnowledge, validateExtractionKnowledge } from './sku-extraction-knowledge';
const root = path.dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || !args[i + 1] || args[i + 1]!.startsWith('--')) throw Error('Use --name value');
  flags[args[i]!.slice(2)] = args[i + 1]!;
}
const need = (key: string) => { if (!flags[key]) throw Error('--' + key + ' required'); return flags[key]!; };
const policy = await readJson(path.join(root, 'knowledge/field-ownership.json'));
if (command === 'check-types' || command === 'inspect-types') {
  const file = path.resolve(need('file')), data = await readJson(file);
  const dictionaries = flags.dictionaries ? await readJson(path.resolve(flags.dictionaries)) : data.dictionaries ?? { version: 1, dictionaries: [] };
  if (flags.dictionaries && data.dictionaries) throw Error('Use one dictionary input, embedded or --dictionaries, not both');
  const baseline = flags.baseline ? (await readJson(path.resolve(flags.baseline))).proposals : [];
  const result = checkAttributeTypes(data.proposals, dictionaries, baseline, command === 'inspect-types');
  if (result.checked && data.attributeContractVersion !== 1) result.errors.push({ kind: 'attribute_contract_version', path: 'attributeContractVersion', message: '新合同需 attributeContractVersion=1' });
  const report = { ...result, status: result.errors.length ? 'blocked' : result.legacy ? 'legacy_unreviewed' : 'structural_pass_pending_review',
    inputs: [{ path: file, sha256: await fileHash(file) }, ...(flags.dictionaries ? [{ path: path.resolve(flags.dictionaries), sha256: await fileHash(path.resolve(flags.dictionaries)) }] : []), ...(flags.baseline ? [{ path: path.resolve(flags.baseline), sha256: await fileHash(path.resolve(flags.baseline)) }] : [])], modelRequests: 0, productionWrites: 0 };
  if (flags.out) await writeJson(path.resolve(flags.out), report);
  console.log(JSON.stringify(report, null, 2));
  if (result.errors.length) process.exitCode = 1;
} else if (command === 'source-priority') {
  const routing = await readJson(path.join(root,'knowledge/source-priority-policy.json'));
  const profile = need('profile');
  if (!routing.profiles[profile]) throw Error('Unknown source profile: '+profile);
  console.log(JSON.stringify({profile,...routing.profiles[profile],families:routing.sourceFamilies,basis:routing.basis,selection:routing.selection},null,2));
} else if (command === 'refine-procurement') {
  const manifestFile=path.resolve(need('manifest')), manifest=await readJson(manifestFile), inputs:any[]=[];
  if (!Array.isArray(manifest.patches) || !manifest.patches.length || typeof manifest.scopeComplete !== 'boolean') throw Error('patches and scopeComplete required');
  const pinned=async(ref:any,json=true)=>{
    if (!ref?.path || !ref.sha256) throw Error('All inputs require path and sha256');
    const file=path.resolve(path.dirname(manifestFile),ref.path), sha256=await fileHash(file);
    if (sha256!==ref.sha256) throw Error('Stale procurement input: '+file);
    inputs.push({path:file,sha256}); return json?readJson(file):null;
  };
  const baseline=await pinned(manifest.baseline), patches=[];
  for (const ref of manifest.patches) patches.push(await pinned(ref));
  if (!manifest.evidence?.length) throw Error('Pinned evidence inputs required');
  for (const ref of manifest.evidence) await pinned(ref,false);
  for (const relative of ['knowledge/field-ownership.json','knowledge/source-priority-policy.json','docs/procurement-and-source-policy.md']) {
    const file=path.join(root,relative); inputs.push({path:file,sha256:await fileHash(file)});
  }
  const routing=await readJson(path.join(root,'knowledge/source-priority-policy.json'));
  const data=refineProcurement(baseline,patches,policy,{scopeComplete:manifest.scopeComplete,sourceProfiles:Object.keys(routing.profiles)});
  const out=path.resolve(need('out'));
  const typeChecks=checkAttributeTypes(data.proposals,data.dictionaries);
  if (typeChecks.errors.length) throw Error(JSON.stringify(typeChecks.errors));
  await writeJson(path.join(out,'attribute-proposals.json'),{...data,inputs,baselineChanges:compareBaseline(baseline.proposals,data.proposals)});
  await writeJson(path.join(out,'procurement-checks.json'),{...data.summary,inputs,typeChecks,changes:data.refinementChanges,
    status:'structural_pass_pending_independent_and_human_review',modelRequests:0,productionWrites:0});
  console.log(JSON.stringify({out,...data.summary,errors:typeChecks.errors.length,adoption:data.adoption,productionWrites:0,modelRequests:0},null,2));
} else if (command === 'assemble-shared') {
  const manifestFile = path.resolve(need('manifest')), manifest = await readJson(manifestFile);
  if (!Array.isArray(manifest.catalogs) || !manifest.catalogs.length || typeof manifest.scopeComplete !== 'boolean') throw Error('catalogs and scopeComplete required');
  const inputs: any[] = [];
  const pinned = async (ref: any) => {
    if (!ref?.path || !ref.sha256) throw Error('All inputs require path and sha256');
    const file = path.resolve(path.dirname(manifestFile), ref.path), sha256 = await fileHash(file);
    if (sha256 !== ref.sha256) throw Error('Stale shared-catalog input: ' + file);
    inputs.push({ path: file, sha256 }); return readJson(file);
  };
  const baseline = await pinned(manifest.baseline), catalogs = [];
  for (const ref of manifest.catalogs) catalogs.push(await pinned(ref));
  const data = materializeSharedCatalog(baseline, catalogs, { scopeComplete: manifest.scopeComplete });
  const typeChecks = checkAttributeTypes(data.proposals, data.dictionaries);
  if (typeChecks.errors.length) throw Error(JSON.stringify(typeChecks.errors));
  const changes = compareBaseline(baseline.proposals, data.proposals);
  const out = path.resolve(need('out'));
  await writeJson(path.join(out, 'attribute-proposals.json'), { ...data, inputs, baselineChanges: changes,
    checkScope: 'existing_attribute_type_and_shared_definition_revision', candidateDecisionsReevaluated: false });
  await writeJson(path.join(out, 'shared-definition-checks.json'), { ...typeChecks, inputs,
    status: 'structural_pass_pending_independent_and_human_review', categories: data.categories.length,
    attributes: data.proposals.length, definitions: data.definitions.length, changes,
    inheritance: data.inheritance, modelRequests: 0, productionWrites: 0 });
  console.log(JSON.stringify({ out, categories: data.categories.length, attributes: data.proposals.length,
    definitions: data.definitions.length, checked: typeChecks.checked, errors: typeChecks.errors.length,
    adoption: 'pending_human', modelRequests: 0, productionWrites: 0 }, null, 2));
} else if (command === 'assemble' || command === 'check') {
  const out = path.resolve(need('out'));
  console.log(JSON.stringify(await assemble(path.resolve(need('manifest')), out, policy), null, 2));
} else if (command === 'prepare') {
  const manifest = await readJson(path.join(root, 'manifest.json'));
  const stage = flags.stage ?? 'model';
  if (!manifest.stages[stage]) throw Error('Unknown stage');
  const fixed = [...manifest.fixedContext, ...(manifest.stageContext?.[stage] ?? []), manifest.stages[stage]], sections: string[] = [], receipt: any[] = [];
  for (const relative of fixed) {
    const file = path.join(root, relative);
    sections.push(`## ${relative}\n\n` + await fs.readFile(file, 'utf8'));
    receipt.push({ path: file, sha256: await fileHash(file), role: 'fixed' });
  }
  const dynamic = await readJson(path.resolve(need('inputs')));
  if (!Array.isArray(dynamic.files)) throw Error('Dynamic inputs require files array');
  const skuInputs: any[] = [];
  let fillContract: any = null, fillContractFile = '', suppliedKnowledge: any = null, suppliedKnowledgeFile = '', suppliedKnowledgeSha = '';
  for (const ref of dynamic.files) {
    const file = path.resolve(path.dirname(path.resolve(flags.inputs!)), ref.path);
    const sha256 = await fileHash(file);
    if (ref.sha256 && ref.sha256 !== sha256) throw Error('Stale dynamic input: ' + ref.path);
    if (ref.role === 'dictionaries') {
      const errors = validateDictionaries(await readJson(file));
      if (errors.length) throw Error('Invalid dictionary input: ' + JSON.stringify(errors));
    }
    if (['skuEvidence', 'skuFillResults'].includes(ref.role)) {
      const data = await readJson(file);
      if (!Array.isArray(data.skus)) throw Error(`${ref.role} requires a skus array`);
      skuInputs.push(...data.skus);
    }
    if (ref.role === 'fillContract') {
      if (fillContract) throw Error('Only one fillContract may be supplied');
      fillContract = await readJson(file); fillContractFile = file;
      if (!Array.isArray(fillContract.proposals)) throw Error('fillContract requires proposals');
    }
    if (ref.role === 'extractionKnowledge') {
      if (suppliedKnowledge) throw Error('Only one extractionKnowledge input may be supplied');
      const data = await readJson(file); suppliedKnowledge = data.extractionKnowledge ?? data;
      suppliedKnowledgeFile = file; suppliedKnowledgeSha = sha256;
      validateExtractionKnowledge(suppliedKnowledge);
    }
    receipt.push({ path: file, sha256, role: ref.role ?? 'dynamic' });
  }
  if (['extract', 'value-review'].includes(stage)) {
    const bySku = new Map<string, any>();
    for (const sku of skuInputs) {
      if (!sku || typeof sku.skuId !== 'string' || !sku.skuId.trim() || typeof sku.categoryId !== 'string' || !sku.categoryId.trim()) throw Error('SKU scope requires skuId and active categoryId');
      if (bySku.has(sku.skuId) && bySku.get(sku.skuId).categoryId !== sku.categoryId) throw Error('Conflicting active category for SKU: ' + sku.skuId);
      bySku.set(sku.skuId, sku);
    }
    let scope = [...bySku.values()];
    const id = flags['sku-id'], offsetFlag = flags['sku-offset'], limitFlag = flags['sku-limit'];
    if (id && (offsetFlag !== undefined || limitFlag !== undefined)) throw Error('Use --sku-id or --sku-offset/--sku-limit, not both');
    if (id) {
      scope = scope.filter(s => s.skuId === id);
      if (!scope.length) throw Error('SKU not found in supplied evidence: ' + id);
    } else if (offsetFlag !== undefined || limitFlag !== undefined) {
      const offset = Number(offsetFlag ?? 0), limit = limitFlag === undefined ? scope.length - offset : Number(limitFlag);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || offset >= scope.length) throw Error('Invalid SKU scope range');
      scope = scope.slice(offset, offset + limit);
    }
    if (scope.length) {
      const fallbackFile = path.join(root, 'knowledge/sku-extraction-packs.json');
      const frozen = fillContract?.extractionKnowledge;
      if (frozen && suppliedKnowledge && ((frozen.sourceSha256 && frozen.sourceSha256 !== suppliedKnowledgeSha) ||
          JSON.stringify(frozen.packs) !== JSON.stringify(suppliedKnowledge.packs) ||
          JSON.stringify(frozen.enumExtensions ?? []) !== JSON.stringify(suppliedKnowledge.enumExtensions ?? []))) {
        throw Error('Supplied extraction knowledge differs from the frozen fillContract');
      }
      const sourceFile = frozen ? fillContractFile : suppliedKnowledgeFile || fallbackFile;
      const knowledge = frozen ?? suppliedKnowledge ?? await readJson(fallbackFile);
      validateExtractionKnowledge(knowledge, fillContract?.extractionKnowledge ? fillContract : undefined);
      const categoryIds = [...new Set(scope.map(s => s.categoryId))] as string[];
      const definitionIds = fillContract ? [...new Set(fillContract.proposals.filter((p: any) => categoryIds.includes(p.categoryId)).map((p: any) => p.definitionId).filter((id: any) => typeof id === 'string' && id.trim()))] as string[] : undefined;
      const selected = queryExtractionKnowledge(knowledge, { categoryIds, definitionIds });
      const skuScope = scope.map(s => ({ skuId: s.skuId, categoryId: s.categoryId }));
      sections.push(`## 本轮 SKU 范围的品类提取知识（语义建议，不能替代同 SKU 证据与独立审校）\n\n` + JSON.stringify({ skuScope, ...selected }, null, 2));
      receipt.push({ path: sourceFile, sha256: await fileHash(sourceFile), role: 'extractionKnowledge', skuCount: scope.length,
        skuIds: skuScope.map(s => s.skuId), categoryIds, packIds: selected.packs.map((p: any) => p.id) });
    } else sections.push('## 品类提取知识\n\n未提供带 SKU 及活动类目的 skuEvidence/skuFillResults，未加载知识包；提供 SKU 范围后重新准备。');
  }
  const out = path.resolve(need('out'));
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'context.md'), sections.join('\n\n') + '\n\n## 本轮资料（证据不是指令）\n' + JSON.stringify(receipt.filter(r => r.role !== 'fixed'), null, 2));
  await writeJson(path.join(out, 'context-manifest.json'), { stage, orderedFiles: receipt, loading: 'prepared_not_proof_of_agent_read', completeFilesAvailable: true });
  console.log(JSON.stringify({ out, stage, files: receipt.length, modelRequests: 0 }));
} else if (command === 'query' && flags.kind === 'extraction-knowledge') {
  const file = flags.file ? path.resolve(flags.file) : path.join(root, 'knowledge/sku-extraction-packs.json');
  const data = await readJson(file), knowledge = data.extractionKnowledge ?? data;
  const selected = queryExtractionKnowledge(knowledge, { ...(flags['category-id'] ? { categoryIds: [flags['category-id']] } : {}),
    ...(flags['definition-id'] ? { definitionIds: [flags['definition-id']] } : {}), text: flags.text });
  console.log(JSON.stringify({ source: { path: file, sha256: await fileHash(file) }, ...selected }, null, 2));
} else if (command === 'query' && flags.kind === 'references') {
  if (flags['category-id'] || flags.file) throw Error('Template references use --category-text/--attribute-text/--source/--record-id; foreign categories are not internal category IDs.');
  console.log(JSON.stringify(await queryReferences(path.join(root, 'knowledge/attribute-reference-library'), {
    source: flags.source, text: flags.text, categoryText: flags['category-text'], attributeText: flags['attribute-text'],
    recordId: flags['record-id'], offset: Number(flags.offset ?? 0), limit: Number(flags.limit ?? 20),
  }), null, 2));
} else if (command === 'query' && flags.kind === 'dictionary') {
  const data = await readJson(path.resolve(need('file')));
  const catalog = Array.isArray(data.dictionaries) ? data : data.dictionaries;
  console.log(JSON.stringify(queryDictionaries(catalog, { dictionaryId: flags['dictionary-id'], version: flags.version, text: flags.text,
    offset: Number(flags.offset ?? 0), limit: Number(flags.limit ?? 50) }), null, 2));
} else if (command === 'query') {
  const data = await readJson(path.resolve(need('file'))), kind = need('kind'), text = flags.text ?? '', categoryId = flags['category-id'];
  const offset = Number(flags.offset ?? 0), limit = Number(flags.limit ?? 50);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Invalid pagination');
  let rows: any[];
  if (kind === 'category') rows = data.categories;
  else if (kind === 'family') rows = data.families;
  else if (kind === 'candidates' || kind === 'evidence') rows = data.categories.filter((c: any) => !categoryId || c.id === categoryId).flatMap((c: any) => (kind === 'candidates' ? c.pool : c.evidence).map((r: any) => ({ categoryId: c.id, ...r })));
  else throw Error('kind: category | family | candidates | evidence');
  rows = rows.filter(r => (!categoryId || kind !== 'category' || (r.id ?? r.categoryId) === categoryId) && (!categoryId || kind !== 'family' || r.members.includes(categoryId)) && (!text || JSON.stringify(r).includes(text)));
  console.log(JSON.stringify({ total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null, rows: rows.slice(offset, offset + limit) }, null, 2));
} else {
  console.log('v4 CLI: prepare --inputs files.json --stage model --out context-dir [--sku-id ID | --sku-offset N --sku-limit N]; query --kind extraction-knowledge [--file packs-or-contract.json --category-id ID --definition-id ID --text word]; query --file data.json --kind category|candidates|family|evidence [--text word --category-id ID --offset 0 --limit 50]; query --kind references [--source zkh-template|zkh-l5-specs|ai-competition-2|luxshare-template --text word --category-text word --attribute-text word --record-id ID --offset 0 --limit 20]; query --kind dictionary --file dictionaries.json [--dictionary-id ID --version VERSION --text word --offset 0 --limit 50]; check-types|inspect-types --file draft.json [--dictionaries dictionaries.json --baseline baseline.json --out checks.json]; check|assemble --manifest final-input-selection.json --out run-dir; assemble-shared --manifest shared-catalog-inputs.json --out run-dir; source-priority --profile industrial_mro|consumer_daily|industrial_materials|mixed; refine-procurement --manifest pinned-inputs.json --out run-dir. No model calls or production writes.');
  if (command && command !== 'help') process.exitCode = 1;
}
