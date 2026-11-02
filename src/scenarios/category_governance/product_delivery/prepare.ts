import { join } from "node:path";
import { loadJson, saveJson, reproDir, type ProductInputs, type DetailsSnapshot } from "./io.ts";
import { loadGoodsApi } from "./collect.ts";
import { fromStdText } from "../offline/codec.ts";
import { parseFlags, boolFlag } from "../util.ts";

export interface EvidenceField { name: string; value: string; source: string; group?: string }
export interface PreparedProduct {
  row: number; sku: string; title: string; variant: string; price: number | null;
  jdTitle: string; jdCategoryIds: string[]; jdCategory: string[]; fields: EvidenceField[];
}
const text = (v: unknown): string => typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v).trim() : "";
function flatValues(v: unknown): string[] { return Array.isArray(v) ? v.flatMap(flatValues) : v && typeof v === "object" ? Object.values(v).flatMap(flatValues) : [text(v)].filter(Boolean); }
export function extractFields(detail: Record<string, unknown>): EvidenceField[] {
  const result: EvidenceField[] = [];
  for (const key of ["brandName", "seoModel", "color", "size", "saleUnit", "productArea", "wareInfo", "warrantDesc"]) {
    if (text(detail[key])) result.push({ name: ({brandName:"品牌",seoModel:"京东检索型号",color:"京东颜色",size:"京东尺寸",saleUnit:"销售单位",productArea:"产地",wareInfo:"包装清单",warrantDesc:"质保说明"} as Record<string,string>)[key]!, value: text(detail[key]), source: `JD.${key}` });
  }
  const add = (v: unknown, source: string, group?: string) => {
    if (!v || typeof v !== "object") return;
    const record = v as Record<string, unknown>;
    const name = text(record.cateAttrName ?? record.paramAttrName ?? record.attrName ?? record.name);
    const values = flatValues(record.cateAttrValList ?? record.paramAttrValList ?? record.attrValue ?? record.value);
    if (name && values.length) result.push({ name, value: [...new Set(values)].join("；"), source, ...(group ? {group} : {}) });
  };
  if (Array.isArray(detail.categoryAttrList)) detail.categoryAttrList.forEach((a,i) => add(a, `JD.categoryAttrList[${i}]`));
  if (Array.isArray(detail.paramGroupAttrList)) detail.paramGroupAttrList.forEach((g,i) => {
    if (!g || typeof g !== "object") return;
    const group = g as Record<string, unknown>;
    const list = group.paramAttributeList ?? group.paramAttrList;
    if (Array.isArray(list)) list.forEach((a,j) => add(a, `JD.paramGroupAttrList[${i}][${j}]`, text(group.paramGroupName)));
  });
  return result;
}
export async function prepare(argv: string[]) {
  const { flags } = parseFlags(argv);
  const input = await loadJson<ProductInputs>(join(reproDir,"inputs.json"));
  const details = await loadJson<DetailsSnapshot>(join(reproDir,"jd-details.json.gz"));
  const refsPath = join(reproDir,"jd-categories.json");
  const refs: Record<string,{categoryId:number;categoryName:string}> = await loadJson<Record<string,{categoryId:number;categoryName:string}>>(refsPath).catch(()=>({}));
  const ids = [...new Set(Object.values(details.items).flatMap(item => text(item.detail?.category).split(";").filter(Boolean)))];
  const missing = ids.filter(id => !refs[id]);
  if (missing.length && !boolFlag(flags.offline)) {
    const api = await loadGoodsApi("/Users/sanheng/Project/sanheng/ai-core", boolFlag(flags.direct));
    // Small batches respect the existing VOP API's list contract.
    for (let i=0;i<missing.length;i+=20) {
      const rows = await api.getCategoryInfoList({categoryId:missing.slice(i,i+20).map(Number)});
      for (const row of rows ?? []) refs[String(row.categoryId)] = row;
      await saveJson(refsPath,refs);
    }
  }
  const products: PreparedProduct[] = input.products.map(p => {
    const detail = details.items[p.sku]?.detail ?? {}, jdCategoryIds = text(detail.category).split(";").filter(Boolean);
    return {...p, jdTitle:text(detail.skuName), jdCategoryIds, jdCategory:jdCategoryIds.map(id=>refs[id]?.categoryName??id),fields:extractFields(detail)};
  });
  await saveJson(join(reproDir,"products.json"),products);
  const templates=fromStdText(await Bun.file(join(import.meta.dir,"../workspace/output/v1/agent-delivery-v3/templates.std.json")).text());
  const categories=templates.categories.map((c,i)=>({index:i,id:c.category.id,path:c.category.path.slice(1),names:[...c.shared,...c.properties].map(p=>p.name)}));
  await saveJson(join(reproDir,"category-index.json"),categories);
  const groups=new Map<string,PreparedProduct[]>();
  for(const p of products){const key=p.jdCategory.join("/")||"京东类目缺失"; const g=groups.get(key)??[];g.push(p);groups.set(key,g);}
  const sorted=[...groups].sort((a,b)=>b[1].length-a[1].length);
  await Bun.write(join(reproDir,"review-groups.txt"), sorted.map(([path,rows],i)=>`${i+1}. ${path} (${rows.length})\n${rows.map(p=>`${p.row}|${p.title}|${p.variant}`).join("\n")}`).join("\n\n"));
  console.log(JSON.stringify({products:products.length,details:Object.values(details.items).filter(x=>x.status==="ok").length,jdCategories:groups.size,categoryRefs:Object.keys(refs).length,missingCategoryRefs:ids.filter(id=>!refs[id]),fields:products.reduce((n,p)=>n+p.fields.length,0)}));
}
if(import.meta.main) await prepare(Bun.argv.slice(2));
