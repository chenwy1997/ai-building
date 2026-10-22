import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash, save, exists, Blocked } from "./core.ts";

export const ROLL_CATEGORIES = [
  {
    id: "15216d47-17c6-4b18-9391-83097f6f7447",
    standardCategoryId: "9fda0128-630c-4756-b26f-248e8fdc3db5",
    name: "有芯小卷纸",
  },
  {
    id: "67adeef9-8c1f-47e2-ad72-462ad35a5a75",
    standardCategoryId: "511563d5-477d-4730-852e-58f9805dc522",
    name: "无芯小卷纸",
  },
] as const;
export const SCM_READ_ACTIONS = [
  "getProductListByStdCategoryIds",
  "getProductInfo",
] as const;
export type ReadAction = (typeof SCM_READ_ACTIONS)[number];
export type ReadTransport = (
  action: ReadAction,
  body: unknown,
) => Promise<unknown>;
const nativeUuid = (id: unknown) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export interface ReadCapture {
  format: 1;
  kind: "scm_readonly_capture";
  action: ReadAction;
  endpoint: string;
  request: unknown;
  capturedAt: string;
  response: unknown;
  responseHash: string;
}
function scrub(value: any): any {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|password|secret|authorization|api.?key/i.test(k)
          ? "[REDACTED]"
          : scrub(v),
      ]),
    );
  return value;
}
export function validateReadRequest(action: ReadAction, body: any) {
  if (!SCM_READ_ACTIONS.includes(action))
    throw new Blocked(
      "read_action",
      "only registered supply-chain reads are allowed",
    );
  if (action === "getProductListByStdCategoryIds") {
    if (
      !body ||
      Object.keys(body).sort().join() !== "page,pageSize,stdCategoryIds" ||
      !Array.isArray(body.stdCategoryIds) ||
      body.stdCategoryIds.length !== 1 ||
      !ROLL_CATEGORIES.some(
        (c) => c.standardCategoryId === body.stdCategoryIds[0],
      ) ||
      body.page !== 1 ||
      !Number.isInteger(body.pageSize) ||
      body.pageSize < 1 ||
      body.pageSize > 3
    )
      throw new Blocked(
        "pilot_scope",
        "pilot permits first page of at most three SKUs per fixed STANDARD category ID, never a mall/governance ID",
      );
  } else if (
    !body ||
    Object.keys(body).join() !== "skus" ||
    !Array.isArray(body.skus) ||
    !body.skus.length ||
    body.skus.length > 6 ||
    new Set(body.skus).size !== body.skus.length ||
    body.skus.some((id: unknown) => !nativeUuid(id))
  )
    throw new Blocked(
      "pilot_scope",
      "detail read needs at most six distinct selected native SKU IDs",
    );
}
export async function localReadKey(
  repoRoot = resolve(import.meta.dir, "../../.."),
) {
  if (process.env.SANHENG_API_KEY) return process.env.SANHENG_API_KEY;
  for (const path of [
    resolve(repoRoot, ".env"),
    "/Users/sanheng/Project/sanheng/ai-core/.env",
  ]) {
    const body = await readFile(path, "utf8").catch(() => "");
    const match = body.match(/^SANHENG_API_KEY\s*=\s*(.+)$/m);
    if (match) return match[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Blocked(
    "read_credentials",
    "missing local SANHENG_API_KEY; no credential was printed",
  );
}
export function nativeReadTransport(key: string): ReadTransport {
  return async (action, body) => {
    validateReadRequest(action, body);
    return new Promise((resolveResponse, reject) => {
      // Python stdlib HTTPS is used because Bun's node:https transport stalls on this host.
      // The credential travels through stdin only, never argv, logs, or capture files.
      const child = spawn(
        "python3",
        [resolve(import.meta.dir, "scm-readonly-transport.py")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Blocked(
            "read_timeout",
            "read exceeded 65 seconds; no automatic retry",
          ),
        );
      }, 65000);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8_000_000) {
          child.kill();
          reject(new Blocked("read_size", "read exceeded 8 MB"));
        } else chunks.push(chunk);
      });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(
          new Blocked("read_transport", "Python 3 read transport unavailable"),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return reject(
            new Blocked(
              "read_transport",
              "supply-chain read failed; no automatic retry or credential logging",
            ),
          );
        try {
          resolveResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Blocked("read_json", "read response was not valid JSON"));
        }
      });
      child.stdin.end(JSON.stringify({ action, body, key }));
    });
  };
}
export async function captureRollPilot(
  outDir: string,
  transport: ReadTransport,
  perCategory = 3,
) {
  if (!Number.isInteger(perCategory) || perCategory < 1 || perCategory > 3)
    throw new Blocked("pilot_scope", "per-category must be 1..3");
  if (await exists(resolve(outDir, "capture-manifest.json")))
    throw new Blocked(
      "capture_exists",
      "capture already fixed; choose a new output directory for a new read",
    );
  const captures: ReadCapture[] = [],
    selected = new Set<string>();
  async function capture(action: ReadAction, request: unknown) {
    validateReadRequest(action, request);
    const response = scrub(await transport(action, request));
    const c: ReadCapture = {
      format: 1,
      kind: "scm_readonly_capture",
      action,
      endpoint: `https://sc.sanheng.com/api/external/${action}`,
      request,
      capturedAt: new Date().toISOString(),
      response,
      responseHash: hash(response),
    };
    captures.push(c);
    return c;
  }
  try {
    for (const category of ROLL_CATEGORIES) {
      const c = await capture("getProductListByStdCategoryIds", {
        stdCategoryIds: [category.standardCategoryId],
        page: 1,
        pageSize: perCategory,
      });
      await save(resolve(outDir, "raw", category.id + ".json"), c);
      const response = c.response as any;
      if (!Array.isArray(response?.items) || !Number.isInteger(response.total))
        throw new Blocked(
          "read_contract",
          "native list read did not return items/total",
        );
      if (response.items.length > perCategory)
        throw new Blocked(
          "pilot_scope",
          "list response exceeded the requested sample cap",
        );
      for (const item of response.items) {
        if (!nativeUuid(item.id) || !nativeUuid(item.productInstanceId))
          throw new Blocked(
            "read_identity",
            "native SKU and product archive instance IDs required",
          );
        if (
          item.standardCategoryId !== category.standardCategoryId ||
          item.standardCategory?.id !== category.standardCategoryId ||
          item.standardCategory.name !== category.name
        )
          throw new Blocked(
            "read_category",
            "native response contains an out-of-scope or mismapped standard category",
          );
        if (selected.has(item.id))
          throw new Blocked(
            "read_duplicate",
            "native list returned a duplicate SKU",
          );
        selected.add(item.id);
      }
    }
    if (selected.size) {
      const detail = await capture("getProductInfo", { skus: [...selected] });
      if (
        !Array.isArray(detail.response) ||
        detail.response.length !== selected.size ||
        new Set(detail.response.map((p: any) => p.sku)).size !==
          selected.size ||
        detail.response.some((p: any) => !selected.has(p.sku))
      )
        throw new Blocked(
          "read_contract",
          "detail response must contain each requested SKU exactly once",
        );
      await save(resolve(outDir, "raw", "details.json"), detail);
    }
    const manifest = {
      format: 1,
      kind: "real_roll_pilot_input",
      scope: ROLL_CATEGORIES,
      perCategory,
      selectedIds: [...selected],
      selection:
        "first page ordered by native Product.createdAt desc; purposive development sample, not a random accuracy sample",
      captures: captures.map(({ response, ...c }) => c),
      productionWrites: 0,
      modelCalls: 0,
    };
    await save(resolve(outDir, "capture-manifest.json"), manifest);
    return manifest;
  } catch (error) {
    await save(resolve(outDir, "capture-failed.json"), {
      kind: "read_capture_incomplete",
      capturedAt: new Date().toISOString(),
      code: error instanceof Blocked ? error.code : "read_error",
      completedReads: captures.map(({ response, ...c }) => c),
      selectedIds: [...selected],
      productionWrites: 0,
      automaticRetries: 0,
    });
    throw error;
  }
}
