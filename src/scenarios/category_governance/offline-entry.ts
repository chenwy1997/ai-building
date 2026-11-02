import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { buildDraft, digest, stableJson, validateDraft } from "./offline/build.ts";
import { toStdText, fromStdText } from "./offline/codec.ts";
import { makePreview } from "./offline/view.ts";
import { writeExcel } from "./offline/excel.ts";
import { packs, commonDefinitions, platformOnlyFields, sources, KNOWLEDGE_VERSION } from "./offline/knowledge.ts";
import type { InputSnapshot } from "./offline/types.ts";
import { refineForDelivery, deliveryAudit } from "./offline/delivery.ts";
import { familyPolicies, numericUnitAliases, sharedSelectionFields, serviceFieldNames, compatibilityFieldNames, DELIVERY_KNOWLEDGE_VERSION } from "./offline/delivery-knowledge.ts";
import { specificRequirements } from "./offline/delivery-decisions.ts";

const SCENARIO=resolve(import.meta.dir),WORKSPACE=join(SCENARIO,"workspace");
function parse(argv: string[]) {
  const values=new Map<string,string>();
  for(let i=0;i<argv.length;i++){
    const arg=argv[i]!;
    if(arg==="--help"||arg==="--no-excel"||arg==="--delivery"){values.set(arg.slice(2),"true");continue;}
    if(!arg.startsWith("--"))throw new Error(`未知参数 ${arg}`);
    const equal=arg.indexOf("="),key=arg.slice(2,equal<0?undefined:equal);
    if(!["edition","version","tree","candidates","evidence"].includes(key))throw new Error(`未知参数 --${key}`);
    const value=equal<0?argv[++i]:arg.slice(equal+1);
    if(!value||value.startsWith("--"))throw new Error(`--${key} 缺少值`);values.set(key,value);
  }
  return values;
}
async function main() {
  const args=parse(Bun.argv.slice(2));
  if(args.has("help")){
    console.log("bun run category-governance:offline [--delivery] [--edition=版本名] [--version=v1] [--no-excel]\n--delivery：应用本轮交付知识，默认输出到 agent-delivery-v3。\n首次锁定本地类目、候选和京东证据快照。再次执行读取同一快照，不调用任何模型、数据库或京东接口。\n新输入使用新 --edition，可指定 --tree=... --candidates=... --evidence=...；要求候选完整覆盖该类目版本。");return;
  }
  const delivery=args.has("delivery");
  const edition=args.get("edition")??(delivery?"agent-delivery-v3":"agent-draft-v1"),version=args.get("version")??"v1";
  if(!/^[a-zA-Z0-9_-]+$/.test(edition)||!/^v\d+$/.test(version))throw new Error("edition/version 只接受安全的版本目录名称");
  const dir=join(WORKSPACE,"output",version,edition),repro=join(dir,".repro");
  const inputPath=join(repro,"input.snapshot.json.gz"),manifestPath=join(dir,"manifest.json");
  await mkdir(repro,{recursive:true});
  let input: InputSnapshot;
  if(await Bun.file(inputPath).exists()){
    if(["tree","candidates","evidence"].some(k=>args.has(k)))throw new Error("本版输入已锁定。更换输入请使用新的 --edition，避免覆盖可复现快照。");
    input=JSON.parse(gunzipSync(await readFile(inputPath)).toString("utf8"));
    console.log("读取本版已锁定的输入快照");
  }else{
    const paths={tree:resolve(args.get("tree")??join(WORKSPACE,"context",version,"category-tree.json")),candidates:resolve(args.get("candidates")??join(WORKSPACE,"output",version,"semantic-review","attribute-templates-v1.json")),evidence:resolve(args.get("evidence")??join(WORKSPACE,"context",version,"jd-attribute-evidence.json"))};
    const entries=await Promise.all(Object.entries(paths).map(async([key,path])=>({key,path,text:await Bun.file(path).text()})));
    const byKey=Object.fromEntries(entries.map(e=>[e.key,JSON.parse(e.text)]));
    input={schema:"sanheng-attribute-input-v1",capturedAt:new Date().toISOString(),tree:byKey.tree,candidates:byKey.candidates,evidence:byKey.evidence,hashes:Object.fromEntries(entries.map(e=>[e.key,digest(e.text)]))};
    if(input.tree.version!==version)throw new Error("输入类目版本与输出版本不一致");
    // Validate before creating the durable input pin.
    buildDraft(input,edition);
    await Bun.write(inputPath,gzipSync(JSON.stringify(input)));
    await Bun.write(join(repro,"source-paths.json"),JSON.stringify(paths,null,2));
  }
  if(input.schema!=="sanheng-attribute-input-v1"||input.tree.version!==version)throw new Error("输入快照格式或版本不符");
  const implementation=await Promise.all(["offline-entry.ts","offline/build.ts","offline/codec.ts","offline/excel.ts","offline/view.ts","offline/types.ts","offline/requirements.ts","offline/excel-worker.mjs",...(delivery?["offline/delivery.ts","offline/delivery-knowledge.ts","offline/delivery-decisions.ts"]:[])].map(p=>Bun.file(join(SCENARIO,p)).text()));
  const knowledgeHash=digest(stableJson({packs,commonDefinitions,platformOnlyFields,sources,KNOWLEDGE_VERSION,delivery:delivery?{familyPolicies,numericUnitAliases,DELIVERY_KNOWLEDGE_VERSION}:null}));
  const inputHash=digest(await readFile(inputPath));
  const buildHash=digest(stableJson({inputHash,knowledgeHash,implementation:implementation.map(digest)}));
  if(await Bun.file(manifestPath).exists()){
    const old=await Bun.file(manifestPath).json();
    if(old.buildHash===buildHash&&(args.has("no-excel")||Boolean(old.artifactHashes?.["attributes.xlsx"]))){
      // Verify, do not trust a stale manifest if someone changed or removed an output file.
      let intact=true; for(const [name,hash] of Object.entries(old.artifactHashes??{})){if(!await Bun.file(join(dir,name)).exists()||digest(await readFile(join(dir,name)))!==hash){intact=false;break;}}
      if(intact){console.log(`相同输入与知识版本，复用已校验结果；API 请求 0\n查看：${join(dir,"view.html")}${old.artifactHashes?.["attributes.xlsx"]?`\nExcel：${join(dir,"attributes.xlsx")}`:"\n本次不导出 Excel"}`);return;}
    }
  }
  console.log("离线编制：固定类目 → 绑定属性知识 → 保留来源 → 生成查看页与 Excel；API 请求 0");
  const built=buildDraft(input,edition),bindings=built.bindings;
  const document=delivery?refineForDelivery(built.document):built.document,compact=toStdText(document);
  validateDraft(document,input);
  if(stableJson(fromStdText(compact))!==stableJson(document))throw new Error("压缩还原不一致");
  const props=document.categories.flatMap(c=>[...c.shared,...c.properties]);
  const counts={nodes:input.tree.nodes.length,categories:document.categories.length,properties:props.length,curated:document.categories.filter(c=>c.treatment!=="historical-draft").length,recomposed:document.categories.filter(c=>c.treatment==="curated-template").length,core:document.categories.filter(c=>c.treatment==="curated-core").length,historical:document.categories.filter(c=>c.treatment==="historical-draft").length,curatedProperties:document.categories.reduce((n,c)=>n+Object.values(c.provenance).filter(p=>p.kind==="curated").length,0),jdLinkedCategories:document.categories.filter(c=>Object.values(c.provenance).some(p=>p.jdFields?.length)).length,required:props.filter(p=>p.required).length,conditional:props.filter(p=>p.condition).length,conditionalRequired:props.filter(p=>p.requiredWhenApplicable).length};
  const expandedBytes=Buffer.byteLength(JSON.stringify(document)),compactBytes=Buffer.byteLength(compact);
  const artifacts: string[]=[];
  const write=async(name:string,text:string)=>{await Bun.write(join(dir,name),text);artifacts.push(name);};
  const audit=delivery?deliveryAudit(document):undefined;
  if(audit){
    await Bun.write(join(repro,"delivery-audit.json"),JSON.stringify(audit,null,2));
    if(audit.conflicts.length)throw new Error(`交付检查发现 ${audit.conflicts.length} 项冲突，详见 .repro/delivery-audit.json`);
    Object.assign(counts,{deliveryRefined:audit.reviewedCategories,deliveryFields:audit.reviewedFields});
  }
  await write("templates.std.json",compact);
  await write("view.html",makePreview(JSON.parse(compact),sources,counts));
  const contextDir=join(dir,"context");await mkdir(contextDir,{recursive:true});
  const domains=[...new Set(document.categories.map(c=>c.category.path[1]!))];
  for(let i=0;i<domains.length;i++){
    const domain=domains[i]!,local={...document,categories:document.categories.filter(c=>c.category.path[1]===domain)};
    await write(`context/${String(i+1).padStart(2,"0")}-${domain.replaceAll("/","_")}.std.json`,toStdText(local));
  }
  await write(".repro/knowledge.json",JSON.stringify({version:KNOWLEDGE_VERSION,sources,packs,commonDefinitions,platformOnlyFields}));
  await write(".repro/category-bindings.json",JSON.stringify(bindings.map(({pack,targets})=>({packId:pack.id,mode:pack.mode,reason:pack.reason,categories:targets.map(n=>({id:n.id,path:n.pathNames}))}))));
  if(delivery)await write(".repro/delivery-knowledge.json",JSON.stringify({version:DELIVERY_KNOWLEDGE_VERSION,familyPolicies,numericUnitAliases,sharedSelectionFields,serviceFieldNames,compatibilityFieldNames,specificRequirements}));
  if(audit)await write(".repro/delivery-audit.json",JSON.stringify(audit,null,2));
  if(!args.has("no-excel")){
    console.log(`导出 ${counts.categories} 个类目、${counts.properties} 行属性……`);
    await writeExcel(document,join(dir,"attributes.xlsx")); artifacts.push("attributes.xlsx");
  }
  const report=`# 三横原类目属性初稿 ${edition}\n\n输入类目版本 ${version}。本次编制及运行没有调用 DeepSeek、其他付费模型或京东 VOP，API 请求 0。Codex 直接整理属性知识和绑定范围，脚本负责可重复的装配、结构检查、压缩与导出。\n\n## 打开结果\n\n- [查看与搜索全部类目](view.html)\n- [全量属性 Excel](attributes.xlsx)：只含“属性模板”sheet，12 列沿用比赛示例。\n- [可无损还原的结构化结果](templates.std.json)\n\n## 实际覆盖\n\n|项目|数量|\n|---|---:|\n|原类目全部节点|${counts.nodes}|\n|末级类目，均有模板|${counts.categories}|\n|属性配置行|${counts.properties}|\n|本次重新编制整套模板的类目|${counts.recomposed}|\n|本次补充核心属性、保留特有候选的类目|${counts.core}|\n|沿用历史草稿的类目|${counts.historical}|\n|本次知识定义形成的属性配置|${counts.curatedProperties}|\n|字段名与本地京东样本对应的类目|${counts.jdLinkedCategories}|\n\n全量覆盖表示所有原末级类目都有输出，**不表示 ${counts.categories} 类已经逐类完成行业审核**。重新编制和保留历史草稿在查看页逐类标明；不把历史 DeepSeek 结果重新包装成 Codex 逐项核验成果。本次版本供查看和选型字段评估，未覆盖旧的冻结基线或正式模板。\n\n## 属性依据\n\n1. 制造商资料与标准摘要：用于确认字段含义和量纲，不复制参考商品的具体值，也不把一个标准套给整个父类。\n2. 已有京东证据：仅用原采集中的明确 targetIds 关联，不做新的模糊映射、不访问 VOP。同名字段仅证明其在样本出现，不能证明必须填写或枚举完整。\n3. Codex 领域知识：记录在 knowledge.ts 中，是本次整理的可核查定义与选型判断。\n4. 历史候选：保留原始快照与字段来源，未把历史自评通过当行业事实。\n\n## 编制约定\n\n- 原类目 ID、名称和路径保持不变。平垫仍在原螺栓目录，但配垫圈属性；保暖耳罩不默认配 SNR。\n- 共用定义、类目绑定、条件属性分开保存。属性知识在代码之外作为数据维护；运行时不靠关键词推断商品类型。\n- 必填是完整建档的业务建议；资料缺失应待补，不能降为选填。品牌可确认填写“无品牌”，但未知不得冒充无品牌。\n- 条件必填使用 requiredWhenApplicable=true 与 condition 表达，required=false 保持“非无条件必填”的含义。不适用留空；适用但未知待补，不填 0 或 false。\n- 历史候选填写要求保留原标记；填写要求只显示必填、选填和条件要求，来源单独记录；共用属性归一化不再将原必填品牌/型号自动降级。\n- 本版无条件必填 ${counts.required} 行，条件必填 ${counts.conditionalRequired} 行。\n- 历史 single/multi 的样本选项改成开放文本；原选项仍在 suggestedValues，属于未核实候选，不在 Excel 的封闭选项列冒充行业全集。\n- 数值、量纲、区间、复合配置分别表达。DN 是标识，不视为精确内径；功率、显色指数、色温分开。\n\n## 压缩与复用\n\n完整含来源结果 ${expandedBytes.toLocaleString()} 字节，字典与树结构结果 ${compactBytes.toLocaleString()} 字节，减少 ${(100*(1-compactBytes/expandedBytes)).toFixed(1)}%。这是同一份结果的 UTF-8 字节对比，不是 API token 或缓存命中率。编译时已执行解压还原逐字段一致性检查。\n\ncontext/ 按 ${domains.length} 个原一级类目切分。属性、来源和长描述去重，类目通过索引引用；压缩文本可由模型读取。输入归档 gzip 只用于本地复现，不用于发送给模型。\n\n再次运行同一命令会校验输入、知识、实现与输出的哈希，直接复用结果，不收取模型费用。未来接入模型时可把固定知识与固定类目作为稳定前缀；此版没有 API 请求，因此不存在已验证的供应商缓存命中率。\n\n## 复现\n\n\`\`\`sh\nbun run category-governance:offline --edition=${edition}\n\`\`\`\n\n本版输入锁定于 .repro/input.snapshot.json.gz；使用新类目版本时新建 edition，显式提供 tree/candidates/evidence。原候选必须覆盖新树全部叶节点，否则明确报缺失，不创建占位模板。\n\n## 知识包\n\n|知识包|适用类目数|方式|\n|---|---:|---|\n${bindings.map(b=>`|${b.pack.title}|${b.targets.length}|${b.pack.mode==="replace"?"重新编制":"核心属性补充"}|`).join("\n")}\n\n## 参考资料\n\n${sources.map(s=>`- ${s.url?`[${s.title}](${s.url})`:s.title}：${s.supports}`).join("\n")}\n`;
  const deliveryReport=audit?`# 交付前完善记录\n\n本版保留三横原类目及已有属性成果，进行全量填写规则检查和针对性语义修正。不是把已有候选重新声称为逐类行业认证。\n\n- 校核覆盖 ${audit.reviewedCategories} 类、${audit.reviewedFields} 个字段定义。\n- 必填 ${audit.required} 行；条件必填 ${audit.conditionalRequired} 行。\n- 结构/格式冲突 ${audit.conflicts.length} 项；缺少特定必填属性的类目 ${audit.withoutSpecificRequired.length} 个（详细列表保留在 .repro/delivery-audit.json）。\n- 区分品牌状态、制造商型号、条件认证；按明确业务域及现有字段含义审定选型要求。\n- 单位只做同倍率记法归一；公称规格标识、视在功率、压制力及真空压力另行解释。\n- 修正油烟管道清洁服务的商品属性错配；听力防护要求注明降噪指标与测试依据。\n- 不调用付费模型或京东VOP；保持旧版本和冻结基线。\n\n复用命令：\n\n\`\`\`sh\nbun run category-governance:offline --delivery --edition=${edition}\n\`\`\`\n\n参考： [ISO DN规格定义](https://www.iso.org/standard/21274.html?browse=ics)、[Eaton VA与W](https://www.eaton.com/gb/en-gb/products/backup-power-ups-surge-it-power-distribution/backup-power-ups/va-versus-watts--eaton.html)、[3M听力防护产品参数](https://www.3m.com/3M/en_US/p/d/v000153015/)。这些资料支持字段含义，不代表厂家规定本项目的必填政策。\n\n`:"";
  await write("report.md",audit?deliveryReport+`## 输出与覆盖\n\n[搜索查看模板](view.html) · [比赛格式 Excel](attributes.xlsx) · [结构化结果](templates.std.json)\n\n- 原树 ${counts.nodes} 个节点，${counts.categories} 个末级类目，${counts.properties} 行属性。所有原类目 ID、名称和路径不变。\n- 累计整套重新编制 ${counts.recomposed} 类，补充核心知识 ${counts.core} 类；其余保留历史字段定义并按本轮知识完善填写要求和格式。不是声称全量逐类完成制造商资料核验。\n- 本轮明确末级类目决定 ${specificRequirements.length} 项，其他复用明确业务域和属性含义的建档知识；每项改动保留在结构化结果的 changes/provenance 中。\n- 已有京东同名字段关联 ${counts.jdLinkedCategories} 类，仅作为字段存在的样本证据，不推导必填或枚举全集。\n- XLSX 仅有“属性模板”sheet，12列沿用比赛参考；不额外加入导出信息或技术记录。\n\n## 填写口径\n\n必填是完整建档的建议要求，缺资料属于待补。条件必填在适用时填写，不适用留空。无品牌必须是经确认的事实；未知不能写成无品牌。布尔值未知留空，不填false。属性模板规定字段，不填造商品参数。历史候选选项保留用于追溯，未核实的列表使用开放文本。品牌、型号、属性名及类目不作为认证依据。\n\n## 复用与留痕\n\n输入锁定在 .repro/input.snapshot.json.gz，知识决定保存在 .repro/knowledge.json、delivery-knowledge.json 和 category-bindings.json。实现位于项目 offline 目录；没有新增模型调用链或自动付费重试。每次修改知识另建 edition，以保留历史版本。\n\n结构化结果 ${compactBytes.toLocaleString()} 字节，相同内容完整展开 ${expandedBytes.toLocaleString()} 字节，减少 ${(100*(1-compactBytes/expandedBytes)).toFixed(1)}%；已经无损还原校验。context 中有 ${domains.length} 个独立一级类目分片。本地相同输入与知识版本直接复用，这是本地结果复用，不是一次供应商缓存命中测试。\n\n## 范围边界\n\n本版可作为比赛评阅的属性模板交付候选。原类目中的“适用年龄”“直播”等名称无法唯一明确商品对象，保留原名，以产品类型、交付形态和条件属性承接；查看页标注这些已知歧义。结构检查通过不代表所有历史特有属性已获行业专家或制造商确认。\n`:report);
  const artifactHashes=Object.fromEntries(await Promise.all(artifacts.map(async p=>[p,digest(await readFile(join(dir,p)))])));
  await Bun.write(manifestPath,JSON.stringify({schema:"sanheng-offline-draft-manifest-v1",edition,categoryVersion:version,knowledgeVersion:KNOWLEDGE_VERSION,generatedAt:new Date().toISOString(),buildHash,knowledgeHash,inputHash,sourceHashes:input.hashes,counts,compression:{expandedBytes,compactBytes,losslessRoundTrip:true},apiRequests:0,providerCacheHitRate:null,artifactHashes},null,2));
  console.log(`完成：全量 ${counts.categories} 类，本次重新编制 ${counts.recomposed} 类、补充核心属性 ${counts.core} 类；API 请求 0\n查看：${join(dir,"view.html")}${args.has("no-excel")?"\n本次不导出 Excel":`\nExcel：${join(dir,"attributes.xlsx")}`}\n说明：${join(dir,"report.md")}`);
}
if(import.meta.main)main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
