import {test,expect} from 'bun:test';
import {normalizeMonth,normalizeMeasuredText,reviseValue} from '../src/scenarios/category_governance/product_delivery/revision-values.ts';
import {propertyFromRow} from '../src/scenarios/category_governance/product_delivery/template-revision.ts';
import {buildRevision} from '../src/scenarios/category_governance/product_delivery/revision-entry.ts';
import {outputDir,sha256} from '../src/scenarios/category_governance/product_delivery/io.ts';
import {compactProducts,type ResolvedProduct} from '../src/scenarios/category_governance/product_delivery/build.ts';
import type {KnowledgeProperty} from '../src/scenarios/category_governance/offline/types.ts';
const baselinePath=outputDir+'/.repro/resolved-products.json';
const baseline:ResolvedProduct[]=await Bun.file(baselinePath).json();
const sample={...baseline[0]!,row:10001,fields:[],title:'测试商品',variant:''};
const prop=(name:string,type:KnowledgeProperty['type']='text',unit=''):KnowledgeProperty=>({key:name,name,type,unit,description:name,required:false});
test('日期仅规范明确月份，季节不能猜月份',()=>{
 expect(normalizeMonth('2025年冬季')).toBeNull();expect(normalizeMonth('2025')).toBeNull();
 expect(normalizeMonth('2025-2')).toBe('2025-02');expect(normalizeMonth('2025年12月')).toBe('2025-12');
 expect(normalizeMonth('2025-13')).toBeNull();
});
test('文本量值保留范围和尺寸结构，统一明确单位',()=>{
 expect(normalizeMeasuredText('120min','h').value).toBe('2');
 expect(normalizeMeasuredText('2×3cm','mm').value).toBe('20×30');
 expect(normalizeMeasuredText('-200～500℃','℃').value).toBe('-200~500');
 expect(normalizeMeasuredText('10mm/12mm','mm').value).toBe('10/12');
 expect(normalizeMeasuredText('FHD+','px').value).toBe('FHD+');
});
test('新字段读取证据，枚举删除不强行匹配，示例不作值',()=>{
 const p={...sample,fields:[{name:'颜色',value:'蓝',source:'JD.categoryAttrList[0]'}]};
 expect(reviseValue(p,{...prop('颜色','single'),options:['红','蓝']}).value).toBe('蓝');
 expect(reviseValue(p,{...prop('颜色','single'),options:['红']}).value).toBeNull();
 expect(reviseValue(sample,{...prop('是否支持','boolean'),example:'true'}).value).toBeNull();
});
test('条件、选项、示例分别解释，不把示例当事实',()=>{
 const a=propertyFromRow(['一','二','三','四','颜色','颜色说明；适用条件：彩色款','单选','条件必填','','红；蓝','','红']);
 expect(a.options).toEqual(['红','蓝']);expect(a.requiredWhenApplicable).toBeTrue();expect(a.required).toBeFalse();
 expect(a.condition).toBe('彩色款');
 expect(()=>propertyFromRow(['一','二','三','四','颜色','颜色说明','单选','条件必填','','红；蓝','','红'])).toThrow('缺适用条件');
});
test('数值换算使用旧值真实单位，不能绕过新单位约束',()=>{
 const old={key:'功率',name:'功率',type:'number' as const,required:false,condition:'',templateUnit:'W',unit:'W',value:5000,status:'已填写' as const,source:'JD参数',quote:'5000W',note:''};
 expect(reviseValue(sample,prop('功率','number','kW'),old,prop('功率','number','W')).value).toBe(5);
});
test('完整增量仅作用295商品，删除4项并保留原类目和基线',async()=>{
 const oldHash=sha256(await Bun.file(baselinePath).text());
 const {products,stat}=await buildRevision('属性模板-修订版.xlsx','改动类目清单.csv');
 expect(stat).toMatchObject({products:1000,affectedProducts:295,unchangedProducts:705,removed:4,added:0,updated:391,newlyFilled:15,paidModelRequests:0,jdRequests:0});
 expect(products.filter((p,i)=>JSON.stringify(p)===JSON.stringify(baseline[i])).length).toBe(705);
 expect(products.map(p=>p.category)).toEqual(baseline.map(p=>p.category));
 const get=(row:number,name:string)=>products.find(p=>p.row===row)!.filled.find(a=>a.name===name);
 expect(get(311,'容量')).toBeUndefined();expect(get(334,'功率')).toBeUndefined();expect(get(370,'重量')).toBeUndefined();expect(get(812,'重量')).toBeUndefined();
 expect(get(529,'桌面长度')?.value).toBe('180');expect(get(998,'外形尺寸')?.status).toBe('资料冲突');
 expect(get(660,'测量范围')?.value).toBe('-200~500');
 expect(sha256(await Bun.file(baselinePath).text())).toBe(oldHash);
 const compact=compactProducts(products,'new-template',true);
 expect(compact.legend.attribute).toContain('options,format');
},20000);
