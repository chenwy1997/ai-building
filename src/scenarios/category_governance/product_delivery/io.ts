import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
export const outputDir = resolve(fileURLToPath(new URL(".",import.meta.url)), "../workspace/output/v1/product-delivery-v1");
export const reproDir = resolve(outputDir, ".repro");
export const sha256 = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
export async function saveJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(data);
  await writeFile(`${path}.tmp`, path.endsWith(".gz") ? gzipSync(json) : json);
  await rename(`${path}.tmp`, path);
}
export async function loadJson<T>(path: string): Promise<T> {
  const bytes = await readFile(path);
  return JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8")) as T;
}
export interface ProductInput { row: number; sku: string; title: string; variant: string; price: number | null }
export interface ProductInputs { source: string; sourceHash: string; headers: string[]; products: ProductInput[] }
export interface DetailRecord { sku: string; fetchedAt: string; status: "ok" | "empty" | "error"; detail?: Record<string, unknown>; error?: string; attempts: number }
export interface DetailsSnapshot { method: string; queryExtSet: number[]; items: Record<string, DetailRecord> }
