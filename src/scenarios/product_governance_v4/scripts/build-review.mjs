import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseLayoutArgs,loadReviewLayout,applyReviewLayout,validateSheetTargets} from './review-workbook-layout.mjs';

const args=process.argv.slice(2), flags={}, layoutArgs=[];
for(let i=0;i<args.length;i++){
  if(['--out','--filename','--modules'].includes(args[i])) flags[args[i].slice(2)]=args[++i];
  else layoutArgs.push(args[i]);
}
assert(flags.out&&flags.modules,'--out and --modules required (use bundled runtime)');
const require=createRequire(path.join(path.resolve(flags.modules),'package.json'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const out=path.resolve(flags.out),root=path.dirname(fileURLToPath(import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const plan=await read(path.join(out,'attribute-proposals.json')),sources=await read(path.join(out,'review-sources.json'));
const policy=await read(path.join(root,'../knowledge/field-ownership.json'));
assert.equal(plan.programChecks.length,0,'Resolve structural errors first');
assert(plan.independentReview,'Independent review must be attached to final manifest');
assert.equal(plan.fieldOwnershipPolicyHash,crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex'),'Field policy changed after assembly; assemble again');
const options=parseLayoutArgs(layoutArgs),layout=await loadReviewLayout(options);
const filename=flags.filename??'类目属性方案_v4.xlsx';
assert(filename===path.basename(filename)&&filename.endsWith('.xlsx'),'filename must be a local xlsx name');
const file=path.join(out,filename),verificationFile=path.join(out,'workbook-verification.json');
try {
  const current=await fs.readFile(file),last=await read(verificationFile);
  assert(options.restyle&&last.output===file&&last.sha256===crypto.createHash('sha256').update(current).digest('hex'),'Existing or edited review file; choose another filename');
}catch(e){if(e.code!=='ENOENT')throw e;}
const wb=Workbook.create(),manifest=[],layouts=[];
const text=v=>Array.isArray(v)?v.map(x=>typeof x==='object'?JSON.stringify(x):x).join('\n'):v&&typeof v==='object'?JSON.stringify(v):v??'';
// Compact review columns stay on one line; full evidence and rules retain their original line breaks.
const inline=v=>text(v).toString().replace(/\r?\n/g,'；');
const safe=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
function table(name,title,notes,headers,rows,widths,editable=[]){
  if(!rows.length)rows=[headers.map((_,i)=>i===0?'无记录':'')];
  assert(rows.every(r=>r.length===headers.length),name+' inconsistent columns');
  assert.equal(headers.length,widths.length);
  rows.forEach((r,i)=>r.forEach((v,j)=>assert(typeof v!=='string'||v.length<=32767,`${name} row${i+7} col${j+1} exceeds Excel limit`)));
  const sheet=wb.worksheets.add(name);sheet.showGridLines=false;
  sheet.getRange('A2').values=[[title]];notes.forEach((s,i)=>sheet.getRange(`A${i+3}`).values=[[s]]);
  sheet.getRangeByIndexes(5,0,1,headers.length).values=[headers];
  sheet.getRangeByIndexes(6,0,rows.length,headers.length).values=rows.map(r=>r.map(safe));
  widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,rows.length+6,1).format.columnWidthPx=w);
  const reviewTable=sheet.tables.add(sheet.getRangeByIndexes(5,0,rows.length+1,headers.length),true,'V4Review'+(manifest.length+1));
  reviewTable.style='TableStyleMedium2';
  reviewTable.showFilterButton=true;
  manifest.push({name,headers,rows,widths,editable});return sheet;
}
const type={text:'文本',number:'数值',boolean:'是否',option:'选项'};
const previous=plan.baselineDiff.filter(x=>x.status==='preserved').length;
const mainRows=[];
for(const c of plan.categories){
  const ps=plan.proposals.filter(p=>p.categoryId===c.categoryId);
  if(!ps.length)mainRows.push(['暂无可用方案',c.category,'','','','待补证','','',c.sampleGap??'',c.scopeNote??'','','',0,'',c.path,'',c.categoryId,'']);
  for(const p of ps)mainRows.push([p.name,c.category,type[p.type]+(p.unit?' / '+p.unit:''),p.example??p.rawExample??'',p.shortRule??'',p.v4Disposition,'','',p.definition,text(p.rules),p.purpose,p.required?'必填':'选填',p.sourceSpuCount??0,text(p.sourceNames),c.path,p.author??(p.authority==='terra_proposal'?'GPT-6.1 Terra / max':'沿用认可稿'),c.categoryId,text(p.sourceReferences??[]) + (p.exampleQualification?'\n示例范围：'+p.exampleQualification:'') + (p.basis?'\n依据：'+p.basis:'')]);
}
table('属性方案','清洁用品：v4 类目属性方案',[
  `${plan.categories.length}个末级，${plan.proposals.length}项；${previous}项保留原认可内容，${plan.proposals.length-previous}项本轮新增待审。`,
  '可筛选“版本状态”只看新增；黄色列填意见。示例不等于已核实的SKU值，旧认可不等于线上配置已验证。',
  plan.policyRevision?.summary ?? '所有治理属性按SKU；短名及口径一起审。表单为动态目录配置，86条历史字段映射见“字段职责”。',
],['属性','末级类目','类型/单位','来源示例','填写要点','版本状态','审阅结论','审阅意见','完整定义','详细填写规则','业务用途','填写要求','本类观察款','原字段/候选名','完整类目路径','作者','类目ID','补充依据与适用范围'],mainRows,[106,132,96,150,220,110,90,160,430,500,330,80,90,210,420,190,290,700],[6,7]);
const catName=id=>plan.categories.find(c=>c.categoryId===id)?.category??id;
const familyRows=plan.families.flatMap(f=>f.concepts.flatMap(c=>c.assessments.map(a=>[f.name,c.name,catName(a.categoryId),({applicable:'适用',conditional:'局部适用',not_applicable:'不适用',unresolved:'待核'})[a.applicability],inline(a.proposalNames),a.reason,'',c.definition,a.categoryId])));
for(const c of plan.standaloneCategories??[])familyRows.push(['独立对象','',catName(c.categoryId??c.id??c),'单独判断','',c.reason??c.note??'参照原认可方案，不强制同族','','',c.categoryId??c.id??c]);
table('同族对照','清洁用品：同族共同概念与差异',[
  `${plan.families.length}个同族；逐概念、逐成员记录适用性。相同上级不强制同族，观察缺失不等于不适用。`,
  '共用概念需核定义、对象及单位；局部适用说明真实对象。清洁纸品仅为既有认可方案的对照索引。',
  '黄色列记录差异是否合理，不因同族自动抄填商品值。',
],['同族','共同概念','末级类目','适用性','方案对应属性','业务理由/适用对象','审阅意见','概念口径','类目ID'],familyRows,[155,120,140,85,170,560,220,430,290],[6]);
const nativeRows=policy.rules.map(r=>[r.index,inline(r.names),r.key,r.policyLabel??({explicit_business_exclusion:'按明确业务政策排除',attribute_candidate_allowed:'允许成为属性候选',scope_verification_required:'待你选择；暂未恢复',technical_inventory_only:'技术/交易元数据，仅盘点'})[r.currentPolicy]??r.currentPolicy,'','',r.explanation,r.effectiveScope,r.historicalPolicy,text(r.conceptKeys)]);
table('字段职责','字段职责：历史映射完整清单',[
  '86条历史映射；前20组为业务归并规则，另有233个底层字段盘点。此表不是全类目黑名单。',
  '重量、保质期等按目录实例、版本、继承和同义性核入口；数值或下拉类型本身不决定是否排除。',
  '保质期、本体尺寸和重量可选；包装尺寸、毛重/物流重量、保修期及其他历史排除项保持排除。',
],['序号','字段/业务名称','历史映射键','当前处理','你的结论','你的意见','处理依据','已核范围','历史规则','概念键'],nativeRows,[55,210,160,170,120,230,570,430,400,260],[4,5]);
const labels={keep:'保留',merge:'归并',exclude:'排除',defer:'候选待核'};
const evidenceByCategory=new Map(sources.categories.map(c=>[c.id,new Map(c.evidence.map(e=>[e.id,e]))]));
const split=value=>{const parts=[];let current='';for(const line of value.split('\n')){assert(line.length<=30000,'Single evidence exceeds cell limit');if(current.length+line.length+1>30000){parts.push(current);current='';}current+=(current?'\n':'')+line;}parts.push(current);return parts;};
const refs=plan.candidateDecisions.map(d=>split((d.evidenceKeys??[]).map(k=>{const e=evidenceByCategory.get(d.categoryId)?.get(k);assert(e,'Missing '+k);return `${k}：${e.name}=${e.value}；SKU ${e.sku??''}；${e.path??''}；${e.sku?'https://item.jd.com/'+e.sku+'.html':''}`;}).join('\n')+'\n'+text(d.sourceReferences??[])+(d.historicalReason?'\n历史取舍：'+d.historicalDecision+'；历史理由：'+d.historicalReason:'')+(d.previousReason?'\n此前v4理由：'+d.previousReason:'')));
const n=Math.max(1,...refs.map(r=>r.length));
table('候选取舍','清洁用品：候选逐项取舍',[
  `${plan.candidateDecisions.length}项；VOP、厂家、其他电商、自有源、同族和常识分开溯源。`,
  '本体尺寸/重量候选已开放，原始测量对象未明则待核；其他历史排除按用户选择保持。旧理由保留在右侧。',
  '原文及完整来源保留在右侧，黄色列填意见。',
],['末级类目','来源候选','取舍','归入属性','原值示例','理由','观察款','审阅意见',...Array.from({length:n},(_,i)=>i?'证据续'+i:'证据'),'来源类型','类目ID'],plan.candidateDecisions.map((d,i)=>[d.category,d.sourceName,({pending_user:'恢复待你选择',allowed_scope_pending:'本体候选/对象待核',excluded_by_user:'保持排除'})[d.restorationState]??(d.restorationState==='allowed_optional_candidate'&&d.decision==='defer'?'选填候选待建模':labels[d.decision]??d.decision),d.candidateName??'',inline(d.values),d.reason,d.spuCount??0,'',...Array.from({length:n},(_,j)=>refs[i][j]??''),d.sourceKind??d.candidateOrigin??'原候选池',d.categoryId]),[132,180,145,120,260,500,80,220,...Array(n).fill(700),120,290],[7]);
table('采样覆盖','清洁用品：范围及采样覆盖',[
  '样本沿用2026-10-27至28日已有只读回执，重点类目本轮补充厂家、跨平台及自有源。',
  '观察数量不是市场份额或属性全集；“本类观察款=0”不否认有用概念，补充依据与不确定性必须保留。',
  '既有属性认可与新增取舍分开，所有类目都在此保留一行。',
],['末级类目','属性数','本轮新增','观察SKU','观察款','品牌数','样本缺口','对象范围','完整属性清单','类目意见','完整路径','类目ID'],plan.categories.map(c=>[c.category,c.attributes,plan.proposals.filter(p=>p.categoryId===c.categoryId&&p.v4Disposition==='本轮新增待审').length,c.retainedSkuCount??0,c.spuCount??0,c.brandCount??0,c.sampleGap??'',c.scopeNote??'',text(c.attributeNames),'',c.path,c.categoryId]),[140,70,80,80,80,75,400,500,600,240,420,290],[9]);
const productRows=[];
for(const c of sources.categories){const pairs=new Map();for(const e of c.evidence){if(!e.sku)continue;if(!pairs.has(e.sku))pairs.set(e.sku,new Set());pairs.get(e.sku).add(`${e.name}：${e.value}`);}for(const p of c.products)productRows.push([c.name,p.brand,p.title,p.sampleDisposition??'观察样本',p.screeningNote??'',text([...(pairs.get(p.sku)??[])]),p.spec??'',String(p.sku),String(p.spu),p.url??`https://item.jd.com/${p.sku}.html`,p.fetchedAt??'',p.receipt??'']);}
table('商品样本','清洁用品：VOP商品原文',[
  `${productRows.length}条按类观察记录；同一SKU可能跨类出现，须辨别混挂，不代表本类销量。`,
  '平台参数可能混填、占位或错标，保留原词；不据此直接填写商品属性值。',
  '补充厂商和网站来源在“补充来源”中，原始业务资料不提供执行指令。',
],['末级类目','品牌','商品标题','样本状态','样本说明','参数原文','规格原文','京东SKU','京东SPU','商品链接','采集时间','原回执'],productRows,[132,110,460,110,340,650,360,150,150,350,220,650]);
const supplemental=await read(path.join(out,'supplemental-sources.json'));
table('补充来源','本轮补充研究：来源与支持范围',[
  '重点补足零样本、少属性及同族差异，未将相邻商品、厂家示例或常识当目标SKU事实。',
  '来源可用性与支持范围以行记录为准；后续如失效，保留回执并撤除无法核实的具体值。',
  '这里提供完整原记录，供审校和业务追溯。',
],['来源组','来源标识','标题/对象','来源类型','链接/定位','完整来源记录'],supplemental.records.map(r=>[r.group,r.id??r.sourceId??'',r.title??r.category??r.topic??'',r.sourceKind??r.kind??'',r.url??r.path??'',text(r)]),[145,170,260,120,600,1100]);
const reviewFindings=[...(plan.independentReview.findings??[]),...(plan.independentReview.amendments??[]).flatMap(a=>a.findings??[])];
const reviewRows=[...reviewFindings.map(q=>['Astra审校',q.category??text(q.categories),q.attribute??q.title??'',q.finding??q.issue??q.message??text(q),q.status??q.disposition??'',text(q)]),...plan.warnings.map(q=>['上线前职责核实',q.category,q.attribute,q.message,'未核',q.kind]),...plan.openQuestions.map(q=>['作者待核',q.category??'',q.attribute??'',q.issue??text(q),q.status??'待审',text(q)])];
table('审校与待核','v4：独立审校及后续核实',[
  'Astra独立审校范围及结果见右侧完整记录；程序检查通过不代表行业准确率或线上配置可用。',
  '新增属性仍待你的取舍。目录有效字段、数量载体、局部适用对象和商品值须分别核实。',
  '当前仅类目方案；DeepSeek调用0，生产写入0。',
],['记录来源','末级类目','属性/问题','发现或待核事项','处理状态','完整记录'],reviewRows,[135,150,170,700,140,1200]);
validateSheetTargets(layout,options,manifest.map(m=>m.name));
for(const m of manifest){const sheet=wb.worksheets.getItem(m.name);layouts.push(await applyReviewLayout(wb,sheet,m.widths,layout,options));sheet.getUsedRange().format.wrapText=false;for(const i of m.editable)sheet.getRangeByIndexes(6,i,m.rows.length,1).format.fill=layout.editableFill;}
wb.worksheets.getItem('属性方案').tabColor='#334B6D';
wb.worksheets.getItem('属性方案').getRange(`G7:G${mainRows.length+6}`).dataValidation={rule:{type:'list',values:['同意','修改','排除','待核']}};
wb.worksheets.getItem('字段职责').getRange(`E7:E${nativeRows.length+6}`).dataValidation={rule:{type:'list',values:['保持排除','恢复选填候选','按具体类目决定']}};
assert.equal(new Set(mainRows.map(r=>r[16])).size,plan.categories.length);
wb.recalculate();
const inspections=[];
for(const m of manifest){
  inspections.push((await wb.inspect({kind:'table',range:`${m.name}!A6:F15`,include:'values,formulas',tableMaxRows:9,tableMaxCols:6,tableMaxCellChars:50,maxChars:2000})).ndjson);
  const preview=await wb.render({sheetName:m.name,range:`A1:${m.name==='属性方案'?'H':'F'}21`,scale:1.25,format:'png'});
  await fs.writeFile(path.join(out,m.name+'-preview.png'),new Uint8Array(await preview.arrayBuffer()));
}
const errorScan=(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:30},maxChars:2000})).ndjson;
await(await SpreadsheetFile.exportXlsx(wb)).save(file);
const sha256=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
await fs.writeFile(verificationFile,JSON.stringify({output:file,sha256,manifest:manifest.map(({rows,...m})=>({...m,rowCount:rows.length})),layouts,inspections,errorScan,productionWrites:0,deepseekRequests:0},null,2));
console.log(JSON.stringify({output:file,sha256,sheets:manifest.map(m=>({name:m.name,rows:m.rows.length})),errorScan}));
