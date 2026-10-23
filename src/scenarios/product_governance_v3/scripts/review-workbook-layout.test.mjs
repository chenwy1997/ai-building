import { expect, test } from "bun:test";
import {
  parseLayoutArgs,
  loadReviewLayout,
  sheetLayout,
  validateLayout,
  validateSheetTargets,
} from "./review-workbook-layout.mjs";

const plain = () => parseLayoutArgs([]);
test("the approved first sheet profile is the shared default", async () => {
  const config = await loadReviewLayout(plain());
  expect(config).toMatchObject({
    bodyFontPt: 10,
    bodyRowHeightPx: 22,
    rowHeightMode: "fixed",
    longTextMode: "note",
  });
  for (const name of ["属性方案", "补充与排除", "定义与设置"])
    expect(
      sheetLayout(config, plain(), name, ["属性", "有芯", "无芯"])
        .freezeLeftColumns,
    ).toBe(1);
});
test("CLI can remove freezing or freeze a different prefix by its header", async () => {
  const config = await loadReviewLayout(plain()),
    headers = ["属性", "有芯", "无芯"];
  expect(
    sheetLayout(
      config,
      parseLayoutArgs(["--freeze-left", "0"]),
      "属性方案",
      headers,
    ).freezeLeftColumns,
  ).toBe(0);
  const options = parseLayoutArgs([
    "--freeze-left",
    "1",
    "--freeze-through",
    "属性方案=无芯",
  ]);
  expect(
    sheetLayout(config, options, "属性方案", headers).freezeLeftColumns,
  ).toBe(3);
  expect(sheetLayout(config, options, "其他", headers).freezeLeftColumns).toBe(
    1,
  );
});
test("explicit sheet settings override defaults, CLI settings override the file", async () => {
  const base = await loadReviewLayout(plain());
  const config = validateLayout({
    ...base,
    sheets: { 属性方案: { freezeThrough: "有芯", rowHeightMode: "wrap" } },
  });
  expect(
    sheetLayout(config, plain(), "属性方案", ["属性", "有芯"]),
  ).toMatchObject({ freezeLeftColumns: 2, rowHeightMode: "wrap" });
  expect(
    sheetLayout(config, parseLayoutArgs(["--freeze-left", "0"]), "属性方案", [
      "属性",
      "有芯",
    ]).freezeLeftColumns,
  ).toBe(0);
});
test("bad flags and missing, duplicate or excessive freeze targets fail clearly", async () => {
  const config = await loadReviewLayout(plain());
  expect(() => parseLayoutArgs(["--freeze-left", "-1"])).toThrow();
  expect(() => parseLayoutArgs(["--freeze-through", "属性"])).toThrow();
  expect(() => parseLayoutArgs(["--freez-left", "1"])).toThrow();
  expect(() =>
    sheetLayout(config, parseLayoutArgs(["--freeze-left", "5"]), "属性方案", [
      "属性",
    ]),
  ).toThrow();
  expect(() =>
    sheetLayout(
      config,
      parseLayoutArgs(["--freeze-through", "属性方案=无芯"]),
      "属性方案",
      ["属性"],
    ),
  ).toThrow();
  expect(() =>
    sheetLayout(
      config,
      parseLayoutArgs(["--freeze-through", "属性方案=属性"]),
      "属性方案",
      ["属性", "属性"],
    ),
  ).toThrow();
  expect(() => validateLayout({ ...config, freezeLeftColumn: 1 })).toThrow();
  expect(() =>
    validateSheetTargets(
      config,
      parseLayoutArgs(["--freeze-through", "拼错页名=属性"]),
      ["属性方案"],
    ),
  ).toThrow("unknown layout sheet");
});
