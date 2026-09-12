import { describe, expect, test } from "bun:test";
import {
  jsonLinesToObjects,
  jsonToObject,
  objectToJson,
  objectsToJsonLines,
  safeJsonToObject,
} from "../src/facilities/json/index.ts";

describe("JSON 公共设施", () => {
  test("JSON 和对象可以双向转换", () => {
    const value = jsonToObject<{ name: string; count: number }>(
      '{"name":"任务","count":2}',
    );
    expect(value).toEqual({ name: "任务", count: 2 });
    expect(objectToJson(value, { pretty: true })).toContain('"name": "任务"');
  });

  test("安全解析不会抛出异常", () => {
    const result = safeJsonToObject("{");
    expect(result.ok).toBe(false);
  });

  test("JSONL 和对象数组可以双向转换", () => {
    const jsonl = objectsToJsonLines([{ id: 1 }, { id: 2 }]);
    expect(jsonLinesToObjects(jsonl)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
