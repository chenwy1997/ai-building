import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import type { Dictionary } from '../../contracts.ts';
import { guidance } from '../guidance.ts';
import { collectBranch, shortlist } from './build.ts';
import type { BranchSpec } from './spec.ts';
import { branches } from './spec.ts';
import { deriveSpec } from './autospec.ts';

/**
 * Local check that a derived spec is safe to use in place of a hand-written one, run before
 * spending anything. The operative test is not whether derivation reproduces my facet list —
 * for 塑料润滑脂 it is deliberately tighter, having dropped O-ring properties grease cannot
 * use — but whether the shortlist still contains every property the branch actually mounted.
 * Miss one and the model would report a gap for something the dictionary already has.
 */

const library = resolve(import.meta.dir, '../../../workspace/dictionary/v1');
const canonical = resolve(library, 'canonical-v1');

export async function main(argv = process.argv.slice(2)) {
  const dictionary = (await Bun.file(resolve(canonical, 'property-dictionary.json')).json()) as Dictionary;
  const mapping = (await Bun.file(resolve(canonical, 'name-mapping.json')).json()) as {
    rows: Array<{ name: string; action: string; propertyId: string | null }>;
  };
  const mapped = new Set(mapping.rows.filter((row) => row.action !== 'defer').map((row) => row.name));
  const targets = new Map<string, string[]>();
  for (const row of mapping.rows) {
    if (!row.propertyId) continue;
    const seen = targets.get(row.name) ?? [];
    if (!seen.includes(row.propertyId)) targets.set(row.name, [...seen, row.propertyId]);
  }

  const db = new Database(resolve(library, 'attribute-library-v1.sqlite'), { readonly: true });
  const paths = new Map<string, string[]>();
  for (const row of db.query(`SELECT DISTINCT path FROM candidates_v1 WHERE namespace = 'sanheng'`).all() as Array<{ path: string }>) {
    const path = JSON.parse(row.path) as string[];
    if (path.length >= 3) paths.set(path.slice(1, -1).join('/'), path.slice(1, -1));
  }

  const wanted = argv.length ? argv : [...Object.keys(branches)];
  console.log('分支                          末级  推出标签  候选集  与手写对比');
  let regressions = 0;
  for (const name of wanted) {
    const authored = branches[name];
    const branchPath = authored?.branchPath ?? [...paths.values()].find((path) => path.at(-1) === name);
    if (!branchPath) {
      console.log(`${name.padEnd(28)}  类目树里找不到这个三级分支`);
      continue;
    }
    const provisional: BranchSpec = { branchPath, facets: [], requiredDimensions: [], premise: '' };
    const evidence = collectBranch(db, provisional, mapped);
    const derived = deriveSpec(evidence, { targets }, guidance);
    const derivedIds = new Set(shortlist(dictionary, guidance, derived).map((candidate) => candidate.propertyId));

    let verdict = '无手写可比';
    const mountedPath = resolve(library, 'branch-v1', name, 'mounted.json');
    if (await Bun.file(mountedPath).exists()) {
      const mounted = (await Bun.file(mountedPath).json()) as { resolved: Array<{ selections: Array<{ propertyId: string }> }> };
      const actuallyUsed = new Set(mounted.resolved.flatMap((leaf) => leaf.selections.map((selection) => selection.propertyId)));
      const missing = [...actuallyUsed].filter((propertyId) => !derivedIds.has(propertyId));
      if (missing.length) regressions += 1;
      verdict = missing.length
        ? `推不到实际挂载的 ${missing.length} 条: ${missing.join(', ')}`
        : `实际挂载的 ${actuallyUsed.size} 条全部召回 ✓`;
    }
    console.log(
      `${branchPath.join('/').padEnd(28)}${String(evidence.leaves.length).padStart(4)}${String(derived.facets.length).padStart(9)}${String(derivedIds.size).padStart(8)}  ${verdict}`,
    );
    console.log(`    标签 ${derived.facets.join('+')}    必填维度 ${derived.requiredDimensions.join('+')}`);
  }
  db.close();
  if (regressions) throw new Error(`${regressions} 个分支的推导候选集召回不到它实际挂上的属性，不能用推导替代手写`);
}

if (import.meta.main) await main();
