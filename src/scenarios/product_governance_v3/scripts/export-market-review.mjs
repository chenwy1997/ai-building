import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseLayoutArgs,loadReviewLayout,applyReviewLayout,validateSheetTargets} from './review-workbook-layout.mjs';
const modules=process.env.PGV3_NODE_MODULES??path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const requireBundled=createRequire(path.join(modules,'__market_review__.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(requireBundled.resolve('@oai/artifact-tool')).href);
const options=parseLayoutArgs(process.argv.slice(2));
if(options.positionals.length!==1||options.restyle)throw Error('expected one verified market run directory');
const dir=path.resolve(options.positionals[0]),j=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const review=await j(path.join(dir,'raw-review.json')),manifest=await j(path.join(dir,'market-run.manifest.json'));
assert.equal(review.codexBusinessEdits,0);assert.equal(review.productionWrites,0);
const category=(await j(manifest.files.pool)).categories.find(c=>c.id===review.category.id);
const a=review.stages.definition.result,s=review.stages.selection.result;
const layout=await loadReviewLayout(options),wb=Workbook.create(),tables=[],layouts=[];
const out=path.join(dir,'review');await fs.mkdir(out,{recursive:true});
const output=path.join(out,category.name+'_DeepSeek原始属性方案.xlsx');
try{await fs.access(output);console.log(JSON.stringify({output,preservedExisting:true}));process.exit(0);}catch(e){if(e.code!=='ENOENT')throw e;}
const safe=v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v;
const types={text:'文本',number:'数值',boolean:'是否',option:'选项',date:'日期'};
const actions={keep:'保留',merge:'归并',exclude:'排除',defer:'待核候选'};
function sheet(name,title,notes,headers,rows,widths,editable=[]) {
  assert(rows.length&&rows.every(r=>r.length===headers.length));
  const sh=wb.worksheets.add(name);sh.getRange('A2').values=[[title]];
  notes.forEach((v,i)=>sh.getRange(`A${i+3}`).values=[[v]]);
  sh.getRangeByIndexes(5,0,1,headers.length).values=[headers];
  sh.getRangeByIndexes(6,0,rows.length,headers.length).values=rows.map(r=>r.map(safe));
  widths.forEach((v,i)=>sh.getRangeByIndexes(0,i,rows.length+6,1).format.columnWidthPx=v);
  sh.tables.add(sh.getRangeByIndexes(5,0,rows.length+1,headers.length),true,'MarketTable'+tables.length).style='TableStyleMedium2';
  tables.push({name,headers,rows,widths,editable});return sh;
}
const mainRows=a.attributes.map(x=>[
  x.name,types[x.type]+(x.unit?' / '+x.unit:''),x.required?'必填':'选填',x.examples.join('\n'),x.fillRule,'','',
  x.definition,x.businessUse,x.applicability,x.requiredReason,x.quantityResponsibility,x.enumValues.join('；'),x.sourceNames.join('、'),x.openQuestions.join('\n'),
  Object.hasOwn(x,'unit')?(x.unit??'null（模型明确返回）'):'未返回（保留原样）',
]);
sheet('属性方案',category.name+'：DeepSeek原始属性方案',[
  `${category.stats.skuCount}个SKU，${category.stats.spuCount}个京东SPU，${category.stats.brandCount}个品牌。DeepSeek给出${a.attributes.length}项属性，全部待人工审阅。`,
  '名称、取舍、定义及规则保持模型原文。黄色列填同意、修改、排除或待核；空白表示未审。',
  '先看名称、例值、填写要求和口径。全文保留在单元格及备注；模型的未决问题与程序发现见“待核问题”。',
],['属性','类型/单位','填写要求','原文例值','填写要点','审阅结论','审阅意见','完整定义','选择用途','适用对象','必填理由','数量职责','枚举值','平台原字段','模型待核问题','单位字段返回'],mainRows,[118,92,78,170,250,90,170,410,330,300,350,380,180,180,460,170],[5,6]);
const evidence=new Map(category.evidence.map(e=>[e.id,e]));
const sourceFor=ids=>ids.map(id=>{const e=evidence.get(id);return e?`${id}：${e.name}=${e.value}；SKU ${e.sku}；${e.path}`:`${id}（引用不存在）`;}).join('\n');
const displayedDecisionKeys=['sourceName','action','attributeName','reason','businessUse','professionalBasis','valueEvidence','evidenceIds','nativeOwnerKey','applicability'];
const decisionExtras=d=>Object.fromEntries(Object.entries(d).filter(([key])=>!displayedDecisionKeys.includes(key)));
const hasDecisionExtras=s.decisions.some(d=>Object.keys(decisionExtras(d)).length>0);
sheet('候选取舍',category.name+'：DeepSeek候选取舍',[
  '每个来源字段一行，包含保留、归并、排除和待核项；“归并”可能转交系统字段，请看原生职责与理由。',
  '平台频次仅说明本次样本覆盖，不能代表市场份额、正确率或必填必要性。',
  '右侧保留模型对业务用途、专业依据、取值证据的原始说明。',
],['平台原字段','取舍','归入属性','原值分布','理由','审阅结论','审阅意见','观察款','品牌数','业务用途','专业口径','取值证据','适用对象','原生职责','引用证据',...(hasDecisionExtras?['模型补充字段']:[])],
  s.decisions.map(d=>{const p=category.pool.find(x=>x.name===d.sourceName);return[
    d.sourceName,actions[d.action],d.attributeName,p?.values.map(v=>`${v.value}（${v.spuCount}款）`).join('\n')??'',d.reason,'','',p?.spuCount??null,p?.brandCount??null,
    d.businessUse,d.professionalBasis,d.valueEvidence,d.applicability,d.nativeOwnerKey??'',sourceFor(d.evidenceIds),
    ...(hasDecisionExtras?[Object.keys(decisionExtras(d)).length?JSON.stringify(decisionExtras(d),null,2):'']:[]),
  ];}),[120,90,125,260,360,90,170,76,76,340,340,340,260,140,650,...(hasDecisionExtras?[480]:[])],[5,6]);
sheet('商品样本',category.name+'：商品与原始参数',[
  `京东VOP搜索后，按标题初筛并轮换品牌选择${category.stats.skuCount}个SKU；SPU按商品详情去重计数。`,
  '标题符合平口垃圾袋，不代表所有平台字段都填写正确；样本原词保留，未人工修正。',
  '商品链接与源参数位置供核对；本表保留全部采样商品，模型请求统计另见运行用量。',
],['品牌','商品标题','平台参数原文','规格原文','原文尺寸','京东SKU','京东SPU','商品链接','采集时间'],
  category.products.map(p=>[p.brand,p.title,category.evidence.filter(e=>e.sku===p.sku&&['平台参数','HTML参数'].includes(e.kind)).map(e=>`${e.name}：${e.value}（${e.path}）`).join('\n'),p.spec,p.size,p.sku,p.spu,p.url,p.fetchedAt]),
  [110,380,600,300,180,145,145,350,220]);
const findings=[
  ...review.checks.map(x=>[x.kind==='schema'?'程序结构检查':x.kind==='candidate_coverage'?'候选覆盖检查':'阶段差异',x.stage,x.message,'待人工复核','']),
  ...s.openQuestions.map(x=>['DeepSeek待核问题','候选取舍',x,'待人工复核','']),
  ...a.openQuestions.map(x=>['DeepSeek待核问题','属性定义',x,'待人工复核','']),
];
const runRows=review.requests.map(r=>[r.stage==='selection'?'候选取舍':'属性定义',r.turn,r.inputTokens,r.cacheHitTokens,r.cacheMissTokens,r.outputTokens,r.reasoningTokens,r.cacheHitRate,r.localReplay?'是':'否',r.key]);
const run=sheet('运行用量','本轮模型用量',[
  `deepseek-flash / low。真实请求${review.requests.length}次，业务纠错0次；Codex业务内容改动0，生产写入0。`,
  '下面统计服务商token缓存；本地回执复用单独列示。首轮包含冷启动，累计命中率按token加权。',
  review.previousLocalFailure?`先前本机代理协议失败记录及${review.previousLocalFailure.reservedCny}元保守预留保留；下表只统计收到usage的请求。`:'预留是本地成本上界，不是服务商账单。未自动重跑业务纠错。',
],['阶段','轮次','输入token','缓存命中','缓存未命中','输出token','思考token','命中率','本地回放','请求ID'],runRows,[120,60,105,105,105,105,105,90,85,500]);
const totalsRow=runRows.length+8;
run.getRange(`A${totalsRow}`).values=[['合计']];
for(const col of ['C','D','E','F','G'])run.getRange(`${col}${totalsRow}`).formulas=[[`=SUM(${col}7:${col}${runRows.length+6})`]];
run.getRange(`H${totalsRow}`).formulas=[[`=D${totalsRow}/C${totalsRow}`]];
sheet('待核问题',category.name+'：原始输出待核问题',[
  '程序记录结构、候选覆盖与阶段差异，不替模型修改；例如数量可能已转交系统字段，阶段差异仍需核实。',
  'DeepSeek待核问题逐字保留。黄色列可写意见，具体属性的采用请在属性方案中填写。',
  '模型自述与实际结构可能不一致，人工意见优先；本次没有自动采用或填写商品值。',
],['记录来源','阶段','问题原文','状态','人工意见'],findings,[135,110,620,120,280],[4]);
validateSheetTargets(layout,options,tables.map(t=>t.name));
for(const t of tables) {
  const sh=wb.worksheets.getItem(t.name);
  layouts.push(await applyReviewLayout(wb,sh,t.widths,layout,options));
  // Fixed-height wrapped cells clip within their own column; complete text also
  // remains in the note. This keeps long model text out of blank review inputs.
  for(const col of t.editable)sh.getRangeByIndexes(6,col,t.rows.length,1).format.fill=layout.editableFill;
  if(t.editable.length===2)sh.getRangeByIndexes(6,t.editable[0],t.rows.length,1).dataValidation={rule:{type:'list',values:['同意','修改','排除','待核']}};
}
run.getRange(`C7:G${totalsRow}`).setNumberFormat('#,##0');run.getRange(`H7:H${totalsRow}`).setNumberFormat('0.0%');
wb.worksheets.getItem('商品样本').getRange(`F7:G${category.products.length+6}`).setNumberFormat('@');
wb.recalculate();
// Export rows preserve all model-authored values, including absent unit keys in the audit.
assert.deepEqual(mainRows.map(r=>r[0]),a.attributes.map(x=>x.name));
assert(mainRows.every(r=>r[5]===''&&r[6]===''));
const errors=(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:20},maxChars:2000})).ndjson;
for(const t of tables) {
  const range=t.name==='运行用量'?`A1:I${totalsRow}`:t.name==='待核问题'?'A1:E17':`A1:G${Math.min(t.rows.length+6,23)}`;
  const png=await wb.render({sheetName:t.name,range,scale:1.25,format:'png'});
  await fs.writeFile(path.join(out,t.name+'-preview.png'),new Uint8Array(await png.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
const digest=crypto.createHash('sha256').update(await fs.readFile(output)).digest('hex');
await fs.writeFile(path.join(out,'workbook-verification.json'),JSON.stringify({output,sha256:digest,layouts,errors,
  tables:tables.map(({name,headers,rows})=>({name,headers,rows:rows.length})),mainRows,modelResultHash:review.stages.definition.parsedHash,
  inspection:(await wb.inspect({kind:'table',range:`运行用量!A${totalsRow}:I${totalsRow}`,include:'values,formulas',tableMaxRows:1,tableMaxCols:9,maxChars:1800})).ndjson,
  codexBusinessEdits:0,humanReviewCellsPrefilled:0},null,2));
console.log(JSON.stringify({output,sha256:digest,attributeCount:a.attributes.length,decisionCount:s.decisions.length,cache:review.tokenUsage,errors}));
