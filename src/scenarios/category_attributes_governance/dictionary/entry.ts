import { Database } from 'bun:sqlite';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fromStdText as decodeDelivery } from '../../category_governance/offline/codec.ts';
import { seed } from './seed.ts';
import { digest, toStdText } from './contracts.ts';
import { importSource, openInventory, search, statistics, storeDictionary } from './inventory.ts';
import type { Observation } from './inventory.ts';
import { locked } from '../storage.ts';

const scenario = resolve(import.meta.dir,'..');
const old = resolve(scenario,'../category_governance/workspace');
const output = resolve(scenario,'workspace/dictionary/v1');
const dbPath = resolve(output,'attribute-library-v1.sqlite');
const sources = [
  {label:'历史语义审阅模板',kind:'historical-model',path:resolve(old,'output/v1/semantic-review/attribute-templates-v1.json'),format:'template'},
  {label:'最近交付模板',kind:'curated-delivery',path:resolve(old,'output/v1/agent-delivery-v3/templates.std.json'),format:'compact'},
  {label:'京东已缓存属性证据',kind:'jd-observed',path:resolve(old,'context/v1/jd-attribute-evidence.json'),format:'jd'},
  {label:'五金30类修订参考',kind:'curated-reference',path:resolve(scenario,'workspace/reference/hardware30-expert-reference-v1/results.json'),format:'outcomes'},
];
async function build() {
  await mkdir(output,{recursive:true});
  await locked(output,async()=>{
    // Rebuild uses a staging DB. Existing successful inventory remains readable until atomic replace.
    const tmp = `${dbPath}.${process.pid}.tmp`;
    // Preserve historical source snapshots and immutable property revisions across rebuilds.
    if(await Bun.file(dbPath).exists()) await copyFile(dbPath,tmp);
    const db = openInventory(tmp);
    try {
      for(const source of sources) {
        const content = await Bun.file(source.path).text();
        const doc = source.format==='compact'?decodeDelivery(content):JSON.parse(content);
        const rows:Observation[]=[];
        if(source.format==='outcomes') {
          for(const c of doc) for(const p of c.attributes) {
            rows.push({namespace:'sanheng',category:{id:c.category.id,name:c.category.name,path:c.category.pathNames},property:{name:p[1],tuple:p},origin:{status:c.status,evidence:c.evidence}});
          }
        } else for(const c of doc.categories) {
          if(source.format==='jd') {
            for(const p of c.attributes) rows.push({namespace:'jd',category:{id:String(c.id),name:c.path.at(-1),path:c.path},property:p,origin:{interpretation:'observed_samples_not_closed_enum'}});
          } else for(const p of [...c.shared,...c.properties]) rows.push({namespace:'sanheng',category:c.category,property:p,origin:{provenance:c.provenance?.[p.key]??null,notes:c.notes??[],cautions:c.cautions??[]}});
        }
        importSource(db,{...source,content},rows);
        console.log(`${source.label}: ${rows.length} 条来源记录`);
      }
      storeDictionary(db,seed);
      const stats = statistics(db);
      db.close();
      await rename(tmp,dbPath);
      const compact = toStdText(seed);
      await Bun.write(resolve(output,'standard-properties-v1.std.txt'),compact);
      await Bun.write(resolve(output,'standard-properties-v1.json'),JSON.stringify(seed,null,2));
      await Bun.write(resolve(output,'manifest.json'),JSON.stringify({schema:'sanheng-attribute-library-manifest-v1',generatedAt:new Date().toISOString(),dictionaryHash:digest(seed),...stats,definitionStatus:'项目定义初稿，经本轮概念核对；未经独立行业专家全量验收',categoryMapping:'尚未自动映射或替换已交付模板',apiRequests:0},null,2));
      const list = seed.properties.map(p=>`| ${p.id} | ${p.name} | ${p.object} | ${p.unitIds.join(' / ')||'—'} |`).join('\n');
      await Bun.write(resolve(output,'查看属性库.md'),`# 属性知识库 v1\n\n已导入 ${stats.observations.toLocaleString('en-US')} 条来源记录，保留 ${stats.contextualCandidates.toLocaleString('en-US')} 条不同类目上下文下的候选定义，共 ${stats.distinctNames.toLocaleString('en-US')} 个不同名称。记录条数不代表独立标准属性数量；两版模板不能当成独立证据投票。\n\n标准定义初稿 ${stats.canonicalDefinitions} 条，单位或标度 ${stats.units} 个。标准定义初稿由本项目编写，不能声称是正式 ETIM/ECLASS 属性目录或已通过行业验收。全部历史候选仍待语义整理。\n\n原始输入全文及 SHA-256 保存在 SQLite 的 sources_v1；逐条属性和类目上下文保存在 candidates_v1；观察出处在 observations_v1。名称相同不会自动合并。京东值是采样值，不能直接变成封闭枚举。\n\n标准库目前仅提供不可随意改写的定义、版本和单位约束；没有替换现有治理流水线，也没有自动发布11796类模板。\n\n| ID | 属性名称 | 描述对象 | 可选单位/标度ID |\n|---|---|---|---|\n${list}\n\n复用方法见项目 dictionary/方法与验收.md。所有构建过程均在本地执行，未调用收费模型。\n`);
      console.log(JSON.stringify(stats,null,2));
      console.log(`查看结果: ${resolve(output,'查看属性库.md')}`);
    } catch(error) { try{db.close();}catch{} await rm(tmp,{force:true}); throw error; }
  });
}
export async function main(args=process.argv.slice(2)) {
  const action = args[0]??'help';
  const option = (key:string) => args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);
  if(action==='build') return build();
  if(action==='search'||action==='stats') {
    if(!await Bun.file(dbPath).exists()) throw new Error('请先执行 dictionary build');
    const db = new Database(dbPath,{readonly:true});
    try {console.log(JSON.stringify(action==='stats'?statistics(db):search(db,option('query')??'',Number(option('limit')??10)),null,2));} finally {db.close();}
    return;
  }
  if(action==='pack') {
    const ids = new Set((option('ids')??'').split(',').filter(Boolean));
    if(!ids.size) throw new Error('pack需要--ids=属性ID,属性ID');
    for(const id of ids) if(!seed.properties.some(p=>p.id===id)) throw new Error(`未知标准属性ID: ${id}`);
    const properties = seed.properties.filter(p=>ids.has(p.id)).sort((a,b)=>a.id<b.id?-1:1);
    const unitIds = new Set(properties.flatMap(p=>p.unitIds));
    console.log(toStdText({...seed,properties,units:seed.units.filter(u=>unitIds.has(u.id))}));
    return;
  }
  if(action!=='help') throw new Error(`未知子命令: ${action}`);
  console.log('本地属性知识库，无API调用\n  build\n  stats\n  search --query=功率 --limit=10\n  pack --ids=sh.own.brand,sh.own.model');
}
if(import.meta.main) main().catch(e=>{console.error(e.message);process.exitCode=1;});
