import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateExtractionKnowledge } from '../sku-extraction-knowledge';

const flags: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!name || !['--contract', '--policy', '--knowledge', '--out'].includes(name) || !process.argv[i + 1] || flags[name.slice(2)]) throw Error('--contract file --policy file [--knowledge file] --out directory');
  flags[name.slice(2)] = process.argv[i + 1]!;
}
if (!flags.contract || !flags.policy || !flags.out) throw Error('--contract --policy --out required');
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const sourcePath = path.resolve(flags.contract), policyPath = path.resolve(flags.policy);
const source = await fs.readFile(sourcePath), policyBytes = await fs.readFile(policyPath);
const contract = JSON.parse(source.toString()), policy = JSON.parse(policyBytes.toString());
if (contract.attributeContractVersion !== 1 || !Array.isArray(contract.proposals) || policy.version !== 2 || !policy.rulesByDefinitionId) throw Error('Invalid contract or value policy');
const knowledgePath = flags.knowledge ? path.resolve(flags.knowledge) : null;
const knowledgeBytes = knowledgePath ? await fs.readFile(knowledgePath) : null;
const knowledge = knowledgeBytes ? JSON.parse(knowledgeBytes.toString()) : null;
if (knowledge) validateExtractionKnowledge(knowledge, contract);
const changes: any[] = [];
for (const p of contract.proposals) {
  const patch = policy.rulesByDefinitionId[p.definitionId]; if (!patch) continue;
  if (typeof patch.shortRule !== 'string' || !patch.shortRule.trim() || !patch.valuePolicy) throw Error(`Invalid value policy for ${p.definitionId}`);
  const before = { shortRule: p.shortRule, rules: p.rules, attention: p.attention, valuePolicy: p.valuePolicy ?? null };
  if (p.previousFillRules === undefined) p.previousFillRules = structuredClone(before);
  p.shortRule = patch.shortRule; p.rules = [patch.shortRule]; p.valuePolicy = patch.valuePolicy;
  if (p.attention !== undefined) p.attention = patch.attention ?? patch.shortRule;
  if (p.typing?.text) p.typing.text.formatHint = patch.shortRule;
  changes.push({ categoryId: p.categoryId, key: p.key, definitionId: p.definitionId, before, after: patch });
}
for (const d of Array.isArray(contract.definitions) ? contract.definitions : []) {
  const patch = policy.rulesByDefinitionId[d.id ?? d.definitionId]; if (!patch) continue;
  if (d.previousFillRule === undefined) d.previousFillRule = { rule: d.rule, shortRule: d.shortRule, valuePolicy: d.valuePolicy ?? null };
  d.rule = patch.shortRule; d.shortRule = patch.shortRule; d.valuePolicy = patch.valuePolicy;
  if (d.typing?.text) d.typing.text.formatHint = patch.shortRule;
}
const enumChanges: any[] = [];
for (const ext of knowledge?.enumExtensions ?? []) {
  const d = contract.definitions?.find((x: any) => (x.id ?? x.definitionId) === ext.definitionId);
  if (!d || d.type !== 'option' || !Array.isArray(d.options)) throw Error(`Enum extension needs shared option definition ${ext.definitionId}`);
  const oldOptions = [...d.options];
  const options = [...oldOptions, ...ext.values.filter((v: string) => !oldOptions.includes(v))];
  if (d.previousOptions === undefined) d.previousOptions = [...oldOptions];
  d.options = options;
  const ref = { sourceId: 'sku-extraction-knowledge', locator: `${knowledgePath}#enumExtensions[definitionId=${ext.definitionId}]` };
  for (const p of contract.proposals.filter((x: any) => x.definitionId === ext.definitionId)) {
    if (p.type !== 'option' || !Array.isArray(p.enumValues) || !p.typing?.choice) throw Error(`Invalid option binding ${p.categoryId}/${p.key}`);
    const oldAllowed = [...(p.typing.choice.allowedValues ?? p.enumValues)];
    const included = ext.categoryIds.includes(p.categoryId);
    const allowed = included ? [...oldAllowed, ...ext.values.filter((v: string) => !oldAllowed.includes(v))] : oldAllowed;
    if (oldAllowed.some((v: string) => !oldOptions.includes(v))) throw Error(`Option binding does not match shared definition: ${p.categoryId}/${p.key}`);
    p.enumValues = [...options]; p.typing.choice.allowedValues = allowed;
    p.typing.choice.applicabilityReferences = [...(p.typing.choice.applicabilityReferences ?? p.typing.choice.boundaryReferences ?? []), ref];
    p.valueDomain = allowed.join('；');
    if (included) enumChanges.push({ categoryId: p.categoryId, key: p.key, definitionId: ext.definitionId, before: oldAllowed, after: allowed, reason: ext.reason, adoption: 'pending_human' });
    const binding = d.bindings?.find((b: any) => b.categoryId === p.categoryId && b.key === p.key);
    if (binding) {
      binding.allowedOptions = [...allowed];
      binding.allowedOptionsReferences = structuredClone(p.typing.choice.applicabilityReferences);
    }
  }
}
if (knowledge) contract.extractionKnowledge = { ...knowledge, sourcePath: knowledgePath, sourceSha256: sha(knowledgeBytes!) };
contract.previousFillPolicy = contract.fillPolicy ?? null;
contract.fillPolicy = { version: policy.version, sourcePath, sourceSha256: sha(source), policyPath, policySha256: sha(policyBytes),
  ...(knowledgePath ? { knowledgePath, knowledgeSha256: sha(knowledgeBytes!) } : {}), changes, enumChanges };
contract.previousProgramChecks = contract.programChecks ?? null;
contract.programChecks = null;
contract.checkScope = 'offline value-policy and scoped extraction knowledge; independent and human review required';
const out = path.resolve(flags.out), target = path.join(out, 'attribute-fill-contract.json'); await fs.mkdir(out, { recursive: true });
await fs.writeFile(target, JSON.stringify(contract, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ contract: target, sha256: sha(await fs.readFile(target)), updatedBindings: changes.length, enumExtensions: enumChanges.length, knowledgePacks: knowledge?.packs.length ?? 0, productionWrites: 0 }));
