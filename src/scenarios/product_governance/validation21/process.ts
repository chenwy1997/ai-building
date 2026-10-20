import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { read, save, digest } from '../runtime/storage.ts';
import { invoke } from '../expansion/model-run.ts';
import { parseObject } from '../adapters/models.ts';
import { parseOpenCodeGoResponse } from '../adapters/opencode-go.ts';
import { COMMANDCODE_MODELS, parseCommandCodeResponse } from '../adapters/commandcode.ts';
import { ROOT, RUN, RUN_ID, STANDARD_SOURCE, HISTORICAL_RUNS, BATCH_SIZE, MODELS, KIMI_GO_RECOVERY_MODEL, CONCURRENCY, FIELD_PROPERTIES, FIELD_STATUSES, RULES } from './settings.ts';

type Row = Record<string, any>;
const exists = (path: string) => Bun.file(path).exists();
const arr = (x: any): Row[] => Array.isArray(x) ? x : x?.products ?? x?.rows ?? [];
const plain = (x: any): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = <T>(x: T): T => structuredClone(x);
const fileHashCache = new Map<string, string>();
async function fileHash(path: string): Promise<string | null> {
  if (!await exists(path)) return null;
  if (!fileHashCache.has(path)) fileHashCache.set(path, createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex'));
  return fileHashCache.get(path)!;
}
async function frozenSave(path: string, value: unknown): Promise<void> {
  if (await exists(path)) { if (digest(await read(path)) !== digest(value)) throw new Error('Frozen input differs: ' + path); return; }
  await save(path, value);
}
async function standard(): Promise<Row> {
  const s: Row = await read(STANDARD_SOURCE);
  if (s.categories?.length !== 21 || !s.reviewState?.rootAdjudicated) throw new Error('Expected root-adjudicated fixed 21-category standard.');
  await frozenSave(join(RUN, 'design/standard.json'), s);
  await frozenSave(join(RUN, 'design/standard-reference.json'), { source: STANDARD_SOURCE, standardHash: digest(s), releaseId: s.releaseId });
  return s;
}
const rawProperties = ['id', 'shortProductId', 'categoryId', 'categoryName', 'categoryPath', 'sampleRank', 'title', 'saleSpec', 'brand', 'brandId', 'esBrand', 'upstreamSku', 'upstream', 'images', 'esFetchedAt', 'detailFetchedAt', 'esStatusChecks', 'detailStatus', 'detailMissingStatusFields', 'detailStatusConflicts', 'evidenceNotes', 'candidateCategories', 'mainImageLocal'];
const sameProductStates = new Set(['matched', 'confirmed', 'verified_same']);
const visualKinds = new Set(['image_verified', 'image_visual_verified', 'image_visual_observation', 'visual_verification', 'image_visual_transcription']);
const isVisual = (e: Row) => visualKinds.has(e.kind) || /^V(?:$|[:_F])/u.test(e.id ?? '') && /查看|核验|核实|视觉|view_image/u.test([e.source, e.verification, e.method].filter(Boolean).join(' '));
const isJd = (e: Row) => /^J/u.test(e.id ?? '') || /upstream|京东|VOP/iu.test([e.kind, e.source].filter(Boolean).join(' '));
async function localImage(p: Row, sourceRoot: string): Promise<string | null> {
  const candidates = [p.mainImageLocal, ...(p.evidence ?? []).map((e: Row) => e.localPath), ...['jpg', 'png', 'jpeg', 'webp'].map(ext => join(sourceRoot, 'inputs/images', `${p.id}.${ext}`))].filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);
  for (const candidate of candidates) { const path = isAbsolute(candidate) ? candidate : resolve(sourceRoot, candidate); if (await exists(path)) return path; }
  return null;
}
async function prepareProduct(p: Row, final: Row | undefined, sourceRoot: string, cohort: string, batch: string, s: Row, ocr?: Row): Promise<Row> {
  const category = s.categories.find((c: Row) => c.id === p.categoryId);
  if (!category) throw new Error('Unknown V2 category ' + p.categoryId);
  const rank = Number(p.sampleRank ?? p.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 50) throw new Error('Invalid sample rank ' + p.id);
  const categoryIndex = s.categories.findIndex((c: Row) => c.id === p.categoryId) + 1;
  const product: Row = Object.fromEntries(rawProperties.filter(k => p[k] !== undefined).map(k => [k, clone(p[k])]));
  product.id = p.id ?? p.productId;
  product.key = `C${String(categoryIndex).padStart(2, '0')}-${String(rank).padStart(2, '0')}`;
  product.productKey = product.key; product.productId = product.id; product.sampleRank = rank;
  product.oldKey = p.key ?? p.productKey ?? final?.key ?? null; product.batch = batch; product.cohort = cohort;
  product.categoryName = category.name; product.categoryPath = category.path;
  product.mainImageLocal = await localImage({ ...p, mainImageLocal: p.mainImageLocal ?? ocr?.localPath, evidence: final?.evidence ?? p.evidence }, sourceRoot);
  product.inputProvenance = { sourceRoot, rawProduct: `${sourceRoot}/inputs/${cohort === 'historical' ? 'model-products' : 'new-products'}.json#${p.key ?? p.id}`, finalEvidence: final ? `${sourceRoot}/analysis/final.json#rows/${final.key}/evidence` : null, oldAnswersExcluded: ['fields', 'category', 'models', 'reviewNotes', 'adjudicator', 'measurementGroups'] };
  const same = final?.jdSameProduct;
  const sameConfirmed = plain(same) && sameProductStates.has(same.status);
  product.historicalSameProduct = same ? { ...clone(same), historicalOnly: true, source: `${sourceRoot}/analysis/final.json#rows/${final!.key}/jdSameProduct`, attributeValidityNotImplied: true } : null;
  const incoming: Row[] = [...(p.evidence ?? []), ...(final?.evidence ?? [])];
  if (!incoming.some(e => e.kind === 'title' || e.field === 'title')) incoming.unshift({ id: 'T', productId: product.id, kind: 'title', text: p.title ?? '', source: 'collected-title', sourceRef: product.inputProvenance.rawProduct });
  const text = ocr?.ocr?.text ?? ocr?.text;
  if (text && !incoming.some(e => e.kind === 'image_ocr')) incoming.push({ id: 'I', productId: product.id, kind: 'image_ocr', text, source: 'main-image-ocr', sourceRef: ocr?.url ?? ocr?.sourceUrl ?? p.images?.[0]?.url, note: 'OCR线索，未经视觉核验。' });
  const evidence: Row[] = [], excluded: Row[] = [], visualRegistry: Row[] = [];
  for (const item of incoming) {
    if (typeof item.text !== 'string' || !item.text.trim()) continue;
    if (item.productId && item.productId !== product.id) throw new Error(`Evidence attached to different SKU ${product.key}:${item.id}`);
    if (evidence.some(e => e.id === item.id && e.text === item.text)) continue;
    const originalId = item.id ?? `E${evidence.length + 1}`;
    const originalKind = item.kind;
    const e: Row = { ...clone(item), id: originalId, productId: product.id, originalEvidenceId: originalId, originalKind, provenanceBatch: batch };
    while (evidence.some(old => old.id === e.id)) e.id = `${originalId}-${evidence.filter(old => old.originalEvidenceId === originalId).length + 1}`;
    if (isJd(item) && cohort === 'historical' && !sameConfirmed) { excluded.push({ ...e, exclusionReason: 'Historical JD same-product binding was rejected, unresolved, or absent; retained for later independent verification.' }); continue; }
    if (isVisual(item)) {
      const actualPath = item.localPath ? (isAbsolute(item.localPath) ? item.localPath : resolve(sourceRoot, item.localPath)) : product.mainImageLocal;
      const sha256 = actualPath ? await fileHash(actualPath) : null;
      e.kind = sha256 ? 'image_verified' : 'historical_visual_missing_image';
      e.source = item.source ?? 'Codex历史独立视觉核验';
      e.localPath = actualPath; e.imageSha256 = sha256;
      e.historicalReviewRef = `${sourceRoot}/analysis/final.json#rows/${final?.key ?? p.key}/evidence/${originalId}`;
      if (sha256) visualRegistry.push({ key: product.key, productId: product.id, evidenceId: e.id, oldEvidenceId: originalId, batch, oldKey: product.oldKey, reviewer: 'Codex historical independent visual review', historicalReviewRef: e.historicalReviewRef, originalKind, verification: item.verification ?? item.method ?? item.source, imagePath: actualPath, imageSha256: sha256, sourceRef: item.sourceRef, evidenceHash: digest(e.text) });
    } else if (e.kind === 'image_ocr') e.note = '未经视觉核验的OCR线索，不可自行作为图片已核验；旧视觉记录另以注册ID提供。';
    else if (isJd(e)) e.kind = 'upstream_detail';
    evidence.push(e);
  }
  product.evidence = evidence; product.excludedEvidence = excluded;
  product.verifiedVisualEvidenceIds = visualRegistry.map(v => v.evidenceId);
  product.visualEvidenceRegistry = visualRegistry;
  product.imageSha256 = product.mainImageLocal ? await fileHash(product.mainImageLocal) : null;
  if (ocr?.download?.sha256 && product.imageSha256 !== ocr.download.sha256) throw new Error('Collected image hash changed ' + product.key);
  product.images = (product.images ?? []).map((image: Row) => ({ ...image, interpreted: false }));
  return product;
}
function uniqueProducts(products: Row[], expectedCounts?: Map<string, number>): void {
  if (new Set(products.map(p => p.key)).size !== products.length || new Set(products.map(p => p.id)).size !== products.length) throw new Error('Duplicate product key or productId in cohort.');
  const groups = Map.groupBy(products, p => p.categoryId);
  for (const [id, group] of groups) { const expected = expectedCounts?.get(id) ?? 50; if (group.length !== expected || new Set(group.map(p => p.sampleRank)).size !== expected) throw new Error(`Category ${id} does not have exactly ${expected} distinct ranks.`); }
  if (expectedCounts && [...expectedCounts.keys()].some(id => !groups.has(id))) throw new Error('Collected category missing from cohort.');
}
function factNames(condition: any): string[] { return condition?.fact ? [condition.fact] : [...(condition?.all ?? []), ...(condition?.any ?? [])].flatMap(factNames); }
async function dictionary(products: Row[]): Promise<Row[]> {
  const items = new Map<string, Row>();
  for (const batch of HISTORICAL_RUNS) {
    const file = join(ROOT, 'outputs/product-governance', batch, 'inputs/brand-reference.json');
    if (!await exists(file)) continue;
    const data: Row = await read(file);
    for (const brand of data.items ?? []) {
      if (!brand.id || !brand.name) continue;
      const prev = items.get(brand.id);
      items.set(brand.id, { ...clone(brand), aliases: [...new Set([...(prev?.aliases ?? []), prev?.name, ...(brand.aliases ?? [])].filter(a => a && a !== brand.name))], sources: [...(prev?.sources ?? []), file] });
    }
  }
  for (const p of products) {
    if (!p.brandId || !p.brand || ['国产', '通用', '未知', '无', 'N/A', '其他', '其它', '无品牌'].includes(p.brand)) continue;
    const prev = items.get(p.brandId), name = prev?.name ?? p.brand;
    const aliases = [...(prev?.aliases ?? []), p.brand, p.esBrand?.internationalName, p.esBrand?.alias].flat().filter(a => a && a !== name);
    items.set(p.brandId, { ...prev, id: p.brandId, name, aliases: [...new Set(aliases)], sources: [...new Set([...(prev?.sources ?? []), p.inputProvenance.rawProduct])] });
  }
  return [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
}
const FIELD_SCHEMA = { value: '规范值；未知/冲突/不适用为null', status: 'filled|needs_evidence|conflict|enum_candidate|not_applicable', unit: '原明确单位或null', per: '原明确分母单位或null', evidenceId: '当前SKU提供的证据ID或null', quote: '该证据精确子串或null', reason: '简短证据判断与缺项原因', calculation: null, weightScope: null, declarationEvidence: null };
async function freezeCohort(cohort: 'historical' | 'new13', products: Row[], s: Row, sourceFiles: Row[]): Promise<void> {
  const sourceManifestPath = join(RUN, 'inputs/new-manifest.json');
  const sourceManifest: Row | null = cohort === 'new13' && await exists(sourceManifestPath) ? await read(sourceManifestPath) : null;
  const expected = cohort === 'historical' ? 400 : sourceManifest?.sampleSize ?? 650;
  if (products.length !== expected) throw new Error(`Expected ${expected} products for ${cohort}; found ${products.length}.`);
  uniqueProducts(products, sourceManifest ? new Map(sourceManifest.categories.map((c: Row) => [c.id, c.sampleSize])) : undefined);
  products.sort((a, b) => a.key.localeCompare(b.key));
  const dict = await dictionary(products);
  await frozenSave(join(RUN, 'inputs', `${cohort}-model-products.json`), products);
  const allCategories = s.categories.map((c: Row) => ({ id: c.id, name: c.name, path: c.path, boundary: c.boundary }));
  const batches: Row[] = [];
  for (const category of s.categories) {
    const ps = products.filter(p => p.categoryId === category.id);
    if (!ps.length) continue;
    const bindings = s.bindings.filter((b: Row) => b.categoryId === category.id);
    const attrs = bindings.map((b: Row) => ({ ...clone(s.definitions.find((d: Row) => d.id === b.attributeId)), ...clone(b) }));
    const groups = s.requirementGroups.filter((g: Row) => g.categoryId === category.id);
    const names = [...new Set([...bindings.flatMap((b: Row) => [...factNames(b.applicabilityCondition), ...factNames(b.requiredWhen)]), ...groups.flatMap((g: Row) => [...factNames(g.applicabilityCondition), ...g.paths.flatMap((p: Row) => factNames(p.applicabilityCondition))])])];
    for (let i = 0; i < ps.length; i += BATCH_SIZE) {
      const group = ps.slice(i, i + BATCH_SIZE);
      const prefix = group[0]!.key.split('-')[0];
      const id = `${cohort}-${prefix}-${String(i + 1).padStart(2, '0')}-${String(i + group.length).padStart(2, '0')}`;
      const candidates = [...new Map([...allCategories, ...group.flatMap(p => p.candidateCategories ?? [])].map((c: Row) => [c.id, c])).values()];
      const payload = {
        schema: 'all21-independent-product-review-v1', task: '逐件按冻结新版完整属性卡独立审归属、填写当前SKU并给出三值条件事实。',
        standardVersion: s.releaseId, standardHash: digest(s), category: clone(category), attributes: attrs, bindings: clone(bindings),
        requirementGroups: groups, conditionFactDefinitions: s.conditionFactDefinitions, requiredFactNames: names,
        requirednessContract: s.requirednessContract, crossFieldRules: s.crossFieldRules, revisionRules: s.revisionRules,
        dictionary: dict.map(({ id, name, aliases }) => ({ id, name, aliases })), candidateCategories: candidates, rules: RULES,
        products: group.map(p => ({ key: p.key, id: p.id, categoryId: p.categoryId, upstreamSku: p.upstreamSku, historicalSameProduct: p.historicalSameProduct, verifiedVisualEvidenceIds: p.verifiedVisualEvidenceIds, evidence: p.evidence.map((e: Row) => ({ id: e.id, productId: e.productId, kind: e.kind, text: e.text, source: e.source, sourceRef: e.sourceRef, scope: e.scope, imageSha256: e.imageSha256, historicalReviewRef: e.historicalReviewRef })) })),
        output: { products: [{ key: '本组key', category: { status: 'matched|wrong|uncertain', targetId: '真实候选ID或null', targetName: '类目名称或待核对象', targetConfirmed: false, reason: '逐件证据判断' }, fields: Object.fromEntries(bindings.map((b: Row) => [b.attributeId, FIELD_SCHEMA])), conditionFacts: [{ fact: 'requiredFactNames中的注册事实', value: null, status: 'known|unknown|conflict', evidenceId: null, quote: null }], reviewNotes: [] }] },
        calculationContract: { operations: ['divide', 'multiply', 'convert'], required: ['operation', 'inputs', 'formula', 'outputUnit'], inputs: '每个输入value/unit/scope/evidenceId/quote', scopeEvidence: '计算的当前SKU、同规格及包装层级精确证据；需换算时额外conversionEvidence/factor', noFabricatedSourceText: true },
        declarationEvidenceContract: '非null时为{evidenceId,quote}，定位同一原始质量声明并含数值和组成口径，不能用自造声明ID。',
      };
      await frozenSave(join(RUN, 'batches', `${id}.input.json`), payload);
      batches.push({ id, cohort, categoryId: category.id, keys: group.map(p => p.key), productIds: group.map(p => p.id), attributeIds: bindings.map((b: Row) => b.attributeId), requiredFactNames: names, hash: digest(payload), inputFile: `batches/${id}.input.json` });
    }
  }
  const core = { schema: 'all21-frozen-cohort-manifest-v1', runId: RUN_ID, cohort, standardHash: digest(s), productsHash: digest(products), dictionaryHash: digest(dict), inputHash: digest({ standardHash: digest(s), products }), sourceFiles, productCount: products.length, batchSize: BATCH_SIZE, requestedProducts: cohort === 'historical' ? 400 : 650, shortfall: (cohort === 'historical' ? 400 : 650) - products.length, shortfallSource: sourceManifest ? { file: sourceManifestPath, hash: digest(sourceManifest), categories: sourceManifest.categories.filter((c: Row) => c.shortfall > 0).map((c: Row) => ({ categoryId: c.id, name: c.name, requested: c.requested, availableSample: c.sampleSize, shortfall: c.shortfall, population: c.population })) } : null, batches };
  const path = join(RUN, 'manifests', cohort + '.json');
  if (await exists(path)) { const old: Row = await read(path); const immutableKeys = Object.keys(old).filter(k => k !== 'frozenAt'); if (immutableKeys.some(k => digest(old[k]) !== digest((core as Row)[k]))) throw new Error('Frozen cohort manifest differs ' + cohort); }
  else await save(path, { ...core, frozenAt: new Date().toISOString() });
  await rebuildCombined();
  console.log(JSON.stringify({ prepared: cohort, products: products.length, batches: batches.length, standardHash: digest(s), withTrustedVisual: products.filter(p => p.verifiedVisualEvidenceIds.length).length, trustedVisualRecords: products.flatMap(p => p.visualEvidenceRegistry).length, withJD: products.filter(p => p.evidence.some(isJd)).length }));
}
async function rebuildCombined(): Promise<void> {
  const products: Row[] = [], manifests: Row[] = [];
  for (const cohort of ['historical', 'new13']) {
    const file = join(RUN, 'manifests', cohort + '.json');
    if (!await exists(file)) continue;
    const manifest: Row = await read(file), ps: Row[] = await read(join(RUN, 'inputs', `${cohort}-model-products.json`));
    if (digest(ps) !== manifest.productsHash) throw new Error('Frozen products hash changed ' + cohort);
    manifests.push(manifest); products.push(...ps);
  }
  if (new Set(products.map(p => p.key)).size !== products.length || new Set(products.map(p => p.id)).size !== products.length) throw new Error('Cohort union has duplicate keys or product IDs.');
  products.sort((a, b) => a.key.localeCompare(b.key));
  await save(join(RUN, 'inputs/model-products.json'), products);
  await save(join(RUN, 'inputs/verified-visual-evidence.json'), { schema: 'all21-independent-visual-registry-v1', records: products.flatMap(p => p.visualEvidenceRegistry), policy: 'Only independently reviewed source records with attached original image sha256 are trusted. OCR and model assertions cannot register themselves.' });
  await save(join(RUN, 'inputs/brand-reference.json'), { source: 'Current source brand entities merged by stable ID; historical later reference supplies canonical name, older exact names preserved as aliases.', items: await dictionary(products) });
  await save(join(RUN, 'batch-manifest.json'), { schema: 'all21-cohort-union-v1', runId: RUN_ID, standardHash: manifests[0]?.standardHash, productsHash: digest(products), productCount: products.length, expectedProductCount: 1050, cohorts: manifests.map(m => ({ cohort: m.cohort, file: `manifests/${m.cohort}.json`, inputHash: m.inputHash, productCount: m.productCount, batchCount: m.batches.length })), batches: manifests.flatMap(m => m.batches) });
}
async function prepareHistorical(s: Row): Promise<void> {
  const products: Row[] = [], sourceFiles: Row[] = [];
  for (const batch of HISTORICAL_RUNS) {
    const base = join(ROOT, 'outputs/product-governance', batch), mp = join(base, 'inputs/model-products.json'), fp = join(base, 'analysis/final.json');
    const data: Row = await read(fp), final = arr(data), raw = await exists(mp) ? arr(await read(mp)) : final;
    sourceFiles.push({ batch, rawFile: mp, rawHash: digest(raw), finalEvidenceFile: fp, finalFileHash: digest(data), modelAnswersCopied: false });
    for (const p of raw) products.push(await prepareProduct(p, final.find(r => r.id === p.id), base, 'historical', batch, s));
  }
  await freezeCohort('historical', products, s, sourceFiles);
}
async function prepareNew(s: Row): Promise<void> {
  const choices = [join(RUN, 'inputs/new13/products.json'), join(RUN, 'inputs/new-products.json')];
  const file = (await Promise.all(choices.map(async p => await exists(p) ? p : null))).find(Boolean);
  if (!file) throw new Error('New13 products are not ready. Historical cohort is independently runnable.');
  const raw = arr(await read(file));
  const ocrChoices = [join(RUN, 'inputs/new13/image-ocr.json'), join(RUN, 'inputs/new-image-ocr.json'), join(RUN, 'inputs/image-ocr.json')];
  const oxFile = (await Promise.all(ocrChoices.map(async p => await exists(p) ? p : null))).find(Boolean);
  const ocrSource: any = oxFile ? await read(oxFile) : null;
  const ocr = ocrSource ? arr(ocrSource) : [];
  if (!ocrSource || ocrSource.status !== 'completed' || ocr.length !== raw.length) throw new Error('Freeze new13 only after the complete per-product OCR/image pass.');
  const historical = await exists(join(RUN, 'inputs/historical-model-products.json')) ? arr(await read(join(RUN, 'inputs/historical-model-products.json'))) : [];
  const oldCategories = new Set(historical.map(p => p.categoryId));
  if (raw.some(p => oldCategories.has(p.categoryId))) throw new Error('New13 source overlaps historical category scope.');
  const treeFile = join(ROOT, 'scratch-category-baseline-20261010/mapped-tree.json');
  const tree: Row = await read(treeFile), leaves: Row[] = tree.nodes.filter((n: Row) => n.isLeaf);
  const wideCandidates = [
    { id: '6356d37b-056b-4c89-9324-bbd5d590d6eb', trigger: /卫生巾|护垫|卫生棉|棉条/u, reason: '女性护理相关本体词命中；宽叶承接仍须逐件核对主体。' },
    { id: '463ae2dd-354b-4f05-aa8f-8e282864ca6f', trigger: /纸杯|塑料杯|一次性.*(?:杯|餐具|碗|盘|筷|吸管)|保鲜膜|保鲜袋/u, reason: '一次性杯具/餐用耗材词命中，V2宽叶候选；不得将商品专名误造为新节点。' },
    { id: '8e1d0430-00e2-4caa-b7d7-8dfa27ad8690', trigger: /纸杯|塑料杯|餐具|筷|饮水杯|咖啡杯/u, reason: '餐用主体词命中，须与一次性用品/厨房用具按用途比较。' },
    { id: '0419bb2e-dc02-48a6-bb9a-bb18d5f81065', trigger: /保鲜膜|保鲜袋|海绵擦|百洁|厨房|厨具/u, reason: '厨房相关主体词命中，宽叶不是默认兜底，专类存在时选专类。' },
    { id: 'c5559600-02c6-46ac-8f54-52ad20f37110', trigger: /毛巾|浴巾|擦脚巾|搓澡巾/u, reason: '毛巾类主体词命中；干一次性洗脸巾/浴巾用途与材料仍须核对。' },
  ];
  for (const spec of wideCandidates) if (!leaves.some(n => n.id === spec.id)) throw new Error('Reviewed broad V2 leaf missing ' + spec.id);
  const products: Row[] = [];
  for (const p of raw) {
    const text = `${p.title ?? ''} ${p.saleSpec ?? ''}`;
    const exact = leaves.filter(n => String(n.name).length >= 2 && String(n.name).split(/[\/、]/u).some(part => part.length >= 2 && text.includes(part))).sort((a, b) => b.name.length - a.name.length).slice(0, 24).map(n => ({ id: n.id, name: n.name, path: n.path, candidateReason: '标题/所选规格命中真实V2叶名称或其并列主体词；仅候选，不代表已确认归属。' }));
    const broad = wideCandidates.filter(c => c.trigger.test(text)).map(spec => { const n = leaves.find(n => n.id === spec.id)!; return { id: n.id, name: n.name, path: n.path, candidateReason: spec.reason }; });
    const binding = /装订|订书/u.test(text) ? leaves.filter(n => /装订|订书/u.test(n.name) && /^办公/u.test(n.path)).map(n => ({ id: n.id, name: n.name, path: n.path, candidateReason: '装订主体/耗材相关真实V2叶；设备本体与替换件需分别判断，不能仅凭设备名填兼容件。' })) : [];
    const enriched = { ...p, candidateCategories: [...new Map([...(p.candidateCategories ?? []), ...exact, ...broad, ...binding].map((c: Row) => [c.id, c])).values()] };
    products.push(await prepareProduct(enriched, undefined, RUN, 'new13', 'new13-es-20261019', s, ocr.find(x => (x.productId ?? x.id) === p.id)));
  }
  await freezeCohort('new13', products, s, [{ rawFile: file, rawHash: digest(raw), imageOcrFile: oxFile ?? null, imageOcrHash: oxFile ? digest(ocr) : null, candidateTreeFile: treeFile, candidateTreeHash: digest(tree) }]);
}

function contractIssues(content: any, batch: Row, input: Row): string[] {
  const issues: string[] = [];
  if (!Array.isArray(content?.products) || content.products.length !== batch.keys.length) return ['Product count differs from exact batch.'];
  const keys = content.products.map((p: Row) => p.key);
  if (new Set(keys).size !== keys.length || batch.keys.some((k: string) => !keys.includes(k))) issues.push('Product keys differ from exact batch.');
  for (const product of content.products) {
    if (!plain(product.category) || !['matched', 'wrong', 'uncertain'].includes(product.category.status) || typeof product.category.reason !== 'string' || typeof product.category.targetConfirmed !== 'boolean') { issues.push(`${product.key}: category shape invalid.`); continue; }
    if (!plain(product.fields) || !Array.isArray(product.conditionFacts)) { issues.push(`${product.key}: fields/conditionFacts missing.`); continue; }
    if (product.category.status !== 'matched') { if (Object.keys(product.fields).length) issues.push(`${product.key}: wrong/uncertain has source-category fields.`); continue; }
    if (product.category.targetId !== batch.categoryId || !product.category.targetConfirmed) issues.push(`${product.key}: matched target is not confirmed current category.`);
    if (Object.keys(product.fields).length !== batch.attributeIds.length || batch.attributeIds.some((id: string) => !Object.hasOwn(product.fields, id))) issues.push(`${product.key}: matched field coverage incomplete.`);
    const source = input.products.find((p: Row) => p.key === product.key);
    for (const [id, claim] of Object.entries(product.fields) as Array<[string, any]>) {
      if (!plain(claim) || FIELD_PROPERTIES.some(k => !Object.hasOwn(claim, k)) || !FIELD_STATUSES.includes(claim.status)) { issues.push(`${product.key}:${id}: full field object invalid.`); continue; }
      if (typeof claim.reason !== 'string') issues.push(`${product.key}:${id}: reason missing.`);
      if (['needs_evidence', 'conflict', 'not_applicable'].includes(claim.status) && claim.value !== null) issues.push(`${product.key}:${id}: unresolved formal value must be null.`);
      if (['filled', 'enum_candidate'].includes(claim.status)) {
        if (claim.value === null || claim.value === undefined || typeof claim.evidenceId !== 'string' || typeof claim.quote !== 'string' || !claim.quote.trim()) issues.push(`${product.key}:${id}: positive claim lacks value/exact evidence.`);
        else if (!source?.evidence.some((e: Row) => e.id === claim.evidenceId && e.text.includes(claim.quote))) issues.push(`${product.key}:${id}: quote is not in current SKU evidence.`);
      }
    }
    const facts = product.conditionFacts.map((f: Row) => f.fact);
    if (batch.requiredFactNames.some((name: string) => !facts.includes(name))) issues.push(`${product.key}: required condition fact states omitted.`);
    for (const f of product.conditionFacts) if (!input.conditionFactDefinitions.some((d: Row) => d.fact === f.fact) || ![true, false, null].includes(f.value) || !['known', 'unknown', 'conflict'].includes(f.status)) issues.push(`${product.key}: condition fact object invalid.`);
  }
  return issues;
}
// Complete independent opinions may be wrong. Preserve semantic mistakes for Codex;
// do not spend another call merely to make a model give a more agreeable answer.
function hardContractIssues(issues: string[]): string[] {
  return issues.filter(issue => !/unresolved formal value must be null|positive claim lacks value\/exact evidence|quote is not in current SKU evidence|matched target is not confirmed current category|condition fact object invalid/u.test(issue));
}
function recoverStructure(raw: any, input: Row): { content: any; recovery: Row | null } {
  let content = clone(raw); const steps: Row[] = [];
  if (Array.isArray(content)) { content = { products: content }; steps.push({ operation: 'wrap_bare_product_array', valueEdits: false }); }
  else if (plain(content) && !Array.isArray(content.products) && plain(content.output) && Array.isArray(content.output.products)) { content = content.output; steps.push({ operation: 'unwrap_output_object', valueEdits: false }); }
  if (Array.isArray(content?.products)) for (const product of content.products) {
    if (!plain(product.fields)) continue;
    for (const [id, claim] of Object.entries(product.fields) as Array<[string, any]>) {
      if (!plain(claim)) continue;
      const d = input.attributes?.find((a: Row) => a.id === id), nullable = ['calculation', 'declarationEvidence'];
      if (id !== 'paper.nominal_mass') nullable.push('weightScope');
      if (['needs_evidence', 'conflict', 'not_applicable'].includes(claim.status) || d && d.type !== '数值' && !/^dimensions/u.test(d.operator ?? '') && d.semantic !== 'quantity') nullable.push('unit', 'per');
      const added: string[] = [];
      for (const field of nullable) if (!Object.hasOwn(claim, field)) { claim[field] = null; added.push(field); }
      if (added.length) steps.push({ operation: 'explicit_null_for_absent_optional_metadata', key: product.key, attributeId: id, fields: added });
    }
  }
  return { content, recovery: steps.length ? { steps, originalContentHash: digest(raw), normalizedContentHash: digest(content), unchanged: ['value', 'status', 'evidenceId', 'quote', 'reason'], fabricatedProductsOrFields: false } : null };
}
async function recoverRecordedOutputs(): Promise<Row> {
  const files = (await readdir(join(RUN, 'models'))).filter(file => /^validate21-.+-(?:deepseek|kimi|glm|qwen)\.json$/u.test(file));
  const recovered: Row[] = [], unresolved: Row[] = [];
  for (const file of files) {
    const source: Row = await read(join(RUN, 'models', file));
    let syntaxRecovery: Row | null = null;
    if (!source.content && ['opencode_go','commandcode'].includes(source.model?.adapter) && source.stage) {
      // The legacy invoke helper selects a CLI raw suffix by logical id. Recover Go/Kimi
      // from its actual adapter suffix without editing the original terminal model record.
      const rawPath = join(RUN, 'models', `${source.stage}-${source.model.id}.raw.json`);
      if (await exists(rawPath)) try {
        source.content = parseObject((source.model.adapter === 'commandcode' ? parseCommandCodeResponse : parseOpenCodeGoResponse)(source.model.model, await read(rawPath)).text);
        syntaxRecovery = { method: 'Raw Go response JSON parsed with exact requested model identity; original terminal unchanged.', rawPath };
      } catch { /* Truncated or invalid output remains a real missing opinion. */ }
    }
    if (!source.content || !source.stage || !source.model?.id) continue;
    const requestFile = join(RUN, 'models', `${source.stage}-${source.model.id}.request.json`);
    if (!await exists(requestFile)) continue;
    const request: Row = await read(requestFile), input = request.payload;
    const batch: Row = { id: source.stage.slice('validate21-'.length), categoryId: input.category.id, keys: input.products.map((p: Row) => p.key), attributeIds: input.bindings.map((b: Row) => b.attributeId), requiredFactNames: input.requiredFactNames };
    const normalizedFile = join(RUN, 'normalized', `${source.stage}-${source.model.id}.json`);
    if (await exists(normalizedFile)) { const previous: Row = await read(normalizedFile); if (!contractIssues(previous.content, batch, input).length) continue; }
    const fixed = recoverStructure(source.content, input), fullIssues = contractIssues(fixed.content, batch, input), hardIssues = hardContractIssues(fullIssues);
    if (!Array.isArray(fixed.content?.products)) { unresolved.push({ stage: source.stage, model: source.model.id, keys: batch.keys, issues: fullIssues }); continue; }
    const accepted = hardIssues.length ? fixed.content.products.filter((p: Row) => batch.keys.includes(p.key) && !hardContractIssues(contractIssues({ products: [p] }, { ...batch, keys: [p.key] }, input)).length) : fixed.content.products;
    const acceptedKeys = new Set(accepted.map((p: Row) => p.key));
    if (acceptedKeys.size !== accepted.length) { unresolved.push({ stage: source.stage, model: source.model.id, keys: batch.keys, issues: ['Duplicate product keys in attempted recovery.'] }); continue; }
    if (accepted.length) {
      const stage = source.stage + '-contract-recovered', path = join(RUN, 'normalized', `${stage}-${source.model.id}.json`);
      const normalized = { model: source.model.id, modelIdentity: { provider: source.model.provider, adapter: source.model.adapter, requestedModel: source.model.model, responseModel: source.responseModel ?? null }, stage, originalStage: source.stage, sourceRecord: `models/${file}`, originalStatus: source.status, requestHash: source.requestHash, syntaxRecovery, structuralRecovery: fixed.recovery, contractWarnings: fullIssues.filter(issue => !hardIssues.includes(issue)), contractRecovery: { acceptedKeys: [...acceptedKeys], expectedKeys: batch.keys, unresolvedKeys: batch.keys.filter((k: string) => !acceptedKeys.has(k)), completeProductsOnly: true, omittedStructurallyIncompleteProductsWithoutEditingThem: hardIssues.length > 0, sourceContractIssues: fullIssues, hardContractIssues: hardIssues, semanticMistakesRemainForCodex: true }, content: { ...fixed.content, products: accepted } };
      if (!await exists(path) || digest(await read(path)) !== digest(normalized)) await save(path, normalized);
      recovered.push({ model: source.model.id, stage: source.stage, normalizedFile: `normalized/${stage}-${source.model.id}.json`, keys: [...acceptedKeys], fullBatch: hardIssues.length === 0, contractWarnings: fullIssues.filter(issue => !hardIssues.includes(issue)), structuralSteps: fixed.recovery?.steps ?? [], omittedKeys: batch.keys.filter((k: string) => !acceptedKeys.has(k)) });
    }
    if (hardIssues.length) unresolved.push({ model: source.model.id, stage: source.stage, keys: batch.keys.filter((k: string) => !acceptedKeys.has(k)), issues: hardIssues });
  }
  const result = { schema: 'all21-mechanical-protocol-recovery-v1', checkedAt: new Date().toISOString(), policy: 'Only output envelope normalization, explicit null optional metadata, or projection of already complete products. No edits to value/status/evidenceId/quote/reason. Original records retained.', recovered, unresolved };
  await save(join(RUN, 'analysis/protocol-recovery.json'), result);
  return result;
}
async function coverageStatus(): Promise<Row> {
  const products: Row[] = await read(join(RUN, 'inputs/model-products.json'));
  const normalized = (await readdir(join(RUN, 'normalized'))).filter(file => file.endsWith('.json'));
  const modelFiles = await readdir(join(RUN, 'models')), modelFileSet = new Set(modelFiles);
  const state = new Map(MODELS.map(m => [m.id, { covered: new Set<string>(), attempted: new Set<string>(), inFlight: new Set<string>(), attempts: 0, unknownRequests: [] as Row[] }]));
  for (const file of normalized) {
    const r: Row = await read(join(RUN, 'normalized', file)), model = state.get(r.model);
    if (!model || !Array.isArray(r.content?.products)) continue;
    for (const p of r.content.products) { model.covered.add(p.key); model.attempts++; }
  }
  for (const file of modelFiles.filter(f => /^validate21-.+-(?:deepseek|kimi|glm|qwen)\.request\.json$/u.test(f))) {
    const r: Row = await read(join(RUN, 'models', file)), model = state.get(r.config?.id);
    if (!model) continue;
    const keys = (r.payload.products ?? []).map((p: Row) => p.key);
    keys.forEach((k: string) => model.attempted.add(k));
    if (!modelFileSet.has(file.replace(/\.request\.json$/u, '.json'))) {
      keys.forEach((k: string) => model.inFlight.add(k));
      model.unknownRequests.push({ requestFile: `models/${file}`, keys, requestHash: r.requestHash, doNotResend: true });
    }
  }
  const models: Row = {};
  for (const config of MODELS) {
    const record = state.get(config.id)!, missing = products.filter(p => !record.covered.has(p.key)).map(p => p.key);
    models[config.id] = { productsWithResponse: products.length - missing.length, expected: products.length, attempts: record.attempts, missingKeys: missing, inFlightKeys: [...record.inFlight], terminalGapKeys: missing.filter(k => record.attempted.has(k) && !record.inFlight.has(k)), notRequestedKeys: missing.filter(k => !record.attempted.has(k)), unknownRequests: record.unknownRequests, ledger: await exists(join(RUN, 'models', `ledger-${config.id}.json`)) ? await read(join(RUN, 'models', `ledger-${config.id}.json`)) : null };
  }
  const status = { schema: 'all21-model-coverage-v1', checkedAt: new Date().toISOString(), expectedActualProducts: products.length, plannedProducts: 1050, sourceShortfall: 1050 - products.length, models, policy: 'Coverage is an independently returned complete product object, never a correctness claim. Missing keys with requests but no terminal record must not be resent.' };
  await save(join(RUN, 'analysis/model-coverage.json'), status);
  return status;
}

// A new audited stage is required when a terminal batch has a genuine coverage gap.
// Existing successful opinions and unresolved provider requests are never resubmitted.
async function runMissing(modelId: string, round: string, callLimit: number, route?: string, maxBatches = Infinity, productsPerCall = BATCH_SIZE): Promise<void> {
  const base = MODELS.find(m => m.id === modelId);
  if (!base || modelId === 'deepseek') throw new Error('Only unfinished subscription models use missing recovery.');
  if (!Number.isInteger(productsPerCall) || productsPerCall < 1 || productsPerCall > BATCH_SIZE) throw new Error('Invalid products-per-call; must be 1 through frozen batch size.');
  if (!/^[a-z0-9-]+$/u.test(round) || !Number.isInteger(callLimit) || callLimit < base.maxCalls) throw new Error('Invalid recovery round or internal call guard.');
  const running = (await readdir(join(RUN, 'models'))).filter(f => f.startsWith(`runner-${modelId}`) && f.endsWith('.lock'));
  if (running.length) throw new Error(`Model queues still active; wait for them before precise recovery: ${running.join(', ')}`);
  if(route && !(route==='go-kimi-k3'&&modelId==='kimi') && !(route==='commandcode'&&Object.hasOwn(COMMANDCODE_MODELS,modelId))) throw new Error('Unverified provider/model route');
  const usesOpenCode = route === 'go-kimi-k3' || (!route && base.adapter === 'opencode_go');
  const resumePlanPath = join(RUN, 'analysis/provider-resume-plan.json');
  if ((usesOpenCode || route === 'commandcode') && await exists(resumePlanPath)) {
    const resume: Row = await read(resumePlanPath);
    const provider = usesOpenCode ? 'opencode-go' : 'commandcode';
    const fallback = usesOpenCode ? resume.previousOpenCodeWindow?.earliestRetryAt ?? resume.earliestRetryAt : undefined;
    const notBefore = Date.parse(resume.providerWindows?.[provider]?.notBefore ?? fallback ?? '');
    if (Number.isFinite(notBefore) && Date.now() < notBefore) throw new Error(`${provider} cooldown active until ${new Date(notBefore).toISOString()}; no request sent.`);
  }
  const lock = join(RUN, 'models', `runner-${modelId}-missing-${round}.lock`);
  await mkdir(lock); await save(join(lock, 'owner.json'), { pid: process.pid, model: modelId, startedAt: new Date().toISOString(), reason: 'root authorized precise missing-only recovery after terminal records' });
  if (route === 'go-kimi-k3') {
    const probe: Row = await read(join(RUN, 'analysis/kimi-go-probe.json'));
    if (probe.httpStatus !== 200 || probe.requestedModel !== 'kimi-k3' || probe.responseModel !== 'kimi-k3' || probe.endpoint !== 'https://opencode.ai/inference/go/openai/v1/chat/completions' || probe.consoleFallback !== false) throw new Error('Identity-checked Go subscription probe required.');
  }
  const model = { ...(route === 'go-kimi-k3' ? KIMI_GO_RECOVERY_MODEL : base),
    ...(route === 'commandcode' ? {adapter:'commandcode' as const,provider:'commandcode',model:COMMANDCODE_MODELS[modelId as keyof typeof COMMANDCODE_MODELS],timeoutMs:600000} : {}), maxCalls: callLimit };
  let stop = false, transportFailures = 0;
  const results: Row[] = [];
  try {
    await recoverRecordedOutputs();
    const coverage = await coverageStatus(), state = coverage.models[modelId];
    const missing = new Set<string>(state.missingKeys.filter((k: string) => !state.inFlightKeys.includes(k)));
    const manifest: Row = await read(join(RUN, 'batch-manifest.json'));
    const planned: Row[] = [];
    // Round-robin categories gives each Codex reviewer evidence while any long tail runs.
    const categories: string[] = [...new Set<string>(manifest.batches.map((b: Row) => b.categoryId))];
    const ordered = [...manifest.batches].sort((a: Row, b: Row) => Number(a.keys[0].slice(4)) - Number(b.keys[0].slice(4)) || categories.indexOf(a.categoryId) - categories.indexOf(b.categoryId));
    for (const original of ordered) {
      const keys = original.keys.filter((k: string) => missing.has(k));
      if (!keys.length) continue;
      const originalInput: Row = await read(join(RUN, original.inputFile));
      for (let offset = 0; offset < keys.length; offset += productsPerCall) {
        const subset = keys.slice(offset, offset + productsPerCall);
        const suffix = productsPerCall < BATCH_SIZE ? `-part-${Math.floor(offset / productsPerCall) + 1}` : '';
        const input = { ...originalInput, products: originalInput.products.filter((p: Row) => subset.includes(p.key)) };
        const stage = `validate21-missing-${round}-${original.id}${suffix}`;
        const inputFile = `batches/missing-${round}-${modelId}-${original.id}${suffix}.input.json`;
        await frozenSave(join(RUN, inputFile), input);
        planned.push({ ...original, keys: subset, stage, inputFile, hash: digest(input), originalInputFile: original.inputFile });
        if (planned.length >= maxBatches) break;
      }
      if (planned.length >= maxBatches) break;
    }
    const plan = { schema: 'all21-missing-only-recovery-v1', model: modelId, modelIdentity: { provider: model.provider, adapter: model.adapter, requestedModel: model.model, family: model.family, route: route ?? 'original' }, round, standardHash: manifest.standardHash, callLimit, expectedKeys: planned.flatMap(b => b.keys), excludedInFlightKeys: state.inFlightKeys, batches: planned, policy: 'Only structurally missing independent opinions. Existing semantic mistakes remain unchanged for Codex. No automatic per-batch retry.' };
    await frozenSave(join(RUN, 'manifests', `missing-${round}-${modelId}.json`), plan);
    let next = 0;
    const concurrency = Math.min(CONCURRENCY[modelId] ?? 3, route === 'commandcode' ? 4 : route ? 8 : 4);
    await Promise.all(Array.from({ length: Math.min(concurrency, planned.length) }, async () => {
      while (!stop && next < planned.length) {
        const batch = planned[next++]!, input: Row = await read(join(RUN, batch.inputFile));
        let fixed: ReturnType<typeof recoverStructure> | null = null;
        const issues: string[] = [];
        try {
          const response = await invoke(batch.stage, model, input, content => {
            fixed = recoverStructure(content, input); issues.splice(0, issues.length, ...contractIssues(fixed.content, batch, input));
            return hardContractIssues(issues).length === 0;
          }, RUN);
          const normalized = fixed as ReturnType<typeof recoverStructure> | null;
          if (response && normalized) await save(join(RUN, 'normalized', `${batch.stage}-${modelId}.json`), { ...response, modelIdentity: { provider: model.provider, adapter: model.adapter, requestedModel: model.model }, content: normalized.content, structuralRecovery: normalized.recovery, contractWarnings: issues });
          const record: Row = await read(join(RUN, 'models', `${batch.stage}-${modelId}.json`));
          if (record.status === 'failed' && !record.content) {
            transportFailures++;
            if (transportFailures >= 3 || /usage limit|quota|429|403|auth_error|调用次数|预算/iu.test(record.error ?? '')) stop = true;
          } else transportFailures = 0;
          results.push({ stage: batch.stage, keys: batch.keys, status: record.status, normalized: !!response, sourceRecord: `models/${batch.stage}-${modelId}.json`, contractWarnings: issues.filter(issue => !hardContractIssues(issues).includes(issue)), hardContractIssues: hardContractIssues(issues), error: record.error ?? null });
          await save(join(RUN, 'validation', `${batch.stage}-${modelId}.contract.json`), results.at(-1));
        } catch (error) { stop = true; results.push({ stage: batch.stage, keys: batch.keys, status: 'scheduling_stopped', error: String(error), retryAllowed: false }); }
        await save(join(RUN, 'analysis', `missing-${round}-${modelId}-status.json`), { model: modelId, round, updatedAt: new Date().toISOString(), stop, scheduled: next, expectedBatches: planned.length, results });
      }
    }));
    await recoverRecordedOutputs(); const final = await coverageStatus();
    console.log(JSON.stringify({ model: modelId, round, stopped: stop, expectedBatches: planned.length, results: results.length, covered: final.models[modelId].productsWithResponse, missing: final.models[modelId].missingKeys.length, inFlight: final.models[modelId].inFlightKeys.length, ledger: final.models[modelId].ledger }));
    if (stop || final.models[modelId].missingKeys.length) process.exitCode = 1;
  } finally { await rm(lock, { recursive: true }); }
}
async function runModel(modelId: string, cohort: string, limit: number, only?: string, accelerating = false, priorityOrder?: string[]): Promise<void> {
  const model = MODELS.find(m => m.id === modelId); if (!model) throw new Error('Unknown configured model ' + modelId);
  const manifest: Row = await read(join(RUN, 'batch-manifest.json'));
  const frozen: Row = await read(join(RUN, 'design/standard.json'));
  if (digest(frozen) !== manifest.standardHash) throw new Error('Frozen standard mismatch.');
  const priority = new Set(frozen.categories.slice(14).map((c: Row) => c.id));
  let candidates = manifest.batches.filter((b: Row) => (cohort === 'all' || b.cohort === cohort) && (!only || b.id.startsWith(only))).sort((a: Row, b: Row) => Number(priority.has(b.categoryId)) - Number(priority.has(a.categoryId)) || a.id.localeCompare(b.id));
  const untouchedBatches = async (): Promise<Row[]> => { const files = new Set(await readdir(join(RUN, 'models'))); return manifest.batches.filter((b: Row) => !files.has(`validate21-${b.id}-${modelId}.request.json`) && !files.has(`validate21-${b.id}-${modelId}.json`)); };
  if (accelerating) { const untouched = new Set((await untouchedBatches()).map(b => b.id)); candidates = candidates.filter((b: Row) => untouched.has(b.id)).reverse(); }
  if (priorityOrder) {
    const untouched = new Set((await untouchedBatches()).map(b => b.id));
    const index = (b: Row) => priorityOrder.findIndex(prefix => b.id === prefix || b.keys[0]?.startsWith(prefix + '-'));
    candidates = candidates.filter((b: Row) => untouched.has(b.id) && index(b) >= 0).sort((a: Row, b: Row) => index(a) - index(b) || a.id.localeCompare(b.id));
  }
  const batches = candidates.slice(0, limit);
  const suffix = priorityOrder ? '-priority' : accelerating ? '-tail-accelerator' : only ? '-only-' + only : '';
  const lock = join(RUN, 'models', `runner-${modelId}-${cohort}${suffix}.lock`); await mkdir(join(RUN, 'models'), { recursive: true });
  try { await mkdir(lock); } catch { throw new Error('Model runner already active or state unknown: ' + lock); }
  await save(join(lock, 'owner.json'), { pid: process.pid, model: modelId, startedAt: new Date().toISOString(), batchIds: batches.map((b: Row) => b.id) });
  let next = 0, completed = 0, stopScheduling = false; const failures: Row[] = [], repairs: Row[] = [], skippedInFlight: Row[] = [];
  const startedAt = new Date().toISOString();
  const statusPath = join(RUN, 'models', `${modelId}-${cohort}${Number.isFinite(limit) ? '-limit' + limit : ''}${suffix}-run-status.json`);
  async function acquireSlot(): Promise<string> {
    const folder = join(RUN, 'models', `slots-${modelId}`); await mkdir(folder, { recursive: true });
    while (true) {
      // Previously launched runners keep their requests alive. Reserve their known worker count
      // while new cohort workers share the remaining root-authorized slots.
      const legacyLock = join(RUN, 'models', `runner-${modelId}.lock/owner.json`);
      let legacyWorkers = 0;
      if (await exists(legacyLock)) { const legacy: Row = await read(legacyLock); legacyWorkers = Math.min(legacy.batchIds.length, modelId === 'kimi' ? 4 : 3); }
      const runtimePath = join(RUN, 'models/runtime-concurrency.json');
      const runtime: Row = await exists(runtimePath) ? await read(runtimePath) : {};
      const cap = Math.min(CONCURRENCY[modelId] ?? 3, Number(priorityOrder ? runtime.priorityCaps?.[modelId] ?? CONCURRENCY[modelId] ?? 3 : runtime[modelId] ?? CONCURRENCY[modelId] ?? 3));
      const floor = priorityOrder ? Math.max(legacyWorkers, ({ kimi: 8, glm: 6, qwen: 6, deepseek: 4 } as Record<string, number>)[modelId] ?? 0) : legacyWorkers;
      for (let slot = floor; slot < cap; slot++) {
        const path = join(folder, String(slot));
        try { await mkdir(path); await save(join(path, 'owner.json'), { pid: process.pid, cohort, acquiredAt: new Date().toISOString() }); return path; }
        catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  async function one(batch: Row, input: Row, stage: string): Promise<boolean> {
    const issues: string[] = [];
    const slot = await acquireSlot();
    try {
      let accepted: ReturnType<typeof recoverStructure> | null = null;
      const result = await invoke(stage, model!, input, content => { accepted = recoverStructure(content, input); issues.splice(0, issues.length, ...contractIssues(accepted.content, batch, input)); return hardContractIssues(issues).length === 0; }, RUN);
      const fixed = accepted as ReturnType<typeof recoverStructure> | null;
      if (result && fixed && (fixed.recovery || issues.length)) await save(join(RUN, 'normalized', `${stage}-${modelId}.json`), { ...result, content: fixed.content, structuralRecovery: fixed.recovery, contractWarnings: issues });
      await save(join(RUN, 'validation', `${stage}-${modelId}.contract.json`), { stage, model: modelId, batchId: batch.id, keys: batch.keys, passed: !!result, issues: hardContractIssues(issues), contractWarnings: issues.filter(issue => !hardContractIssues(issues).includes(issue)), sourceRecord: `models/${stage}-${modelId}.json` });
      return !!result;
    } finally { await rm(slot, { recursive: true }); }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY[modelId] ?? 3, batches.length) }, async () => {
      while (next < batches.length && !stopScheduling) {
        if (accelerating && (await untouchedBatches()).length <= 2 * (CONCURRENCY[modelId] ?? 3)) { stopScheduling = true; break; }
        const batch: Row = batches[next++]!, input: Row = await read(join(RUN, batch.inputFile));
        if (digest(input) !== batch.hash) throw new Error('Frozen payload changed ' + batch.id);
        const stage = 'validate21-' + batch.id;
        try {
          if (await one(batch, input, stage)) { completed++; continue; }
          // Only terminal recorded results may be repaired; a request without its result is never resent.
          if (!await exists(join(RUN, 'models', `${stage}-${modelId}.json`))) { failures.push({ batchId: batch.id, stage, keys: batch.keys, type: 'unknown_in_flight', retryAllowed: false }); continue; }
          const failedKeys: string[] = [];
          for (let i = 0; i < input.products.length; i += 2) {
            const products = input.products.slice(i, i + 2), repairStage = `${stage}-repair-small-${i / 2 + 1}`;
            const subset = { ...batch, keys: products.map((p: Row) => p.key) }, payload = { ...input, products, repair: '前次请求已终态且结构/覆盖失败；此次只补本组明确key，不引用前次答案。保留完整fields对象。' };
            try { if (!await one(subset, payload, repairStage)) failedKeys.push(...subset.keys); else repairs.push({ originalStage: stage, stage: repairStage, keys: subset.keys }); }
            catch (error) { failedKeys.push(...subset.keys); failures.push({ batchId: batch.id, stage: repairStage, keys: subset.keys, type: 'repair_exception_or_unknown', error: String(error), retryAllowed: false }); }
          }
          if (failedKeys.length) failures.push({ batchId: batch.id, stage, keys: [...new Set(failedKeys)], type: 'terminal_repair_failure', retryAllowed: true });
          else completed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const unknown = /已有请求但结果未知|already active|state unknown/u.test(message);
          if (unknown && accelerating) { skippedInFlight.push({ batchId: batch.id, stage, keys: batch.keys, reason: 'The primary runner acquired this request; no second provider call was issued.' }); continue; }
          failures.push({ batchId: batch.id, stage, keys: batch.keys, type: unknown ? 'unknown_in_flight' : 'exception', error: message, retryAllowed: !unknown });
          console.log(JSON.stringify({ model: modelId, batch: batch.id, attention: message }));
          if (/预算|调用次数/u.test(message)) { next = batches.length; break; }
        } finally {
          await save(statusPath, { model: modelId, cohort, accelerating, state: 'running', startedAt, updatedAt: new Date().toISOString(), expected: batches.length, scheduled: next, completed, repairs, failures, skippedInFlight });
        }
      }
    }));
    await save(statusPath, { model: modelId, cohort, accelerating, state: failures.length ? 'needs_attention' : stopScheduling ? 'primary_finishing_safe_window' : 'completed', startedAt, completedAt: new Date().toISOString(), expected: batches.length, scheduled: next, completed, repairs, failures, skippedInFlight, stoppedAtSafetyWindow: stopScheduling });
    const ledger = await exists(join(RUN, 'models', `ledger-${modelId}.json`)) ? await read(join(RUN, 'models', `ledger-${modelId}.json`)) : null;
    console.log(JSON.stringify({ model: modelId, cohort, completed, expected: batches.length, failures: failures.length, repairs: repairs.length, ledger }));
    if (failures.length) process.exitCode = 1;
  } finally { await rm(lock, { recursive: true }); }
}

const mode = process.argv[2] ?? 'prepare';
if (mode === 'prepare') {
  const cohort = process.argv[3] ?? 'historical', s = await standard();
  if (cohort === 'historical' || cohort === 'all') await prepareHistorical(s);
  if (cohort === 'new13' || cohort === 'all') await prepareNew(s);
} else if (mode === 'run') {
  const model = process.argv[3] ?? 'all', cohort = process.argv[4] ?? 'all';
  const limitArg = process.argv.find(a => a.startsWith('--limit=')), onlyArg = process.argv.find(a => a.startsWith('--only='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  if (!(limit > 0)) throw new Error('limit must be positive.');
  if (model === 'all') await Promise.all(MODELS.map(m => runModel(m.id, cohort, limit, onlyArg?.slice(7))));
  else await runModel(model, cohort, limit, onlyArg?.slice(7));
} else if (mode === 'accelerate') {
  const model = process.argv[3];
  if (!model || model === 'deepseek') throw new Error('Acceleration is for an unfinished subscription model; completed DS is not reissued.');
  const runtimePath = join(RUN, 'models/runtime-concurrency.json');
  if (!await exists(runtimePath)) await save(runtimePath, { ...CONCURRENCY, authority: 'root authorized controlled throughput increase; existing in-flight requests retained' });
  await runModel(model, 'all', Infinity, undefined, true);
} else if (mode === 'prioritize') {
  const model = process.argv[3];
  if (!model || !['kimi', 'glm', 'qwen'].includes(model)) throw new Error('Priority scheduling targets an unfinished subscription model.');
  const runtimePath = join(RUN, 'models/runtime-concurrency.json');
  const previous: Row = await exists(runtimePath) ? await read(runtimePath) : { ...CONCURRENCY };
  await save(runtimePath, { ...previous, [model]: 0, priorityCaps: { ...previous.priorityCaps, [model]: CONCURRENCY[model] }, priorityReason: 'Root requested earliest untouched C05 then collector300; tail helpers pause only at request boundaries.' });
  try { await runModel(model, 'all', Infinity, undefined, false, ['new13-C15-01-05', 'C05', 'C08', 'C10', 'C11', 'C12', 'C13']); }
  finally { const latest: Row = await read(runtimePath); await save(runtimePath, { ...latest, [model]: CONCURRENCY[model], priorityCompletedFor: [...new Set([...(latest.priorityCompletedFor ?? []), model])] }); }
} else if (mode === 'recover') {
  const watch = process.argv.includes('--watch');
  do {
    const result = await recoverRecordedOutputs();
    const coverage = await coverageStatus();
    console.log(JSON.stringify({ recoveredAttempts: result.recovered.length, unresolvedAttempts: result.unresolved.length, coverage: Object.fromEntries(Object.entries(coverage.models).map(([id, r]: [string, any]) => [id, { covered: r.productsWithResponse, terminalGaps: r.terminalGapKeys.length, inFlight: r.inFlightKeys.length }])) }));
    if (!watch || !(await readdir(join(RUN, 'models'))).some(file => /^runner-.+\.lock$/u.test(file))) break;
    await new Promise(resolve => setTimeout(resolve, 15000));
  } while (true);
} else if (mode === 'status') {
  const status = await coverageStatus();
  console.log(JSON.stringify({ expected: status.expectedActualProducts, models: Object.fromEntries(Object.entries(status.models).map(([id, r]: [string, any]) => [id, { covered: r.productsWithResponse, terminalGaps: r.terminalGapKeys.length, inFlight: r.inFlightKeys.length, ledger: r.ledger }])) }));
} else if (mode === 'recover-missing') {
  const model = process.argv[3] ?? '', roundArg = process.argv.find(a => a.startsWith('--round=')), guardArg = process.argv.find(a => a.startsWith('--call-limit=')), routeArg = process.argv.find(a => a.startsWith('--route=')), limitArg = process.argv.find(a => a.startsWith('--limit=')), sizeArg = process.argv.find(a => a.startsWith('--products-per-call='));
  await runMissing(model, roundArg?.slice(8) ?? 'r01', Number(guardArg?.slice(13) ?? 450), routeArg?.slice(8), limitArg ? Number(limitArg.slice(8)) : Infinity, sizeArg ? Number(sizeArg.slice('--products-per-call='.length)) : BATCH_SIZE);
} else throw new Error('Use prepare/run/accelerate/prioritize, recover [--watch], status, or recover-missing MODEL --round=r01 --call-limit=450.');
