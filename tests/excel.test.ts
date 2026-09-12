import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  excelToJson,
  excelToObjects,
  jsonToExcel,
  objectsToExcel,
} from "../src/facilities/excel/index.ts";

const tempDirectory = await mkdtemp(join(tmpdir(), "ai-building-test-"));

afterAll(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("Excel 公共设施", () => {
  test("对象数组可以写入并读回 Excel", async () => {
    const path = join(tempDirectory, "roundtrip.xlsx");
    await objectsToExcel(
      [
        { id: 1, name: "运营", metadata: { source: "test" } },
        { id: 2, name: "AI", metadata: null },
      ],
      path,
    );

    const rows = await excelToObjects(path);
    expect(rows).toEqual([
      { id: 1, name: "运营", metadata: '{"source":"test"}' },
      { id: 2, name: "AI", metadata: null },
    ]);
  });

  test("JSON 和 Excel 可以双向转换", async () => {
    const path = join(tempDirectory, "json.xlsx");
    await jsonToExcel('[{"name":"A"},{"name":"B"}]', path);
    const json = await excelToJson(path);
    expect(JSON.parse(json)).toEqual([{ name: "A" }, { name: "B" }]);
  });
});
