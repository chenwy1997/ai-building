import {test,expect} from 'bun:test';
import {applyBusinessPatch} from '../workflows/business-feedback.ts';
import {checkSharedRules,sharedPolicy} from '../domain/shared-rules.ts';
const base=()=>({attributes:[{id:'local.width',name:'宽度',kind:'公共属性',enumValues:[]},{id:'unit',name:'销售单位',kind:'类目特性属性',enumValues:['包','箱']}],bindings:[{attributeId:'local.width',valueLevel:'SPU',requiredness:'optional'},{attributeId:'unit',valueLevel:'SKU',requiredness:'optional'}],rules:[{attributeId:'local.width',operator:'direct',formula:'',examples:[]},{attributeId:'unit',operator:'direct',formula:'',examples:[]}],provenance:[{attributeId:'local.width',claims:[]},{attributeId:'unit',claims:[]}],dimensions:[{name:'尺寸',purpose:'本体',attributeIds:['local.width','unit']}],unresolved:[]});
test('model delta changes only authorized fields and archives SKU base definitions',()=>{
 const original=base();
 const p={edits:[{attributeId:'local.width',group:'attributes',field:'kind',valueJson:'"类目特性属性"',reason:'测量对象特定'},{attributeId:'local.width',group:'bindings',field:'valueLevel',valueJson:'"SKU"',reason:'当前SKU'}],removals:[{attributeId:'unit',destination:'skuBase.salesUnit',reason:'基础字段'}],dimensions:[{name:'尺寸规格',purpose:'本体',attributeIds:['local.width']}],unresolved:[]};
 const r=applyBusinessPatch(original,p,sharedPolicy);
 expect(r.card.attributes).toHaveLength(1);expect(r.skuBaseFields[0].attribute.enumValues).toEqual(['包','箱']);
 expect(original.attributes).toHaveLength(2);expect(original.bindings[0]!.valueLevel).toBe('SPU');
 expect(()=>applyBusinessPatch(original,{...p,removals:[{attributeId:'local.width',destination:'skuBase.salesUnit',reason:'错删'}]},sharedPolicy)).toThrow('only existing transaction');
 expect(()=>applyBusinessPatch(original,{...p,edits:[{...p.edits[0],field:'id'}]},sharedPolicy)).toThrow('unapproved field');
 expect(()=>applyBusinessPatch(original,{...p,edits:[{...p.edits[0],group:'bindings',field:'requiredness',valueJson:'"optional"'}]},sharedPolicy)).toThrow('unapproved field');
});
test('shared policy catches category-specific public labels, SPU and sales unit boundaries',()=>{
 const e=checkSharedRules(base()).join(';');
 expect(e).toContain('public definition must be explicitly registered');expect(e).toContain('skuBase.salesUnit');expect(e).toContain('must use SKU');expect(e).toContain('use 尺寸规格');
});
