import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { formatSkuExtractionSources, formatSkuEvidence, skuExtractionSources, validateSkuSourceSelections } from '../sku-source-display.mjs';

const source = (kind: string, extra = {}) => ({ kind, field: '原料', readState: 'available', text: '原生木浆', ...extra });
const row = (...ids: string[]) => ({ skuId:'s',categoryId:'c',attributeKey:'material',status: 'proposed', evidence: ids.map(sourceId => ({ sourceId, quote: '原生木浆' })) });
const selection=(primarySourceId:string,valueEvidenceSourceIds:string[],extra={})=>({primarySourceId,valueEvidenceSourceIds,reason:'按实际值证据选择',...extra});

describe('SKU 主要提取来源', () => {
  test('已有商品文本不会因为上游或链接为京东就冒充接口补证', () => {
    const sources = new Map([['local', source('summary', { locator: 'https://item.jd.com/123.html', upstreamName: '京东VOP' })]]);
    expect(formatSkuExtractionSources(row('local'), sources)).toBe('商品文本');
    sources.set('api', source('jd_vop'));
    expect(formatSkuExtractionSources(row('local', 'api'), sources,selection('local',['local','api']))).toBe('商品文本');
  });
  test('BT810标题仅确认身份，原料值来自品牌网页，不能因文本优先而伪标文本', () => {
    const sources = new Map([['title', source('summary',{text:'BT810 心相印180克10粒装四层卷筒卫生纸'})], ['web', source('web')]]),r=row('title','web');
    expect(()=>formatSkuExtractionSources(r,sources)).toThrow('Source roles required');
    expect(formatSkuExtractionSources(r,sources,selection('web',['web'],{identitySourceIds:['title']}))).toBe('网络提取');
    expect(skuExtractionSources(r,sources)).toEqual(['商品文本','网络提取']);
  });
  test('图片或OCR只能显示为图片参考，未读URL不能作为图片事实', () => {
    const sources = new Map([['image', source('user_image_manual_observation', { extractionMethod: 'manual_visual_transcription' })], ['online', source('web', { extractionMethod: 'ocr' })]]);
    expect(formatSkuExtractionSources(row('image'), sources)).toBe('图片参考');
    expect(formatSkuExtractionSources(row('online'), sources)).toBe('图片参考');
    sources.set('unread', { ...source('image'), readState: 'image_only', text: null });
    expect(() => formatSkuExtractionSources(row('unread'), sources)).toThrow('Uninterpreted');
  });
  test('图片反证不变成文字值来源；需要图片才能确定的对象仍作参考', () => {
    const sources=new Map([['title',source('summary',{text:'四层'})],['image',source('user_image_manual_observation',{text:'心柔3层',extractionMethod:'manual_visual_transcription'})]]);
    expect(formatSkuExtractionSources(row('title','image'),sources,selection('title',['title'],{counterEvidenceSourceIds:['image']}))).toBe('商品文本');
    expect(formatSkuExtractionSources(row('title','image'),sources,selection('image',['title','image']))).toBe('图片参考');
  });
  test('不能用身份来源、未引用来源或低优先级旁证充当主来源', () => {
    const sources=new Map([['local',source('summary')],['web',source('web')]]),r=row('local','web');
    expect(()=>formatSkuExtractionSources(r,sources,selection('local',['web'],{identitySourceIds:['local']}))).toThrow('Primary source');
    expect(()=>formatSkuExtractionSources(r,sources,selection('web',['web','absent']))).toThrow('Invalid value');
    expect(()=>formatSkuExtractionSources(r,sources,selection('web',['local','web']))).toThrow('priority');
    expect(()=>formatSkuExtractionSources(r,sources,selection('local',['local'],{identitySourceIds:['local']}))).toThrow('identitySourceIds');
  });
  test('来源决定绑定值和证据版本；缺行、重复或旧哈希都拒绝', () => {
    const r=row('local'),d={rows:[r],sources:[{...source('summary'),sourceId:'local'}]};
    const decision={...r,...selection('local',['local']),rowSha256:createHash('sha256').update(JSON.stringify(r)).digest('hex')};
    const input={version:1,resultSha256:'result',decisions:[decision]};
    expect(validateSkuSourceSelections(d,input,'result').size).toBe(1);
    expect(()=>validateSkuSourceSelections(d,input,'changed')).toThrow('Stale');
    expect(()=>validateSkuSourceSelections({...d,rows:[{...r,value:'竹浆'}]},input,'result')).toThrow('Stale');
    expect(()=>validateSkuSourceSelections(d,{...input,decisions:[]},'result')).toThrow('cover');
    expect(()=>validateSkuSourceSelections(d,{...input,decisions:[decision,decision]},'result')).toThrow('duplicate');
  });
  test('待核依据不冒充已提取值，未知来源也不默认为商品文本', () => {
    expect(formatSkuExtractionSources({ ...row('candidate'), status: 'needs_evidence' }, new Map())).toBe('');
    expect(() => formatSkuExtractionSources(row('absent'), new Map())).toThrow('Missing');
    expect(() => formatSkuExtractionSources(row('new'), new Map([['new', source('unknown')]]))).toThrow('Unmapped');
  });
  test('品牌资料的网络标签仍保留URL、范围和SKU匹配依据', () => {
    const s = source('web', { locator: 'https://example.com/brand', publisher: '示例厂家', applicability: '示例系列干纸', matchBasis: '本SKU系列一致，品牌资料推断' });
    const output = formatSkuEvidence({ sourceId: 'web', quote: '原生木浆' }, s);
    for (const value of ['网络提取', s.locator, s.applicability, s.matchBasis]) expect(output).toContain(value);
  });
});
