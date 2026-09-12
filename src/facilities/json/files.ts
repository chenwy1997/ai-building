import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { jsonToObject, objectToJson } from "./json.ts";
import type {
  JsonToObjectOptions,
  ObjectToJsonOptions,
} from "./json.ts";

export async function readTextFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`文件不存在：${path}`);
  }
  return file.text();
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  return Bun.write(path, content);
}

export async function readJsonFile<T>(
  path: string,
  options: JsonToObjectOptions<T> = {},
): Promise<T> {
  return jsonToObject<T>(await readTextFile(path), options);
}

export async function writeJsonFile(
  path: string,
  value: unknown,
  options: ObjectToJsonOptions = { pretty: true, trailingNewline: true },
): Promise<number> {
  return writeTextFile(path, objectToJson(value, options));
}
