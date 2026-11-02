import path from 'node:path';
import { fileHash, writeJson } from '../../core';
import { catalog, packageFor } from './type-contract';

// Reusable offline integration input. Not an author/reviewer opinion or a business dictionary.
export async function typeSelection(dir: string, groups: any[][], baselineProposals: any[] = [], changes: any[] = []) {
  const ref = async (name: string, data: any) => {
    const file = path.join(dir, name + '.json'); await writeJson(file, data);
    return { path: name + '.json', sha256: await fileHash(file) };
  };
  const baseline = packageFor(baselineProposals);
  const categoryIds = [...new Set([...groups.flat(), ...baselineProposals].map(p => p.categoryId))];
  const selected = groups.flat().map(p => p.categoryId);
  const preserve = categoryIds.filter(id => !selected.includes(id));
  const scope = { categories: categoryIds.map(id => ({ id, name: '离线验收', path: '技术验收>' + id })) };
  const groupRefs = [];
  for (const [i, ps] of groups.entries()) {
    const pkg = packageFor(ps);
    groupRefs.push({ categoryIds: pkg.draft.categories.map(c => c.categoryId),
      draft: await ref(`group-${i}-draft`, pkg.draft), pool: await ref(`group-${i}-pool`, pkg.pool), matrix: await ref(`group-${i}-matrix`, pkg.matrix) });
  }
  const config = {
    scope: await ref('scope', scope), baseline: await ref('baseline', baseline.draft),
    baselineSources: await ref('baseline-sources', baseline.pool),
    dictionaries: await ref('dictionaries', catalog()), groups: groupRefs, preserveCategoryIds: preserve,
    preservedMatrix: await ref('preserved-matrix', { families: [], standaloneCategories: preserve.map(id => ({ categoryId: id, reason: '技术验收旧稿保留' })) }),
    review: await ref('review', { reviewedCategories: [], authoringModel: null, methods: ['offline_program_acceptance'],
      findings: [{ finding: '全部为技术构造数据；未做业务、模型或人工审校', status: '业务未审' }], remainingLimitations: ['不能用于生产或业务属性采用'] }),
    humanRecognition: '技术夹具模拟旧稿保留路径，无真实人审意见',
    proposedBaselineChanges: changes,
    policyRevision: { summary: '仅离线技术构造数据；测试类型能力，不是清洁用品业务修改建议。' },
  };
  const manifest = path.join(dir, 'selection.json'); await writeJson(manifest, config);
  return { manifest, config, ref };
}
