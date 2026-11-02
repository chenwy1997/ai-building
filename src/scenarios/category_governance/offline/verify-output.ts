import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fromStdText, toStdText } from "./codec.ts";
import { digest, stableJson, validateDraft } from "./build.ts";
import { attributeContractIssues } from "../attribute-revision.ts";
import type { InputSnapshot } from "./types.ts";

// Local structural verification. It does not make an AI judgment or call an API.
const edition=Bun.argv.find(a=>a.startsWith("--edition="))?.slice(10)??"agent-draft-v1";
const version=Bun.argv.find(a=>a.startsWith("--version="))?.slice(10)??"v1";
if(!/^[a-zA-Z0-9_-]+$/.test(edition)||!/^v\d+$/.test(version))throw new Error("版本目录名无效");
const dir=resolve(import.meta.dir,"../workspace/output",version,edition),manifest=await Bun.file(join(dir,"manifest.json")).json();
for(const [file,hash] of Object.entries(manifest.artifactHashes))if(digest(await readFile(join(dir,file)))!==hash)throw new Error(`产物哈希不匹配：${file}`);
const inputBytes=await readFile(join(dir,".repro/input.snapshot.json.gz"));
if(digest(inputBytes)!==manifest.inputHash)throw new Error("输入快照被修改");
const input=JSON.parse(gunzipSync(inputBytes).toString("utf8")) as InputSnapshot;
const document=fromStdText(await Bun.file(join(dir,"templates.std.json")).text());
validateDraft(document,input);
if(stableJson(fromStdText(toStdText(document)))!==stableJson(document))throw new Error("完整结构文本未无损往返");
const contractIssues=document.categories.flatMap(c=>attributeContractIssues(c).map(issue=>({id:c.category.id,path:c.category.path,issue})));
const files=[...new Bun.Glob("*.std.json").scanSync(join(dir,"context"))],ids:string[]=[];
for(const file of files){const part=fromStdText(await Bun.file(join(dir,"context",file)).text());if(new Set(part.categories.map(c=>c.category.path[1])).size!==1)throw new Error(`分片混入其他一级类目：${file}`);ids.push(...part.categories.map(c=>c.category.id));}
const expected=new Set(document.categories.map(c=>c.category.id));
if(ids.length!==expected.size||new Set(ids).size!==expected.size||ids.some(id=>!expected.has(id)))throw new Error("分片存在遗漏或重复");
const result={edition,checkedAt:new Date().toISOString(),apiRequests:0,categoryCount:expected.size,propertyRows:document.categories.reduce((n,c)=>n+c.shared.length+c.properties.length,0),chunks:files.length,unchangedTaxonomy:true,losslessRoundTrip:true,artifactHashesValid:true,structuralIssueCategories:new Set(contractIssues.map(i=>i.id)).size,contractIssues,businessAcceptance:"仅结构检查；不表示全量语义验收"};
await Bun.write(join(dir,".repro/verification.json"),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(contractIssues.length)process.exitCode=1;
