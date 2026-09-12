export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ValueValidator<T> = (value: unknown) => T;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };
