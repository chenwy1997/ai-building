import { join } from "node:path";
import { read, hash, Blocked } from "./core.ts";
import { readTerminalRequest, type RecordedRequest } from "./request-journal.ts";
import { verifiedReplayClient } from "./transcript-replay.ts";
import { isOutputTruncated } from "./response-outcome.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { batchTask, type BatchPlan, type BatchJob } from "./batch.ts";
import { assertCompatibleManifest } from "./batch-recovery.ts";
import type { Release } from "./release.ts";
import type { DataSnapshot } from "./snapshot.ts";

// Validate a saved resumption against its frozen source and paid transcript.
// No category IDs or failure counts are execution policy. Successful proposals,
// including explicit zero-attribute proposals, are preserved byte-for-byte.
export async function loadResumptionForOutputRecovery(args: {
  directory: string; parentDir: string; source: BatchPlan; sourceFingerprint: string;
  originalResults: any; snapshot: DataSnapshot; wireRelease: Release; ledger: any;
  execution: any; maxOutputTokens: number;
}) {
  const { directory, parentDir, source, snapshot, wireRelease, ledger } = args,
    identity = await read(join(parentDir, "resume.execution.json")), { id, ...record } = identity,
    saved = await read(join(parentDir, "resume.results.json"));
  if (id !== hash(record) || hash(identity) !== hash(await read(join(parentDir, "resume.identity.json"))) ||
      identity.sourceBatchId !== source.id || identity.sourceFingerprint !== args.sourceFingerprint ||
      identity.businessReleaseId !== source.releaseId || identity.inputVersion !== snapshot.version ||
      hash(identity.model) !== hash(source.model) || hash(identity.limits) !== hash(source.limits) ||
      saved.sourceBatchId !== source.id || saved.sourceFingerprint !== args.sourceFingerprint ||
      saved.hostReleaseId !== identity.hostReleaseId || saved.businessReleaseId !== source.releaseId ||
      saved.mode !== args.execution.mode || identity.mode !== args.execution.mode ||
      identity.transportId !== args.execution.transportId || hash(saved.model) !== hash(source.model) ||
      hash(saved.resumedCategoryIds) !== hash(identity.categoryIds) ||
      hash(saved.familySeeds) !== hash(args.originalResults.familySeeds) ||
      saved.leaves.length !== source.categoryIds.length ||
      hash(saved.leaves.map((j: BatchJob) => j.categoryId).sort()) !== hash([...source.categoryIds].sort()))
    throw new Blocked("resume_source_corrupt", "saved resumption differs from its frozen source/execution");
  const requests: RecordedRequest[] = [];
  for (const entry of saved.budget.entries) {
    const current = ledger.entries.find((e: any) => e.id === entry.id);
    if (!current || current.reservedCny !== entry.reservedCny)
      throw new Blocked("budget_change", "saved resumption reservation changed");
    requests.push(await readTerminalRequest(directory, entry.id));
  }
  const targets: BatchJob[] = [], transcripts = new Map<string, RecordedRequest[]>(), verified: string[] = [];
  for (const job of saved.leaves as BatchJob[]) {
    if (!identity.categoryIds.includes(job.categoryId)) {
      if (hash(job) !== hash(args.originalResults.leaves.find((j: BatchJob) => j.categoryId === job.categoryId)))
        throw new Blocked("resume_source_corrupt", "preserved source leaf was modified");
      continue;
    }
    const task = batchTask(source, job.categoryId, "leaf"), transcript = requests.filter(p => {
      let input: any;
      try { input = JSON.parse(p.request.body.input[0].content); } catch { return false; }
      return hash(input.task) === hash(task);
    });
    if (!transcript.length || transcript.length > source.limits.maxRounds || transcript.some(p =>
        p.request.identity.releaseId !== source.releaseId || p.request.identity.snapshotVersion !== snapshot.version))
      throw new Blocked("resume_transcript_drift", "saved resumption has missing, excessive or mismatched requests");
    const last = transcript.at(-1)!;
    if (job.status === "program_pass_pending_human") {
      if (!job.artifact || hash(job.artifact.requestKeys) !== hash(transcript.map(p => p.request.key)))
        throw new Blocked("resume_source_corrupt", "successful leaf request inventory changed");
      assertCompatibleManifest(job.artifact.manifest, wireRelease, task);
      const replay = verifiedReplayClient({ client: null, mode: args.execution.mode,
        transportId: args.execution.transportId, transcript });
      const rebuilt = await runStage({ release: wireRelease, snapshot, task, client: replay.client,
        outDir: join(parentDir, "output-recovery", "source-verification"), model: source.model,
        limits: source.limits, corrections: BATCH_CORRECTIONS });
      if (replay.consumed() !== transcript.length || ["result", "modelProposal", "assembly", "feedback", "toolEvents", "checks"]
        .some(k => hash((rebuilt as any)[k]) !== hash((job.artifact as any)[k])))
        throw new Blocked("resume_source_corrupt", "successful leaf differs from independently replayed result");
      verified.push(job.categoryId);
    } else if (job.code === "incomplete_response" && last.response.status !== "incomplete") {
      throw new Blocked("resume_source_corrupt", "incomplete leaf is missing its terminal paid response");
    } else if (job.code === "incomplete_response" && isOutputTruncated(last.response)) {
      if (transcript.slice(0, -1).some(p => p.response.status !== "completed") ||
          args.maxOutputTokens <= last.request.body.max_output_tokens)
        throw new Blocked("resume_capacity", "output recovery requires one terminal truncation and a larger explicit output limit");
      targets.push(job); transcripts.set(job.categoryId, transcript);
    }
  }
  return { targets, transcripts, originalResults: saved, sourceDir: parentDir,
    outDir: join(parentDir, "output-recovery"),
    parentFingerprint: hash({ identity, results: saved }), verifiedSourceLeaves: verified };
}
