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
export async function runStage(options: {
  release: Release;
  snapshot: DataSnapshot;
  task: Task;
  client: ResponsesClient;
  outDir: string;
  limits?: Partial<Limits>;
}) {
  const { release, snapshot, task, client, outDir } = options,
    limits = { ...DEFAULT_LIMITS, ...options.limits };
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
    }),
    runPath = join(outDir, "runs", runKey);
  const history: InputItem[] = [
      { role: "user", content: canonical(plan.input) },
    ],
    requestKeys: string[] = [],
    callIds = new Set<string>();
  let toolCount = 0,
    toolBytes = 0;
  await client.budget.init();
  await save(runPath + ".manifest.json", {
    ...plan.manifest,
    runKey,
    limits,
    mode: client.mode,
  });
  try {
    const knowledgeGaps = plan.tools.knowledgeGaps();
    if (task.stage !== "domain-research" && knowledgeGaps.length)
      throw new Blocked(
        "knowledge_dependency",
        "required knowledge is not ready; route to research/preparation before requesting a dependent candidate: " +
          knowledgeGaps.join("; "),
      );
    for (let round = 0; round < limits.maxRounds; round++) {
      const body = {
        model: "deepseek-flash",
        instructions: plan.instructions,
        input: history,
        tools: plan.tools.definitions,
        reasoning: { effort: "none" },
        max_output_tokens: limits.maxOutputTokens,
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
      const { key, response } = await client.request(body, {
        releaseId: release.id,
        snapshotVersion: snapshot.version,
      });
      requestKeys.push(key);
      const calls = response.output.filter((i) => i.type === "function_call");
      if (calls.length) {
        if (toolCount + calls.length > limits.maxToolCalls)
          throw new Blocked("tool_budget", "tool call limit exceeded");
        if (round + 1 === limits.maxRounds)
          throw new Blocked(
            "round_budget",
            "no round remains to consume tool results",
          );
        // Validate the entire group before executing even the first read.
        const parsed = calls.map((call) => {
          if (callIds.has(call.call_id))
            throw new Blocked("duplicate_call_id", "function call ID reused");
          callIds.add(call.call_id);
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            throw new Blocked(
              "tool_arguments",
              "function arguments must be JSON",
            );
          }
          plan.tools.validateCall(call.name, args);
          return { call, args };
        });
        history.push(...response.output);
        for (const { call, args } of parsed) {
          const output = canonical(await plan.tools.call(call.name, args));
          toolBytes += Buffer.byteLength(output);
          if (toolBytes > limits.maxToolBytes)
            throw new Blocked(
              "tool_budget",
              "cumulative tool result byte limit exceeded",
            );
          history.push({
            type: "function_call_output",
            call_id: call.call_id,
            output,
          });
          toolCount++;
        }
        continue;
      }
      const texts = response.output
        .filter((i) => i.type === "message")
        .flatMap((i) =>
          Array.isArray(i.content)
            ? i.content
                .filter((c: any) => c.type === "output_text")
                .map((c: any) => c.text)
            : [],
        );
      if (texts.length !== 1 || typeof texts[0] !== "string")
        throw new Blocked(
          "final_output",
          "exactly one JSON output_text required",
        );
      let result: unknown;
      try {
        result = JSON.parse(texts[0]);
      } catch {
        throw new Blocked("final_json", "final output must be strict JSON");
      }
      const checks = checkResult(task, result, plan.tools);
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
      status: "program_blocked",
      code: error instanceof Blocked ? error.code : "stage_error",
      knowledgeGaps: plan.tools.knowledgeGaps(),
      error: String(error),
      adoption: "not_eligible",
    });
    throw error;
  }
}
