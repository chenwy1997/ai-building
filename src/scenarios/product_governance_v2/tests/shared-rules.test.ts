import {test,expect} from 'bun:test';
import {checkSharedRules,calculatePackQuantity} from '../domain/shared-rules.ts';
const defs=[{id:'common.brand',kind:'公共属性',fieldType:'文本',enumValues:[]},{id:'common.model',kind:'公共属性',fieldType:'文本',enumValues:[]}];
test('missing evidence cannot downgrade protected counts or move them to SPU',()=>{
 const card={categoryId:'433be34e-e1cc-4b5f-b955-df3d802ed2ec',attributes:defs,bindings:[{attributeId:'pieces_per_pack',requiredness:'conditional',condition:'有资料时填写',valueLevel:'SPU'}],rules:[]};
 const e=checkSharedRules(card).join(';');
 expect(e).toContain('protected core');expect(e).toContain('availability');expect(e).toContain('must use SKU');
});
test('unknown and other stay distinct, including examples',()=>{
 const c={categoryId:'test',attributes:[...defs,{id:'color',enumValues:['未知','红色']}],bindings:[],rules:[{attributeId:'color',operator:'direct',formula:'',examples:[{expected:'其他（待补证）',reason:'未明示'}]}]};
 expect(checkSharedRules(c).filter(s=>s.startsWith('R04:'))).toHaveLength(2);
 c.attributes[2]!.enumValues=['红色'];c.rules[0]!.examples=[{expected:'unknown',reason:'未明示'}];expect(checkSharedRules(c)).toEqual([]);
});
test('quantity calculation rejects mixed packs, gifts, derived inputs and cross-SKU evidence',()=>{
 const a={value:2000,skuId:'a',salesUnitId:'unit',origin:'direct' as const},b={...a,value:4};
 const context={homogeneous:true,giftTreatmentKnown:true,sameCountUnit:true};
 expect(calculatePackQuantity('divide',a,b,context)).toBe(500);
 expect(()=>calculatePackQuantity('divide',a,b,{...context,homogeneous:false})).toThrow();
 expect(()=>calculatePackQuantity('divide',a,b,{...context,giftTreatmentKnown:false})).toThrow();
 expect(()=>calculatePackQuantity('divide',{...a,origin:'derived'},b,context)).toThrow();
 expect(()=>calculatePackQuantity('divide',a,{...b,skuId:'b'},context)).toThrow();
 expect(()=>calculatePackQuantity('divide',a,{...b,value:3},context)).toThrow();
 expect(()=>calculatePackQuantity('divide',a,b,{...context,sameCountUnit:false})).toThrow();
});
test('paper properties cannot migrate onto the tissue accessory card',()=>{
 const c={categoryId:'1f96cac3-8498-4c32-936c-7a6a54b9320b',attributes:[...defs,{id:'ply_count',enumValues:[]}],bindings:[],rules:[]};
 expect(checkSharedRules(c).join()).toContain('paper property on accessory');
});
test('an enum policy cannot introduce a missing other option',()=>{
 const c:any={categoryId:'test',attributes:[...defs,{id:'surface',fieldType:'选项',enumValues:['印花'],enumPolicy:'“其他”仅接纳明示值'}],bindings:[],rules:[]};
 expect(checkSharedRules(c).join()).toContain('undeclared other enum');
 c.attributes[2]!.enumValues.push('其他');
 expect(checkSharedRules(c)).toEqual([]);
});
