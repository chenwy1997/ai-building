import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttributeProperty } from "../src/scenarios/category_governance/types.ts";
import { buildAttributeConsensus } from "../src/scenarios/category_governance/consensus.ts";
import { propertyToTuple } from "../src/scenarios/category_governance/template-codec.ts";
import { acceptedRevision, applyRevisionPatch, buildEvaluationPrompt, buildRevisionPrompt, parseRevisionJudgment, parseRevisionPatch, parseRevisionTuple, reviseCategory, revisionDefinitions, revisionInputFingerprint, templateFingerprint, type AttributeTemplate, type RevisionInput } from "../src/scenarios/category_governance/attribute-revision.ts";
import { revisionMain } from "../src/scenarios/category_governance/attribute-revision-entry.ts";
import { freezeMain } from "../src/scenarios/category_governance/freeze-entry.ts";
import { atomicJson, jsonJournal, mergeRevisionResults, readJournal, withRevisionLock, type RevisionState } from "../src/scenarios/category_governance/revision-storage.ts";
import type { OpenAiChatResponse } from "../src/ai/types.ts";

const prop = (key: string, extra: Partial<AttributeProperty> = {}): AttributeProperty => ({ key, name: key, type: "text", required: false, unit: null, options: [], description: "", format: null, example: null, scope: "category", ...extra });
const category = { id: "test-leaf", name: "测试设备", path: ["标准类目", "设备", "测试设备"] };
const base = (properties: AttributeProperty[]): AttributeTemplate => ({ category, shared: [], properties, notes: [] });
const candidateDoc = (properties: AttributeProperty[]) => buildAttributeConsensus([{ runId: "19", result: base(properties) }]);
const input = (): RevisionInput => ({ category: candidateDoc([prop("model"), prop("new_feature")]).categories[0]!, base: base([prop("model"), prop("previous_review_addition")]), evidenceText: "型号与新功能的商品证据" });
const proposal = (extra: Record<string, unknown> = {}) => JSON.stringify({ category_id: category.id, scope: "测试设备本体", reviewed: true, upsert: [], remove: [], uncertainty: "", ...extra });
const edit = (p: AttributeProperty, reason = "必要修改") => { const { key, ...fields } = p; return { key, fields, reason }; };
const accept = () => JSON.stringify({ category_id: category.id, verdict: "accept", issues: [] });
const reject = () => JSON.stringify({ category_id: category.id, verdict: "revise", issues: [{ keys: ["new_feature"], code: "scope", reason: "这项描述的是其他对象" }] });
const response = (content: string, finish = "stop"): OpenAiChatResponse => ({ id: "test", object: "chat.completion", created: 0, model: "test", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, completion_tokens_details: { reasoning_tokens: 0 } } });

describe("以定稿为基础的属性修订", () => {
  test("新候选缺失历史补充项时仍保留；忽略新候选不等于删除旧属性", () => {
    const data = input(); const patch = parseRevisionPatch(proposal(), data);
    expect(applyRevisionPatch(data.base, patch).properties.map(p => p.key)).toEqual(["model", "previous_review_addition"]);
    expect(buildRevisionPrompt(data)).toContain("previous_review_addition");
    expect(() => parseRevisionPatch(proposal({ remove: [{key:"new_feature",reason:"不需要"}] }), data)).toThrow("只能删除 BASE");
    expect(() => parseRevisionPatch(proposal({ reviewed: false }), data)).toThrow("reviewed=true");
    const update = parseRevisionPatch(proposal({ uncertainty: undefined, upsert: [{key:"model",fields:{description:"填写厂家型号",unit:""},reason:"补充说明"}] }), data);
    expect(update.upsert[0]?.property.name).toBe("model");
    expect(update.upsert[0]?.property.type).toBe("text");
    expect(update.upsert[0]?.property.unit).toBe(null);
    expect(update.defer).toEqual([]);
  });

  test("修改只能选择一份完整定义；不推断冲突定义、类型、单位或枚举", () => {
    const data = input();
    const patch = parseRevisionPatch(proposal({ upsert: [edit(prop("new_feature"))] }), data);
    expect(applyRevisionPatch(data.base, patch).properties).toHaveLength(3);
    expect(() => parseRevisionPatch(proposal({ upsert: [{key:"model",fields:{unknown_field:true},reason:"无效字段"}] }), data)).toThrow("不支持 unknown_field");
    expect(() => parseRevisionPatch(proposal({ upsert: [edit(prop("new_feature")),edit(prop("new_feature"))] }), data)).toThrow("重复修改");
    expect(() => parseRevisionTuple(["x", "x", "bad", "", null, [], "", null, null, "category"])).toThrow("类型代码");
    expect(() => parseRevisionPatch(proposal({ upsert: [edit(prop("choice", {type:"single"}))] }), data)).toThrow("没有枚举选项");
    expect(() => applyRevisionPatch(data.base, parseRevisionPatch(proposal({ upsert: [edit(prop("x",{name:"长度",type:"number"}))] }), data))).toThrow("unit");
  });

  test("独立验收不读取候选或提案理由，验收不通过就保留基准", async () => {
    const data = input(); const prompts: string[] = [];
    const replies = [proposal({ upsert: [edit(prop("new_feature"), "提案者声称一定正确")] }), reject()];
    const result = await reviseCategory(data, { attempts: 1, chat: async request => { prompts.push(request.messages[1]!.content!); expect(request.thinking?.type).toBe("disabled"); return response(replies.shift()!); } });
    expect(result.status).toBe("needs_review");
    expect(prompts[1]).not.toContain("#CANDIDATES");
    expect(prompts[1]).not.toContain("提案者声称一定正确");
    expect(acceptedRevision(data.base, result)).toEqual(data.base);
    expect(() => acceptedRevision(data.base, { ...result, status: "accepted" })).toThrow("通过结论");
  });

  test("验收反馈进入下一轮修订，所有请求费用计入，修改通过才采用", async () => {
    const data = input(); const replies = [proposal({ upsert: [edit(prop("new_feature"))] }), reject(), proposal(), accept()];
    const prompts: string[] = [];
    const result = await reviseCategory(data, { attempts: 2, chat: async request => { prompts.push(request.messages[1]!.content!); return response(replies.shift()!); } });
    expect(result.status).toBe("accepted"); expect(result.requestCount).toBe(4);
    expect(result.usage.totalTokens).toBe(440); expect(result.usage.reasoningTokens).toBe(0);
    expect(prompts[2]).toContain("这项描述的是其他对象");
    expect(acceptedRevision(data.base, result).properties.map(p => p.key)).toEqual(["model", "previous_review_addition"]);
    expect(() => acceptedRevision(base([prop("another_base")]), result)).toThrow("基准已变化");
    expect(() => acceptedRevision(data.base, { ...result, proposed: base([prop("tampered")]) })).toThrow("通过结论");
  });

  test("输出截断和验收格式失败不得当作成功；重试只重试出错阶段", async () => {
    const data = input(); let calls = 0;
    const replies = [response(proposal()), response("{}"), response(accept())];
    const result = await reviseCategory(data, { attempts: 2, chat: async () => { calls++; return replies.shift()!; } });
    expect(result.status).toBe("accepted"); expect(calls).toBe(3);
    expect(result.usage.totalTokens).toBe(330);
    const truncated = await reviseCategory(data, { attempts: 1, chat: async () => response(proposal(), "length") });
    expect(truncated.status).toBe("failed"); expect(truncated.error).toContain("截断");
    expect(acceptedRevision(data.base, truncated)).toEqual(data.base);
    expect(() => parseRevisionJudgment(JSON.stringify({ category_id: category.id, verdict: "accept", issues: [{keys:["x"],code:"scope",reason:"不适用"}] }), data.base)).toThrow("accept 必须无问题");
  });

  test("相同定义的重复批次不触发新审阅，定稿/证据/定义变化会触发", () => {
    const data = input(); const fingerprint = revisionInputFingerprint(data);
    expect(revisionInputFingerprint({ ...data, category: { ...data.category, runCount: 10 } })).toBe(fingerprint);
    expect(revisionInputFingerprint({ ...data, evidenceText: "新证据" })).not.toBe(fingerprint);
    expect(revisionInputFingerprint({ ...data, base: base([prop("changed")]) })).not.toBe(fingerprint);
    expect(revisionInputFingerprint({ ...data, category: candidateDoc([prop("new_definition")]).categories[0]! })).not.toBe(fingerprint);
    const proposalPrompt = buildRevisionPrompt(data); const evaluationPrompt = buildEvaluationPrompt(data, data.base);
    expect(proposalPrompt.split("#CANDIDATES")[0]).toBe(evaluationPrompt.split("#PROPOSED")[0]);
  });

  test("日志完整行可恢复；并发写入串行落盘，锁防止多进程覆盖", async () => {
    const dir = await mkdtemp(join(tmpdir(), "attribute-revision-"));
    try {
      const journal = jsonJournal(join(dir, "results.jsonl"));
      await Promise.all(Array.from({ length: 20 }, (_, n) => journal.append({ n })));
      expect(await readJournal(join(dir, "results.jsonl"))).toHaveLength(20);
      await withRevisionLock(dir, async () => { await expect(withRevisionLock(dir, async () => {})).rejects.toThrow("正在运行"); });
      await withRevisionLock(dir, async () => {});
      await Bun.write(join(dir, "partial.jsonl"), '{"n":1}\n{"n":');
      expect(await readJournal(join(dir, "partial.jsonl"))).toEqual([{ n: 1 }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("Bun 入口从冻结基线初始化，同清单第二次零请求，失败提案不污染正式状态", async () => {
    const dir = await mkdtemp(join(tmpdir(), "attribute-revision-cli-"));
    try {
      const data = input(); const root = join(dir, "output/v1/semantic-review");
      const templateDoc = { version: "attribute-template-semantic-v1", generatedAt: "before", sourceConsensus: ["19"], categories: [data.base] };
      await atomicJson(join(dir, "context/v1/category-tree.json"), { version: "v1", nodes: [{ id: category.id, name: category.name, pathNames: category.path, isLeaf: true }] });
      await atomicJson(join(dir, "output/v1/consensus/attribute-candidates-v1.json"), candidateDoc([prop("model"), prop("new_feature")]));
      const frozenPath = join(dir, "output/v1/baseline/attribute-templates-v1.json");
      await atomicJson(frozenPath, templateDoc);
      await atomicJson(join(root, "attribute-templates-v1.json"), { ...templateDoc, categories: [base([prop("polluted_legacy")])] });
      await atomicJson(join(root, "original-sample/manifest.json"), { categoryIds: [category.id] });
      const frozenText = await readFile(frozenPath, "utf8");
      let calls = 0;
      const flags = [`--workspace=${dir}`, "--from-run=original-sample", "--attempts=1", "--concurrency=1"];
      await revisionMain(flags, { chat: async request => { calls++; expect(request.messages[1]!.content).not.toContain("polluted_legacy"); return response(calls === 1 ? proposal() : accept()); } });
      expect(calls).toBe(2);
      await revisionMain(flags, { chat: async () => { throw new Error("相同输入不应再次调用模型"); } });
      const state = JSON.parse(await readFile(join(root, "attribute-governance-state-v1.json"), "utf8")) as RevisionState;
      expect(state.templates.categories[0]!.properties.map(p => p.key)).toEqual(["model", "previous_review_addition"]);
      expect(state.records[category.id]?.status).toBe("accepted");
      await Bun.write(join(root, "attribute-templates-v1.json"), "{}");
      await revisionMain(flags, { chat: async () => { throw new Error("修复导出视图不应调用模型"); } });
      expect(JSON.parse(await readFile(join(root,"attribute-templates-v1.json"),"utf8")).categories).toEqual(state.templates.categories);
      expect(await readFile(frozenPath, "utf8")).toBe(frozenText);
      const runDirs = (await readdir(root)).filter(name => name.endsWith("-revision"));
      expect(runDirs).toHaveLength(1);
      expect(await Bun.file(join(root, runDirs[0]!, "legacy-templates-before-migration.json")).exists()).toBe(true);
      await rm(join(root,"attribute-governance-state-v1.json"));
      await Bun.write(join(root,"attribute-templates-v1.json"), "{}");
      await revisionMain([`--workspace=${dir}`,`--resume-run=${runDirs[0]}`], {chat: async () => {throw new Error("已落盘的验收结果应免费恢复");}});
      expect(JSON.parse(await readFile(join(root,"attribute-templates-v1.json"),"utf8")).categories).toEqual(state.templates.categories);
      const badResult = await reviseCategory(data, { attempts: 1, chat: async request => response(request.messages[1]!.content!.endsWith("propose") ? proposal({ upsert: [edit(prop("new_feature"))] }) : reject()) });
      const next = mergeRevisionResults(state, [badResult], "failed-run");
      expect(templateFingerprint(next.templates.categories[0]!)).toBe(templateFingerprint(data.base));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("冻结从正式状态生成模板，不依赖旧版复审记录或过期视图", async () => {
    const dir = await mkdtemp(join(tmpdir(), "attribute-freeze-state-"));
    try {
      const template = input().base;
      await atomicJson(join(dir, "context/v1/category-tree.json"), { leafCount: 1, nodes: [{ id: category.id }] });
      await atomicJson(join(dir, "context/v1/id-index.json"), {});
      await atomicJson(join(dir, "output/v1/consensus/attribute-candidates-v1.json"), candidateDoc([prop("model")]));
      await atomicJson(join(dir, "output/v1/semantic-review/attribute-governance-state-v1.json"), { version: "attribute-governance-state-v2", anchor: null, records: {}, templates: { version: "attribute-template-semantic-v1", categories: [template] } });
      await freezeMain([`--workspace=${dir}`]);
      const frozen = JSON.parse(await readFile(join(dir, "output/v1/baseline/attribute-templates-v1.json"), "utf8"));
      expect(frozen.categories).toEqual([template]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
