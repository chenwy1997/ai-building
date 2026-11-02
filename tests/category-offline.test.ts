import { describe, expect, test } from "bun:test";
import { buildDraft, bindKnowledge, stableJson } from "../src/scenarios/category_governance/offline/build.ts";
import { toStdText, fromStdText } from "../src/scenarios/category_governance/offline/codec.ts";
import type { InputSnapshot, KnowledgePack } from "../src/scenarios/category_governance/offline/types.ts";
import { packs } from "../src/scenarios/category_governance/offline/knowledge.ts";
import { excelRows } from "../src/scenarios/category_governance/offline/excel.ts";

const input = (): InputSnapshot => ({schema:"sanheng-attribute-input-v1",capturedAt:"fixed",hashes:{},evidence:{categories:[]},tree:{version:"v1",roots:["root"],leafCount:2,nodes:[
  {id:"root",parentId:null,name:"标准类目",level:1,pathNames:["标准类目"],pathIds:["root"],categoryId:null,isLeaf:false,enabled:true,payload:{}},
  ...["平垫","螺栓"].map((name,i)=>({id:`leaf-${i}`,parentId:"root",name,level:2,pathNames:["标准类目",name],pathIds:["root",`leaf-${i}`],categoryId:null,isLeaf:true,enabled:true,payload:{}}))
]},candidates:{categories:["平垫","螺栓"].map((name,i)=>({category:{id:`leaf-${i}`,name,path:["标准类目",name]},shared:[],properties:[{key:"material",name:"材质",type:"single",required:false,unit:null,options:["钢"]}],notes:[]}))}});
const washer: KnowledgePack={id:"washer",title:"垫圈",leafNames:["平垫"],mode:"replace",sources:["codex-domain"],reason:"按实际商品含义绑定",properties:[{key:"id",name:"内径",type:"number",unit:"mm",required:true,options:[]}]};
describe("离线属性编制",()=>{
  test("共用定义不能把来源中的必填品牌和型号降级",()=>{
    const source=input();
    source.candidates.categories[0]!.shared=["brand","model"].map((key,i)=>({key,name:["品牌","型号"][i]!,type:"text",required:true,unit:null,options:[]}));
    const {document}=buildDraft(source,"test",[]);
    expect(document.categories[0]!.properties.filter(p=>["brand","model"].includes(p.key)).every(p=>p.required)).toBe(true);
  });
  test("条件必填无损往返且导出为条件必填，不能误作无条件必填或选填",()=>{
    const conditional:KnowledgePack={...washer,properties:[{...washer.properties[0]!,required:false,condition:"有中心孔时",requiredWhenApplicable:true}]};
    const source=input();
    source.tree.nodes.filter(n=>n.isLeaf).forEach(n=>{n.pathNames=["标准类目","五金工具","紧固件","垫圈",n.name];});
    const {document}=buildDraft(source,"test",[conditional]);
    const restored=fromStdText(toStdText(document));
    expect(restored.categories[0]!.properties[0]!.required).toBe(false);
    expect(restored.categories[0]!.properties[0]!.requiredWhenApplicable).toBe(true);
    expect(excelRows(restored)[0]![7]).toBe("条件必填");
    expect(excelRows(restored)[1]![7]).toBe("选填");
    delete conditional.properties[0]!.condition;
    expect(()=>buildDraft(source,"test",[conditional])).toThrow("条件必填缺少适用条件");
  });
  test("代表模板使用各自规则，共用材质不跨类目强制继承",()=>{
    const prop=(id:string,key:string)=>packs.find(p=>p.id===id)!.properties.find(p=>p.key===key)!;
    expect(prop("phone","brand").required).toBe(true);
    expect(prop("phone","model").required).toBe(true);
    expect(prop("flat-washer","material").required).toBe(true);
    expect(prop("flat-washer","model").requiredWhenApplicable).toBe(true);
    expect(prop("light-bulb","rated_power").required).toBe(true);
    expect(prop("computer","screen").requiredWhenApplicable).toBe(true);
    expect(prop("phone","ip_rating").required).toBe(false);
    expect(prop("hemostat","device_registration").required).toBe(false);
    expect(packs.find(p=>p.id==="service-repair")!.properties.some(p=>p.key==="brand")).toBe(false);
  });
  test("仅显式绑定类目更换模板，原类目和输入对象不变",()=>{const source=input(),before=stableJson(source);const {document}=buildDraft(source,"test",[washer]);expect(document.categories[0]!.properties.map(p=>p.name)).toEqual(["内径"]);expect(document.categories[1]!.properties.map(p=>p.name)).toEqual(["材质"]);expect(stableJson(source)).toBe(before);expect(document.categories.map(c=>c.category.id)).toEqual(["leaf-0","leaf-1"]);});
  test("单个观测值不能自动形成行业闭集，来源和原候选值保留",()=>{const {document}=buildDraft(input(),"test",[]);const p=document.categories[0]!.properties[0]!;expect(p.type).toBe("text");expect(p.options).toEqual([]);expect(p.suggestedValues).toEqual(["钢"]);expect(document.categories[0]!.provenance.material!.kind).toBe("historical-candidate");});
  test("全字段及来源无损还原，分片也能独立还原",()=>{const {document}=buildDraft(input(),"test",[washer]);expect(stableJson(fromStdText(toStdText(document)))).toBe(stableJson(document));const part={...document,categories:[document.categories[1]!]};expect(stableJson(fromStdText(toStdText(part)))).toBe(stableJson(part));});
  test("缺失输入与拼错映射必须报错，不能生成占位模板",()=>{const source=input();source.candidates.categories.pop();expect(()=>buildDraft(source,"test",[])).toThrow("缺少原始候选模板");expect(()=>bindKnowledge(input(),[{...washer,leafNames:["不存在"]}])).toThrow("末级类目不存在");});
});
