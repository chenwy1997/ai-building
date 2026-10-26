import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash, read } from "./core.ts";
import { loadRelease, type Release } from "./release.ts";
import { parseResultJson, ResultJsonSyntaxError } from "./result-json.ts";
import { fixtureSnapshot, fixtureTask, fixtureOutput, finalMessage, functionCall, scriptedFetch } from "./fixtures.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { BATCH_CORRECTIONS, runStage } from "./runner.ts";
import recordings from "./fixtures/pilot-core-json-failures-20261026.json";

let temp: string, release: Release, counter = 0;
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-json-feedback-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
function failure(raw: string) {
  try { parseResultJson(raw); } catch (error) {
    expect(error).toBeInstanceOf(ResultJsonSyntaxError);
    return error as ResultJsonSyntaxError;
  }
  throw Error("malformed JSON was accepted");
}
const rawMessage = (raw: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: raw }] });

for (const [index, record] of recordings.records.entries()) test(`recorded seed turn ${record.turn}: exact raw response locates the unclosed quantity decision`, () => {
  expect(hash(record.rawText)).toBe(record.rawTextSha256);
  const error = failure(record.rawText), d = error.diagnostic, offset = index === 0 ? 8261 : 8263;
  expect(error.code).toBe("final_json");
  expect(error.message).not.toContain("expected strict JSON or exactly one JSON code fence");
  expect(error.envelope).toBe(index === 2 ? "single_json_fence" : "none");
  expect(d.location).toEqual({ offset, line: 1, column: offset + 1 });
  expect(d.rawLocation).toEqual({ offset: offset + (index === 2 ? 8 : 0), line: index === 2 ? 2 : 1, column: offset + 1 });
  expect(d.path).toBe("$.decisions[3]");
  expect(d.objectId).toBe("facial.contents_per_package");
  expect(d.lastCompletedPath).toBe("$.decisions[3].quantity");
  expect(d.expected).toBe("quoted property name after object comma");
  expect(d.found).toBe("{");
  expect(d.excerpt.text[d.excerpt.caretOffset]).toBe("{");
  expect(d.excerpt.text).toContain('"objectId":"facial.scent"');
  expect(d.excerpt.text.length).toBeLessThanOrEqual(240);
});

test("fenced, CRLF, indented and Unicode output reports both JSON and original-text positions", () => {
  const json = '{\r\n "说明":"中文😀",\r\n "items":[1 2]\r\n}', pos = json.indexOf("2]");
  for (const [prefix, suffix, envelope] of [
    ["\uFEFF \n ", "\n ", "none"],
    ["候选文本\r\n```json\r\n", "\r\n```\r\n待人审。", "single_json_fence"],
    ["```\n", "\n```", "single_json_fence"],
  ] as const) {
    const raw = prefix + json + suffix, error = failure(raw), d = error.diagnostic;
    expect(error.envelope).toBe(envelope!);
    expect(d.path).toBe("$.items");
    expect(d.location.offset).toBe(pos);
    expect(d.location.line).toBe(3);
    expect(d.rawLocation.offset).toBe(prefix!.length + pos);
    expect(raw[d.rawLocation.offset]).toBe("2");
  }
  const emoji = '{"name":"😀", "bad": }', d = failure(emoji).diagnostic;
  expect(d.location.column).toBe(emoji.indexOf("}") + 1); // UTF-16, not code points/bytes.
});

for (const item of [
  { raw: '{"x" 1}', marker: "1", path: "$.x", expected: '":"' },
  { raw: '{"x":1 "y":2}', marker: '"y"', path: "$", expected: '"," or "}"' },
  { raw: '{"x":[1,]}', marker: "]", path: "$.x[1]", expected: "JSON value" },
  { raw: '{"x":1,}', marker: "}", path: "$", expected: "quoted property name after object comma" },
  { raw: '{"x":"bad\\q"}', marker: "q", path: "$.x", expected: "valid JSON string escape" },
  { raw: '{"x":"bad\\u00x0"}', marker: "00x0", path: "$.x", expected: "four hexadecimal" },
  { raw: '{"x":"a\nb"}', marker: "\n", path: "$.x", expected: "escaped control" },
  { raw: '{"x": /* note */ 1}', marker: "/", path: "$.x", expected: "JSON value" },
  { raw: '{"x":NaN}', marker: "N", path: "$.x", expected: "JSON value" },
  { raw: '{"x":01}', marker: "1", path: "$", expected: '"," or "}"' },
  { raw: '{"x":1e+}', marker: "e", path: "$", expected: '"," or "}"' },
  { raw: '{"x":true} false', marker: "false", path: "$", expected: "end of JSON" },
  { raw: '{"a.b":[1, x]}', marker: "x", path: '$["a.b"][1]', expected: "JSON value" },
]) test("syntax diagnostics keep invalid input rejected: " + JSON.stringify(item.raw), () => {
  const d = failure(item.raw).diagnostic;
  expect(d.path).toBe(item.path);
  expect(d.location.offset).toBe(item.raw.indexOf(item.marker));
  expect(d.expected).toContain(item.expected);
});

test("EOF, empty and deep invalid responses fail closed with bounded diagnostics", () => {
  for (const raw of ["", '{"x":', '{"x":[1', '{"x":"unterminated', '{"x":"escape\\']) {
    const d = failure(raw).diagnostic;
    expect(d.location.offset).toBe(raw.length);
    expect(d.found).toBe("end of input");
  }
  const deep = "[".repeat(2000) + "wrong";
  expect(failure(deep).diagnostic.reason).toBe("diagnostic_limit");
  const hugeKey = '{"' + "很长".repeat(10000) + '":bad}';
  const d = failure(hugeKey).diagnostic;
  expect(d.pathTruncated).toBe(true);
  expect(JSON.stringify(d).length).toBeLessThan(3000);
});

test("valid escapes, nesting and presentation wrappers retain every business value", () => {
  const value = { text: '中文😀 { [ \\ " ```json', empty: "", negative: -1.25e-4,
    flags: [true, false, null, { x: [] }], "a.b": "\r\n\t\b\f" };
  const json = JSON.stringify(value);
  for (const raw of [json, "\uFEFF " + json]) {
    expect(parseResultJson(raw).result).toEqual(value);
    expect(parseResultJson(raw).businessValuesModified).toBe(false);
  }
  expect(parseResultJson('前言\n```json\n{"x":false}\n```\n后言').result).toEqual({ x: false });
  for (const raw of ['前文 {}\n```json\n{}\n```', '```json\n{}\n```\n```json\n{}\n```'])
    expect(() => parseResultJson(raw)).toThrow();
  // A fence marker in JSON data must not hide the actual grammar error.
  expect(failure('{"text":"```", "x": }').diagnostic.path).toBe("$.x");
});

function setup(script: Parameters<typeof scriptedFetch>[0]) {
  const dir = join(temp, String(counter++)), mock = scriptedFetch(script), budget = new Budget(dir, 0, "offline-zero"),
    client = new ResponsesClient({ mode: "offline", transportId: "json-feedback-regression", fetch: mock.fetch }, dir, budget);
  return { dir, mock, budget, client, options: { release, snapshot: new DataSnapshot(fixtureSnapshot()),
    task: fixtureTask("family-modeling"), client, outDir: dir, corrections: BATCH_CORRECTIONS,
    model: { model: "deepseek-flash" as const, reasoningEffort: "low" as const } } };
}
function assertWire(requests: any[]) {
  for (const [i, body] of requests.entries()) {
    expect(body.reasoning.effort).toBe("low");
    expect(body.text.format.strict).toBe(true);
    if (i) {
      const previous = requests[i - 1];
      expect(body.instructions).toBe(previous.instructions);
      expect(body.tools).toEqual(previous.tools);
      expect(body.text).toEqual(previous.text);
      expect(canonical(body.input.slice(0, previous.input.length))).toBe(canonical(previous.input));
    }
  }
}

test("recorded failures feed exact diagnostics through real request loop, stop after two corrections and replay without HTTP", async () => {
  const call = functionCall("categories_get", { id: "fixture-root" }, "category-before-final");
  const { options, mock, dir, budget } = setup([
    [call], ...recordings.records.map(record => [rawMessage(record.rawText)]),
  ]);
  await expect(runStage(options)).rejects.toThrow("$.decisions[3]");
  expect(mock.requests).toHaveLength(4); assertWire(mock.requests);
  expect(mock.requests[1].input.at(-2).call_id).toBe(call.call_id);
  expect(JSON.parse(mock.requests[1].input.at(-2).output).node.id).toBe("fixture-root");
  for (const [i, body] of mock.requests.slice(2).entries()) {
    const feedback = JSON.parse(body.input.at(-2).content);
    expect(feedback.kind).toBe("host_contract_feedback");
    expect(feedback.errors[0].diagnostic).toEqual(failure(recordings.records[i]!.rawText).diagnostic);
    expect(feedback.instruction).toContain("不要仅加代码围栏");
    expect(feedback.instruction).toContain("所有业务规则保持不变");
  }
  const files = await readdir(join(dir, "runs"));
  expect(files.some(f => f.endsWith(".result.json"))).toBe(false);
  const blocked = await read(join(dir, "runs", files.find(f => f.endsWith(".blocked.json"))!));
  expect(blocked.feedback).toHaveLength(2); expect(blocked.toolCount).toBe(1);
  expect(blocked.diagnostic.rawLocation.offset).toBe(8271);
  expect(blocked.code).toBe("final_json"); expect(blocked.adoption).toBe("not_eligible");
  for (const [i, record] of recordings.records.entries()) {
    const saved = await read(join(dir, "requests", blocked.requestKeys[i + 1] + ".response.json"));
    expect(saved.response.output[0].content[0].text).toBe(record.rawText);
  }
  const before = await read(join(dir, "budget.json")), replay = new ResponsesClient({ mode: "offline",
    transportId: options.client.transportId, fetch: async () => { throw Error("must replay recorded responses"); } }, dir, budget);
  await expect(runStage({ ...options, client: replay })).rejects.toThrow("$.decisions[3]");
  expect(replay.calls).toBe(0); expect(replay.cacheHits).toBe(4);
  expect(await read(join(dir, "budget.json"))).toEqual(before);
});

test("corrected JSON still faces business checks; only the subsequent valid model proposal passes", async () => {
  // Constructed business responses test the checker boundary, not DeepSeek accuracy.
  const badBusiness = fixtureOutput("family-modeling"); badBusiness.attributes[1].numberConfig.precision = 5;
  const { options, mock } = setup([
    [rawMessage(recordings.records[0]!.rawText)],
    [finalMessage(badBusiness)],
    [finalMessage(fixtureOutput("family-modeling"))],
  ]);
  const artifact = await runStage(options);
  expect(mock.requests).toHaveLength(3); assertWire(mock.requests);
  expect(artifact.feedback.map(f => f.code)).toEqual(["final_json", "program_checks"]);
  expect(JSON.parse(mock.requests[2].input.at(-2).content).errors.some((e: any) => e.ruleId === "R03")).toBe(true);
  expect(artifact.checks.errors).toEqual([]);
  expect(artifact.businessRepairs).toBe(0); expect(artifact.adoption).toBe("pending_human");
});
