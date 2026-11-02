import {expect,test} from 'bun:test';
import {formatSkuDimensions,formatSkuDimensionRows,projectSkuText} from '../sku-value-normalization';
import {hashContract,hashSourceText,validateSkuFill} from '../sku-fill-contract';

test('用户实样：纯材料去比例，但混合成分不能删成一项',()=>{
 expect(projectSkuText('material_name','100%棉')).toBe('棉');
 expect(projectSkuText('material_name','全棉')).toBe('棉');
 expect(projectSkuText('material_name','30%棉70%聚酯')).toBeNull();
 expect(projectSkuText('material_name','棉柔')).toBeNull();
 expect(projectSkuText('material_name','100%棉（装饰除外）')).toBeNull();
});
test('用户实样：只去冗余对象，不删除物理单位或替换计数词',()=>{
 expect(projectSkuText('dimensions','125mmX110mm/节')).toBe('125mmX110mm');
 expect(projectSkuText('dimensions','125X110/节')).toBeNull();
 expect(projectSkuText('dimensions','60g/m²')).toBeNull();
 expect(projectSkuText('scoped_count','90抽/包','包')).toBe('90抽');
 expect(projectSkuText('scoped_count','90张/包','包')).toBe('90张');
 expect(projectSkuText('scoped_count','90抽/盒','包')).toBeNull();
});
test('投影实际接入值检查：需合同允许，来源、规范值与对象匹配',()=>{
 const p={categoryId:'cat',key:'material',name:'材质',type:'text',unit:null,typing:{version:1,text:{minLength:null,maxLength:null}},valuePolicy:{materialNameOnly:true}};
 let text=JSON.stringify({attributeContractVersion:1,proposals:[p]});
 const source={sourceId:'spec',skuId:'sku',kind:'summary',field:'saleSpec',text:'100%棉',readState:'available' as const,sha256:hashSourceText('100%棉')};
 const row={skuId:'sku',categoryId:'cat',attributeKey:'material',status:'proposed' as const,value:'棉',evidence:[{sourceId:'spec',start:0,end:5,quote:'100%棉'}],normalization:{method:'text_projection' as const,evidenceIndex:0,rule:'material_name' as const}};
 const run=()=>validateSkuFill({contractText:text,expectedContractSha256:hashContract(text),skus:[{skuId:'sku',categoryId:'cat'}],sources:[source],rows:[row]});
 expect(run().structureValid).toBe(true);
 row.value='聚酯';expect(run().rows[0]!.blockingIssues.map(x=>x.code)).toContain('text_projection_value');row.value='棉';
 text=JSON.stringify({attributeContractVersion:1,proposals:[{...p,valuePolicy:{}}]});
 expect(run().rows[0]!.blockingIssues.map(x=>x.code)).toContain('text_projection_contract');
});

test('尺寸格式补全表达式共享单位并统一乘号，保留混合单位及顺序，不截取整句',()=>{
 expect(formatSkuDimensions('155*120mm')).toBe('155mm*120mm');
 expect(formatSkuDimensions('125mmX110mm')).toBe('125mm*110mm');
 expect(formatSkuDimensions('42*47*63.6CM')).toBe('42cm*47cm*63.6cm');
 expect(formatSkuDimensions('1cm × 20mm')).toBe('1cm*20mm');
 expect(formatSkuDimensions('1cm*20*30mm')).toBeNull();
 expect(formatSkuDimensions('155*120')).toBeNull();
 expect(formatSkuDimensions('100mm×115mm×三层')).toBeNull();
 expect(formatSkuDimensions('60g/m²')).toBeNull();
 expect(formatSkuDimensions('商品尺寸155*120mm')).toBeNull();
 expect(projectSkuText('dimensions','125mmX110mm/节')).toBe('125mmX110mm');
});

test('尺寸格式同时检查原转换和格式映射，知识推断仍标未验证',()=>{
 const p={categoryId:'cat',key:'size',name:'尺寸',definitionId:'cleaning.dimensions',type:'text',unit:null,typing:{version:1,text:{minLength:null,maxLength:null}}};
 const c={attributeContractVersion:1,proposals:[p],extractionKnowledge:{version:1,packs:[{id:'pack',version:'1',categoryIds:['cat'],rules:[{id:'rule',definitionIds:['cleaning.dimensions'],description:'尺寸约定'}]}]}};
 const text=JSON.stringify(c), sourceText='155*120mm';
 const source={sourceId:'spec',skuId:'sku',kind:'summary',field:'saleSpec',text:sourceText,readState:'available' as const,sha256:hashSourceText(sourceText)};
 const row:any={skuId:'sku',categoryId:'cat',attributeKey:'size',status:'proposed',value:'155mm*120mm',evidence:[{sourceId:'spec',start:0,end:sourceText.length,quote:sourceText}],
  normalization:{method:'exact',formatting:{rule:'dimensions',inputValue:'155*120mm'}}};
 const run=()=>validateSkuFill({contractText:text,expectedContractSha256:hashContract(text),skus:[{skuId:'sku',categoryId:'cat'}],sources:[source],rows:[row]});
 expect(run().structureValid).toBe(true);expect(run().rows[0]!.normalizationCheck).toBe('verified');
 row.value='120mm*155mm';expect(run().rows[0]!.blockingIssues.map(x=>x.code)).toContain('formatting_mismatch');
 row.value='156mm*120mm';row.normalization.formatting.inputValue='156*120mm';
 expect(run().rows[0]!.blockingIssues.map(x=>x.code)).toContain('normalization_mismatch');
 row.value='155mm*120mm';row.normalization={method:'category_inference',packId:'pack',ruleId:'rule',reason:'有原文及品类语境',assumptions:['所售对象明确'],formatting:{rule:'dimensions',inputValue:'155*120mm'}};
 expect(run().structureValid).toBe(true);expect(run().rows[0]!.normalizationCheck).toBe('unverified');
 row.value='155mm*120mm';row.normalization.formatting.inputValue='155*120';
 expect(run().rows[0]!.blockingIssues.map(x=>x.code)).toContain('formatting_mismatch');
});

test('批量只规范已治理尺寸建议，原行与来源不变，重复执行不叠加格式化',()=>{
 const rows:any[]=[{skuId:'s',categoryId:'c',attributeKey:'size',status:'proposed',value:'155*120mm',evidence:[{quote:'155*120mm'}],normalization:{method:'exact'}},
  {skuId:'s',categoryId:'c',attributeKey:'other',status:'proposed',value:'20*30cm',normalization:{method:'exact'}},
  {skuId:'s2',categoryId:'c',attributeKey:'size',status:'proposed',value:'155*120',normalization:{method:'semantic',reason:'原始判断'}},
  {skuId:'s3',categoryId:'c',attributeKey:'size',status:'missing',value:null}];
 const proposals=[{categoryId:'c',key:'size',definitionId:'cleaning.dimensions'},{categoryId:'c',key:'other',definitionId:'other'}];
 const original=structuredClone(rows), result=formatSkuDimensionRows(rows,proposals);
 expect(rows).toEqual(original); expect(result.changes).toEqual([{skuId:'s',categoryId:'c',attributeKey:'size',originalValue:'155*120mm',value:'155mm*120mm'}]);
 expect(result.rows[0]).toMatchObject({value:'155mm*120mm',normalization:{method:'exact',formatting:{rule:'dimensions',inputValue:'155*120mm'}},evidence:[{quote:'155*120mm'}]});
 expect(result.rows.slice(1)).toEqual(rows.slice(1));
 expect(formatSkuDimensionRows(result.rows,proposals).changes).toEqual([]);
});
