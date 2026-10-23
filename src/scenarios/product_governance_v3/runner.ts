import { join } from "node:path";
import {
  canonical,
  hash,
  save,
  Blocked,
  type Task,
  type AttributeDefinition,
  type AttributeBinding,
} from "./core.ts";
import { assemble } from "./context.ts";
import type { Release } from "./release.ts";
import type { DataSnapshot } from "./snapshot.ts";
import type { ResponsesClient, InputItem } from "./responses.ts";
import { checkResult } from "./checks.ts";
import { projectNative } from "./native-contract.ts";
import { preparationBundle, type FactExtraction } from "./fact-preparation.ts";
import { parseResultJson, responseText } from "./result-json.ts";
import { modelConfigurationReview } from "./scripts/configuration-review.mjs";

export interface Limits {
  maxRounds: number;
  maxToolCalls: number;
  maxRequestBytes: number;
  maxToolBytes: number;
  maxOutputTokens: number;
}
export const DEFAULT_LIMITS: Limits = {
  maxRounds: 6,
  maxToolCalls: 16,
  maxRequestBytes: 350000,
  maxToolBytes: 160000,
  maxOutputTokens: 12000,
};
export interface ModelOptions {
  model: "deepseek-flash" | "deepseek-v4-pro";
  reasoningEffort: "none" | "low" | "high" | "max";
}
export const DEFAULT_MODEL: ModelOptions = {
  model: "deepseek-flash",
  reasoningEffort: "none",
};
export interface CorrectionPolicy { maxCorrections: number; converge: boolean }
export const BATCH_CORRECTIONS: CorrectionPolicy = Object.freeze({ maxCorrections: 2, converge: true });
export async function runStage(options: {
  release: Release;
  snapshot: DataSnapshot;
  task: Task;
  client: ResponsesClient;
  outDir: string;
  limits?: Partial<Limits>;
  model?: ModelOptions;
  corrections?: CorrectionPolicy;
  onProgress?: (event: Record<string, unknown>) => void;
}) {
  const { release, snapshot, task, client, outDir } = options,
    limits = { ...DEFAULT_LIMITS, ...options.limits },
    model = options.model ?? DEFAULT_MODEL,
    corrections = options.corrections ?? { maxCorrections: 0, converge: false };
  if (!Number.isInteger(corrections.maxCorrections) || corrections.maxCorrections < 0 || corrections.maxCorrections > 2)
    throw Error("maxCorrections must be 0..2 within the existing request/round limit");
  if (!["deepseek-flash", "deepseek-v4-pro"].includes(model.model) ||
      !["none", "low", "high", "max"].includes(model.reasoningEffort))
    throw Error("invalid model/reasoning configuration");
  for (const [key, value] of Object.entries(limits))
    if (!Number.isInteger(value) || value < 1)
      throw Error("invalid limit " + key);
  if (client.mode === "network" && snapshot.data.kind === "fixture")
    throw new Blocked("fixture_network", "fixture cannot enter paid transport");
  const plan = await assemble(release, snapshot, task),
    runKey = hash({
      manifest: plan.manifest,
      task,
      transportId: client.transportId,
      limits,
      model,
      corrections,
    }),
    runPath = join(outDir, "runs", runKey);
  const history: InputItem[] = [
      { role: "user", content: canonical(plan.input) },
    ],
    requestKeys: string[] = [],
    callIds = new Set<string>();
  let toolCount = 0,
    toolBytes = 0, forceFinal = false;
  const feedback: { round: number; code: string; details: unknown }[] = [];
  await client.budget.init();
  await save(runPath + ".manifest.json", {
    ...plan.manifest,
    runKey,
    limits,
    model,
    corrections,
    mode: client.mode,
  });
  try {
    if (plan.input.sharedContext.modelingMode === "inherited_leaf" && !snapshot.baseline(task))
      throw new Blocked("family_dependency", "inherited leaf requires a completed usable baseline; cannot fall back to independent generation");
    const knowledgeGaps = plan.tools.knowledgeGaps();
    if (task.stage !== "domain-research" && knowledgeGaps.length)
      throw new Blocked(
        "knowledge_dependency",
        "required knowledge is not ready; route to research/preparation before requesting a dependent candidate: " +
          knowledgeGaps.join("; "),
      );
    for (let round = 0; round < limits.maxRounds; round++) {
      const finalOnly = corrections.converge &&
        (forceFinal || toolCount >= limits.maxToolCalls || round + 1 === limits.maxRounds);
      const protocol = corrections.maxCorrections || corrections.converge ?
        `\n运行预算：本次请求为${round + 1}/${limits.maxRounds}轮；剩余模型工具调用${limits.maxToolCalls - toolCount}次（预取不占此额度）。` +
        "sharedContext已预取实际可用基线及其引用依赖、必读知识。按modelingMode执行：independent_proposal可提出独立待审方案，缺少基线本身不是不建属性的理由；inherited_leaf必须继承。工具参数必须合法JSON，类目ID必须来自树，缺省使用JSON null而非字符串null。" +
        "search_attribute_pool的query与categoryId至少一个非空，不要用null/null；多概念分开查询，结果不是同族继承合同。" +
        "baselineAttributeId仅引用当前适用family基线中的ID；属性池里看见同名属性不代表存在继承关系。共同定义须完整保持包括类型配置；叶绑定有变更必须写differenceReason。" +
        "isPublic或标题/列表展示为true时uses须包含display；searchable须包含search。引用只用实际已读版本和逐字原文。" +
        (finalOnly ? "当前必须直接输出最终JSON，禁止再调用工具。未解决问题明确留待人工，不得编造或删改冻结基线来过检查。" : "最终只输出合同JSON对象，不要Markdown或说明。") : "";
      const body = {
        model: model.model,
        instructions: plan.instructions + protocol,
        input: history,
        tools: plan.tools.definitions,
        reasoning: { effort: model.reasoningEffort },
        max_output_tokens: limits.maxOutputTokens,
        ...(finalOnly ? { tool_choice: "none" } : {}),
        text: {
          format: {
            type: "json_schema",
            name: task.stage.replaceAll("-", "_"),
            strict: true,
            schema: plan.schema,
          },
        },
      };
      if (Buffer.byteLength(canonical(body)) > limits.maxRequestBytes)
        throw new Blocked(
          "request_budget",
          "request/history exceeds byte budget",
        );
      options.onProgress?.({ event: "model-request", round: round + 1, maxRounds: limits.maxRounds,
        toolCallsRemaining: limits.maxToolCalls - toolCount, finalOnly, model: model.model, reasoningEffort: model.reasoningEffort });
      const { key, response, cached } = await client.request(body, {
        releaseId: release.id,
        snapshotVersion: snapshot.version,
      });
      requestKeys.push(key);
      options.onProgress?.({ event: "model-response", round: round + 1, cached });
      const calls = response.output.filter((i) => i.type === "function_call");
      if (calls.length) {
        const overBudget = toolCount + calls.length > limits.maxToolCalls;
        if (overBudget && !corrections.maxCorrections)
          throw new Blocked("tool_budget", "tool call limit exceeded");
        if (round + 1 === limits.maxRounds)
          throw new Blocked(
            "round_budget",
            "no round remains to consume tool results",
          );
        if (finalOnly) throw new Blocked("tool_budget", "model called a tool after explicit final-output convergence");
        // Validate the entire group before executing even the first read. Error feedback never grants tool access.
        const parsed: { call: InputItem; args: unknown }[] = [];
        const failures: { code: string; message: string; callId: string }[] = [];
        for (const call of calls) {
          if (callIds.has(call.call_id))
            throw new Blocked("duplicate_call_id", "function call ID reused");
          callIds.add(call.call_id);
          let args: unknown;
          // An unregistered tool remains a hard block, including malformed arguments.
          if (!plan.tools.definitions.some((d) => d.name === call.name))
            throw new Blocked("tool_not_allowed", "tool not allowed in stage: " + call.name);
          try { args = JSON.parse(call.arguments); }
          catch {
            failures.push({ code: "tool_arguments", message: "function arguments must be JSON; quote string/UUID values", callId: call.call_id });
            continue;
          }
          try { plan.tools.validateCall(call.name, args); }
          catch (error) { failures.push({ code: "tool_arguments", message: String(error), callId: call.call_id }); continue; }
          parsed.push({ call, args });
        }
        if (overBudget) {
          failures.push({ code: "tool_budget", message: "whole call group not executed: remaining tool budget is " + (limits.maxToolCalls - toolCount), callId: "group" });
          forceFinal = true;
        }
        if (failures.length && !corrections.maxCorrections)
          throw new Blocked(failures[0]!.code, failures[0]!.message);
        history.push(...response.output);
        const returned = new Map<string, string>();
        if (!failures.length) for (const { call, args } of parsed) {
          let value: unknown;
          try { value = await plan.tools.call(call.name, args); }
          catch (error) {
            // Scope errors may be corrected; unavailable sources, unknown tools and other boundary violations remain fatal.
            if (!corrections.maxCorrections || !(error instanceof Blocked) || error.code !== "pool_scope") throw error;
            failures.push({ code: error.code, message: String(error), callId: call.call_id });
            returned.set(call.call_id, canonical({ ok: false, error: failures.at(-1) }));
            continue;
          }
          const output = canonical(value);
          returned.set(call.call_id, output);
          toolCount++;
        }
        for (const call of calls) {
          const output = returned.get(call.call_id) ?? canonical({ ok: false, error: {
            code: "group_not_executed", message: "No tool in this invalid group was executed; correct the group or produce final JSON.", details: failures } });
          toolBytes += Buffer.byteLength(output);
          if (toolBytes > limits.maxToolBytes)
            throw new Blocked("tool_budget", "cumulative tool result/error byte limit exceeded");
          history.push({ type: "function_call_output", call_id: call.call_id, output });
        }
        if (failures.length) {
          if (feedback.length >= corrections.maxCorrections)
            throw new Blocked(failures[0]!.code, "bounded correction limit reached: " + failures[0]!.message);
          feedback.push({ round: round + 1, code: failures[0]!.code, details: failures });
        }
        continue;
      }
      let parsedResult: ReturnType<typeof parseResultJson>;
      try { parsedResult = parseResultJson(responseText(response.output)); }
      catch (error) {
        if (!(error instanceof Blocked) || !["final_json", "final_output"].includes(error.code) ||
            round + 1 === limits.maxRounds || feedback.length >= corrections.maxCorrections) throw error;
        feedback.push({ round: round + 1, code: error.code, details: error.message });
        history.push(...response.output, { role: "user", content: canonical({
          kind: "host_contract_feedback", code: error.code, errors: [error.message],
          instruction: "请返回一个完整合法的最终JSON对象。程序不修复业务字段或JSON语法；所有业务规则保持不变。" }) });
        continue;
      }
      const { result, ...outputParsing } = parsedResult;
      const checks = checkResult(task, result, plan.tools);
      if (checks.errors.length && round + 1 < limits.maxRounds && feedback.length < corrections.maxCorrections) {
        feedback.push({ round: round + 1, code: "program_checks", details: checks.errors });
        history.push(...response.output, { role: "user", content: canonical({
          kind: "host_contract_feedback", code: "program_checks", errors: checks.errors,
          instruction: "根据逐项错误自行纠正，返回完整JSON合同。不能篡改冻结定义、伪造引文或忽略规则；无法核实的问题明确待人工。" }) });
        continue;
      }
      const modeled = result as {
        attributes: AttributeDefinition[];
        bindings: AttributeBinding[];
      };
      const nativeProjections =
        task.stage === "family-modeling" && !checks.errors.length
          ? modeled.attributes.map((a) =>
              projectNative(
                a,
                modeled.bindings.find((b) => b.attributeId === a.id)!,
              ),
            )
          : [];
      const artifact = {
        runKey,
        mode: client.mode,
        snapshotKind: snapshot.data.kind,
        releaseId: release.id,
        manifest: plan.manifest,
        requestKeys,
        toolCount,
        result,
        checks,
        configurationReview: checks.executedChecks.includes("configuration-explanations") ? modelConfigurationReview(result) : null,
        outputParsing,
        feedback,
        factPreparation:
          task.stage === "fact-extraction" && !checks.errors.length
            ? preparationBundle(task, result as FactExtraction, plan.tools)
            : null,
        nativeProjections,
        toolEvents: plan.tools.events,
        actualReads: {
          knowledge: [...plan.tools.knowledgeReads].map(([id, ranges]) => ({
            id,
            version: release.knowledge[id]!.sha256,
            ranges,
          })),
          sources: [...plan.tools.sourceReads].map(([id, ranges]) => ({
            id,
            version: hash(snapshot.source(id, task)),
            ranges,
          })),
          calculationPolicies: [...plan.tools.policyReads].map(
            ([id, version]) => ({ id, version }),
          ),
          toolHistoryHash: hash(plan.tools.events),
        },
        adoption: checks.errors.length ? "not_eligible" : "pending_human",
        productionWrites: 0,
        businessRepairs: 0,
      };
      await save(runPath + ".result.json", artifact);
      return artifact;
    }
    throw new Blocked("round_budget", "response round limit exceeded");
  } catch (error) {
    await save(runPath + ".blocked.json", {
      runKey,
      releaseId: release.id,
      requestKeys,
      toolCount,
      toolEvents: plan.tools.events,
      feedback,
      status: "program_blocked",
      code: error instanceof Blocked ? error.code : "stage_error",
      knowledgeGaps: plan.tools.knowledgeGaps(),
      error: String(error),
      adoption: "not_eligible",
    });
    throw error;
  }
}
