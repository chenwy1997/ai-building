import {describe,test,expect} from "bun:test";
import {fillAttribute,normalizeNumeric,titleFacts} from "../src/scenarios/category_governance/product_delivery/attributes.ts";
import type {MappedProduct} from "../src/scenarios/category_governance/product_delivery/mapping.ts";
import type {KnowledgeProperty} from "../src/scenarios/category_governance/offline/types.ts";
import {workbookRows,compactProducts,type ResolvedProduct} from "../src/scenarios/category_governance/product_delivery/build.ts";
const prop=(name:string,type:KnowledgeProperty["type"]="text",unit?:string):KnowledgeProperty=>({name,key:name,type,unit,required:true,description:name});
const product=(overrides:Partial<MappedProduct>={}):MappedProduct=>({row:10001,sku:"100000000001",title:"测试商品",variant:"",price:10,jdTitle:"测试商品",jdCategoryIds:[],jdCategory:[],fields:[],category:{id:"unchanged-id",name:"测试类目",path:["标准类目","一级","二级","三级","测试类目"],isLeaf:true,index:0},mappingStatus:"末级已挂载",mappingNote:"",attributes:[],...overrides});
describe("商品证据填写边界",()=>{
 test("同维度换算；月份、质量与体积不强行互换",()=>{
  expect(normalizeNumeric("5000W","kW")).toBe(5);
  expect(normalizeNumeric("2km","m")).toBe(2000);
  expect(normalizeNumeric("3年","月")).toBe(36);
  expect(normalizeNumeric("12个月","天")).toBeNull();
  expect(normalizeNumeric("250mL","kg")).toBeNull();
  expect(normalizeNumeric("10-30L","L")).toBeNull();
  expect(normalizeNumeric("32","mm")).toBeNull();
 });
 test("月保质期保留真实单位且同时保留模板单位",()=>{
  const p=product({fields:[{name:"保质期",value:"12个月",source:"JD.paramGroupAttrList[0][0]"}]});
  const a=fillAttribute(p,prop("保质期","number","天"));
  expect([a.value,a.unit,a.templateUnit]).toEqual([12,"月","天"]);
 });
 test("未知、商家占位零、可用范围均不作为已填规格",()=>{
  expect(fillAttribute(product(),prop("是否无糖","boolean")).value).toBeNull();
  const p=product({fields:[{name:"保质期",value:"0天",source:"JD.categoryAttrList[0]"},{name:"容量",value:"10-30L",source:"JD.categoryAttrList[1]"}]});
  expect(fillAttribute(p,prop("保质期","number","天")).status).toBe("待补充");
  expect(fillAttribute(p,prop("容量","number","L")).quote).toContain("10-30L");
 });
 test("净含量采用选定规格，组合件数量可追溯",()=>{
  const a=prop("净含量","number","g");const p=product({title:"米1kg",variant:"1.05kg*2袋",attributes:[a]});
  const value=fillAttribute(p,a);
  expect(value.value).toBe(2100);expect(value.source).toBe("原表.颜色尺寸");expect(value.note).toContain("× 2");
 });
 test("数值商品型号有效，不把中文商品长标题冒充型号",()=>{
  expect(fillAttribute(product({title:"得力15171",fields:[{name:"京东检索型号",value:"15171",source:"JD.seoModel"}]}),prop("型号")).value).toBe("15171");
  expect(fillAttribute(product({fields:[{name:"京东检索型号",value:"商用烘干机24层全自动",source:"JD.seoModel"}]}),prop("型号")).value).toBeNull();
 });
 test("排除PLC整机证据后，网线不会继承设备电参",()=>{
  const p=product({row:347,title:"Profinet网线1米",fields:[{name:"功率",value:"400W",source:"JD.paramGroupAttrList[0][0]"},{name:"尺寸",value:"500",source:"JD.paramGroupAttrList[0][1]"}]});
  expect(fillAttribute(p,prop("功率","number","W")).value).toBeNull();
 });
 test("人工确认功率仍使用模板的kW，光模块距离转换为m",()=>{
  expect(fillAttribute(product({row:83}),prop("额定功率","number","kW")).value).toBe(5);
  expect(fillAttribute(product({row:263,title:"SFP 2km"}),prop("传输距离","number","m")).value).toBe(2000);
  expect(fillAttribute(product({row:263}),prop("波长")).value).toBe("1310nm");
 });
 test("文本量值保留单位，尺码不套用推荐体重",()=>{
  const a=prop("净含量");const p=product({title:"牙膏140g",attributes:[a]});
  expect(fillAttribute(p,a).value).toBe("140g");
  const clothes=product({title:"内衣",variant:"4XL 推荐体重190-210斤",category:{...p.category,name:"内衣",path:["标准类目","生活福利","内衣"]}});
  expect(titleFacts(clothes).some(f=>f.name==="重量")).toBe(false);
 });
 test("主表保留原始五列，压缩字典能还原来源和不同单位",()=>{
  const a=prop("保质期","number","天"),p=product({attributes:[a],fields:[{name:"保质期",value:"12个月",source:"JD.paramGroupAttrList[0][0]"}]});
  const resolved:ResolvedProduct={...p,filled:[fillAttribute(p,a)],supplemental:[],filledCount:1,requiredMissing:[],conflicts:[]};
  expect(workbookRows([resolved]).products[0]!.slice(0,5)).toEqual([p.row,p.sku,p.title,p.variant,p.price??""]);
  const doc=compactProducts([resolved]);const values=doc.products[0]![8] as unknown[][];
  expect(values[0]!.slice(1,3)).toEqual([12,"已填写"]);expect(values[0]![6]).toBe("月");
  expect((doc.attributes[0] as unknown[])[3]).toBe("天");
 });
});
