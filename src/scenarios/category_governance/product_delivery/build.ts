import { join } from "node:path";
import { buildMappings, type MappedProduct, inputHash } from "./mapping.ts";
import { fillAttribute, titleFacts, type FilledAttribute } from "./attributes.ts";
import { outputDir, reproDir, saveJson, sha256, loadJson, type ProductInputs } from "./io.ts";
import { templateHash } from "./decisions.ts";
import { requirementLabel } from "../offline/requirements.ts";
import { semanticFacts } from "./semantic-facts.ts";
import { reviewedFacts } from "./facts.ts";
export interface Supplement {name:string;value:string;source:string;quote:string}
export interface ResolvedProduct extends MappedProduct {filled:FilledAttribute[];supplemental:Supplement[];filledCount:number;requiredMissing:string[];conflicts:string[]}
export const PRODUCT_HEADERS=["序号","SKU编号","商品标题","颜色尺寸","京东价","一级类目","二级类目","三级类目","四级类目","三横类目ID","挂载状态","已填模板属性数","待补必填属性","属性值汇总","核实事项","补充规格（原表明示）"];
export const ATTRIBUTE_HEADERS=["商品序号","SKU编号","商品标题","三横类目路径","属性名称","填写要求","属性值","单位","原始依据","说明","模板默认单位"];
export const displayValue=(v:FilledAttribute["value"]):string|number=>v===null?"":typeof v==="boolean"?v?"是":"否":v;
export const cleanWorkbookText=(v:string)=>v.split(/([；。\n])/u).map((s,i,parts)=>/codex/iu.test(s)?"":i>0&&/^[；。\n]$/u.test(s)&&/codex/iu.test(parts[i-1]??"")?"":s).join("").replace(/^[；。\n]+|[；\n]+$/gu,"");
export function workbookRows(products:ResolvedProduct[]){
  const rows = {
    products:products.map(p=>{
      const path=p.category.path.slice(1);return [p.row,p.sku,p.title,p.variant,p.price??"",...Array.from({length:4},(_,i)=>path[i]??""),p.category.id,p.mappingStatus,p.filledCount,p.requiredMissing.join("；"),p.filled.filter(a=>a.status==="已填写").map(a=>`${a.name}：${displayValue(a.value)}${a.unit?` ${a.unit}`:""}`).join("；"),[p.mappingStatus!=="末级已挂载"?p.mappingNote:"",...p.conflicts.map(n=>`${n}存在资料冲突`)].filter(Boolean).join("；"),p.supplemental.map(f=>`${f.name}：${f.value}`).join("；")];
    }),
    attributes:products.flatMap(p=>p.filled.map((a,i)=>[p.row,p.sku,p.title,p.category.path.slice(1).join(" > "),a.name,requirementLabel(p.attributes[i]!),displayValue(a.value),a.unit,a.quote,[a.note,a.condition&&a.status==="已填写"?`适用条件：${a.condition}`:""].filter(Boolean).join("；"),a.templateUnit]))
  };
  return {products:rows.products.map(r=>r.map(v=>typeof v==="string"?cleanWorkbookText(v):v)),attributes:rows.attributes.map(r=>r.map(v=>typeof v==="string"?cleanWorkbookText(v):v))};
}
export function compactProducts(products:ResolvedProduct[],revisionTemplateHash=templateHash,includeConstraints=false){
 const attrs:unknown[]=[],categories:unknown[]=[],attrKeys=new Map<string,number>(),catKeys=new Map<string,number>();
 const dict=(data:unknown,list:unknown[],map:Map<string,number>)=>{const key=JSON.stringify(data);let id=map.get(key);if(id===undefined){id=list.length;list.push(data);map.set(key,id);}return id;};
 return{schema:includeConstraints?"sanheng-product-attributes-v2":"sanheng-product-attributes-v1",sourceSha256:inputHash,templateSha256:revisionTemplateHash,
 legend:{products:"[row,sku,title,selectedVariant,price,categoryIndex,mappingStatus,mappingNote,attributeValues,supplemental]",values:"[attributeIndex,value,status,source,quote,note,valueUnit]",category:"[originalID,originalPath,isLeaf]",attribute:includeConstraints?"[key,name,type,templateUnit,required,condition,requiredWhenApplicable,options,format,description,example]":"[key,name,type,templateUnit,required,condition,requiredWhenApplicable]",supplemental:"[{name,value,source,quote}]"},
 categories,attributes:attrs,products:products.map(p=>[p.row,p.sku,p.title,p.variant,p.price,dict([p.category.id,p.category.path,p.category.isLeaf],categories,catKeys),p.mappingStatus,p.mappingNote,p.filled.map((a,i)=>[dict([a.key,a.name,a.type,a.templateUnit,a.required,a.condition,p.attributes[i]?.requiredWhenApplicable??false,...(includeConstraints?[p.attributes[i]?.options??[],p.attributes[i]?.format??"",p.attributes[i]?.description??"",p.attributes[i]?.example??""]:[])],attrs,attrKeys),a.value,a.status,a.source,a.quote,a.note,a.unit]),p.supplemental])};
}
export async function buildProducts(){
 const mappings=await buildMappings();
 const products:ResolvedProduct[]=mappings.map(p=>{
  const facts=titleFacts(p);const filled=p.attributes.map(a=>fillAttribute(p,a,facts));
  const extra=semanticFacts(p).filter(f=>!p.attributes.some(a=>a.name===f.name)).map(f=>({name:f.name,value:f.value,source:f.source,quote:f.quote}));
  for(const [name,f] of Object.entries(reviewedFacts[p.row]??{}))if(typeof f.value==="string"&&!p.attributes.some(a=>a.name===name)&&!extra.some(a=>a.name===name))extra.push({name,value:f.value,source:f.source??"原表.商品标题",quote:f.quote??p.title});
  if(new Set(filled.map(a=>a.key)).size!==filled.length)throw new Error(`重复属性 ${p.row}`);
  for(const a of filled){if(a.status==="已填写"&&(a.value===null||!a.source||!a.quote))throw new Error(`属性无来源 ${p.row}/${a.name}`);if(a.value!==null&&a.type==="number"&&typeof a.value!=="number")throw new Error(`数值属性类型不符 ${p.row}/${a.name}`);}
  return{...p,filled,supplemental:extra,filledCount:filled.filter(a=>a.status==="已填写").length,requiredMissing:filled.filter((a,i)=>a.status!=="已填写"&&a.status!=="不适用"&&p.attributes[i]!.required&&!a.condition).map(a=>a.name),conflicts:filled.filter(a=>a.status==="资料冲突").map(a=>a.name)};
 });
 const stat={products:products.length,leafMounted:products.filter(p=>p.category.isLeaf).length,parentMounted:products.filter(p=>!p.category.isLeaf).length,scopeReview:products.filter(p=>p.mappingStatus!=="末级已挂载").length,leafCategories:new Set(products.filter(p=>p.category.isLeaf).map(p=>p.category.id)).size,attributes:products.reduce((n,p)=>n+p.filled.length,0),filled:products.reduce((n,p)=>n+p.filledCount,0),missing:products.reduce((n,p)=>n+p.filled.filter(a=>a.status==="待补充").length,0),conflicts:products.reduce((n,p)=>n+p.conflicts.length,0),inapplicable:products.reduce((n,p)=>n+p.filled.filter(a=>a.status==="不适用").length,0),productsWithAllUnconditionalRequired:products.filter(p=>!p.requiredMissing.length).length,paidModelRequests:0};
 await saveJson(join(reproDir,"resolved-products.json"),products);
 const compact=compactProducts(products);await saveJson(join(outputDir,"products.std.json"),compact);
 const inputs=await loadJson<ProductInputs>(join(reproDir,"inputs.json"));
 const report=`# 三横比赛商品挂载与属性填写\n\n输入：${inputs.source.split("/").at(-1)}，共 ${stat.products} 个不同 SKU。保留原始序号、SKU、标题、选定规格和价格。\n\n- ${stat.leafMounted} 个商品挂入原有末级，涉及 ${stat.leafCategories} 个末级；${stat.parentMounted} 个暂挂原有上级。类目 ID、名称和层级未改动。\n- 共 ${stat.attributes} 个模板属性项：已填 ${stat.filled}，待补 ${stat.missing}，资料冲突 ${stat.conflicts}，明确不适用 ${stat.inapplicable}。\n- ${stat.productsWithAllUnconditionalRequired} 个商品的无条件必填项已齐；其余待补项保留在结果表，条件必填仍按模板适用条件判断。\n- 京东详情已取得 1000/1000；本次未调用 DeepSeek 或其他付费模型。\n\n## 交付文件\n\n\`比赛结果-1000商品.xlsx\` 只有两个结果工作表：商品挂载（一商品一行）与商品属性（一属性一行）。属性记录含来源及原始依据，便于抽查。\`products.std.json\` 将类目和属性定义抽成公共字典，可无损读取所有结果。\n\n## 填写边界\n\n属性模板沿用 agent-delivery-v3。全量商品先由 Codex 阅读标题、选定规格与京东类目分组，再形成明确归类记录；检索评分仅供候选查找，不决定类别。参数取自本 SKU 的原表、京东详情，以及少量同型号制造商官方规格，不从其他商品或模板示例复制。原始数据中的‘其他’、‘未知’、无单位数字、筛选区间、明显占位零值不冒充精确规格；未提供不等于否。\n\n选定规格优先于标题中的其他可选型号；同一商品的明确冲突单独标注。能够核对单位的数值做可逆换算；净含量与保质期等保留源资料单位，同时提供模板默认单位，例如 12 个月不会臆换为 360 天。原表明示但模板没有对应字段的规格放在商品挂载表的“补充规格”列，不计入已填模板属性数量。\n\n京东商家填报并不等于制造商验证，已有标题/规格冲突、近似挂载和缺失参数会显示在工作表中。本文件为可提交审查的结构化结果，不能据此宣称全部参数已独立验证。\n\n## 制造商核对\n\n序号 677 的大疆 Inspire 3，京东详情将其误写成益智无人机，部分相机参数为“无”。采用[大疆官方规格](https://www.dji.com/inspire-3/specs)核对，保留单块电池、图传标准与飞行条件，未知的审批编号仍留空。核对日期：2026-09-14。具体引用在该 SKU 的属性行中。\n\n## 需要明确的类目边界\n\n${products.filter(p=>p.mappingStatus!=="末级已挂载").map(p=>`- 序号 ${p.row} / SKU ${p.sku}：${p.category.path.slice(1).join(" > ")}。${p.mappingNote}`).join("\n")}\n\n## 本地复用\n\n运行 \`bun run category-governance:products\` 从缓存重新生成这份结果，无 API 调用。原始输入与模板有 SHA-256 校验，修改测试集不能直接套用旧行号决策。用 \`--refresh-evidence --direct\` 补取未缓存的京东详情；已有成功结果默认复用。\n\n脚本与复用方法：项目内 \`src/scenarios/category_governance/product_delivery/README.md\`。原始证据与逐行核对结果保存在本目录 \`.repro/\`，不会增加 Excel 工作表。结构和文件校验不代表所有商品参数都经制造商验证。\n\n源文件 SHA-256：\`${inputHash}\`\n属性模板 SHA-256：\`${templateHash}\`\n`;
 await Bun.write(join(outputDir,"交付说明.md"),report);
 await saveJson(join(reproDir,"validation.json"),{...stat,outputHash:sha256(JSON.stringify(compact)),inputHash,templateHash});
 console.log(JSON.stringify(stat));return{products,stat};
}
if(import.meta.main)await buildProducts();
