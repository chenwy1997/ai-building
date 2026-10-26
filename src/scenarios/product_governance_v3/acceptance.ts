import { join } from "node:path";
import { STAGES, save, read, hash, canonical, type Stage, Blocked } from "./core.ts";
import { loadRelease } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { fixtureSnapshot, fixtureTask, happyScript } from "./fixtures.ts";
import { Budget } from "./budget.ts";
import { ResponsesClient } from "./responses.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { matchesContextLayout } from "./request-layout.ts";

export async function offlineAcceptance(outDir: string) {
  const release = await loadRelease(),
    snapshot = new DataSnapshot(fixtureSnapshot()),
    stages = [];
  for (const stage of STAGES) {
    const mock = happyScript(stage),
      dir = join(outDir, stage),
      budget = new Budget(dir, 0, "offline-zero");
    const client = new ResponsesClient(
      { mode: "offline", transportId: "fixture-" + stage, fetch: mock.fetch },
      dir,
      budget,
    );
    const artifact = await runStage({
      release,
      snapshot,
      task: fixtureTask(stage),
      client,
      outDir: dir,
      corrections: BATCH_CORRECTIONS,
    });
    if (
      artifact.checks.status !== "program_pass_pending_human" ||
      artifact.checks.knowledgeGaps.length !== 0 ||
      client.calls + client.cacheHits !== 2 ||
      artifact.toolCount !== 1
    )
      throw new Blocked(
        "acceptance_failed",
        stage + " did not complete actual tool loop/checks",
      );
    const bodies = await Promise.all(artifact.requestKeys.map(async (key) =>
      (await read(join(dir, "requests", key + ".request.json"))).body));
    const contextIntegrity = bodies.every(body =>
      hash(JSON.parse(body.input[0].content)) === artifact.manifest.inputHash &&
      matchesContextLayout(body.input[0].content, artifact.manifest.requestLayout));
    const stableInstructions = bodies.every(body => body.instructions === bodies[0].instructions);
    const appendOnlyHistory = bodies.slice(1).every((body, index) =>
      canonical(body.input.slice(0, bodies[index].input.length)) === canonical(bodies[index].input));
    if (!contextIntegrity || !stableInstructions || !appendOnlyHistory)
      throw new Blocked("acceptance_failed", stage + " lost context or changed the existing request prefix");
    stages.push({
      stage,
      runKey: artifact.runKey,
      status: artifact.checks.status,
      requests: client.calls,
      cachedResponses: client.cacheHits,
      modelToolCalls: artifact.toolCount,
      requestLayout: artifact.manifest.requestLayout,
      contextIntegrity,
      stableInstructions,
      appendOnlyHistory,
      actualMaterialHashes: artifact.manifest.skill,
      knowledge: artifact.manifest.knowledge,
      ruleRegistryHash: artifact.manifest.ruleRegistryHash,
      actualReads: artifact.actualReads,
      executedChecks: artifact.checks.executedChecks,
      humanReviewRules: artifact.checks.humanReviewRules,
      nativeProjectionCount: artifact.nativeProjections.length,
    });
  }
  const report = {
    kind: "constructed_offline_wiring_acceptance",
    dataContractFormat: snapshot.data.format,
    transport: "injected_http_mock",
    releaseId: release.id,
    snapshotVersion: snapshot.version,
    stages,
    externalNetworkCalls: 0,
    paidModelCalls: 0,
    productionWrites: 0,
    businessAccuracyEvaluated: false,
    humanAuditCapabilityEvaluated: false,
    excelVisualAcceptancePerformed: false,
    fullBusinessWorkflowEvaluated: false,
    note: "程序接线构造验收；负例/预算/恢复/版本/证据检查见同目录Bun测试。尚未进行真实DeepSeek语义表现、业务留出集和线上写后核验。",
  };
  await save(join(outDir, "acceptance.json"), report);
  return report;
}
