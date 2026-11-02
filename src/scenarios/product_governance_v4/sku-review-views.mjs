import {skuPrimaryExtractionSource, skuValueSourceKey} from './sku-source-display.mjs';

export const shortSku = id => String(id).split('-')[0];
export const displaySkuValue = value => value == null ? '' : Array.isArray(value) ? value.join('；') : typeof value === 'boolean' ? (value ? '是' : '否') : value;

function evidenceLabel(source) {
  if (source.field === 'ocr' || /ocr/i.test(source.kind) || /ocr|transcription/i.test(source.extractionMethod ?? '')) return '图片文字';
  if (/image|visual/i.test(`${source.kind} ${source.extractionMethod ?? ''} ${source.field ?? ''}`)) return '图片观察';
  if (source.kind === 'web') return '网页原文';
  if (['vop','jd_vop','jdvop'].includes(source.kind)) return '京东VOP原文';
  return ({title:'标题',saleSpec:'规格',description:'详情',detail:'详情',attributes:'商品参数'})[source.field] ?? '商品原文';
}

export const evidenceExcerptKey = (attribute, quote) => JSON.stringify([attribute, quote]);

/** Reviewed display excerpts are exact, ordered source spans, never replacement facts. */
export function validateSkuEvidenceExcerpts(data, manifest, resultSha256) {
  if (manifest.version !== 1 || manifest.resultSha256 !== resultSha256 || !Array.isArray(manifest.excerpts)) throw Error('Evidence excerpts belong to another result');
  const available = new Set(data.rows.flatMap(row => (row.evidence ?? []).map(ref => evidenceExcerptKey(row.attribute, ref.quote))));
  const excerpts = new Map();
  for (const entry of manifest.excerpts) {
    const key = evidenceExcerptKey(entry.attribute, entry.quote);
    if (!available.has(key) || excerpts.has(key) || !Array.isArray(entry.segments) || !entry.segments.length) throw Error('Invalid or duplicate evidence excerpt');
    let end = 0;
    for (const segment of entry.segments) {
      const start = typeof segment === 'string' && segment.trim() ? entry.quote.indexOf(segment, end) : -1;
      if (start < 0) throw Error('Evidence excerpt must use ordered original spans');
      end = start + segment.length;
    }
    excerpts.set(key, entry.segments.join(' … '));
  }
  return excerpts;
}

/** Show the value-supporting excerpt, not the identity-matching title or a source-ID dump. */
export function skuReviewEvidence(row, sources, selection, reviewedExcerpts = new Map()) {
  let refs = row.evidence ?? [];
  if (row.status === 'proposed') {
    const main = skuPrimaryExtractionSource(row, sources, selection);
    const ids = new Set(selection?.valueEvidenceSourceIds ?? refs.map(r=>r.sourceId));
    refs = refs.filter(ref => ids.has(ref.sourceId) && (main.referenceOnly ||
      skuPrimaryExtractionSource({status:'proposed',evidence:[ref]},sources).label === main.label));
    refs = [...refs].sort((a,b)=>Number(b.sourceId===selection?.primarySourceId)-Number(a.sourceId===selection?.primarySourceId));
  }
  const excerpts=new Map(),urls=[],sourceIds=[];
  for (const ref of refs) {
    const source=sources.get(ref.sourceId);
    if (!source || typeof ref.quote!=='string' || !source.text?.includes(ref.quote)) throw Error('Review excerpt must exist in its source');
    const quote=reviewedExcerpts.get(evidenceExcerptKey(row.attribute,ref.quote)) ?? ref.quote;
    const labels=excerpts.get(quote) ?? new Set();labels.add(evidenceLabel(source));excerpts.set(quote,labels);
    if (source.kind==='web' && /^https?:\/\//.test(source.locator ?? '') && !urls.includes(source.locator)) urls.push(source.locator);
    if (!sourceIds.includes(source.sourceId)) sourceIds.push(source.sourceId);
  }
  const quote=[...excerpts].map(([text,labels])=>`${[...labels].join('/')}：${text}`).join('；'),urlText=urls.join('\n');
  // Leave a blank line before links so a compact single-row view shows the evidence first.
  return {quote,urls:urlText,text:[quote,urlText].filter(Boolean).join('\n\n'),sourceIds};
}

/** One SKU per row, positional attribute/name/value/unit groups in its own contract order. */
export function skuWideView(data, sources, selections) {
  const rowMap=new Map(data.skus.map(s=>[s.skuId,[]])),seen=new Set(),imageCells=[];
  if(rowMap.size!==data.skus.length) throw Error('Duplicate SKU in wide view');
  for (const row of data.rows) {
    const values=rowMap.get(row.skuId),key=skuValueSourceKey(row);
    if (!values) throw Error('Wide view contains an unknown SKU');
    if (seen.has(key)) throw Error('A SKU has multiple rows for one attribute; do not overwrite a value');
    seen.add(key);values.push(row);
  }
  const slotCount=Math.max(0,...[...rowMap.values()].map(rows=>rows.length));
  const slots=Array.from({length:slotCount},(_,i)=>({title:`属性 ${i+1}`,headers:[`属性${i+1}`,`填入值${i+1}`,`单位${i+1}`]}));
  const rows=data.skus.map((sku,i)=>{
    const rr=rowMap.get(sku.skuId);
    return slots.flatMap((_,j)=>{
      const row=rr[j];
      if (!row) return ['','',''];
      if (row.status==='proposed' && skuPrimaryExtractionSource(row,sources,selections.get(skuValueSourceKey(row))).referenceOnly) imageCells.push({row:i,column:j*3+1});
      return [row.attribute,row.status==='proposed'?displaySkuValue(row.value):'',row.unit ?? ''];
    });
  });
  return {slots,rows,imageCells};
}
