import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AiService } from "../../ai/service.ts";
import { loadAppConfig } from "../../config/env.ts";
import { PostgresAiCatalog } from "../../data/ai-catalog.ts";
import { DatabaseHub } from "../../platform/database/index.ts";
import { readJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import type { AttributeConsensusDocument } from "./consensus.ts";
import { loadJdEvidence, buildJdEvidenceText, type JdEvidenceDocument } from "./jd-evidence.ts";
import { prepareReviewConsensus, reviewCategoryStats, sampleReviewCategories } from "./review-preparation.ts";
import { addSemanticReviewUsage, emptySemanticReviewUsage, type SemanticTemplateDocument } from "./semantic-review.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { asInt, boolFlag, parseFlags, parseGovernanceConcurrency, shortCategoryId } from "./util.ts";
import { attributeContractIssues, buildRevisionPrompt, hashText, matchesRevisionInput, reviseCategory, revisionInputFingerprint, templateFingerprint, REVISION_PROTOCOL, REVISION_SYSTEM_PROMPT, type RevisionChat, type RevisionInput, type RevisionResult, type RevisionTrace } from "./attribute-revision.ts";
import { atomicJson, jsonJournal, mergeRevisionResults, readJournal, withRevisionLock, type RevisionState } from "./revision-storage.ts";
import { adjudicateRevision, validateAdjudication, type AttributeAdjudication } from "./revision-adjudication.ts";

const HELP = `
类目属性增量治理：已采用模板 → AI 修改提案 → 独立语义验收 → 通过后采用

bun run category-governance:semantic-review --changed-only --sample=30 --direct
bun run category-governance:semantic-review --from-run=run-20260914T063111-388Z --concurrency=8 --attempts=2 --direct

范围：--category=名称/路径/ID  --limit=10  --sample=30  --all
增量：--changed-only  --failed-only --unreviewed-only
争议：相同输入的待改进项默认暂停；--retry-review 明确重新付费尝试
裁决：--adjudicate=裁决JSON（本地采用，API 0；加 --plan 仅检查）
审计：--audit（全量本地结构审计，API 0） --invalid-only（只选结构检查未通过项，可配 --sample）
固定清单：--from-run=运行目录名（精确复测同一清单，可加 --category）
恢复：--resume-run=运行目录名（恢复已完成结果，只调用剩余部分）
本地：--plan  --dry-run  --replay-run=新协议运行目录名（不调用 API）
运行：--concurrency=8/auto/max  --attempts=2（最多两轮提案/验收） --direct
输入：--consensus=路径 --jd-evidence=路径 --workspace=路径 --version=v1
模型：--provider=deepseek --model=flash；思考始终关闭
--force  明确重新审阅已用相同输入验收通过的类目；默认直接跳过

初次从冻结 baseline 初始化正式状态，旧版仅通过格式校验的输出保留为历史。
每次运行用 trace.jsonl / results.jsonl 保存过程，不再为每次请求拆多个文件。
`.trim();

async function optionalJson<T>(path: string): Promise<T | undefined> {
  if (!(await Bun.file(path).exists())) return undefined;
  return readJsonFile<T>(path); // 已存在但损坏必须报错，不能当成没有而重置定稿。
}
function direct(): void {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
  process.env.NO_PROXY = "*"; process.env.no_proxy = "*";
}

export async function revisionMain(argv: string[] = Bun.argv.slice(2), injected?: { chat: RevisionChat }): Promise<void> {
  const { flags, positionals } = parseFlags(argv);
  if (flags.help === "true" || flags.h === "true") { console.log(HELP); return; }
  if (positionals.length) throw new Error(`不支持位置参数：${positionals.join(" ")}`);
  const supported = new Set(["category", "category-id", "limit", "sample", "all", "changed-only", "failed-only", "unreviewed-only", "from-run", "resume-run", "replay-run", "plan", "dry-run", "concurrency", "attempts", "direct", "consensus", "jd-evidence", "workspace", "version", "provider", "model", "force", "retry-review", "adjudicate", "audit", "invalid-only"]);
  for (const key of Object.keys(flags)) if (!supported.has(key)) throw new Error(`不支持参数 --${key}`);
  if (flags.adjudicate) for (const key of Object.keys(flags)) if (!["adjudicate", "workspace", "version", "consensus", "jd-evidence", "plan", "dry-run"].includes(key)) throw new Error("裁决模式只接受文件、输入路径和 --plan/--dry-run，不接受付费运行参数");
  if (boolFlag(flags.audit)) for (const key of Object.keys(flags)) if (!["audit", "workspace", "version", "consensus", "jd-evidence"].includes(key)) throw new Error("--audit 进行全量本地检查，不接受运行或范围参数");
  for (const key of ["limit", "sample", "attempts"]) if (flags[key] !== undefined && (!Number.isInteger(Number(flags[key])) || Number(flags[key]) < 1)) throw new Error(`--${key} 必须为正整数`);
  if ([flags.limit !== undefined, flags.sample !== undefined, boolFlag(flags.all)].filter(Boolean).length > 1) throw new Error("--limit、--sample、--all 不能同时使用");
  if ([flags["from-run"], flags["resume-run"], flags["replay-run"]].filter(Boolean).length > 1) throw new Error("from-run/resume-run/replay-run 只能指定一个");
  const fixed = flags["from-run"] ?? flags["resume-run"] ?? flags["replay-run"];
  if (fixed && (flags.limit || flags.sample || boolFlag(flags.all) || boolFlag(flags["changed-only"]))) throw new Error("固定运行清单不能同时使用 limit/sample/all/changed-only；可用 --category 选清单内的类目");
  const workspace = flags.workspace ?? workspaceRoot();
  const version = flags.version ?? "v1";
  const root = join(workspace, "output", version, "semantic-review");
  const preview = boolFlag(flags.plan) || boolFlag(flags["dry-run"]);
  const work = async () => runRevision(flags, workspace, version, root, fixed, injected);
  if (preview) await work(); else await withRevisionLock(root, work);
}

async function runRevision(flags: Record<string, string>, workspace: string, version: string, root: string, fixed: string | undefined, injected?: { chat: RevisionChat }): Promise<void> {
  const consensusPath = flags.consensus ?? join(workspace, "output", version, "consensus", "attribute-candidates-v1.json");
  const consensus = prepareReviewConsensus(await readJsonFile<AttributeConsensusDocument>(consensusPath));
  const context = await readContextDocument(workspace, version);
  const nodes = new Map(context.nodes.map(n => [n.id, n]));
  const selector = (flags.category ?? flags["category-id"])?.trim().toLocaleLowerCase();
  const inSelector = (id: string): boolean => {
    const node = nodes.get(id);
    return Boolean(node?.isLeaf && (!selector || [id, shortCategoryId(id), ...node.pathNames, node.pathNames.join("/"), node.pathNames.join(">")].some(v => v.toLocaleLowerCase() === selector)));
  };
  const statePath = join(root, "attribute-governance-state-v1.json");
  const templatePath = join(root, "attribute-templates-v1.json");
  const baselinePath = join(workspace, "output", version, "baseline", "attribute-templates-v1.json");
  let state = await optionalJson<RevisionState>(statePath);
  const initialized = !state;
  if (state && state.version !== "attribute-governance-state-v2") throw new Error("正式治理状态版本不受支持");
  if (!state) {
    const baseline = await optionalJson<SemanticTemplateDocument>(baselinePath);
    state = { version: "attribute-governance-state-v2", anchor: baseline ? { path: baselinePath, sha256: hashText(await Bun.file(baselinePath).text()) } : null, updatedAt: new Date().toISOString(), records: {}, templates: baseline ?? { version: "attribute-template-semantic-v1", generatedAt: new Date().toISOString(), sourceConsensus: [], categories: [] } };
  }
  const evidencePath = flags["jd-evidence"] ?? join(workspace, "context", version, "jd-attribute-evidence.json");
  const evidence: JdEvidenceDocument | undefined = await Bun.file(evidencePath).exists() ? await loadJdEvidence(evidencePath) : undefined;
  const templateMap = () => new Map(state!.templates.categories.map(t => [t.category.id, t]));
  let accepted = templateMap();
  const baseFor = (category: typeof consensus.categories[number]) => accepted.get(category.category.id) ?? { category: category.category, shared: [], properties: [], notes: [] };
  const evidenceTexts = new Map<string,string>();
  const inputFor = (category: typeof consensus.categories[number]): RevisionInput => {
    const id = category.category.id;
    if (!evidenceTexts.has(id)) evidenceTexts.set(id, evidence && nodes.has(id) ? buildJdEvidenceText([nodes.get(id)!], evidence) : "");
    return { category, base: baseFor(category), evidenceText: evidenceTexts.get(id)!, reviewedReference: state!.records[id]?.reviewedReference };
  };
  if (boolFlag(flags.audit)) {
    const categories = state.templates.categories.map(template => ({ category: template.category, issues: attributeContractIssues(template) })).filter(c => c.issues.length);
    const emptyEnums = categories.flatMap(c => c.issues).filter(i => i.code === "empty_enum").length;
    const runDir = join(root, `run-${new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-")}-audit`);
    await atomicJson(join(runDir,"manifest.json"), { protocol: "attribute-contract-audit-v1", source: initialized ? baselinePath : statePath, sourceFingerprint: hashText(JSON.stringify(state.templates)), categoryCount: state.templates.categories.length, affectedCategoryCount: categories.length, emptyEnumAttributes: emptyEnums, categoryIds: categories.map(c => c.category.id), apiRequests: 0 });
    await atomicJson(join(runDir,"issues.json"),categories);
    await writeTextFile(join(runDir,"report.md"), `# 本地属性结构审计\n\n模板 ${state.templates.categories.length} 类，结构问题涉及 ${categories.length} 类；其中单选/多选没有选项的属性 ${emptyEnums} 个。API 请求 0。\n\n此检查只验证类型、选项、单位和重复字段等结构约定，不证明行业语义正确；未自动改动模板。问题详见 issues.json。\n\n先用 --invalid-only --sample=10 --plan 预览小批修订范围。\n`);
    console.log(`本地审计：模板 ${state.templates.categories.length} 类，结构问题 ${categories.length} 类，空枚举 ${emptyEnums} 个；API 请求 0\n报告：${join(runDir,"report.md")}`); return;
  }
  if (flags.adjudicate) {
    const document = await readJsonFile<AttributeAdjudication>(flags.adjudicate); validateAdjudication(document);
    const sourceDir = document.sourceRun.includes("/") ? resolve(document.sourceRun) : join(root, document.sourceRun);
    const sourceResults = new Map((await readJournal<RevisionResult>(join(sourceDir, "results.jsonl"))).map(r => [r.categoryId, r]));
    const results: RevisionResult[] = []; let alreadyApplied = 0;
    for (const decision of document.decisions) {
      const category = consensus.categories.find(c => c.category.id === decision.categoryId);
      const source = sourceResults.get(decision.categoryId);
      if (!category || !source) throw new Error(`裁决类目不在当前候选库或来源结果中：${decision.categoryId}`);
      const prior = state.records[decision.categoryId];
      const fingerprint = hashText(JSON.stringify({ reviewer: document.reviewer, sourceRun: document.sourceRun, sourceTemplateFingerprint: decision.sourceTemplateFingerprint, decision }));
      if (prior?.adjudicationFingerprint === fingerprint && matchesRevisionInput(prior.settledFingerprint, inputFor(category)) && templateFingerprint(inputFor(category).base) === decision.finalTemplateFingerprint) { alreadyApplied++; continue; }
      results.push(adjudicateRevision(inputFor(category), source, document, decision));
    }
    const passed = results.filter(r => r.status === "accepted").length;
    if (boolFlag(flags.plan) || boolFlag(flags["dry-run"])) { console.log(`裁决检查通过：可采用 ${passed}，保留待核 ${results.length - passed}，已采用 ${alreadyApplied}；API 请求 0`); return; }
    if (!results.length) { await atomicJson(templatePath, state.templates); console.log(`裁决已采用 ${alreadyApplied}，无需重复写入；API 请求 0`); return; }
    const runDir = join(root, `run-${new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-")}-adjudication`);
    await atomicJson(join(runDir, "adjudication.json"), document);
    const journal = jsonJournal(join(runDir, "results.jsonl"));
    for (const result of results) await journal.append(result);
    const next = mergeRevisionResults(state, results, runDir);
    await atomicJson(statePath, next); await atomicJson(templatePath, next.templates);
    await atomicJson(join(runDir, "attribute-templates-v1.json"), next.templates);
    await atomicJson(join(runDir, "manifest.json"), { protocol: REVISION_PROTOCOL, sourceRun: sourceDir, reviewer: document.reviewer, adjudicationFile: resolve(flags.adjudicate), categoryIds: results.map(r => r.categoryId), successCount: passed, needsReviewCount: results.length - passed, errorCount: 0, apiRequests: 0, usage: emptySemanticReviewUsage() });
    console.log(`本地裁决：采用 ${passed}，保留待核 ${results.length - passed}；API 请求 0\n正式模板：${templatePath}\n裁决记录：${runDir}`); return;
  }
  const fixedDir = fixed ? (fixed.includes("/") ? resolve(fixed) : join(root, fixed)) : undefined;
  const fixedManifest = fixedDir ? await readJsonFile<{ protocol?: string; categoryIds: string[] }>(join(fixedDir, "manifest.json")) : undefined;
  if (fixedManifest && (!Array.isArray(fixedManifest.categoryIds) || !fixedManifest.categoryIds.length)) throw new Error("运行 manifest 没有明确的类目 ID 清单");
  if ((flags["resume-run"] || flags["replay-run"]) && fixedManifest?.protocol !== REVISION_PROTOCOL) throw new Error("旧协议没有独立验收响应，不能恢复成正式结果；请用 --from-run 按原清单执行新流程");
  const fixedIds = fixedManifest ? new Set(fixedManifest.categoryIds) : undefined;
  if (fixedIds) for (const id of fixedIds) if (!consensus.categories.some(c => c.category.id === id)) throw new Error(`固定清单的类目不在当前候选库：${id}`);
  let recovered = 0;
  if (flags["resume-run"] && !boolFlag(flags.plan) && !boolFlag(flags["dry-run"])) {
    const records = await readJournal<RevisionResult>(join(fixedDir!, "results.jsonl"));
    for (const result of records) {
      const category = consensus.categories.find(c => c.category.id === result.categoryId);
      if (!category || !fixedIds?.has(result.categoryId) || !inSelector(result.categoryId) || result.status !== "accepted" || result.inputFingerprint !== revisionInputFingerprint(inputFor(category))) continue;
      state = mergeRevisionResults(state, [result], fixedDir!); accepted = templateMap(); recovered++;
    }
    if (recovered) await atomicJson(statePath, state);
  }
  const legacyErrors = initialized ? new Set((await optionalJson<{ errors?: Array<{ categoryId: string }> }>(join(root, "attribute-reviews-v1.json")))?.errors?.map(e => e.categoryId) ?? []) : new Set<string>();
  let skipped = 0; let awaitingAdjudication = 0;
  const matching = consensus.categories.filter(category => {
    const id = category.category.id; if (!inSelector(id)) return false;
    if (fixedIds && !fixedIds.has(id)) return false;
    const record = state!.records[id];
    const invalid = boolFlag(flags["invalid-only"]) && attributeContractIssues(baseFor(category)).length > 0;
    if (boolFlag(flags["invalid-only"]) && !invalid) return false;
    if (boolFlag(flags["failed-only"]) && !(record && record.status !== "accepted") && !legacyErrors.has(id)) return false;
    if (boolFlag(flags["unreviewed-only"]) && accepted.has(id)) return false;
    if (!invalid && !boolFlag(flags.force) && record?.status === "accepted" && matchesRevisionInput(record.settledFingerprint, inputFor(category))) { skipped++; return false; }
    if (!boolFlag(flags["retry-review"]) && record?.status === "needs_review" && matchesRevisionInput(record.inputFingerprint, inputFor(category))) { awaitingAdjudication++; return false; }
    return true;
  });
  const sample = flags.sample ? asInt(flags.sample, 30) : undefined;
  const limit = flags.limit ? asInt(flags.limit, 10) : !fixed && !selector && !sample && !boolFlag(flags.all) && !boolFlag(flags["changed-only"]) && !boolFlag(flags["failed-only"]) && !boolFlag(flags["unreviewed-only"]) ? 10 : undefined;
  const categories = sample ? sampleReviewCategories(matching, sample) : limit ? matching.slice(0, limit) : matching;
  if (!categories.length) {
    console.log(`当前范围无需请求；相同输入已验收 ${skipped}，等待裁决 ${awaitingAdjudication}，本地恢复 ${recovered}；API 请求 0`);
    if (awaitingAdjudication) console.log("待改进项保留上次提案与意见；用 --adjudicate=文件 采用明确裁决，或 --retry-review 明确重新付费尝试。");
    // 上一次可能在原子状态提交之后、兼容视图写入之前中断；零请求运行也修复视图。
    if ((!initialized || recovered > 0) && !boolFlag(flags.plan) && !boolFlag(flags["dry-run"])) await atomicJson(templatePath, state.templates);
    return;
  }
  const attempts = asInt(flags.attempts, 2);
  const concurrency = parseGovernanceConcurrency(flags.concurrency ?? Bun.env.CATEGORY_GOVERNANCE_CONCURRENCY);
  const runDir = join(root, `run-${new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-")}-revision`);
  const manifest = { protocol: REVISION_PROTOCOL, runDir, sourceConsensus: consensusPath, sourceRuns: consensus.sourceRuns, sourceEvidence: evidence ? evidencePath : null, anchor: state.anchor, fromRun: fixedDir, categoryIds: categories.map(c => c.category.id), categoryCount: categories.length, matchedCategoryCount: matching.length, consensusCategoryCount: consensus.categories.length, selectedStats: categories.map(c => ({ categoryId: c.category.id, ...reviewCategoryStats(c) })), sampleSize: sample ?? null, concurrency, workerCount: Math.min(categories.length, concurrency), attempts, skipped, awaitingAdjudication, recovered, thinking: "disabled" };
  console.log(`候选类目 ${consensus.categories.length}，本次 ${categories.length}；相同输入已验收跳过 ${skipped}，等待裁决 ${awaitingAdjudication}，本地恢复 ${recovered}`);
  console.log(`流程：模板增量修订 → 独立语义验收 → 通过后采用；并发 ${manifest.workerCount}；思考关闭`);
  if (initialized) console.log(`初始模板：${state.anchor?.path ?? "尚无基线，从空模板建立"}；旧复审输出保留为历史，不作为已验收修改`);
  if (boolFlag(flags.plan)) { await atomicJson(join(runDir, "plan.json"), { ...manifest, apiRequests: 0 }); console.log(`计划：${runDir}；API 请求 0`); return; }
  if (boolFlag(flags["dry-run"])) {
    const requests = jsonJournal(join(runDir, "requests.jsonl"));
    for (const category of categories) await requests.append({ categoryId: category.category.id, system: REVISION_SYSTEM_PROMPT, user: buildRevisionPrompt(inputFor(category)), inputFingerprint: revisionInputFingerprint(inputFor(category)) });
    await atomicJson(join(runDir, "manifest.json"), { ...manifest, dryRun: true, apiRequests: 0 }); console.log(`请求预览：${runDir}；API 请求 0`); return;
  }
  const replay = flags["replay-run"] ? await readJournal<RevisionTrace>(join(fixedDir!, "trace.jsonl")) : undefined;
  const responses = new Map(replay?.filter(e => e.response).map(e => [hashText(JSON.stringify(e.request)), e.response!]));
  if (boolFlag(flags.direct)) direct();
  const databases = injected || replay ? undefined : new DatabaseHub(loadAppConfig().postgresUrl);
  const ai = databases ? new AiService(new PostgresAiCatalog(databases.publicDatabase()), loadAppConfig().masterKey) : undefined;
  const usage = emptySemanticReviewUsage();
  const results: RevisionResult[] = [];
  const trace = jsonJournal(join(runDir, "trace.jsonl"));
  const completed = jsonJournal(join(runDir, "results.jsonl"));
  await atomicJson(join(runDir, "manifest.json"), { ...manifest, status: "running" });
  if (initialized && await Bun.file(templatePath).exists()) await copyFile(templatePath, join(runDir, "legacy-templates-before-migration.json"));
  const chat: RevisionChat = replay ? async request => {
    const response = responses.get(hashText(JSON.stringify(request)));
    if (!response) throw new Error("本地没有与当前输入完全相同的已保存响应；恢复不会调用 API");
    return response;
  } : injected?.chat ?? (request => ai!.chat(flags.provider ?? "deepseek", flags.model ?? "flash", request));
  let cursor = 0;
  let fatal: unknown;
  let actualRequests = 0;
  try {
    const workers = await Promise.allSettled(Array.from({ length: manifest.workerCount }, async () => {
      while (true) {
        const category = categories[cursor++]; if (!category) return;
        const input = inputFor(category);
        const previous = state!.records[category.category.id];
        const result = await reviseCategory(input, { chat, attempts, feedback: previous?.inputFingerprint === revisionInputFingerprint(input) ? previous.feedback : undefined, trace: async event => {
          actualRequests++;
          addSemanticReviewUsage(usage, event.response?.usage);
          await trace.append(event);
        } });
        await completed.append(result); // 先落盘，再记完成；中断后可恢复，避免重复付费。
        results.push(result);
        if (results.length === 1 || results.length % 10 === 0 || results.length === categories.length) console.log(`进度 ${results.length}/${categories.length}，通过 ${results.filter(r => r.status === "accepted").length}，待改进 ${results.filter(r => r.status === "needs_review").length}，请求/格式失败 ${results.filter(r => r.status === "failed").length}`);
      }
    }));
    const failedWorker = workers.find((worker): worker is PromiseRejectedResult => worker.status === "rejected");
    if (failedWorker) fatal = failedWorker.reason;
  } catch (error) { fatal = error; }
  finally { await databases?.closeAll(); await trace.flush(); await completed.flush(); }
  state = mergeRevisionResults(state, results, runDir);
  state.templates.sourceConsensus = [...new Set([...state.templates.sourceConsensus, ...consensus.sourceRuns])];
  await atomicJson(statePath, state); // 单个原子状态文件为正式真源；模板文件仅为兼容视图。
  await atomicJson(templatePath, state.templates);
  await atomicJson(join(runDir, "attribute-templates-v1.json"), state.templates);
  const acceptedCount = results.filter(r => r.status === "accepted").length;
  const needsReviewCount = results.filter(r => r.status === "needs_review").length;
  const errorCount = results.filter(r => r.status === "failed").length;
  const apiRequests = replay ? 0 : actualRequests;
  await atomicJson(join(runDir, "manifest.json"), { ...manifest, status: fatal ? "interrupted" : "completed", successCount: acceptedCount, needsReviewCount, errorCount, apiRequests, usage: replay ? emptySemanticReviewUsage() : usage, usageIncludesAllResponses: true, ...(replay ? { sourceResponseUsage: usage } : {}) });
  const rows = results.map(r => { const category = categories.find(c => c.category.id === r.categoryId)!; const before = inputFor(category).base; return `| ${category.category.name} | ${r.status} | ${before.shared.length + before.properties.length} | ${r.proposed ? r.proposed.shared.length + r.proposed.properties.length : "—"} | ${r.usage.totalTokens} | ${r.error ?? r.judgment?.issues.map(i => i.reason).join("；") ?? ""} |`; });
  await writeTextFile(join(runDir, "report.md"), `# 属性增量治理\n\n通过 ${acceptedCount}，待改进 ${needsReviewCount}，请求/格式失败 ${errorCount}。仅验收通过的模板进入正式文件。\n\nAPI 请求 ${apiRequests}；${replay ? "源响应" : "本次"}输入 ${usage.promptTokens}，输出 ${usage.completionTokens}，缓存命中 ${usage.promptCacheHitTokens}，未命中 ${usage.promptCacheMissTokens}，思考 ${usage.reasoningTokens ?? 0}。\n\n| 类目 | 状态 | 修改前属性数 | 提案属性数 | token | 问题 |\n|---|---|---:|---:|---:|---|\n${rows.join("\n")}\n`);
  console.log(`治理完成：验收通过 ${acceptedCount}，待改进 ${needsReviewCount}，请求/格式失败 ${errorCount}`);
  console.log(`正式模板：${templatePath}\n本次记录：${runDir}`);
  console.log(`API 请求 ${apiRequests}；输入 ${usage.promptTokens}，输出 ${usage.completionTokens}，缓存命中 ${usage.promptCacheHitTokens}，未命中 ${usage.promptCacheMissTokens}，思考 ${usage.reasoningTokens ?? 0}`);
  if (fatal) throw fatal;
}
