import { Blocked, canonical, type Task } from "./core.ts";
import { assemble } from "./context.ts";
import type { Release } from "./release.ts";
import type { DataSnapshot } from "./snapshot.ts";
import type { InputItem } from "./responses.ts";
import type { Limits, ModelOptions, CorrectionPolicy } from "./runner.ts";
import { RUNTIME_PROTOCOL, runtimeState } from "./request-layout.ts";

// Engineering headroom for append-only tool output and bounded correction feedback.
// It is not a provider token-window claim or permission to raise the paid request cap.
export const HISTORY_HEADROOM_BYTES = 64000;

export function stageRequest(plan: Awaited<ReturnType<typeof assemble>>, task: Task,
  model: ModelOptions, limits: Limits, corrections: CorrectionPolicy,
  history: InputItem[], finalOnly: boolean) {
  return {
    model: model.model,
    instructions: plan.instructions + (corrections.maxCorrections || corrections.converge ? RUNTIME_PROTOCOL : ""),
    input: history, tools: plan.tools.definitions,
    reasoning: { effort: model.reasoningEffort }, max_output_tokens: limits.maxOutputTokens,
    ...(finalOnly ? { tool_choice: "none" } : {}),
    text: { format: { type: "json_schema", name: task.stage.replaceAll("-", "_"), strict: true, schema: plan.schema } },
  };
}

export async function assembleStageContext(options: {
  release: Release; snapshot: DataSnapshot; task: Task;
  model: ModelOptions; limits: Limits; corrections: CorrectionPolicy;
}) {
  const { release, snapshot, task, model, limits, corrections } = options;
  // Preserve all source text; the actual serialized request, not an unrelated 200 KB
  // source-only threshold, determines whether a stage can start.
  const plan = await assemble(release, snapshot, task, limits.maxRequestBytes),
    finalOnly = corrections.converge && limits.maxRounds === 1,
    history: InputItem[] = [{ role: "user", content: plan.serializedInput }];
  if (corrections.maxCorrections || corrections.converge)
    history.push(runtimeState({ round: 1, maxRounds: limits.maxRounds, toolCallsRemaining: limits.maxToolCalls, finalOnly }));
  const initialRequestBytes = Buffer.byteLength(canonical(stageRequest(plan, task, model, limits, corrections, history, finalOnly))),
    historyReserveBytes = limits.maxRounds > 1 ? HISTORY_HEADROOM_BYTES : 0,
    capacity = { initialRequestBytes, maxRequestBytes: limits.maxRequestBytes,
      historyReserveBytes, initialLimitBytes: limits.maxRequestBytes - historyReserveBytes,
      availableHistoryBytes: limits.maxRequestBytes - initialRequestBytes,
      contextBytes: plan.manifest.contextUsage.totalBytes,
      envelopeBytes: initialRequestBytes - plan.manifest.contextUsage.totalBytes };
  if (initialRequestBytes > capacity.initialLimitBytes)
    throw new Blocked("context_budget", "complete initial request leaves insufficient history capacity: " + canonical(capacity) +
      "; no content was truncated and no request was sent; preserve any completed baseline and inspect capacity before continuation");
  return { ...plan, manifest: { ...plan.manifest, requestCapacity: capacity } };
}
