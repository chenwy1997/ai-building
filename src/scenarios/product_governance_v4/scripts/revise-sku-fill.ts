import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assembleSkuFillRevision, assembleIncrementalSkuFillRevision, RevisionError, serializeRevisionJson } from '../sku-fill-revision';
import type { IncrementalRevisionReferences, RevisionReference, RevisionReferences } from '../sku-fill-revision';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function main(): Promise<void> {
  const args = process.argv.slice(2), flags: Record<string, string> = {};
  if (args.length !== 4) throw Error('Usage: --manifest file --out revision-directory');
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!name || !['--manifest', '--out'].includes(name) || !args[i + 1] || flags[name]) throw Error('Usage: --manifest file --out revision-directory');
    flags[name] = args[i + 1]!;
  }
  if (!flags['--manifest'] || !flags['--out']) throw Error('Usage: --manifest file --out revision-directory');
  const manifestPath = await fs.realpath(path.resolve(flags['--manifest']));
  const manifestDir = path.dirname(manifestPath), out = path.resolve(flags['--out']);
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (![1, 2].includes(manifest.version)) throw Error('Revision manifest version must be 1 or 2');
  const snapshots = new Map<string, string>([[manifestPath, hash(manifestBytes)]]);
  async function pinned(ref: any, label: string, base: string): Promise<{ ref: RevisionReference; text: string; data: any }> {
    if (!ref || typeof ref.path !== 'string' || !ref.path.trim() || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '')) throw Error(`${label} needs path and SHA-256`);
    const file = await fs.realpath(path.resolve(base, ref.path)), bytes = await fs.readFile(file);
    if (hash(bytes) !== ref.sha256) throw Error(`Stale input: ${label} (${file})`);
    const previous = snapshots.get(file);
    if (previous && previous !== ref.sha256) throw Error(`Conflicting hashes for ${file}`);
    snapshots.set(file, ref.sha256);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let data: any;
    try { data = JSON.parse(text); } catch { throw Error(`Invalid JSON: ${label} (${file})`); }
    return { ref: { path: file, sha256: ref.sha256 }, text, data };
  }
  const names = manifest.version === 1 ? ['baseline', 'contract', 'tree', 'currentAuthor', 'routing', 'targetAuthor'] : ['baseline', 'contract'];
  const loaded: Record<string, Awaited<ReturnType<typeof pinned>>> = {};
  for (const name of names) loaded[name] = await pinned(manifest[name], name, manifestDir);
  const patches: Awaited<ReturnType<typeof pinned>>[] = [];
  if (manifest.version === 2) {
    if (!Array.isArray(manifest.patches)) throw Error('patches must be an array');
    for (const [i, ref] of manifest.patches.entries()) patches.push(await pinned(ref, `patches[${i}]`, manifestDir));
    for (const name of ['supplementalSources', 'routingPatch', 'tree']) {
      if (manifest[name] !== undefined) loaded[name] = await pinned(manifest[name], name, manifestDir);
    }
  }
  if (!!manifest.review !== !!manifest.deltas) throw Error('review and deltas must be supplied together');
  if (manifest.review) {
    loaded.review = await pinned(manifest.review, 'review', manifestDir);
    loaded.deltas = await pinned(manifest.deltas, 'deltas', manifestDir);
  }
  const baseline = loaded.baseline!, routing = loaded.routing;
  const baselineContract = manifest.version === 1 ? await pinned({ path: baseline.data.contractPath, sha256: baseline.data.contractSha256 }, 'baseline contract', path.dirname(baseline.ref.path)) : undefined;
  if (routing) {
    await pinned(routing.data.treeSource, 'routing treeSource', path.dirname(routing.ref.path));
    await pinned(routing.data.contractSource, 'routing contractSource', path.dirname(routing.ref.path));
  }
  const reviewDir = path.join(out, 'review');
  const namesOut = ['author-rows.json', 'review-bindings.json', 'program-checks.json', 'sku-fill-results.json'];
  // Never overwrite an input, an earlier result, or a user-edited artifact.
  await fs.mkdir(reviewDir, { recursive: true });
  const actualReviewDir = await fs.realpath(reviewDir);
  for (const name of namesOut) {
    const file = path.join(actualReviewDir, name);
    if (snapshots.has(file)) throw Error(`Output would overwrite input: ${file}`);
    try { await fs.lstat(file); throw Error(`Output already exists: ${file}; choose a new --out directory`); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
  try {
    let assembled: ReturnType<typeof assembleSkuFillRevision>;
    if (manifest.version === 1) {
      const references: RevisionReferences = { baseline: baseline.ref, contract: loaded.contract!.ref, tree: loaded.tree!.ref,
        currentAuthor: loaded.currentAuthor!.ref, routing: routing!.ref, targetAuthor: loaded.targetAuthor!.ref,
        ...(loaded.review ? { review: loaded.review.ref, deltas: loaded.deltas!.ref } : {}) };
      assembled = assembleSkuFillRevision({ references, baseline: baseline.data, baselineContractText: baselineContract!.text,
        contractText: loaded.contract!.text, tree: loaded.tree!.data, currentAuthor: loaded.currentAuthor!.data, routing: routing!.data,
        targetAuthor: loaded.targetAuthor!.data, review: loaded.review?.data, deltas: loaded.deltas?.data });
    } else {
      const references: IncrementalRevisionReferences = { baseline: baseline.ref, contract: loaded.contract!.ref, patches: patches.map(p => p.ref),
        ...(loaded.supplementalSources ? { supplementalSources: loaded.supplementalSources.ref } : {}),
        ...(loaded.routingPatch ? { routingPatch: loaded.routingPatch.ref } : {}), ...(loaded.tree ? { tree: loaded.tree.ref } : {}),
        ...(loaded.review ? { review: loaded.review.ref, deltas: loaded.deltas!.ref } : {}) };
      assembled = assembleIncrementalSkuFillRevision({ references, baseline: baseline.data, contractText: loaded.contract!.text,
        patches: patches.map(p => p.data), ...(loaded.supplementalSources ? { supplementalSources: loaded.supplementalSources.data } : {}),
        ...(loaded.routingPatch ? { routingPatch: loaded.routingPatch.data } : {}), ...(loaded.tree ? { tree: loaded.tree.data } : {}),
        ...(loaded.review ? { review: loaded.review.data, deltas: loaded.deltas!.data } : {}) });
    }
    for (const [file, expected] of snapshots) if (hash(await fs.readFile(file)) !== expected) throw Error(`Input changed during assembly: ${file}`);
    assembled.result.revision.manifest = { path: manifestPath, sha256: snapshots.get(manifestPath) };
    if (baselineContract && routing) {
      assembled.result.revision.baselineContract = baselineContract.ref;
      assembled.result.revision.routingTreeSource = routing.data.treeSource;
      assembled.result.revision.routingContractSource = routing.data.contractSource;
    }
    await fs.writeFile(path.join(actualReviewDir, 'author-rows.json'), serializeRevisionJson(assembled.authorRows), { flag: 'wx' });
    await fs.writeFile(path.join(actualReviewDir, 'review-bindings.json'), serializeRevisionJson(assembled.reviewBindings), { flag: 'wx' });
    await fs.writeFile(path.join(actualReviewDir, 'program-checks.json'), serializeRevisionJson(assembled.checks), { flag: 'wx' });
    await fs.writeFile(path.join(actualReviewDir, 'sku-fill-results.json'), serializeRevisionJson(assembled.result), { flag: 'wx' });
    console.log(JSON.stringify({ out: actualReviewDir, reviewState: assembled.result.reviewState, skus: assembled.result.summary.skus,
      attributes: assembled.result.summary.attributes, routing: assembled.checks.routing, productionWrites: 0, deepseekRequests: 0 }));
  } catch (error) {
    const diagnostic = { version: 1, structureValid: false, stage: error instanceof RevisionError ? error.stage : 'assembly',
      error: error instanceof Error ? error.message : String(error), report: error instanceof RevisionError ? error.report : undefined };
    try { await fs.writeFile(path.join(actualReviewDir, 'program-checks.json'), serializeRevisionJson(diagnostic), { flag: 'wx' }); } catch { /* Preserve existing diagnostics. */ }
    throw error;
  }
}

if (import.meta.main) await main();
