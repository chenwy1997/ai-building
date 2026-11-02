import {join} from "node:path";
import {parseFlags,boolFlag} from "../util.ts";
import {outputDir,loadJson,saveJson,sha256,type ProductInputs} from "./io.ts";
import {readRevision,revisionDir,revisionRepro,propertyFromRow} from "./template-revision.ts";
import {reviseValue,REVIEWED_TEMPLATE_HASH} from "./revision-values.ts";
import {compactProducts,type ResolvedProduct} from "./build.ts";
import {writeProductExcel} from "./excel.ts";
import {writeProductView} from "./html.ts";

export async function buildRevision(template:string,changesFile:string){
 const revision=await readRevision(template,changesFile);
 const baselinePath=join(outputDir,".repro/resolved-products.json"),baselineBytes=await Bun.file(baselinePath).text();
 const baseline:ResolvedProduct[]=JSON.parse(baselineBytes),byCategory=new Map(revision.diffs.map(d=>[d.id,d]));
 const inputs=await loadJson<ProductInputs>(join(outputDir,".repro/inputs.json"));
 if(inputs.sourceHash!==compactProducts([]).sourceSha256||sha256(new Uint8Array(await Bun.file(inputs.source).arrayBuffer()))!==inputs.sourceHash)throw new Error("商品测试集已改变，需要重新审阅SKU语义决定");
 if(baseline.length!==1000||baseline.some((p,i)=>["row","sku","title","variant","price"].some(k=>JSON.stringify(p[k as keyof ResolvedProduct])!==JSON.stringify(inputs.products[i]?.[k as keyof typeof inputs.products[number]]))))throw new Error("商品基线与原测试集不一致");
 const reviewedDecisionsApplied=revision.sourceHash===REVIEWED_TEMPLATE_HASH;
 const changes:Array<Record<string,unknown>>=[];
 let affected=0,removed=0,added=0,updated=0,newlyFilled=0,withdrawn=0,changedValues=0;
 const products=baseline.map(p=>{
  const diff=byCategory.get(p.category.id);if(!diff)return p;affected++;
  const previous=new Map(p.attributes.map((a,i)=>[a.name,{a,value:p.filled[i]!,row:diff.before.find(r=>r[4]===a.name)!}]));
  const changedNames=new Set(diff.updated.map(u=>u.name));
  const attributes=diff.after.map(row=>{const old=previous.get(row[4]!);return old&&!changedNames.has(row[4]!)?old.a:propertyFromRow(row,old?.a);});
  const filled=attributes.map(a=>{
   const old=previous.get(a.name);
   if(old&&!changedNames.has(a.name))return old.value;
   const next=reviseValue(p,a,old?.value,old?.a,reviewedDecisionsApplied);
   if(!old)added++;else updated++;
   if(next.status==="已填写"&&old?.value.status!=="已填写")newlyFilled++;
   if(next.status!=="已填写"&&old?.value.status==="已填写")withdrawn++;
   if(old&&(old.value.value!==next.value||old.value.unit!==next.unit||old.value.status!==next.status))changedValues++;
   const fieldDiff=diff.updated.find(u=>u.name===a.name)?.fields??[];
   changes.push({row:p.row,sku:p.sku,category:p.category.id,name:a.name,action:old?"updated":"added",fields:fieldDiff,before:old?.value??null,after:next});
   return next;
  });
  for(const name of diff.removed){removed++;changes.push({row:p.row,sku:p.sku,category:p.category.id,name,action:"removed",before:previous.get(name)?.value,after:null});}
  return{...p,attributes,filled,supplemental:p.supplemental.filter(f=>!diff.removed.includes(f.name)&&!attributes.some(a=>a.name===f.name)),filledCount:filled.filter(a=>a.status==="已填写").length,requiredMissing:filled.filter((a,i)=>a.status!=="已填写"&&a.status!=="不适用"&&attributes[i]!.required&&!a.condition).map(a=>a.name),conflicts:filled.filter(a=>a.status==="资料冲突").map(a=>a.name)};
 });
 // Exhaustive scope checks before any delivery file is produced.
 const seen=new Set<string>();
 for(let i=0;i<products.length;i++){
  const p=products[i]!,b=baseline[i]!,diff=byCategory.get(p.category.id);
  if(seen.has(p.sku))throw new Error("重复SKU");seen.add(p.sku);
  for(const key of ["row","sku","title","variant","price","category","mappingStatus","mappingNote"] as const)if(JSON.stringify(p[key])!==JSON.stringify(b[key]))throw new Error(`越界修改商品或类目 ${p.row}/${key}`);
  if(!diff&&JSON.stringify(p)!==JSON.stringify(b))throw new Error(`未受影响商品被修改 ${p.row}`);
  if(diff&&JSON.stringify(p.attributes.map(a=>a.name))!==JSON.stringify(diff.after.map(r=>r[4])))throw new Error(`商品属性与修订模板不一致 ${p.row}`);
  if(new Set(p.attributes.map(a=>a.name)).size!==p.attributes.length)throw new Error(`重复属性 ${p.row}`);
  for(let j=0;j<p.filled.length;j++){
   const a=p.attributes[j]!,v=p.filled[j]!;
   if(v.status==="已填写"&&(v.value===null||!v.source||!v.quote))throw new Error(`缺属性依据 ${p.row}/${a.name}`);
   if(!diff?.updated.some(u=>u.name===a.name)&&!diff?.added.includes(a.name))continue;
   if(v.value!==null&&a.type==="number"&&typeof v.value!=="number")throw new Error(`数值类型错误 ${p.row}/${a.name}`);
   if(v.value!==null&&a.type==="boolean"&&typeof v.value!=="boolean")throw new Error(`布尔类型错误 ${p.row}/${a.name}`);
   if(v.value!==null&&a.type==="text"&&typeof v.value!=="string")throw new Error(`文本类型错误 ${p.row}/${a.name}`);
   if(v.value!==null&&a.type==="date"&&a.format==="yyyy-MM"&&!/^\d{4}-(0[1-9]|1[0-2])$/u.test(String(v.value)))throw new Error(`年月格式错误 ${p.row}/${a.name}`);
   if(v.value!==null&&["single","multi"].includes(a.type)&&String(v.value).split(";").some(x=>!a.options?.includes(x)))throw new Error(`枚举值错误 ${p.row}/${a.name}`);
  }
 }
 const stat={products:products.length,affectedProducts:affected,unchangedProducts:products.length-affected,affectedCategories:new Set(products.filter(p=>byCategory.has(p.category.id)).map(p=>p.category.id)).size,attributes:products.reduce((n,p)=>n+p.filled.length,0),filled:products.reduce((n,p)=>n+p.filledCount,0),missing:products.flatMap(p=>p.filled).filter(a=>a.status==="待补充").length,conflicts:products.flatMap(p=>p.filled).filter(a=>a.status==="资料冲突").length,inapplicable:products.flatMap(p=>p.filled).filter(a=>a.status==="不适用").length,removed,added,updated,newlyFilled,withdrawn,changedValues,productsWithAllUnconditionalRequired:products.filter(p=>!p.requiredMissing.length).length,paidModelRequests:0,jdRequests:0};
 await saveJson(join(revisionRepro,"resolved-products.json"),products);
 await saveJson(join(revisionRepro,"value-changes.json"),changes);
 await saveJson(join(revisionRepro,"validation.json"),{...stat,reviewedDecisionsApplied,baselinePath,baselineHash:sha256(baselineBytes),templateSource:revision.source,templateHash:revision.sourceHash,changeSource:revision.changeSource,changeHash:revision.changeHash,sourceInputHash:compactProducts(products).sourceSha256});
 const compact=compactProducts(products,revision.sourceHash,true);
 await saveJson(join(revisionDir,"products.std.json"),{...compact,revision:{source:revision.source,baselineTemplateSha256:revision.baselineHash,baselineProductsSha256:sha256(baselineBytes)}});
 const report=`# 专家模板修订后的商品属性结果

保留原1000个商品、原类目挂载与原表五列；仅针对专家模板的实际字段差异重新处理。本次全部使用缓存，京东请求0，付费模型请求0。

## 模板对比

修订模板含${revision.categoryCount}个末级类目、${revision.attributeCount}项属性定义。清单列出${revision.listedCount}个类目，其中${revision.diffs.length}个存在实际字段变化、${revision.unchangedListed.length}个字段内容未变。实际差异均在清单中，没有只按清单猜测删除。

测试集命中${stat.affectedCategories}个修改类目、${stat.affectedProducts}个商品，其余${stat.unchangedProducts}个商品逐字段保留。测试集商品属性新增${added}项、删除${removed}项、更新定义${updated}项。其他类目的新增属性不强行加到无关商品。

## 结果

- 属性总项数${stat.attributes}，已填${stat.filled}，待补${stat.missing}，资料冲突${stat.conflicts}，不适用${stat.inapplicable}。
- 新补出${newlyFilled}项有效值；${withdrawn}项原已填值因新定义要求、资料冲突或占位值撤回。另有单位及文本表达调整。改后${stat.productsWithAllUnconditionalRequired}个商品无条件必填齐全。
- 删除安全罐/气瓶的重复容量、挂烫机/熨斗的重复功率、毛毯的重复重量，其他属性和原始证据保留。
- CCC由布尔改文本，但京东“是”和认证型号不是有效证书核验。保留原始声明，缺证书/标签/官方记录的标为待补。
- 上市季节不能猜成月份；yyyy-MM没有准确月时留空。布尔示例改true不会把商品的false改成true。
${reviewedDecisionsApplied?`- 单位规范后，选定桌长1.8米、2.0米、3.2米分别填180、200、320厘米；电表30(100)A保留基本/最大电流语义。
- 冰箱1mm占位尺寸不再作为有效值；另一冰箱宽深参数自相矛盾、洗地机电池与续航信息矛盾，保留待核实。`:"- 本次是另一份专家模板；已执行通用字段适配，未套用上次逐SKU语义决定，需要复核新差异。"}

Excel仍只有“商品挂载”“商品属性”两个结果sheet；删除信息来源、填写状态列，清理所有工作表中的代理名称字样。内部差异记录在.repro/value-changes.json；CSV清单与实际模板逐字段比较记录在.repro/template-diff.json。

## 复用

在项目根目录执行：

\`\`\`sh
bun run category-governance:products --template="属性模板-修订版.xlsx" --changes="改动类目清单.csv"
\`\`\`

输出位于product-delivery-v2，原product-delivery-v1保留。重复执行复用相同输入文件的读取缓存与SKU证据；不同专家模板会重新比较差异，不套用旧模板内容。商品级语义修正仅绑定本次专家模板与原测试集，另换模板时须重审对应决定。

模板SHA-256：${revision.sourceHash}
原商品结果SHA-256：${sha256(baselineBytes)}
`;
 await Bun.write(join(revisionDir,"交付说明.md"),report);
 await writeProductView(products,revisionDir);
 return{products,stat,revision};
}

export async function main(argv:string[]){
 const {flags}=parseFlags(argv);
 if(boolFlag(flags.help)){console.log('bun run category-governance:products --template="属性模板-修订版.xlsx" --changes="改动类目清单.csv" [--json-only]');return;}
 const {products,stat}=await buildRevision(flags.template??"属性模板-修订版.xlsx",flags.changes??"改动类目清单.csv");
 console.log(JSON.stringify(stat));
 if(!boolFlag(flags["json-only"]))console.log(`Excel：${await writeProductExcel(products,revisionDir)}`);
 console.log(`修订结果：${revisionDir}`);
}
if(import.meta.main)main(Bun.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
