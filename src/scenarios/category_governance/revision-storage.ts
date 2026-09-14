import { appendFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SemanticTemplateDocument } from "./semantic-review.ts";
import { acceptedRevision, revisionFeedback, type RevisionResult } from "./attribute-revision.ts";
import { adjudicationFingerprint } from "./revision-adjudication.ts";

export interface RevisionState {
  version: "attribute-governance-state-v2";
  anchor: { path: string; sha256: string } | null;
  updatedAt: string;
  templates: SemanticTemplateDocument;
  records: Record<string, {
    status: RevisionResult["status"];
    inputFingerprint: string;
    settledFingerprint?: string;
    runDir: string;
    error?: string;
    feedback?: unknown;
    adjudicationFingerprint?: string;
    reviewedReference?: string;
  }>;
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await Bun.write(temp, JSON.stringify(value) + "\n"); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}

export function jsonJournal(path: string) {
  let pending: Promise<void> = mkdir(dirname(path), { recursive: true }).then(() => {});
  return {
    append(value: unknown): Promise<void> {
      pending = pending.then(() => appendFile(path, JSON.stringify(value) + "\n", "utf8"));
      return pending;
    },
    flush: () => pending,
  };
}

export async function readJournal<T>(path: string): Promise<T[]> {
  const lines = (await readFile(path, "utf8")).split("\n");
  const result: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try { result.push(JSON.parse(line)); }
    catch (error) {
      // 进程被中断时最后一行可能未写完；完整行中的错误不能静默跳过。
      if (i === lines.length - 1) break;
      throw error;
    }
  }
  return result;
}

export function mergeRevisionResults(state: RevisionState, results: RevisionResult[], runDir: string): RevisionState {
  const templates = new Map(state.templates.categories.map(c => [c.category.id, c]));
  const records = { ...state.records };
  for (const result of results) {
    const base = templates.get(result.categoryId) ?? (result.proposed ? { category: result.proposed.category, shared: [], properties: [], notes: [] } : undefined);
    if (result.status === "accepted") {
      if (!base) throw new Error(`缺少修订基准：${result.categoryId}`);
      templates.set(result.categoryId, acceptedRevision(base, result));
    }
    records[result.categoryId] = { status: result.status, inputFingerprint: result.inputFingerprint, settledFingerprint: result.settledFingerprint, runDir, reviewedReference: result.reviewedReference ?? records[result.categoryId]?.reviewedReference, ...(result.error ? { error: result.error } : {}), ...(result.status === "accepted" ? {} : { feedback: revisionFeedback(result) }), ...(result.adjudication ? { adjudicationFingerprint: adjudicationFingerprint(result) } : {}) };
  }
  return { ...state, updatedAt: new Date().toISOString(), records, templates: { ...state.templates, generatedAt: new Date().toISOString(), categories: [...templates.values()].sort((a, b) => a.category.id.localeCompare(b.category.id)) } };
}

/** 同一工作区只允许一个写入进程；进程退出留下的锁可自动清理。并发模型请求仍在进程内运行。 */
export async function withRevisionLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const path = join(root, ".revision.lock");
  const token = randomUUID();
  for (;;) {
    try {
      const handle = await open(path, "wx");
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); }
      finally { await handle.close(); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let lock: { pid: number; token: string };
      try { lock = JSON.parse(await readFile(path, "utf8")); }
      catch { throw new Error(`另一个进程正在初始化治理锁：${path}`); }
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
      if (alive) throw new Error(`类目复审进程 ${lock.pid} 正在运行，请等它结束后再启动同一工作区`);
      if (JSON.parse(await readFile(path, "utf8")).token === lock.token) await unlink(path);
    }
  }
  try { return await work(); }
  finally {
    try { if (JSON.parse(await readFile(path, "utf8")).token === token) await unlink(path); } catch { /* 锁已被清理 */ }
  }
}
