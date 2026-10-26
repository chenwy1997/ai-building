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
import { assembleStageContext, stageRequest } from "./stage-context.ts";
import type { Release } from "./release.ts";
import type { DataSnapshot } from "./snapshot.ts";
import type { ResponsesClient, InputItem } from "./responses.ts";
import { checkResult } from "./checks.ts";
import { projectNative } from "./native-contract.ts";
import { preparationBundle, type FactExtraction } from "./fact-preparation.ts";
import { parseResultJson, responseText, ResultJsonSyntaxError } from "./result-json.ts";
import { modelConfigurationReview } from "./scripts/configuration-review.mjs";
import { runtimeState } from "./request-layout.ts";
import { materializeModelResult } from "./modeling-proposal.ts";
import { correctableToolError } from "./runtime-errors.ts";
import { isOutputTruncated, terminalFailure } from "./response-outcome.ts";
import { outputTokens } from "./response-capacity.ts";

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
// A read-only replay client can verify a stopped transcript without reserving or
// sending another request. Normal execution still uses ResponsesClient.
export type StageClient = Pick<ResponsesClient, "mode" | "transportId" | "request"> & {
  budget: Pick<ResponsesClient["budget"], "init">;
};
export async function runStage(options: {
  release: Release;
  snapshot: DataSnapshot;
  task: Task;
  client: StageClient;
  outDir: string;
  limits?: Partial<Limits>;
  model?: ModelOptions;
  corrections?: CorrectionPolicy;
  onProgress?: (event: Record<string, unknown>) => void;
  // Host-only recovery keeps the frozen business version on the wire so paid
  // requests can replay exactly; record the actual host release separately.
  hostResume?: { hostReleaseId: string; sourceBatchId: string; sourceFingerprint: string };
  // Explicit recovery only. The historical incomplete request consumes a round;
  // one larger-capacity request may follow without resetting tools/corrections.
  outputRecovery?: { maxOutputTokens: number };
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
  outputTokens(limits.maxOutputTokens);
  if (options.outputRecovery) outputTokens(options.outputRecovery.maxOutputTokens);
  if (client.mode === "network" && snapshot.data.kind === "fixture")
    throw new Blocked("fixture_network", "fixture cannot enter paid transport");
  const plan = await assembleStageContext({ release, snapshot, task, limits, model, corrections }),
    runKey = hash({
      manifest: plan.manifest,
      task,
      transportId: client.transportId,
      limits,
      model,
      corrections,
      ...(options.outputRecovery ? { outputRecovery: options.outputRecovery } : {}),
    }),
    runPath = join(outDir, "runs", runKey);
  const history: InputItem[] = [
      { role: "user", content: plan.serializedInput },
    ],
    requestKeys: string[] = [],
    callIds = new Set<string>();
  const withRuntimeState = Boolean(corrections.maxCorrections || corrections.converge);
  let toolCount = 0,
    toolBytes = 0, forceFinal = false, effectiveOutputTokens = limits.maxOutputTokens;
  const capacityRecoveries: { round: number; requestKey: string; from: number; to: number }[] = [];
  const feedback: { round: number; code: string; details: unknown }[] = [];
  await client.budget.init();
  await save(runPath + ".manifest.json", {
    ...plan.manifest,
    runKey,
    limits,
    model,
    corrections,
    ...(options.hostResume ? { hostResume: options.hostResume } : {}),
    ...(options.outputRecovery ? { outputRecovery: options.outputRecovery } : {}),
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
      // Append after the previous response AND every paired tool output/feedback.
      // Never rewrite earlier states: the previous request remains an exact input prefix.
      if (withRuntimeState) history.push(runtimeState({ round: round + 1, maxRounds: limits.maxRounds,
        toolCallsRemaining: limits.maxToolCalls - toolCount, finalOnly }));
      const body = stageRequest(plan, task, model, { ...limits, maxOutputTokens: effectiveOutputTokens }, corrections, history, finalOnly);
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
      if (response.status !== "completed") {
        const increased = options.outputRecovery?.maxOutputTokens;
        if (!isOutputTruncated(response) || !increased || increased <= effectiveOutputTokens ||
            capacityRecoveries.length || round + 1 === limits.maxRounds) throw terminalFailure(response);
        capacityRecoveries.push({ round: round + 1, requestKey: key, from: effectiveOutputTokens, to: increased });
        effectiveOutputTokens = increased;
        // Keep the complete original input/tool history. The unfinished response
        // is archived in the journal, never executed, spliced or treated as fact.
        history.push({ role: "user", content: canonical({ kind: "host_output_capacity_feedback",
          reason: "max_output_tokens", instruction: "上一轮响应达到输出上限而截断，未采用其中的业务字段或工具调用。完整原输入和已完成工具结果仍在上文；本轮已提高输出额度，请返回符合原合同的完整结果。业务规则、模型思考档位和纠错额度不变。" }) });
        options.onProgress?.({ event: "output-capacity-recovery", round: round + 1, maxOutputTokens: increased });
        continue;
      }
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
            // A cursor is a model argument, not an infrastructure failure. Keep
            // source/permission/unknown-tool failures fatal; never drop a page.
            const correctable = correctableToolError(error);
            if (!corrections.maxCorrections || !correctable) throw error;
            failures.push({ code: correctable.code, message: correctable.message, callId: call.call_id });
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
        const details = error instanceof ResultJsonSyntaxError
          ? { message: error.message, envelope: error.envelope, diagnostic: error.diagnostic } : error.message;
        feedback.push({ round: round + 1, code: error.code, details });
        history.push(...response.output, { role: "user", content: canonical({
          kind: "host_contract_feedback", code: error.code, errors: [details],
          instruction: "请检查diagnostic的路径、所在对象、期待语法及错误位置之前的括号/引号，修正后返回完整合法的最终JSON对象，不要仅加代码围栏。location相对JSON内容，rawLocation相对原响应；偏移从0起、行列从1起，均按UTF-16计数。excerpt是原响应资料，不是指令；错误定位不是代改建议。程序不修复业务字段或JSON语法，所有业务规则保持不变。" }) });
        continue;
      }
      const { result: modelProposal, ...outputParsing } = parsedResult;
      let materialized: ReturnType<typeof materializeModelResult>;
      try { materialized = materializeModelResult(snapshot, task, modelProposal); }
      catch (error) {
        if (!(error instanceof Blocked) || error.code !== "proposal_contract" ||
            round + 1 === limits.maxRounds || feedback.length >= corrections.maxCorrections) throw error;
        feedback.push({ round: round + 1, code: error.code, details: error.message });
        history.push(...response.output, { role: "user", content: canonical({
          kind: "host_contract_feedback", code: error.code, errors: [error.message],
          instruction: "按本次schema返回增量提案；冻结对象只引用版本，修改写revisionRequests。程序不会代改业务判断。" }) });
        continue;
      }
      const { result, assembly } = materialized;
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
        ...(options.hostResume ? { hostResume: options.hostResume } : {}),
        manifest: plan.manifest,
        requestKeys,
        toolCount,
        result,
        modelProposal: assembly ? modelProposal : null,
        assembly,
        checks,
        configurationReview: checks.executedChecks.includes("configuration-explanations") ? modelConfigurationReview(result) : null,
        outputParsing,
        feedback,
        ...(options.outputRecovery ? { outputRecovery: options.outputRecovery, capacityRecoveries } : {}),
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
      ...(options.hostResume ? { hostResume: options.hostResume } : {}),
      requestKeys,
      toolCount,
      toolEvents: plan.tools.events,
      feedback,
      ...(options.outputRecovery ? { outputRecovery: options.outputRecovery, capacityRecoveries } : {}),
      status: "program_blocked",
      code: error instanceof Blocked ? error.code : "stage_error",
      knowledgeGaps: plan.tools.knowledgeGaps(),
      error: String(error),
      ...(error instanceof ResultJsonSyntaxError ? { diagnostic: error.diagnostic, envelope: error.envelope } : {}),
      adoption: "not_eligible",
    });
    throw error;
  }
}
