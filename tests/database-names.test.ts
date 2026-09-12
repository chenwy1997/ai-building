import { describe, expect, test } from "bun:test";
import {
  databaseUrl,
  scenarioDatabaseName,
} from "../src/platform/database/names.ts";

describe("数据库命名", () => {
  test("场景名映射到独立数据库", () => {
    expect(scenarioDatabaseName("product_match")).toBe(
      "ai-building-product_match",
    );
  });

  test("拒绝非 snake_case 场景名", () => {
    expect(() => scenarioDatabaseName("Product-Match")).toThrow();
  });

  test("只替换连接 URL 的数据库名", () => {
    const url = databaseUrl(
      "postgresql://user:pass@localhost:5432/postgres?sslmode=disable",
      "ai-building-public",
    );
    expect(url).toContain("/ai-building-public?sslmode=disable");
  });
});
