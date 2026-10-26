import { parseArgs } from "node:util";
import { prepareContinuation } from "./batch-continuation.ts";
import { prepareResume, executeResume } from "./batch-resume.ts";
import { validateBatchAccounting } from "./batch-accounting.ts";
import { resolve, join as joinPath } from "node:path";
import { read, save, hash, lock, STAGES, type Stage, type Task } from "./core.ts";
import { freezeRelease, loadRelease } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { CategoryIndex } from "./catalog.ts";
import { assemble } from "./context.ts";
import { offlineAcceptance } from "./acceptance.ts";
import {
  captureRollPilot,
  nativeReadTransport,
  localReadKey,
} from "./scm-readonly.ts";
import { prepareRollPilot, replayRollExtraction } from "./roll-pilot.ts";
import { prepareBatch, planSummary, executeBatch, CLEAN_PAPER_ID } from "./batch.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { exportBatchReview, validateBatchExport } from "./batch-export.ts";
import { inventorySource } from "./scm-field-inventory.ts";
import { recheckBatch, correctBatchLeaf } from "./batch-recovery.ts";
import { prepareRerun, parseReasoningEffort } from "./batch-rerun.ts";
import { logFormat, progressLogger } from "./progress.ts";
import {
  importFactReview,
  type PreparationBundle,
  type FactReview,
} from "./fact-preparation.ts";

const USAGE = `商品治理v3：类目属性提案；默认离线，batch、batch-rerun、batch-continue、batch-resume或单类batch-recover显式--execute才请求付费DeepSeek；无生产写入。
  bun src/scenarios/product_governance_v3/cli.ts batch --category-id ${CLEAN_PAPER_ID} --concurrency 32
  bun src/scenarios/product_governance_v3/cli.ts batch --category-id ${CLEAN_PAPER_ID} --concurrency 32 --out outputs/product-governance-v3/clean-paper-batch --execute
  bun src/scenarios/product_governance_v3/cli.ts batch-export --out /batch-dir --freeze-through 属性方案=属性
  bun src/scenarios/product_governance_v3/cli.ts batch-recover --out /original-batch-dir
  bun src/scenarios/product_governance_v3/cli.ts batch-recover --out /original-batch-dir --category-id FAILED_LEAF_ID --execute
  bun src/scenarios/product_governance_v3/cli.ts batch-rerun --out /original-batch-dir --round rules-20261023 --concurrency 32
  bun src/scenarios/product_governance_v3/cli.ts batch-rerun --out /original-batch-dir --round pilot-low --category-ids LEAF_ID_1,LEAF_ID_2 --reasoning-effort low --concurrency 3
  bun src/scenarios/product_governance_v3/cli.ts batch-continue --out /original-batch-dir --from-round SOURCE_ROUND --category-ids LEAF_ID_1,LEAF_ID_2 --reasoning-effort low --concurrency 2
  bun src/scenarios/product_governance_v3/cli.ts batch-resume --out /original-batch-dir --from-round SOURCE_ROUND --reasoning-effort low --concurrency 32
  bun src/scenarios/product_governance_v3/cli.ts offline-acceptance --out outputs/product-governance-v3/offline
  bun src/scenarios/product_governance_v3/cli.ts plan --snapshot /abs/snapshot.json --category-id ID --stage family-modeling --run-id BATCH --out /abs/plan.json
  bun src/scenarios/product_governance_v3/cli.ts tree-search --tree scratch-category-baseline-20261010/mapped-tree.json --query 小卷纸 --limit 10
  bun src/scenarios/product_governance_v3/cli.ts budget-set-remaining --out /original-batch-dir --remaining-cny 100 --adjustment-id user-20261024 --reason 用户确认增加剩余预留额度
  bun src/scenarios/product_governance_v3/cli.ts freeze-release
  bun src/scenarios/product_governance_v3/cli.ts capture-roll-pilot --out /new/capture-dir
  bun src/scenarios/product_governance_v3/cli.ts inventory-scm-fields --source-root /local/scm-repository --out /abs/inventory.json
  bun src/scenarios/product_governance_v3/cli.ts prepare-roll-pilot --capture /capture-dir --tree /mapped-tree.json --out /prepared-dir
  bun src/scenarios/product_governance_v3/cli.ts replay-roll-pilot --snapshot /prepared-dir/snapshot.raw.json --proposals /recorded-agent-proposals.json --out /replay-dir
  bun src/scenarios/product_governance_v3/cli.ts import-fact-review --snapshot /prepared-dir/snapshot.raw.json --bundle /bundle.json --review /human.review.json --out /new/reviewed-snapshot-dir
  bun test ./src/scenarios/product_governance_v3
sku-filling/fact-extraction另需--product-id；SKU审核需--product-id，审核另需--candidate文件。分页可传--cursor，树检索可传--scope-id。
batch支持--tree或--snapshot、--budget-cny（默认200保守预留额度，不是预计账单）、--out、--run-id；并发1..128，默认8。batch、batch-rerun、batch-continue、batch-resume或batch-recover的--execute才读取DEEPSEEK_API_KEY（Bun可从.env自动载入）。batch-rerun显式按当前规则新建一轮，必须指定--round名称；--out仍为原批次根目录，--category-id可选且不得越出原范围；同名重复执行只恢复该轮，可调并发，不能改预算或输入。旧方案不复用，已审阅输入基线仍保留，费用沿用原台账。原批次普通重跑只恢复相同请求；修复宿主后请用batch-recover，默认只离线复核，不请求模型。需要纠正时显式指定一个失败末级ID并加--execute；只补该类及必要的同族基线，沿用原累计费用台账。结果未知的请求绝不自动重发。--log-format human|json|quiet默认human，正常进度stdout，阻断stderr；quiet只输出最后汇总。输出属性方案/扩展候选/全部类目问题和审阅Excel；不试填SKU值。
默认知识覆盖清洁纸品，其他类目需--snapshot提供已准备的字段职责、知识要求及同族。capture-roll-pilot仅两类各最多3件，无自动重试；仅此命令读取供应链密钥。replay使用录制候选，不发送DeepSeek请求。
batch-rerun另支持--category-ids逗号分隔末级ID列表（与--category-id互斥，不展开上级）、--reasoning-effort none|low|high|max（none关闭思考，省略沿用原档位）。范围和思考档位随轮次冻结；A/B须用不同固定轮次名，仍共用原累计预算。详见docs/small-scope-reasoning-pilot-20261023.md。
batch-continue只续跑发送前context_budget阻断的末级，完整核对并复用已通过基线。--from-round指定原轮次，保持原runId/资料/模型档位与累计预算；省略--execute仅预检。同源轮次固定continuations目录，重复执行恢复原请求，不重新生成基线或购买新循环。
batch-resume用于本地预留触顶或已修复的分页游标错误：先离线逐请求重放核对，再从原中断位置继续；保留成功末级和已生成基线，6轮/2次纠错额度不重置。固定resumptions/来源轮次目录，--execute由用户显式执行；不重置预算，不处理结果未知的请求。
freeze-release仅更新本地材料/代码指纹，不能替代规范内容的人类评审。`;
export async function main(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      out: { type: "string" },
      snapshot: { type: "string" },
      "category-id": { type: "string" },
      "category-ids": { type: "string" },
      "reasoning-effort": { type: "string" },
      stage: { type: "string" },
      "run-id": { type: "string" },
      "product-id": { type: "string" },
      candidate: { type: "string" },
      tree: { type: "string" },
      query: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
      "scope-id": { type: "string" },
      help: { type: "boolean" },
      capture: { type: "string" },
      proposals: { type: "string" },
      bundle: { type: "string" },
      review: { type: "string" },
      "source-root": { type: "string" },
      concurrency: { type: "string" },
      "budget-cny": { type: "string" },
      execute: { type: "boolean" },
      "no-excel": { type: "boolean" },
      layout: { type: "string" },
      "freeze-left": { type: "string" },
      "freeze-through": { type: "string", multiple: true },
      "log-format": { type: "string" },
      round: { type: "string" },
      "from-round": { type: "string" },
      "remaining-cny": { type: "string" },
      "adjustment-id": { type: "string" },
      reason: { type: "string" },
    },
  });
  const required = (key: keyof typeof values) => {
    const v = values[key];
    if (typeof v !== "string" || !v) throw Error("--" + key + " required");
    return v;
  };
  if (values.help || !positionals.length) return { help: USAGE };
  if (positionals.length !== 1) throw Error("one command required");
  if (values.round && positionals[0] !== "batch-rerun") throw Error("--round仅用于batch-rerun");
  if (values["from-round"] && !["batch-continue", "batch-resume"].includes(positionals[0]!)) throw Error("--from-round仅用于batch-continue或batch-resume");
  if ((values["category-ids"] !== undefined || values["reasoning-effort"] !== undefined) && !["batch-rerun", "batch-continue", "batch-resume"].includes(positionals[0]!))
    throw Error("--category-ids和--reasoning-effort仅用于batch-rerun、batch-continue或batch-resume");
  if (["remaining-cny", "adjustment-id", "reason"].some(k => values[k as keyof typeof values] !== undefined) && positionals[0] !== "budget-set-remaining")
    throw Error("额度调整参数只用于budget-set-remaining");
  switch (positionals[0]) {
    case "budget-set-remaining": {
      for (const key of Object.keys(values)) if (!["out", "remaining-cny", "adjustment-id", "reason"].includes(key))
        throw Error("budget-set-remaining只接受原批次目录、剩余额度、授权ID和原因；不会执行模型任务");
      const directory = resolve(required("out"));
      return lock(joinPath(directory, "execution.lock"), async () => {
        const source = await read(joinPath(directory, "batch.identity.json")), {id, ...identity} = source,
          execution = await read(joinPath(directory, "execution.identity.json"));
        if (source.accounting || source.format !== 1 || id !== hash(identity) || execution.batchId !== id)
          throw Error("额度调整须指向完整的原始批次根目录");
        const budget = new Budget(directory, execution.budgetCny, execution.pricingId);
        const result = await budget.setRemaining(Number(required("remaining-cny")), required("adjustment-id"), required("reason"));
        return {budgetPath: budget.path, originalLimitCny: result.originalLimitCny, limitCny: result.limitCny,
          cumulativeReservedCny: Number(result.committedUpperBoundCny.toFixed(2)), remainingReservationCny: result.remainingReservationCny,
          adjustment: result.adjustments?.at(-1), accounting: result.accounting, modelRequests: 0};
      });
    }
    case "batch-export":
      return exportBatchReview(resolve(required("out")), layoutArgs(values));
    case "batch-resume": {
      for (const key of Object.keys(values)) if (!["out", "from-round", "concurrency", "reasoning-effort", "execute",
        "no-excel", "layout", "freeze-left", "freeze-through", "log-format"].includes(key))
        throw Error("batch-resume只恢复原轮次已识别的失败；不能更换范围、输入、轮次或预算");
      const options = { directory: resolve(required("out")), fromRound: required("from-round"),
        concurrency: Number(values.concurrency ?? "32"), reasoningEffort: parseReasoningEffort(values["reasoning-effort"]) },
        release = await loadRelease(), format = logFormat(values["log-format"]);
      await validateBatchExport(layoutArgs(values));
      const preview = await prepareResume(options, release);
      if (!values.execute) { if (!preview.ready) process.exitCode = 2; return preview; }
      if (!preview.ready) throw Error("离线重放预检未通过；见 " + preview.outDir + "/resume.plan.json，未新增模型请求");
      const root = await validateBatchAccounting(options.directory);
      if (root.execution.mode !== "network") throw Error("构造离线批次不能通过CLI转为付费执行");
      const key = process.env.DEEPSEEK_API_KEY?.trim();
      if (!key) throw Error("缺少DEEPSEEK_API_KEY；预检已保存，未新增模型请求");
      const client = new ResponsesClient({ mode: "network", allowNetwork: true, apiKey: key,
        transportId: root.execution.transportId, perRequestUpperBoundCny: root.source.reserveCny, timeoutMs: 240000 },
        options.directory, new Budget(options.directory, root.execution.budgetCny, root.execution.pricingId));
      const result = await executeResume(options, release, client, progressLogger(format));
      let excel: unknown = null, exportError: string | null = null;
      if (!values["no-excel"]) try { excel = await exportBatchReview(result.outDir, layoutArgs(values)); }
      catch (e) { exportError = String(e); }
      if (result.blocked || exportError) process.exitCode = 2;
      return { ...result, excel, exportError };
    }
    case "batch-continue":
    case "batch-rerun": {
      const continuing = positionals[0] === "batch-continue";
      if (continuing && (values.round || values["category-id"])) throw Error("续跑须指定--from-round和--category-ids，不能换轮次或展开类目");
      if (values.tree || values.snapshot || values.stage || values["product-id"] || values.candidate || values["budget-cny"] || values["run-id"])
        throw Error("新一轮沿用原批次资料和累计预算，不接受更换输入、试填商品或重设费用");
      await validateBatchExport(layoutArgs(values));
      const format = logFormat(values["log-format"]), directory = resolve(required("out")), release = await loadRelease();
      const { plan, execution, preview } = continuing
        ? await prepareContinuation({ directory, fromRound: required("from-round"),
          categoryIds: required("category-ids").split(",").map(id => id.trim()),
          reasoningEffort: parseReasoningEffort(values["reasoning-effort"]), concurrency: Number(values.concurrency ?? "2") }, release)
        : await prepareRerun({ directory, roundName: required("round"),
        categoryId: values["category-id"], categoryIds: values["category-ids"]?.split(",").map((id) => id.trim()),
        reasoningEffort: parseReasoningEffort(values["reasoning-effort"]), concurrency: Number(values.concurrency ?? "8") }, release);
      if (!values.execute) {
        if (plan.preflight.length) process.exitCode = 2;
        return preview;
      }
      if (plan.preflight.length) throw Error("预检未通过，见 " + plan.outDir + (continuing ? "/continuation.plan.json" : "/rerun.plan.json") + "；未请求DeepSeek");
      if (execution.mode !== "network") throw Error("构造离线批次不能通过CLI转为付费执行");
      const key = process.env.DEEPSEEK_API_KEY?.trim();
      if (!key) throw Error("缺少DEEPSEEK_API_KEY；新一轮预检已保存，未新增模型请求");
      const client = new ResponsesClient({ mode: "network", allowNetwork: true, apiKey: key,
        transportId: execution.transportId, perRequestUpperBoundCny: plan.reserveCny, timeoutMs: 240000 },
        directory, new Budget(directory, execution.budgetCny, execution.pricingId));
      const result = await executeBatch(plan, release, client, progressLogger(format));
      let excel: unknown = null, exportError: string | null = null;
      if (!values["no-excel"]) try { excel = await exportBatchReview(plan.outDir, layoutArgs(values)); }
      catch (error) { exportError = String(error); }
      if (result.blocked || exportError) process.exitCode = 2;
      return { outDir: plan.outDir, originalDirectory: directory, roundName: values.round ?? values["from-round"], continuation: continuing, model: plan.model, passed: result.passed,
        proposalsPendingHuman: result.proposalsPendingHuman, noAdmittedAttributes: result.noAdmittedAttributes,
        blocked: result.blocked, total: result.total, requests: result.networkCallsThisExecution,
        cacheHits: result.cacheHitsThisExecution, cumulativeReservedCny: Number(result.budget.committedUpperBoundCny.toFixed(2)),
        budgetLimitCny: result.budget.limitCny, accounting: result.budget.accounting, excel, exportError,
        adoption: "pending_human", productionWrites: 0 };
    }
    case "batch-recover": {
      if (values.tree || values.snapshot || values.stage || values["product-id"] || values.candidate ||
          values["budget-cny"] || values["run-id"] || values.concurrency)
        throw Error("恢复沿用原批次输入和累计预算；当前只支持指定一个失败末级类目及必要同族基线，不接受重设输入或并发参数");
      const dir = resolve(required("out")), format = logFormat(values["log-format"]), release = await loadRelease();
      await validateBatchExport(layoutArgs(values));
      const recheck = await recheckBatch(dir, release);
      const selected = values["category-id"] ? recheck.jobs.find((j) => j.categoryId === values["category-id"]) : null;
      if (values["category-id"] && !selected)
        throw Error("--category-id须为原批次中的一个末级类目，不能传整个大类");
      const selectedGroup = selected ? recheck.original.groups.find((g: { members: string[] }) => g.members.includes(selected.categoryId)) : null;
      const needsSeed = selectedGroup?.needsSeed && recheck.seeds.find((j) => j.familyId === selectedGroup.id)?.status !== "program_pass_pending_human";
      const stages = !selected || selected.status === "program_pass_pending_human" ? 0 : needsSeed ? 2 : 1;
      const selectedPlan = selected ? { categoryId: selected.categoryId, currentStatus: selected.status,
        prerequisiteFamilySeed: needsSeed ? selectedGroup.id : null,
        maximumNewRequests: stages * recheck.original.limits.maxRounds,
        maximumAdditionalReservationCny: Number((stages * recheck.original.limits.maxRounds * recheck.original.reserveCny).toFixed(2)),
        accounting: "保守预留上限，不是实际收费；沿用原累计预算", executeRequested: !!values.execute } : null;
      let result: any = recheck.report;
      if (values.execute) {
        const categoryId = required("category-id");
        if (!recheck.jobs.some((j) => j.categoryId === categoryId))
          throw Error("--category-id须为原批次中的一个末级类目，不能传整个大类");
        // Already eligible historical results must not require a key or make another paid call.
        if (recheck.jobs.find((j) => j.categoryId === categoryId)!.status === "program_pass_pending_human")
          result = { ...recheck.report, skipped: "already_program_pass_pending_human" };
        else {
          const key = process.env.DEEPSEEK_API_KEY?.trim();
          if (!key) throw Error("缺少DEEPSEEK_API_KEY；离线复核已保存，未新增模型请求");
          const budget = new Budget(dir, recheck.execution.budgetCny, recheck.execution.pricingId),
            client = new ResponsesClient({ mode: "network", allowNetwork: true, apiKey: key,
              transportId: recheck.execution.transportId, perRequestUpperBoundCny: recheck.original.reserveCny,
              timeoutMs: 240000 }, dir, budget);
          result = await correctBatchLeaf(dir, release, categoryId, client, progressLogger(format));
        }
      }
      let excel: unknown = null, exportError: string | null = null;
      if (!values["no-excel"]) {
        try { excel = await exportBatchReview(result.outDir, layoutArgs(values)); }
        catch (error) { exportError = String(error); }
      }
      if ((values.execute && !result.skipped && result.blocked) || exportError) process.exitCode = 2;
      const { traces, pending, ...summary } = result;
      return { ...summary, pendingFile: joinPath(result.outDir, values.execute && !result.skipped ? "correction.results.json" : "pending-corrections.json"),
        selectedPlan, excel, exportError, next: values.execute ? "先检查所选类目结果，再决定是否逐类继续" : "查看离线结果和待纠正清单；如需付费纠正，指定一个失败末级ID并加--execute，勿换目录整批重跑" };
    }
    case "batch": {
      if (values["product-id"] || values.candidate || (values.stage && values.stage !== "family-modeling"))
        throw Error("batch只产出类目属性方案，不接受商品试填、候选审核或其他stage参数");
      await validateBatchExport(layoutArgs(values));
      const format = logFormat(values["log-format"]);
      const categoryId = required("category-id"),
        outDir = resolve(values.out ?? `outputs/product-governance-v3/attributes-${categoryId}`),
        release = await loadRelease(),
        plan = await prepareBatch({
          categoryId, outDir, runId: values["run-id"] ?? outDir,
          concurrency: Number(values.concurrency ?? "8"),
          ...(values.tree ? { treePath: values.tree } : {}),
          ...(values.snapshot ? { snapshotPath: values.snapshot } : {}),
          ...(values["budget-cny"] !== undefined ? { budgetCny: Number(values["budget-cny"]) } : {}),
        }, release);
      if (!values.execute) {
        if (plan.preflight.length) process.exitCode = 2;
        return planSummary(plan);
      }
      if (plan.preflight.length) throw Error("预检未通过，见 " + outDir + "/batch.plan.json；未请求DeepSeek");
      const key = process.env.DEEPSEEK_API_KEY?.trim();
      if (!key) throw Error("缺少DEEPSEEK_API_KEY；在本地.env设置后重跑，未请求DeepSeek。不要将密钥放在命令参数或提交到Git。");
      const budget = new Budget(outDir, plan.budgetCny, plan.pricingId),
        client = new ResponsesClient({ mode: "network", allowNetwork: true, apiKey: key,
          transportId: "deepseek-official-responses-v1", perRequestUpperBoundCny: plan.reserveCny, timeoutMs: 240000 }, outDir, budget),
        result = await executeBatch(plan, release, client,
          progressLogger(format));
      let excel: unknown = null, exportError: string | null = null;
      if (!values["no-excel"]) {
        try { excel = await exportBatchReview(outDir, layoutArgs(values)); }
        catch (error) { exportError = String(error); }
      }
      if (result.blocked || exportError) process.exitCode = 2;
      return { outDir, passed: result.passed, blocked: result.blocked, total: result.total,
        proposalsPendingHuman: result.proposalsPendingHuman, noAdmittedAttributes: result.noAdmittedAttributes,
        requests: result.networkCallsThisExecution, cacheHits: result.cacheHitsThisExecution,
        reservedCny: Number(result.budget.committedUpperBoundCny.toFixed(2)), excel, exportError,
        adoption: "pending_human", productionWrites: 0 };
    }
    case "inventory-scm-fields": {
      const inventory = await inventorySource(resolve(required("source-root")));
      await save(resolve(required("out")), inventory);
      return {
        fields: inventory.fields.length,
        unmapped: inventory.unknown.length,
        status: inventory.status,
        productionWrites: 0,
      };
    }
    case "capture-roll-pilot":
      return captureRollPilot(
        resolve(required("out")),
        nativeReadTransport(await localReadKey()),
      );
    case "prepare-roll-pilot":
      return prepareRollPilot(
        resolve(required("capture")),
        resolve(required("out")),
        resolve(required("tree")),
      );
    case "replay-roll-pilot":
      return replayRollExtraction(
        resolve(required("snapshot")),
        resolve(required("proposals")),
        resolve(required("out")),
      );
    case "import-fact-review": {
      const output = await importFactReview(
        new DataSnapshot(await read(required("snapshot"))),
        await read<PreparationBundle>(required("bundle")),
        await read<FactReview>(required("review")),
      );
      const dir = resolve(required("out"));
      await save(resolve(dir, "snapshot.reviewed.json"), output.snapshot.data);
      await save(resolve(dir, "review-receipt.json"), output.receipt);
      return {
        acceptedFacts: output.receipt.acceptedFacts,
        remainingCandidates: output.receipt.remainingCandidates,
        productionWrites: 0,
      };
    }
    case "freeze-release":
      return freezeRelease();
    case "offline-acceptance":
      return offlineAcceptance(resolve(required("out")));
    case "plan": {
      const stage = required("stage") as Stage;
      if (!STAGES.includes(stage)) throw Error("unknown stage");
      const task: Task = {
        runId: required("run-id"),
        stage,
        categoryId: required("category-id"),
        productId: values["product-id"] ?? null,
        question: "离线上下文预检",
        candidate: values.candidate
          ? await read(resolve(values.candidate))
          : null,
      };
      const release = await loadRelease(),
        snapshot = new DataSnapshot(await read(resolve(required("snapshot")))),
        plan = await assemble(release, snapshot, task);
      const path = resolve(required("out"));
      await save(path, {
        manifest: plan.manifest,
        instructions: plan.instructions,
        input: plan.input,
        tools: plan.tools.definitions,
        outputSchema: plan.schema,
      });
      return {
        mode: "offline-plan",
        path,
        releaseId: release.id,
        snapshotVersion: snapshot.version,
        networkCalls: 0,
      };
    }
    case "tree-search": {
      const tree = new CategoryIndex(await read(resolve(required("tree")))),
        query = required("query"),
        scopeId = values["scope-id"] ?? null;
      return tree.page(
        tree.search(query, scopeId),
        { query, scopeId },
        Number(values.limit ?? "20"),
        values.cursor ?? null,
      );
    }
    default:
      throw Error(
        "unknown command: " + positionals[0] + "\n" + USAGE,
      );
  }
}
function layoutArgs(values: { layout?: string; "freeze-left"?: string; "freeze-through"?: string[] }) {
  return [
    ...(values.layout ? ["--layout", resolve(values.layout)] : []),
    ...(values["freeze-left"] !== undefined ? ["--freeze-left", values["freeze-left"]] : []),
    ...(values["freeze-through"] ?? []).flatMap((v) => ["--freeze-through", v]),
  ];
}
if (import.meta.main)
  main(Bun.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(String(error));
      process.exitCode = 1;
    });
