import { withFixtureDecisions } from "./fixtures.ts";
import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import { DataSnapshot } from "./snapshot.ts";
import { loadRelease, type Release } from "./release.ts";
import { type ExtensionCandidate, type Stage, type Snapshot, jsonClone } from "./core.ts";
import { attribute, binding, fixtureSnapshot, fixtureTask, fixtureOutput,
  prepareFixtureFacts, scriptedFetch, functionCall, finalMessage } from "./fixtures.ts";
import { rollDefinitions, rollExtensionCandidates, rollBindings, PAPER_KNOWLEDGE, FIELD_KNOWLEDGE } from "./roll-pilot.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { runStage } from "./runner.ts";

let release: Release, temp: string, serial = 0;
beforeAll(async () => {
  release = await loadRelease();
  temp = await mkdtemp(join(tmpdir(), "pgv3-admission-"));
});
afterAll(async () => { await rm(temp, {recursive: true, force: true}); });
const extension = (): ExtensionCandidate => ({
  id: "synthetic-extension", name: "合成扩展参数", conceptKey: "synthetic.parameter",
  scope: "synthetic-object", potentialUse: "某个尚未确认的器具适配判断",
  deferReason: "未确认本类业务是否需要该适配维度",
  activationCriteria: "业务确认适配场景及维护收益，再修订共享基线",
  references: [],
});
function extended() {
  const data = fixtureSnapshot(), output = fixtureOutput("family-modeling");
  data.families[0]!.extensionCandidates = [extension()];
  output.extensionCandidates = [extension()];
  return {data, output};
}
async function plan(stage: Stage, data: Snapshot = fixtureSnapshot()) {
  return assemble(release, new DataSnapshot(data), fixtureTask(stage));
}
async function report(stage: Stage, result: unknown, data: Snapshot) {
  return checkResult(fixtureTask(stage), stage === "family-modeling" ? withFixtureDecisions(result as any) : result, (await plan(stage, data)).tools);
}

test("extensions travel through actual context and function return without becoming attributes or native projections", async () => {
  const {data, output} = extended(), task = fixtureTask("family-modeling"),
    p = await plan("family-modeling", data);
  expect((p.input.sharedContext as any).family[0].items[0].extensionCandidates).toEqual([extension()]);
  const pool = await p.tools.call("search_attribute_pool", {query: extension().name, categoryId: task.categoryId, limit: 20, cursor: null});
  expect(pool.items).toEqual([]);
  expect((await plan("fact-extraction", data)).input.contractAttributes!.some(a => a.id === extension().id)).toBe(false);
  const mock = scriptedFetch([
    [functionCall("get_family_context", {categoryId: task.categoryId, limit: 10, cursor: null})],
    request => {
      const returned = request.input.find((i: any) => i.type === "function_call_output");
      expect(JSON.parse(returned.output).items[0].extensionCandidates).toEqual([extension()]);
      return [finalMessage(withFixtureDecisions(output))];
    },
  ]);
  const dir = join(temp, String(serial++)),
    client = new ResponsesClient({mode: "offline", transportId: "admission-test", fetch: mock.fetch}, dir, new Budget(dir, 0, "offline-zero")),
    artifact = await runStage({release, snapshot: new DataSnapshot(data), task, client, outDir: dir});
  expect(artifact.checks.errors).toEqual([]);
  expect(artifact.checks.executedChecks).toContain("extension-separation");
  expect(artifact.nativeProjections).toHaveLength(data.families[0]!.attributes.length);
  expect(JSON.stringify(artifact.nativeProjections)).not.toContain(extension().id);
  expect(artifact.productionWrites).toBe(0);
  expect(mock.requests).toHaveLength(2);
});

test("a frozen extension cannot be promoted in a leaf, including new IDs and optional bindings with reasons", async () => {
  for (const alias of [{}, {id: "alias-id"}, {id: "alias-id", conceptKey: "alias-concept"}]) {
    const {data, output} = extended(), c = {...extension(), ...alias};
    output.attributes.push(attribute({id: c.id, name: c.name, conceptKey: c.conceptKey, scope: c.scope, fieldType: "text", definition: "合成候选试图进入合同"}));
    output.bindings.push(binding(c.id, {categoryId: output.categoryId, requiredness: "optional", differenceReason: "仍不能绕过共享修订"}));
    const r = await report("family-modeling", output, data);
    expect(r.errors.some(e => e.ruleId === "R07" && e.message.includes("frozen extension"))).toBe(true);
  }
});

test("a new family may defer every candidate without inventing a governed attribute to satisfy the schema", async () => {
  const data = fixtureSnapshot(), output = fixtureOutput("family-modeling");
  data.families = [];
  output.baselineVersion = null;
  output.attributes = [];
  output.bindings = [];
  output.extensionCandidates = [extension()];
  output.unresolved = [];
  expect((await report("family-modeling", output, data)).errors).toEqual([]);
  output.extensionCandidates = [];
  expect((await report("family-modeling", output, data)).status).toBe("program_blocked");
  output.unresolved = ["合成对象的业务用途待确认，暂不建立治理属性"];
  expect((await report("family-modeling", output, data)).errors).toEqual([]);
});

test("extensions require reasons and activation criteria, carry no native configuration and preserve frozen disposition", async () => {
  for (const mutate of [
    (o: any) => {o.extensionCandidates[0].activationCriteria = " ";},
    (o: any) => {o.extensionCandidates[0].fieldType = "boolean";},
    (o: any) => {o.extensionCandidates[0].binding = binding(extension().id);},
    (o: any) => {o.extensionCandidates = [];},
  ]) {
    const {data, output} = extended(); mutate(output);
    expect((await report("family-modeling", output, data)).status).toBe("program_blocked");
  }
  const {data} = extended();
  data.families[0]!.extensionCandidates!.push(jsonClone(extension()));
  expect(() => new DataSnapshot(data)).toThrow();
});

test("known base-field ownership also excludes a deferred extension, without a blanket name blacklist", async () => {
  const {data, output} = extended();
  output.extensionCandidates.push({...extension(), id: "synthetic-brand-extension", name: "品牌", conceptKey: "common.brand"});
  const r = await report("family-modeling", output, data);
  expect(r.errors.some(e => e.ruleId === "R01" && e.message.includes("brandId"))).toBe(true);
});

test("a snapshot cannot bind the same parameter as both extension and governed definition", () => {
  const {data} = extended(), c = extension(), a = attribute({id: c.id, name: c.name, conceptKey: c.conceptKey, scope: c.scope, fieldType: "text"});
  data.families[0]!.attributes.push(a);
  data.families[0]!.bindings.push(binding(a.id));
  expect(() => new DataSnapshot(data)).toThrow("extension candidate overlaps");
});

test("a deferred dimension does not blacklist a distinct measurement scope with an established use", async () => {
  const {data, output} = extended(), c = {...extension(), name: "设备内径", conceptKey: "synthetic.diameter", scope: "inner-bore"},
    a = attribute({id: "synthetic-outer-diameter", name: "设备外径", conceptKey: c.conceptKey,
      scope: "outer-housing", fieldType: "number", unit: "mm", definition: "构造设备外壳直径，供已明确的安装空间适配"});
  data.families[0]!.extensionCandidates = [c];
  data.families[0]!.attributes.push(a);
  data.families[0]!.bindings.push(binding(a.id));
  output.extensionCandidates = [c];
  output.attributes.push(a);
  output.bindings.push(binding(a.id, {categoryId: output.categoryId, baselineAttributeId: a.id}));
  expect((await report("family-modeling", output, data)).errors).toEqual([]);
});

test("SKU filling and extraction refuse an extension even when a source is available", async () => {
  const {data} = extended(), fill = fixtureOutput("sku-filling"), extraction = fixtureOutput("fact-extraction");
  fill.values.push({attributeId: extension().id, status: "unknown", value: null, evidence: [], derivation: null, reason: "不能把扩展候选当缺值"});
  expect((await report("sku-filling", fill, data)).errors.some(e => e.message.includes("not in fixed contract"))).toBe(true);
  extraction.candidates[0].attributeId = extension().id;
  expect((await report("fact-extraction", extraction, data)).errors.some(e => e.message.includes("outside fixed contract"))).toBe(true);
});

async function rollData() {
  const data = fixtureSnapshot(), attrs = await rollDefinitions(), extensions = await rollExtensionCandidates();
  data.attributes = attrs;
  data.families[0]!.attributes = attrs;
  data.families[0]!.bindings = rollBindings(attrs);
  data.families[0]!.extensionCandidates = extensions;
  data.knowledgeIds = [PAPER_KNOWLEDGE, FIELD_KNOWLEDGE];
  data.knowledgeRequirements = data.knowledgeRequirements.map(r => ({...r, knowledgeIds: [PAPER_KNOWLEDGE, FIELD_KNOWLEDGE]}));
  data.sources[0]!.text = "明确说明：280格/卷；有香味";
  data.sources[0]!.facts = [];
  prepareFixtureFacts(data);
  return data;
}
test("roll contract uses concise names with exact registered references and keeps six extensions separate", async () => {
  const data = await rollData(), attrs = data.families[0]!.attributes, extensions = data.families[0]!.extensionCandidates!;
  expect(attrs.map(a => a.name)).toEqual(["是否无芯", "层数", "单卷重量", "原料", "纸张尺寸", "每卷数量", "香型"]);
  expect(extensions.map(a => a.name)).toEqual(["是否印花", "是否压花", "卷外径", "卷宽", "纸芯内径", "单卷长度"]);
  const p = await plan("family-modeling", data), output = fixtureOutput("family-modeling");
  output.attributes = attrs;
  output.extensionCandidates = extensions;
  output.bindings = rollBindings(attrs).map(b => ({...b, categoryId: output.categoryId, baselineAttributeId: b.attributeId}));
  expect(checkResult(fixtureTask("family-modeling"), withFixtureDecisions(output), p.tools).errors).toEqual([]);
  for (const a of [...attrs, ...extensions])
    for (const ref of a.references) expect(p.tools.referenceError(ref)).toBeNull();
  expect(attrs.find(a => a.id === "roll.declared_mass")!.scope).toBe("single-roll-declared-mass");
  expect(attrs.find(a => a.id === "roll.fragrance")!.fieldType).toBe("text");
});

test("raw count units and coarse fragrance survive extraction, but unsupported rewrites are rejected", async () => {
  const data = await rollData(), p = await plan("fact-extraction", data), task = fixtureTask("fact-extraction"), s = data.sources[0]!;
  const candidate = (id: string, quote: string) => ({id, attributeId: id, sourceId: s.id, sourceVersion: s.version,
    start: s.text.indexOf(quote), end: s.text.indexOf(quote) + quote.length, quote, value: quote, normalization: "identity", rationale: "构造原词定位"});
  const result = {categoryId: task.categoryId, productId: task.productId, candidates: [candidate("roll.perforation", "280格/卷"), candidate("roll.fragrance", "有香味")], unresolved: ["计数等价和具体香型尚未核实"]};
  expect(checkResult(task, result, p.tools).errors).toEqual([]);
  for (const value of ["280张/卷", "1120格/卷"]) {
    const bad = jsonClone(result); bad.candidates[0]!.value = value;
    expect(checkResult(task, bad, p.tools).status).toBe("program_blocked");
  }
  for (const value of ["柠檬香", "有香（未注明香型）", true]) {
    const bad: any = jsonClone(result); bad.candidates[1].value = value;
    expect(checkResult(task, bad, p.tools).status).toBe("program_blocked");
  }
});
