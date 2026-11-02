// Provenance is independent of extraction/normalization method. A web-backed
// inference remains a web source; an API record does not become one by having a URL.
import {createHash} from 'node:crypto';
const text = value => typeof value === 'string' ? value.trim() : '';

export const SKU_SOURCE_LABELS = Object.freeze(['商品文本', '图片识别', '网络提取', '京东VOP']);
const sourceKinds = new Map([
  ...['es', 'summary', 'management', 'product_text'].map(kind => [kind, '商品文本']),
  ...['image', 'image_ocr', 'image_visual', 'user_image_ocr', 'user_image_manual_observation'].map(kind => [kind, '图片识别']),
  ['web', '网络提取'],
  ...['vop', 'jd_vop', 'jdvop'].map(kind => [kind, '京东VOP']),
]);

/** Only sources actually cited for a proposed value. SKU upstream is not evidence provenance. */
export function skuExtractionSources(row, sources) {
  if (row.status !== 'proposed') return [];
  const labels = new Set();
  for (const reference of row.evidence ?? []) {
    const source = sources.get(reference.sourceId);
    if (!source) throw Error(`Missing evidence source: ${reference.sourceId}`);
    const label = sourceKinds.get(source.kind);
    if (!label) throw Error(`Unmapped evidence source kind: ${source.kind}`);
    if (!['available', 'truncated'].includes(source.readState) || !text(source.text)) {
      throw Error(`Uninterpreted evidence source: ${reference.sourceId}`);
    }
    labels.add(label);
    if (/ocr|visual/.test(text(source.extractionMethod))) labels.add('图片识别');
  }
  if (!labels.size) throw Error(`Proposed value has no source: ${row.skuId}/${row.attributeKey}`);
  return SKU_SOURCE_LABELS.filter(label => labels.has(label));
}

const priority = ['商品文本', '京东VOP', '网络提取', '图片识别'];
export const skuValueSourceKey = row => JSON.stringify([row.skuId, row.categoryId, row.attributeKey]);
const rowHash = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const valueChannel = source => /ocr|visual/.test(text(source.extractionMethod)) ? '图片识别' : sourceKinds.get(source.kind);

/** Choose among value evidence only. Identity/brand matching is not value support. */
export function skuPrimaryExtractionSource(row, sources, selection) {
  const channels = skuExtractionSources(row, sources);
  if (!channels.length) return {label:'',referenceOnly:false};
  const cited = new Set(row.evidence.map(e => e.sourceId));
  if (!selection) {
    const actual = [...new Set([...cited].map(id => valueChannel(sources.get(id))))];
    if (actual.length !== 1) throw Error(`Source roles required: ${skuValueSourceKey(row)}`);
    return {label:actual[0]==='图片识别'?'图片参考':actual[0],referenceOnly:actual[0]==='图片识别'};
  }
  const ids = selection.valueEvidenceSourceIds;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id=>!cited.has(id))) throw Error('Invalid value evidence sources');
  if (!ids.includes(selection.primarySourceId)) throw Error('Primary source must support the value');
  for (const role of ['identitySourceIds','counterEvidenceSourceIds']) {
    const others=selection[role]??[];
    if (!Array.isArray(others) || others.some(id=>!cited.has(id)||ids.includes(id))) throw Error(`Invalid ${role}`);
  }
  const valueChannels = [...new Set(ids.map(id=>valueChannel(sources.get(id))))];
  const referenceOnly = valueChannels.includes('图片识别');
  const preferred = referenceOnly ? '图片识别' : priority.find(label=>valueChannels.includes(label));
  if (valueChannel(sources.get(selection.primarySourceId))!==preferred) throw Error('Primary source ignores value-evidence priority');
  // A required image contribution is still a reference, even if text supplied one component.
  return {label:referenceOnly?'图片参考':preferred,referenceOnly,primarySourceId:selection.primarySourceId};
}

export const formatSkuExtractionSources = (row, sources, selection) => skuPrimaryExtractionSource(row,sources,selection).label;

/** Bind semantic source-role decisions to the exact exported rows, not row numbers. */
export function validateSkuSourceSelections(data, input, resultSha256) {
  if (input?.version!==1 || input.resultSha256!==resultSha256 || !Array.isArray(input.decisions)) throw Error('Stale or invalid source-selection manifest');
  const rows=new Map(data.rows.filter(r=>r.status==='proposed').map(r=>[skuValueSourceKey(r),r]));
  const sources=new Map(data.sources.map(s=>[s.sourceId,s]));
  const selections=new Map();
  for (const decision of input.decisions) {
    const key=skuValueSourceKey(decision),row=rows.get(key);
    if (!row || selections.has(key) || decision.rowSha256!==rowHash(row)) throw Error(`Stale, unknown or duplicate source decision: ${key}`);
    if (!text(decision.reason)) throw Error('Source decision needs a semantic reason');
    skuPrimaryExtractionSource(row,sources,decision);selections.set(key,decision);
  }
  if (selections.size!==rows.size) throw Error('Source decisions must cover all proposed values');
  return selections;
}

export function formatSkuSource(reference, source) {
  if (source?.kind !== 'web') return reference.sourceId;
  return [
    '网络提取',
    text(source.publisher),
    text(source.pageTitle),
    text(source.locator) ? `链接：${source.locator}` : '',
    text(source.retrievedAt) ? `采集时间：${source.retrievedAt}` : '',
    text(source.applicability) ? `适用范围：${source.applicability}` : '',
    text(source.matchBasis) ? `本商品匹配依据：${source.matchBasis}` : '',
    `来源ID：${reference.sourceId}`,
  ].filter(Boolean).join('\n');
}

export function formatSkuEvidence(reference, source) {
  const quote = `${source?.field ?? ''}：${reference.quote}`;
  if (source?.kind !== 'web') return quote;
  return `${formatSkuSource(reference, source)}\n原文${quote}`;
}
