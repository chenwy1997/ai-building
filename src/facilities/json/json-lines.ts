import { objectToJson } from "./json.ts";
import type { ValueValidator } from "./types.ts";

export function jsonLinesToObjects<T = unknown>(
  input: string,
  validateItem?: ValueValidator<T>,
): T[] {
  const lines = input.split(/\r?\n/u);
  const result: T[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    try {
      const value: unknown = JSON.parse(line);
      result.push(validateItem ? validateItem(value) : (value as T));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyntaxError(`JSONL 第 ${index + 1} 行解析失败：${message}`);
    }
  }

  return result;
}

export function objectsToJsonLines(values: Iterable<unknown>): string {
  return Array.from(values, (value) => objectToJson(value)).join("\n") + "\n";
}
