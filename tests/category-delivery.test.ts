import { expect, test } from "bun:test";
import { refineForDelivery, deliveryAudit } from "../src/scenarios/category_governance/offline/delivery.ts";
import { fromStdText, toStdText } from "../src/scenarios/category_governance/offline/codec.ts";
import type { DraftDocument, KnowledgeProperty } from "../src/scenarios/category_governance/offline/types.ts";
const p=(key:string,name:string,more:Partial<KnowledgeProperty>={}):KnowledgeProperty=>({key,name,type:"text",unit:null,options:[],required:false,...more});
const document=(props:KnowledgeProperty[],domain="五金工具"):DraftDocument=>({schema:"sanheng-attribute-draft-v1",categoryVersion:"v1",edition:"test",categories:[{category:{id:"fixture",name:"测试件",path:["标准类目",domain,"电动工具","整机","测试件"]},shared:[],properties:props,notes:[],changes:[],cautions:[],knowledgePacks:[],treatment:"historical-draft",provenance:Object.fromEntries(props.map(p=>[p.key,{kind:"historical-candidate",sources:["historical-input"]}]))}]});
test("交付完善保留原类目和输入，记录字段依据并支持无损压缩",()=>{
  const d=document([p("brand","品牌"),p("power","额定功率",{type:"number",unit:"瓦"})]),before=JSON.stringify(d);
  const next=refineForDelivery(d,[]),out=next.categories[0]!;
  expect(JSON.stringify(d)).toBe(before);expect(out.category).toEqual(d.categories[0]!.category);
  expect(out.properties[1]!.unit).toBe("W");expect(out.properties[1]!.required).toBe(true);
  expect(out.provenance.power!.kind).toBe("historical-candidate");expect(out.provenance.power!.reviews).toContain("unit-spelling");
  expect(fromStdText(toStdText(next))).toEqual(next);
});
test("泛化家族要求不能降级既有逐类决定，也不能给裸机强制填写电池容量",()=>{
  const d=document([p("battery","电池容量",{type:"number",unit:"Ah"}),p("color","颜色")]);
  d.categories[0]!.provenance.color!.kind="curated";
  const out=refineForDelivery(d,[]).categories[0]!;
  expect(out.properties[0]!.required).toBe(false);expect(out.properties[0]!.requiredWhenApplicable).toBe(true);expect(out.properties[1]!.required).toBe(false);
});
test("净含量质量/体积选项不误作密度；压力与电力标识保留正确量纲",()=>{
  const out=refineForDelivery(document([p("net","净含量",{type:"number",unit:"g/ml"}),p("dn","公称通径",{unit:"DN"}),p("power","额定功率",{type:"number",unit:"kVA"})]),[]).categories[0]!;
  expect(out.properties[0]!.unit).toBeNull();expect(out.properties[0]!.type).toBe("text");
  expect(out.properties[1]!.unit).toBeNull();expect(out.properties[1]!.format).toContain("DN");
  expect(out.properties[2]!.name).toBe("额定视在功率");expect(out.properties[2]!.unit).toBe("kVA");
});
test("服务补足交付范围和验收，显式绑定失效不能静默跳过",()=>{
  const d=document([p("provider","服务商"),p("site","服务地点"),p("service_time","服务时段")]);const next=refineForDelivery(d,[]);
  expect(next.categories[0]!.properties.some(p=>p.name==="验收要求"&&p.required)).toBe(true);
  expect(next.categories[0]!.properties.some(p=>p.name==="作业内容与数量"&&p.required)).toBe(true);
  expect(deliveryAudit(next).conflicts).toEqual([]);
  expect(next.categories[0]!.properties.filter(p=>p.key==="service_time")).toHaveLength(1);
  expect(next.categories[0]!.properties.find(p=>p.key==="service_time")!.name).toBe("服务时段");
  expect(()=>refineForDelivery(d,[{domain:"五金工具",leaf:"测试件",fields:["不存在"]}])).toThrow("缺少字段");
});
