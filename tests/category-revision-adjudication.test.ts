import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAttributeConsensus } from "../src/scenarios/category_governance/consensus.ts";
import { applyRevisionPatch, buildEvaluationPrompt, parseRevisionJudgment, reviseCategory, revisionInputFingerprint, templateFingerprint, type AttributeTemplate, type RevisionInput, type RevisionResult } from "../src/scenarios/category_governance/attribute-revision.ts";
import { adjudicateRevision, type AttributeAdjudication } from "../src/scenarios/category_governance/revision-adjudication.ts";
import { revisionMain } from "../src/scenarios/category_governance/attribute-revision-entry.ts";
import { atomicJson, mergeRevisionResults, type RevisionState } from "../src/scenarios/category_governance/revision-storage.ts";
import { emptySemanticReviewUsage } from "../src/scenarios/category_governance/semantic-review.ts";
import type { AttributeProperty } from "../src/scenarios/category_governance/types.ts";
import type { OpenAiChatResponse } from "../src/ai/types.ts";

const prop = (key: string): AttributeProperty => ({key,name:key,type:"text",required:false,unit:null,options:[],description:"",format:null,example:null,scope:"category"});
const category = {id:"id",name:"设备",path:["设备"]};
const base: AttributeTemplate = {category,shared:[],properties:[prop("old_size"),prop("size")],notes:[]};
const proposed: AttributeTemplate = {...base,properties:[{...prop("size"),unit:"mm",description:"宽×深×高"}]};
const consensus = buildAttributeConsensus([{runId:"19",result:base}]);
const input: RevisionInput = {base,category:consensus.categories[0]!,evidenceText:""};
const badJudgment = {categoryId:category.id,verdict:"revise" as const,issues:[{keys:["old_size","size"],code:"duplicate",reason:"旧字段与当前字段重复"}],templateFingerprint:templateFingerprint(proposed)};
const source: RevisionResult = {categoryId:category.id,status:"needs_review",baseFingerprint:templateFingerprint(base),inputFingerprint:revisionInputFingerprint(input),proposed,judgment:badJudgment,requestCount:4,usage:emptySemanticReviewUsage()};
const decision: AttributeAdjudication = {version:"attribute-adjudication-v1",reviewer:"测试审阅者",reviewedAt:"2026-09-14T08:00:00Z",sourceRun:"source",decisions:[{categoryId:category.id,sourceInputFingerprint:source.inputFingerprint,sourceTemplateFingerprint:templateFingerprint(proposed),outcome:"accept",rationale:"已核对当前模板只剩一个尺寸字段",issues:[{index:0,disposition:"dismissed",reason:"old_size 已删除，不属于当前模板"}],finalTemplateFingerprint:templateFingerprint(proposed),sources:[]}]};
const reply = (content: string): OpenAiChatResponse => ({id:"t",object:"chat.completion",created:0,model:"test",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content}}]});

test("验收当前模板与删除历史隔离；不能引用已删除字段构造重复，也不把 text 空选项当错误", () => {
  const prompt = buildEvaluationPrompt(input, proposed);
  const current = JSON.parse(prompt.split("#PROPOSED\n")[1]!.split("\n#HISTORY_NOT_CURRENT")[0]!);
  expect(current.old_size).toBeUndefined(); expect(current.size.type).toBe("text"); expect(current.size.options).toBeUndefined();
  expect(prompt).not.toContain("#BASE\n");
  expect(() => parseRevisionJudgment(JSON.stringify({category_id:category.id,...badJudgment}),proposed,base)).toThrow("当前 PROPOSED");
  expect(() => parseRevisionJudgment(JSON.stringify({category_id:category.id,verdict:"revise",issues:[{keys:["size"],code:"missing_core",reason:"缺失尺寸"}]}),proposed,base)).toThrow("已在 PROPOSED");
  expect(() => parseRevisionJudgment(JSON.stringify({category_id:category.id,verdict:"revise",issues:[{keys:["size"],code:"regression",reason:"发生退化"}]}),base,base)).toThrow("未变化");
  expect(applyRevisionPatch(proposed,{categoryId:category.id,scope:"本体",upsert:[],remove:[],defer:[]})).toEqual(proposed);
  expect(() => applyRevisionPatch({...base,properties:[{...prop("choice"),type:"single"}]},{categoryId:category.id,scope:"本体",upsert:[],remove:[],defer:[]})).toThrow("没有枚举选项");
});

test("相同提案不再重复验收；到上限的争议保留供裁决", async () => {
  let calls = 0;
  const proposal = JSON.stringify({category_id:category.id,scope:"本体",reviewed:true,upsert:[],remove:[],uncertainty:""});
  const judge = JSON.stringify({category_id:category.id,verdict:"revise",issues:[{keys:["old_size","size"],code:"duplicate",reason:"两个当前尺寸字段重复"}]});
  const result = await reviseCategory(input,{attempts:5,chat:async () => reply(++calls === 2 ? judge : proposal)});
  expect(calls).toBe(3); expect(result.status).toBe("needs_review"); expect(result.stopReason).toBe("unchanged_proposal");
});

test("裁决逐项留依据且绑定完整输入/模板，不能靠改 verdict 或过期结果覆盖", () => {
  const result = adjudicateRevision(input,source,decision,decision.decisions[0]!);
  expect(result.status).toBe("accepted"); expect(result.requestCount).toBe(0); expect(result.adjudication?.reviewer).toBe("测试审阅者");
  expect(result.reviewedReference).toContain("只剩一个尺寸字段");
  expect(result.settledFingerprint).toBe(revisionInputFingerprint({...input,base:proposed,reviewedReference:result.reviewedReference}));
  expect(() => adjudicateRevision({...input,evidenceText:"新证据"},source,decision,decision.decisions[0]!)).toThrow("已经变化");
  expect(() => adjudicateRevision(input,source,decision,{...decision.decisions[0]!,issues:[]})).toThrow("逐项");
  expect(() => adjudicateRevision(input,source,decision,{...decision.decisions[0]!,finalTemplateFingerprint:"a".repeat(64)})).toThrow("最终模板");
  expect(() => adjudicateRevision(input,source,decision,{...decision.decisions[0]!,issues:[{index:0,disposition:"unresolved",reason:"无法确认"}]})).toThrow("未解决");
});

test("命令重跑相同争议零请求；本地裁决可预览、采用、幂等重放且冻结基线不变", async () => {
  const dir = await mkdtemp(join(tmpdir(),"attribute-adjudication-"));
  try {
    const root = join(dir,"output/v1/semantic-review");
    const templates = {version:"attribute-template-semantic-v1" as const,generatedAt:"before",sourceConsensus:["19"],categories:[base]};
    const state: RevisionState = mergeRevisionResults({version:"attribute-governance-state-v2",anchor:null,updatedAt:"before",templates,records:{}},[source],join(root,"source"));
    await atomicJson(join(root,"attribute-governance-state-v1.json"),state);
    await atomicJson(join(dir,"context/v1/category-tree.json"),{version:"v1",nodes:[{...category,pathNames:category.path,isLeaf:true}]});
    await atomicJson(join(dir,"output/v1/consensus/attribute-candidates-v1.json"),consensus);
    await atomicJson(join(dir,"output/v1/baseline/attribute-templates-v1.json"),templates);
    await atomicJson(join(root,"source/results.jsonl"),source);
    const file = join(dir,"decision.json"); await atomicJson(file,decision);
    const noNetwork = {chat:async () => { throw new Error("不得调用 API"); }};
    await revisionMain([`--workspace=${dir}`,"--failed-only"],noNetwork);
    await revisionMain([`--workspace=${dir}`,`--adjudicate=${file}`,"--plan"],noNetwork);
    expect((await Bun.file(join(root,"attribute-governance-state-v1.json")).json()).records.id.status).toBe("needs_review");
    await revisionMain([`--workspace=${dir}`,`--adjudicate=${file}`],noNetwork);
    await revisionMain([`--workspace=${dir}`,`--adjudicate=${file}`],noNetwork);
    expect((await Bun.file(join(root,"attribute-governance-state-v1.json")).json()).templates.categories).toEqual([proposed]);
    expect((await Bun.file(join(dir,"output/v1/baseline/attribute-templates-v1.json")).json()).categories).toEqual([base]);
    // 免费审计和范围筛选针对整个正式模板，不只检查最近修改过的字段。
    const current = await Bun.file(join(root,"attribute-governance-state-v1.json")).json() as RevisionState;
    current.templates.categories[0]!.properties = [{...prop("empty_choice"),type:"single"}];
    await atomicJson(join(root,"attribute-governance-state-v1.json"),current);
    await revisionMain([`--workspace=${dir}`,"--audit"],noNetwork);
    await revisionMain([`--workspace=${dir}`,"--invalid-only","--sample=1","--plan"],noNetwork);
    const audits = (await readdir(root)).filter(n => n.endsWith("-audit"));
    const audit = await Bun.file(join(root,audits[0]!,"manifest.json")).json();
    expect(audit.emptyEnumAttributes).toBe(1); expect(audit.apiRequests).toBe(0);
    const plans = (await readdir(root)).filter(n => n.endsWith("-revision"));
    expect((await Bun.file(join(root,plans[0]!,"plan.json")).json()).categoryIds).toEqual([category.id]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
