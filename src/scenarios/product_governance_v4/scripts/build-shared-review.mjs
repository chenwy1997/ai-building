import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parseLayoutArgs,loadReviewLayout,applyReviewLayout,validateSheetTargets} from './review-workbook-layout.mjs';
import {validateAttribute,validateSharedDefinitions} from '../attribute-contract.mjs';
import {optionsDisplay,bindingOptionsDisplay} from '../shared-definitions.mjs';

const args=process.argv.slice(2), flags={}, layoutArgs=[];
for(let i=0;i<args.length;i++){
  if(['--out','--filename','--modules','--title'].includes(args[i]))flags[args[i].slice(2)]=args[++i];
  else layoutArgs.push(args[i]);
}
assert(flags.out&&flags.modules,'--out and --modules required; use bundled runtime');
const options=parseLayoutArgs(layoutArgs),layout=await loadReviewLayout(options);
const require=createRequire(path.join(path.resolve(flags.modules),'package.json'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const out=path.resolve(flags.out),read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const planFile=path.join(out,'attribute-proposals.json'),planBytes=await fs.readFile(planFile),plan=JSON.parse(planBytes);
const filename=flags.filename??'类目属性方案_三表修订版.xlsx';
assert(filename===path.basename(filename)&&filename.endsWith('.xlsx'),'filename must be a local xlsx name');
const file=path.join(out,filename),verificationFile=path.join(out,'workbook-verification.json');
try {const last=await read(verificationFile);assert(options.restyle&&last.output===file&&last.sha256===hash(await fs.readFile(file)),'Refusing to overwrite edited workbook');}
catch(e){if(e.code!=='ENOENT')throw e;else {try{await fs.access(file);throw Error('Existing workbook without verification; choose another filename');}catch(missing){if(missing.code!=='ENOENT')throw missing;}}}
assert.equal(plan.attributeContractVersion,1);
assert.equal(plan.adoption,'pending_human');
const typeErrors=[...validateSharedDefinitions(plan.proposals),...plan.proposals.flatMap(p=>validateAttribute(p))];
assert.equal(typeErrors.length,0,JSON.stringify(typeErrors));
assert(plan.inputs?.length,'Assemble pinned input manifest before export');
for(const input of plan.inputs)assert.equal(hash(await fs.readFile(input.path)),input.sha256,'Stale input '+input.path);
const definitions=new Map(plan.definitions.map(d=>[d.id,d])),cats=new Map(plan.categories.map(c=>[c.categoryId,{...c,entries:[]}]))
  ,mounts=new Map(plan.inheritance.map(d=>[d.definitionId,d.mounts]));
const seen=new Set();
for(const p of plan.proposals){
  const d=definitions.get(p.definitionId),id=p.categoryId+':'+p.key;
  assert(d&&cats.has(p.categoryId)&&!seen.has(id),'Invalid or repeated binding');seen.add(id);
  assert.equal(d.name,p.name);assert.equal(d.type,p.type);assert.equal(d.unit??null,p.unit??null);
  assert.equal(d.definition,p.definition);assert.equal(d.rule,p.shortRule);
  assert.equal(JSON.stringify(d.options),JSON.stringify(p.enumValues));
  assert(d.bindings.some(b=>b.categoryId===p.categoryId&&b.key===p.key));
  cats.get(p.categoryId).entries.push({p,d});
}
assert.equal([...definitions.values()].reduce((n,d)=>n+d.bindings.length,0),seen.size);
const typeName=d=>d.type==='option'?(d.mode==='multiple'?'多选枚举':'枚举'):({text:'文本',number:'数值',boolean:'布尔'})[d.type];
const inline=v=>v==null?'':Array.isArray(v)?v.map(inline).join('；'):typeof v==='object'?JSON.stringify(v):String(v).replace(/\r?\n/g,'；');
const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const wb=Workbook.create(),specs=[],layouts=[],title=flags.title??'类目属性';
function sheet(name,subtitle,notes,headers,rows,widths,groups,editable=null){
  assert.equal(headers.length,widths.length);assert(rows.every(r=>r.length===headers.length));
  for(const row of rows)for(const v of row)assert(typeof v!=='string'||v.length<=32767,'Cell exceeds Excel text limit');
  const s=wb.worksheets.add(name);s.tabColor='#294F70';s.getRange('A2').values=[[title+'：'+subtitle]];
  notes.forEach((v,i)=>s.getRange('A'+(i+3)).values=[[v]]);
  s.getRangeByIndexes(5,0,1,headers.length).values=[headers];
  s.getRangeByIndexes(6,0,rows.length,headers.length).values=rows.map(r=>r.map(literal));
  const table=s.tables.add(`A6:${col(headers.length-1)}${rows.length+6}`,true,'SharedReview'+specs.length);table.style='TableStyleLight9';
  widths.forEach((w,i)=>s.getRangeByIndexes(0,i,rows.length+6,1).format.columnWidthPx=w);
  if(editable!==null)s.getRangeByIndexes(6,editable,rows.length,1).dataValidation={rule:{type:'list',values:['同意','建议修改','建议排除','待讨论']}};
  specs.push({name,headers,rows,widths,groups,editable,sheet:s});
}
const maxAttrs=Math.max(...[...cats.values()].map(c=>c.entries.length));
const wideHeaders=['末级类目','业务分组','上级类目','属性数'],wideWidths=[140,100,110,60],wideGroups=[{start:0,end:3,title:'类目定位'}];
for(let n=1;n<=maxAttrs;n++){
  const start=wideHeaders.length;wideHeaders.push(`属性${n}`,`类型${n}`,`单位${n}`,`选项${n}`,`填写规则${n}`);
  wideWidths.push(110,94,55,210,270);wideGroups.push({start,end:start+4,title:'属性 '+n});
}
const trace=wideHeaders.length;wideHeaders.push('完整类目路径','类目ID');wideWidths.push(420,300);wideGroups.push({start:trace,end:trace+1,title:'类目追溯'});
const wideRows=[...cats.values()].map(c=>{
  const parts=c.path.split('>'),row=[c.category,parts[1]??'',parts.at(-2)??'',c.entries.length];
  for(let n=0;n<maxAttrs;n++){const e=c.entries[n];row.push(...(e?[e.p.name,typeName(e.d),e.p.unit??'',bindingOptionsDisplay(e.d,e.p),e.p.shortRule]:['','','','','']));}
  row.push(c.path,c.categoryId);return row;
});
sheet('03-类目级属性表','类目级属性表',[
  `${cats.size} 个末级类目 · ${plan.proposals.length} 项属性 · ${definitions.size} 条共享定义；每类一行，属性横向分组。`,
  plan.summary ? `本轮新增 ${plan.summary.added} 项、修改 ${plan.summary.modified} 项；绿色属性名为新增、浅橙为修改。03/04选项为本类子集。` : '文本选项留空；数值显示来源参考，非行业上下限。类型、选项和新定义待审；逐项审阅见 04。'
],wideHeaders,wideRows,wideWidths,wideGroups);

const longHeaders=['属性','末级类目','审阅结论','类型','单位','选项','填写规则','完整定义','业务用途','来源示例（原值）','局部适用说明','完整类目路径','类目ID','共享定义ID'];
if(plan.summary)longHeaders.push('本轮变化','变更理由');
const longRows=plan.proposals.map(p=>{const d=definitions.get(p.definitionId),row=[p.name,p.category,'',typeName(d),p.unit??'',bindingOptionsDisplay(d,p),p.shortRule,p.definition,p.purpose,inline(p.example),p.applicabilityNote??'',cats.get(p.categoryId).path,p.categoryId,p.definitionId];if(plan.summary)row.push(p.refinement?(p.refinement.action==='add'?'新增待审':'修改待审'):'沿用基线',p.refinement?.reason??'');return row;});
sheet('04-类目属性长表','类目属性长表',[
  `${plan.proposals.length} 项属性逐行呈现。黄色列填审阅结论；本轮修改未继承旧版人工同意。`,
  plan.summary ? '新增/修改另标；构造例明确标注非商品原值。枚举外真实值保留待审；不要改成最近选项。' : '来源示例保留旧原值，不等于已规范化值；数值参考依据及共用范围见 05。未知留空。'
],longHeaders,longRows,[120,140,105,95,55,235,290,450,350,240,350,370,300,300,...(plan.summary?[110,380]:[])],
[{start:0,end:1,title:'属性定位'},{start:2,end:2,title:'人工审阅'},{start:3,end:5,title:'类型与选项'},{start:6,end:9,title:'定义、规则与来源'},{start:10,end:13,title:'适用范围与追溯'},...(plan.summary?[{start:14,end:15,title:'本轮变化'}]:[])],2);

const sorted=[...definitions.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||b.bindings.length-a.bindings.length||a.id.localeCompare(b.id));
const dictHeaders=['属性','类型','单位','选项','引用类目数','完整定义','填写规则','建议继承节点','适用类目','同名拆分理由','业务用途','参考范围依据','类型选择依据','共享定义ID'];
if(plan.summary)dictHeaders.push('各类选项子集','枚举依据与维护');
const dictRows=sorted.map(d=>{const parent=(mounts.get(d.id)??[]).filter(m=>m.mode==='parent_inheritance');
  const row=[d.name,typeName(d),d.unit??'',optionsDisplay(d),new Set(d.bindings.map(b=>b.categoryId)).size,d.definition,d.rule,
    parent.length?parent.map(m=>m.path).join('；'):'末级绑定',
    [...new Set(d.bindings.map(b=>cats.get(b.categoryId).category))].join('；'),d.splitReason??'',d.purpose,d.referenceRange?.basis??'',d.rationale,d.id];
  if(plan.summary)row.push(d.bindings.filter(b=>b.allowedOptions).map(b=>`${cats.get(b.categoryId).category}：${b.allowedOptions.join('、')}`).join('；'),d.enumPolicy?`${({platform_reference:'平台参考',procurement_review:'采购审校',normative_standard:'正式标准'})[d.enumPolicy.basisKind]}；${d.enumPolicy.version}；新值待审后发布新版本`:'');return row;});
sheet('05-属性字典','共享属性定义库',[
  `${new Set(sorted.map(d=>d.name)).size} 个属性名，${definitions.size} 条共享定义；同名同义共用，确有异义才拆分。`,
  '本页是属性定义库，不使用字典应用类型。继承仅为适用范围内建议，尚未修改线上目录。'
],dictHeaders,dictRows,[120,95,55,235,90,440,310,460,500,440,360,500,430,300,...(plan.summary?[500,360]:[])],
[{start:0,end:4,title:'共用定义与类型'},{start:5,end:6,title:'定义与填写规则'},{start:7,end:9,title:'继承与适用范围'},{start:10,end:13,title:'用途、依据与追溯'},...(plan.summary?[{start:14,end:15,title:'局部值域与维护'}]:[])]);
validateSheetTargets(layout,options,specs.map(s=>s.name));
for(const spec of specs){
  const s=spec.sheet;layouts.push(await applyReviewLayout(wb,s,spec.widths,layout,options));
  for(const g of spec.groups){const r=s.getRangeByIndexes(4,g.start,1,g.end-g.start+1);if(g.end>g.start)r.merge();r.values=[[g.title]];
    r.format={fill:'#DCE6F1',font:{name:layout.fontFamily,size:10,bold:true,color:'#294F70'},horizontalAlignment:'center',verticalAlignment:'center',rowHeightPx:25,wrapText:false,borders:{bottom:{style:'thin',color:'#FFFFFF'},right:{style:'thin',color:'#FFFFFF'}}};
  }
  if(spec.editable!==null)s.getRangeByIndexes(6,spec.editable,spec.rows.length,1).format.fill=layout.editableFill;
  s.getRangeByIndexes(6,0,spec.rows.length,spec.headers.length).format.wrapText=false;
  s.getRangeByIndexes(6,0,spec.rows.length,spec.headers.length).format.verticalAlignment='center';
}
if(plan.summary){
 const fill=p=>p.refinement?.action==='add'?'#E2EFDA':'#FCE4D6';
 plan.proposals.forEach((p,i)=>{if(p.refinement)specs[1].sheet.getRangeByIndexes(i+6,0,1,1).format.fill=fill(p);});
 [...cats.values()].forEach((c,i)=>c.entries.forEach(({p},j)=>{if(p.refinement)specs[0].sheet.getRangeByIndexes(i+6,4+j*5,1,1).format.fill=fill(p);}));
}
wb.recalculate();
const inspection=await wb.inspect({kind:'table',range:'04-类目属性长表!A6:H15',include:'values,formulas',tableMaxRows:10,tableMaxCols:8,maxChars:6500});
await fs.writeFile(path.join(out,'inspection.ndjson'),inspection.ndjson);
const previews={'03-类目级属性表':'A1:I18','04-类目属性长表':'A1:F21','05-属性字典':'A1:E23'};
for(const spec of specs){const blob=await wb.render({sheetName:spec.name,range:previews[spec.name],scale:1,format:'png'});await fs.writeFile(path.join(out,spec.name+'.png'),new Uint8Array(await blob.arrayBuffer()));}
await (await SpreadsheetFile.exportXlsx(wb)).save(file);
assert.equal(hash(await fs.readFile(planFile)),hash(planBytes),'Plan changed during export');
for(const input of plan.inputs)assert.equal(hash(await fs.readFile(input.path)),input.sha256,'Source changed during export');
const counts=plan.proposals.reduce((a,p)=>{const key=typeName(definitions.get(p.definitionId));a[key]=(a[key]??0)+1;return a;},{});
const verification={output:file,sha256:hash(await fs.readFile(file)),planSha256:hash(planBytes),inputs:plan.inputs,categories:cats.size,attributes:plan.proposals.length,definitions:definitions.size,types:counts,adoption:'pending_human',productionWrites:0,modelRequests:0,layouts,
  sheets:specs.map(s=>({name:s.name,rows:s.rows.length,columns:s.headers.length,headers:s.headers,groups:s.groups})),refinement:plan.summary??null,limitations:['原基线未修改部分原样保留，不冒称重新核实所有商品证据','数值参考不是行业范围；平台枚举仅为当前待审版本，目录外新值保留待核','父级挂载为离线建议，局部子集不同不共挂父级；目录版本及生产能力待验收']};
await fs.writeFile(verificationFile,JSON.stringify(verification,null,2)+'\n');
await fs.writeFile(path.join(out,'workbook-view-data.json'),JSON.stringify(specs.map(s=>({name:s.name,headers:s.headers,rows:s.rows})))+'\n');
console.log(JSON.stringify({output:file,categories:cats.size,attributes:plan.proposals.length,definitions:definitions.size,types:counts}));
