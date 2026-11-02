import {expect,test} from 'bun:test';
import {shortSku,skuReviewEvidence,skuWideView,validateSkuEvidenceExcerpts} from '../sku-review-views.mjs';
import {skuValueSourceKey} from '../sku-source-display.mjs';

const src=(id:string,kind:string,field:string,text:string,extra={})=>({sourceId:id,kind,field,text,readState:'available',...extra});
const ref=(sourceId:string,quote:string)=>({sourceId,quote});
test('短编号只改显示，不作为完整身份键',()=>{
  expect(shortSku('a2fd2fee-04b6-48b9')).toBe('a2fd2fee');
  expect(shortSku('simpleSKU')).toBe('simpleSKU');
});
test('网络原料前置依据使用网页原文和网址，不把标题身份当参数',()=>{
  const sources=new Map([['title',src('title','summary','title','某品牌 ABC')],['web',src('web','web','excerpt','原料：原生木浆',{locator:'https://example.com/abc'})]]);
  const row={status:'proposed',evidence:[ref('title','某品牌 ABC'),ref('web','原料：原生木浆')]};
  const result=skuReviewEvidence(row,sources,{primarySourceId:'web',valueEvidenceSourceIds:['web'],identitySourceIds:['title']});
  expect(result.quote).toBe('网页原文：原料：原生木浆');
  expect(result.urls).toBe('https://example.com/abc');
  expect(result.text).toBe('网页原文：原料：原生木浆\n\nhttps://example.com/abc');
  expect(result.sourceIds).toEqual(['web']);
});
test('文字已经支持时仅前置文字，图片文字与图片观察不能冒作同一种OCR',()=>{
  const sources=new Map([['title',src('title','summary','title','四层')],['web',src('web','web','excerpt','四层',{locator:'https://example.com/layers'})],['ocr',src('ocr','image_ocr','text','粉色')],['visual',src('visual','user_image_manual_observation','visual','可见圆形卷芯')]]);
  const row={status:'proposed',evidence:[ref('title','四层'),ref('web','四层')]};
  const result=skuReviewEvidence(row,sources,{primarySourceId:'title',valueEvidenceSourceIds:['title','web']});
  expect(result.quote).toBe('标题：四层');expect(result.urls).toBe('');
  expect(skuReviewEvidence({status:'proposed',evidence:[ref('ocr','粉色')]},sources).quote).toBe('图片文字：粉色');
  expect(skuReviewEvidence({status:'proposed',evidence:[ref('visual','可见圆形卷芯')]},sources).quote).toBe('图片观察：可见圆形卷芯');
  expect(()=>skuReviewEvidence({status:'proposed',evidence:[ref('title','三层')]},sources)).toThrow('exist');
});
test('横表按每SKU自身顺序成组，不按全局属性名挤占空列，也不丢零和否',()=>{
  const skus=[{skuId:'a-full',path:'清洁用品>垃圾处理>垃圾桶>脚踏垃圾桶'},{skuId:'b-full',path:'清洁用品>垃圾处理>垃圾袋>平口式垃圾袋'},{skuId:'c-full',path:'清洁用品>垃圾处理>垃圾桶>公共垃圾桶'}];
  const rows=skus.map((s,i)=>({skuId:s.skuId,categoryId:String(i),attributeKey:'key'+i,definitionId:i===1?'bagCapacity':'binCapacity',definitionVersion:1,type:'number',unit:'L',attribute:'容量',status:'proposed',value:i===0?0:i===1?false:30,evidence:[ref('text','容量')]}));
  const sources=new Map([['text',src('text','summary','title','容量')]]);
  const view=skuWideView({skus,rows},sources,new Map());
  expect(view.slots).toEqual([{title:'属性 1',headers:['属性1','填入值1','单位1']}]);
  expect(view.rows).toEqual([['容量',0,'L'],['容量','否','L'],['容量',30,'L']]);
  expect(()=>skuWideView({skus,rows:[...rows,rows[0]]},sources,new Map())).toThrow('multiple rows');
});
test('横表缺值保留空白，图片值另外标识，不变成普通文本事实',()=>{
  const skus=[{skuId:'a-full',path:'清洁用品>垃圾桶'}],row={skuId:'a-full',categoryId:'c',attributeKey:'color',definitionId:'color',attribute:'颜色',status:'proposed',value:['粉色'],evidence:[ref('image','粉色')]};
  const sources=new Map([['image',src('image','image_ocr','text','粉色')]]);
  const selections=new Map([[skuValueSourceKey(row),{primarySourceId:'image',valueEvidenceSourceIds:['image']}]]);
  const view=skuWideView({skus,rows:[row]},sources,selections);
  expect(view.rows).toEqual([['颜色','粉色','']]);expect(view.imageCells).toEqual([{row:0,column:1}]);
  expect(skuWideView({skus,rows:[{...row,status:'out_of_domain'}]},sources,selections).rows).toEqual([['颜色','','']]);
});
test('属性数量不同的SKU按槽位补空，未提取属性仍保留名称和单位',()=>{
  const skus=[{skuId:'a'},{skuId:'b'}],sources=new Map([['text',src('text','summary','title','30L')]]);
  const rows=[{skuId:'a',categoryId:'c',attributeKey:'capacity',attribute:'容量',unit:'L',status:'proposed',value:30,evidence:[ref('text','30L')]},{skuId:'a',categoryId:'c',attributeKey:'color',attribute:'颜色',status:'missing',value:null,evidence:[]},{skuId:'b',categoryId:'d',attributeKey:'size',attribute:'尺寸',status:'missing',value:null,evidence:[]}];
  const view=skuWideView({skus,rows},sources,new Map());
  expect(view.slots.length).toBe(2);
  expect(view.rows).toEqual([['容量',30,'L','颜色','',''],['尺寸','','','','','']]);
});
test('关键摘录保留适用范围和原文字面，网址附尾，完整证据不变',()=>{
  const quote='在现场观众和嘉宾的共同见证下，100%原生木浆标识正式发布。一直以来心相印全系干巾均采用100%原生木浆，产品包装上都将印上100%原生木浆标识。';
  const row={attribute:'原料',status:'proposed',evidence:[ref('web',quote)]},data={rows:[row]},before=JSON.stringify(data);
  const manifest={version:1,resultSha256:'hash',excerpts:[{attribute:'原料',quote,segments:['心相印全系干巾均采用100%原生木浆']}]};
  const sources=new Map([['web',src('web','web','excerpt',quote,{locator:'https://example.com/paper'})]]);
  const reviewed=validateSkuEvidenceExcerpts(data,manifest,'hash');
  expect(skuReviewEvidence(row,sources,undefined,reviewed).text).toBe('网页原文：心相印全系干巾均采用100%原生木浆\n\nhttps://example.com/paper');
  expect(JSON.stringify(data)).toBe(before);
  expect(()=>validateSkuEvidenceExcerpts(data,manifest,'other')).toThrow('another result');
  expect(()=>validateSkuEvidenceExcerpts(data,{...manifest,excerpts:[{...manifest.excerpts[0],segments:['所有商品都是原生木浆']}]},'hash')).toThrow('original spans');
});
test('未复核摘录不自动删除否定、单位或对象限定；两处完全相同摘录可合并标签',()=>{
  const quote='仅A系列单层厚度0.8丝，B系列不适用。';
  const sources=new Map([['title',src('title','summary','title',quote)],['spec',src('spec','summary','saleSpec',quote)]]);
  const row={attribute:'单层厚度',status:'proposed',evidence:[ref('spec',quote),ref('title',quote)]};
  expect(skuReviewEvidence(row,sources).quote).toBe('规格/标题：'+quote);
});
