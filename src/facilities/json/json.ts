import type { JsonValue, ParseResult, ValueValidator } from "./types.ts";

export interface JsonToObjectOptions<T> {
  reviver?: (this: unknown, key: string, value: unknown) => unknown;
  validate?: ValueValidator<T>;
}

export interface ObjectToJsonOptions {
  pretty?: boolean | number;
  replacer?: (this: unknown, key: string, value: unknown) => unknown;
  trailingNewline?: boolean;
}

/**
 * 把 JSON 字符串转换为对象。泛型只提供调用端类型提示；需要运行时校验时传入 validate。
 */
export function jsonToObject<T = JsonValue>(
  json: string,
  options: JsonToObjectOptions<T> = {},
): T {
  const value: unknown = JSON.parse(json, options.reviver);
  return options.validate ? options.validate(value) : (value as T);
}

export function safeJsonToObject<T = JsonValue>(
  json: string,
  options: JsonToObjectOptions<T> = {},
): ParseResult<T> {
  try {
    return { ok: true, value: jsonToObject(json, options) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function objectToJson(
  value: unknown,
  options: ObjectToJsonOptions = {},
): string {
  const indentation =
    typeof options.pretty === "number" ? options.pretty : options.pretty ? 2 : 0;
  const json = JSON.stringify(value, options.replacer, indentation);

  if (json === undefined) {
    throw new TypeError("该值无法序列化为 JSON");
  }

  return options.trailingNewline ? `${json}\n` : json;
}

export function jsonToObjects<T extends object = Record<string, unknown>>(
  json: string,
  validateItem?: ValueValidator<T>,
): T[] {
  const value = jsonToObject<unknown>(json);
  if (!Array.isArray(value)) {
    throw new TypeError("JSON 顶层必须是数组");
  }

  return validateItem ? value.map(validateItem) : (value as T[]);
}
