import { test, expect } from "bun:test";
import { collectOpinions } from "./export-roll-review-json.mjs";
function sample() {
  const row = Array(23).fill(null);
  Object.assign(row, {
    0: "合成样例",
    2: "层数",
    3: 3,
    4: "“3层”",
    5: "待核实候选",
    14: "test-candidate",
    15: "test-hash",
    16: "test-bundle",
    17: "test-sku",
    18: "test-source",
  });
  const headers = Array.from({ length: 23 }, (_, i) => "c" + i);
  const index = {
    workbookHeaders: headers,
    candidates: [
      {
        candidateId: row[14],
        candidateHash: row[15],
        bundleHash: row[16],
        productId: row[17],
        skuLabel: "合成样例",
        bundlePath: "test-only",
        immutableCells: row.map((v, i) => (i >= 6 && i <= 12 ? null : v)),
      },
    ],
  };
  return { row, headers, index };
}
test("empty review workbook exports no implicit human decisions", () => {
  const { row, headers, index } = sample();
  expect(collectOpinions(index, headers, [row], null, null).files).toEqual([]);
});
test("explicit review exports the same candidate/hash and four semantic checks", () => {
  const { row, headers, index } = sample();
  row[6] = "采用候选";
  row[7] = "合成核实测试，非真实人工意见";
  row.splice(8, 4, ...["是", "是", "是", "是"]);
  const output = collectOpinions(
    index,
    headers,
    [row],
    "synthetic-test-reviewer",
    "2026-10-22T12:00:00Z",
  );
  expect(output.files[0].review.decisions[0]).toMatchObject({
    candidateId: "test-candidate",
    candidateHash: "test-hash",
    decision: "accept",
    scopeConfirmed: true,
  });
});
test("stable candidate ID survives row reordering", () => {
  const { row, headers, index } = sample(),
    blank = Array(23).fill(null);
  blank[0] = "未知样例";
  blank[2] = "无来源";
  expect(
    collectOpinions(index, headers, [blank, row], null, null).files,
  ).toEqual([]);
});
test("edited candidate content, duplicate/missing rows and changed headers are refused", () => {
  const { row, headers, index } = sample();
  const changed = [...row];
  changed[3] = 4;
  expect(() => collectOpinions(index, headers, [changed], null, null)).toThrow(
    "content changed",
  );
  expect(() => collectOpinions(index, headers, [row, row], null, null)).toThrow(
    "duplicate",
  );
  expect(() => collectOpinions(index, headers, [], null, null)).toThrow(
    "missing",
  );
  expect(() => collectOpinions(index, ["wrong"], [row], null, null)).toThrow(
    "headers",
  );
});
test("adoption without semantic checks or identified human is refused", () => {
  const { row, headers, index } = sample();
  row[6] = "采用候选";
  row[7] = "test";
  expect(() => collectOpinions(index, headers, [row], null, null)).toThrow(
    "reviewer",
  );
  expect(() =>
    collectOpinions(index, headers, [row], "test", "2026-10-22T12:00:00Z"),
  ).toThrow("four");
});
test("unknown rows can record observations but cannot become facts", () => {
  const { row, headers, index } = sample(),
    unknown = Array(23).fill(null);
  unknown[0] = "未知样例";
  unknown[2] = "芯结构";
  unknown[7] = "待补来源";
  expect(
    collectOpinions(index, headers, [row, unknown], null, null).observations,
  ).toHaveLength(1);
  unknown[6] = "采用候选";
  expect(() =>
    collectOpinions(
      index,
      headers,
      [row, unknown],
      "test",
      "2026-10-22T12:00:00Z",
    ),
  ).toThrow("unknown values");
});
