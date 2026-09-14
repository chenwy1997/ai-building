import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { readJsonFile, readTextFile } from "../../facilities/json/files.ts";
import { parseGovernanceResponsePartial } from "./template-codec.ts";
import type { CategoryNode, CategoryTreeDocument, GovernanceResult } from "./types.ts";

interface RetryManifest {
  version: string;
  groupDepth: number;
  retryRunId?: string | null;
  source?: { contextSha256?: string };
  errors: Array<{ key: string; categoryIds?: string[]; error?: string }>;
}

export interface RecoveredGovernanceResult {
  result: GovernanceResult;
  rawText: string;
  source: {
    runId: string;
    batch: string;
    attempt: number;
    path: string;
    repairedClosingDelimiters: boolean;
  };
}

export interface GovernanceRetryPlan {
  runId: string;
  groupDepth: number;
  groups: Array<{ key: string; nodes: CategoryNode[]; error?: string }>;
  recovered: Map<string, RecoveredGovernanceResult>;
  inspectedRunIds: string[];
}

export function normalizeGovernanceRunId(value: string): string {
  const id = value.replace(/^run-/u, "");
  if (!/^\d+$/u.test(id)) throw new Error(`无效的治理运行编号：${value}`);
  return id;
}

function requestDirectory(outputRoot: string, runId: string, key: string): string {
  if (!key || basename(key) !== key || key === "." || key === "..") throw new Error(`无效的批次路径：${key}`);
  return join(outputRoot, `run-${runId}`, key);
}

/** 按历史请求中的准确 ID 重试，改变 batch-size 或重复补跑也不会错选类目。只读本地文件。 */
export async function planGovernanceRetry(options: {
  outputRoot: string;
  runId: string;
  document: CategoryTreeDocument;
  contextSha256: string;
}): Promise<GovernanceRetryPlan> {
  const runId = normalizeGovernanceRunId(options.runId);
  const chain: Array<{ id: string; manifest: RetryManifest }> = [];
  const seenRuns = new Set<string>();
  let currentId: string | null = runId;
  while (currentId) {
    if (seenRuns.has(currentId)) throw new Error("治理补跑记录的来源链存在循环");
    seenRuns.add(currentId);
    const manifest: RetryManifest = await readJsonFile(join(options.outputRoot, `run-${currentId}`, "manifest.json"));
    if (manifest.version !== options.document.version || (manifest.source?.contextSha256 && manifest.source.contextSha256 !== options.contextSha256)) {
      throw new Error(`run-${currentId} 与当前类目上下文不同，不能直接补跑`);
    }
    chain.push({ id: currentId, manifest });
    currentId = manifest.retryRunId ? normalizeGovernanceRunId(String(manifest.retryRunId)) : null;
  }
  const origin = chain[0]!;
  const byId = new Map(options.document.nodes.map((node) => [node.id, node]));
  const groups: GovernanceRetryPlan["groups"] = [];
  const targetIds = new Set<string>();
  for (const error of origin.manifest.errors) {
    const dir = requestDirectory(options.outputRoot, runId, error.key);
    let ids = error.categoryIds;
    if (!ids) {
      const files = (await readdir(dir)).filter((name) => /^attempt-\d+\.request\.json$/u.test(name)).sort();
      const latest = files.at(-1);
      if (!latest) throw new Error(`缺少失败请求，无法确定目标类目：${dir}`);
      ids = (await readJsonFile<{ categoryIds: string[] }>(join(dir, latest))).categoryIds;
    }
    if (!Array.isArray(ids) || ids.length === 0) throw new Error(`失败批次没有类目 ID：${error.key}`);
    const nodes = ids.map((id) => {
      const node = byId.get(id);
      if (!node?.isLeaf) throw new Error(`失败请求包含不存在的末级类目：${id}`);
      if (targetIds.has(id)) throw new Error(`失败记录包含重复类目：${id}`);
      targetIds.add(id);
      return node;
    });
    groups.push({ key: error.key, nodes, error: error.error });
  }

  const recovered = new Map<string, RecoveredGovernanceResult>();
  for (const run of chain) {
    for (const error of run.manifest.errors) {
      if (recovered.size === targetIds.size) break;
      const dir = requestDirectory(options.outputRoot, run.id, error.key);
      const names = (await readdir(dir)).filter((name) => /^attempt-\d+\.raw\.txt$/u.test(name)).sort().reverse();
      for (const name of names) {
        const request = await readJsonFile<{ categoryIds: string[] }>(join(dir, name.replace(/\.raw\.txt$/u, ".request.json")));
        const nodes = request.categoryIds.filter((id) => targetIds.has(id) && !recovered.has(id)).map((id) => byId.get(id)!);
        if (nodes.length === 0) continue;
        const path = join(dir, name);
        const rawText = await readTextFile(path);
        let parsed;
        try { parsed = parseGovernanceResponsePartial(rawText, nodes); } catch { continue; }
        for (const result of parsed.results) {
          recovered.set(result.category.id, {
            result, rawText,
            source: {
              runId: run.id, batch: error.key, attempt: Number(name.match(/attempt-(\d+)/u)![1]),
              path, repairedClosingDelimiters: parsed.repairedClosingDelimiters,
            },
          });
        }
      }
    }
  }
  return { runId, groupDepth: origin.manifest.groupDepth, groups, recovered, inspectedRunIds: chain.map((run) => run.id) };
}
