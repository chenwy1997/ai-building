import {expect,test} from 'bun:test';
import {hashContract,hashSourceText,validateSkuFill} from '../sku-fill-contract';
import {formatSkuDimensionRows} from '../sku-value-normalization';

// De-identified real feedback cases. SKU constants are test fixtures, not runtime routing.
function check(name:string,text:string,value:any,type:string,ruleId:string,unit:string|null=null,choices?:string[]) {
 const p={categoryId:'test-category',key:'value',name,definitionId:name==='尺寸'?'cleaning.dimensions':'test-definition',type,unit,
  ...(choices?{enumValues:choices,typing:{version:1,choice:{mode:'multiple'}}}:{}),valuePolicy:{compactDimensions:true}};
 const contract={attributeContractVersion:1,proposals:[p],extractionKnowledge:{version:1,packs:[{id:'test-pack',version:1,categoryIds:['test-category'],rules:[{id:ruleId,definitionIds:[p.definitionId],description:'同SKU商品对象、已读规格及限定品类惯例，待人工核实'}]}]}};
 const contractText=JSON.stringify(contract),source={sourceId:'spec',skuId:'sku',kind:'summary',field:'saleSpec',text,readState:'available' as const,sha256:hashSourceText(text)};
 const row={skuId:'sku',categoryId:p.categoryId,attributeKey:p.key,status:'proposed' as const,value,evidence:[{sourceId:'spec',start:0,end:text.length,quote:text}],normalization:{method:'category_inference' as const,packId:'test-pack',ruleId,reason:'规格语境与品类惯例支持，原文未完整标明',assumptions:['同SKU与所选销售对象相符，未发现相反证据']}};
 const run=(rows=[row])=>validateSkuFill({contractText,expectedContractSha256:hashContract(contractText),skus:[{skuId:'sku',categoryId:p.categoryId}],sources:[source],rows});
 return {p,row,run};
}

test('180克10粒与75克10粒可记录单卷惯例推断，不伪装成直接单位解析',()=>{
 for(const [text,value] of [['BT810心相印180克10粒装四层卷筒卫生纸',180],['6LR910卷纸75克10粒装',75]] as const){
  const f=check('单卷重量',text,value,'number','roll-item-mass','g');
  expect(f.run().structureValid).toBe(true);expect(f.run().rows[0]!.normalizationCheck).toBe('unverified');
  const bad={...f.row,normalization:{method:'number',evidenceIndex:0,token:`${value}克10粒`}};
  expect(f.run([bad as any]).structureValid).toBe(false);
 }
});
test('70X90垃圾袋推断cm后统一格式，原文与推断仍保留',()=>{
 const f=check('尺寸','物业垃圾袋 普通70X90【50个】','70×90cm','text','bag-dimension-unit');
 const result=formatSkuDimensionRows([f.row],[f.p]);expect(result.rows[0]!.value).toBe('70cm*90cm');
 expect(result.rows[0]!.evidence[0]!.quote).toContain('70X90');
 expect(f.run(result.rows).rows[0]!.normalizationCheck).toBe('unverified');
 expect(f.run([{...result.rows[0]!,value:'70mm*90mm'}]).structureValid).toBe(false);
});
test('不锈钢本色映射需真实枚举选项和品类依据，不能绕过值域',()=>{
 const f=check('颜色','不锈钢脚踏垃圾桶 本色20L',['不锈钢色'],'option','stainless-natural-color',null,['白色','不锈钢色']);
 expect(f.run().structureValid).toBe(true);expect(f.run().rows[0]!.normalizationCheck).toBe('unverified');
 expect(f.run([{...f.row,value:['金色']}]).structureValid).toBe(false);
});
