import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadJson, saveJson, sha256, reproDir, type ProductInputs, type DetailsSnapshot, type DetailRecord } from "./io.ts";
import { parseFlags, asInt, boolFlag } from "../util.ts";

// Uses the existing company's read-only VOP goods client. Never writes back to JD.
export async function loadGoodsApi(project: string, direct: boolean) {
  for (const filename of [".env.local", ".env"]) {
    const contents = await readFile(join(project, filename), "utf8").catch(() => "");
    for (const line of contents.split(/\r?\n/u)) {
      const m = line.match(/^\s*(?:export\s+)?(JD_VOP_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
      if (!m || process.env[m[1]!] !== undefined) continue;
      let value = m[2]!;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[m[1]!] = value;
    }
  }
  if (direct) {
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
    process.env.NO_PROXY = "*"; process.env.no_proxy = "*";
  }
  if (!process.env.JD_VOP_APP_KEY || !process.env.JD_VOP_APP_SECRET) throw new Error("缺少 JD VOP 配置，未发送请求");
  return await import(join(project, "src/lib/jd-vop/goods/index.ts")) as {
    getSkuDetailInfo: (request: Record<string, unknown>) => Promise<Record<string, unknown> | Record<string, unknown>[]>;
    searchSku: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getCategoryInfoList: (request: { categoryId: number[] }) => Promise<Array<{ categoryId: number; categoryName: string; parentId?: number; categoryLevel?: number }>>;
  };
}

export async function importProducts(path?: string): Promise<ProductInputs> {
  const target = join(reproDir, "inputs.json");
  if (!path) return loadJson<ProductInputs>(target);
  const source = resolve(path), bytes = await readFile(source), hash = sha256(bytes);
  const existing = await loadJson<ProductInputs>(target).catch(() => undefined);
  if (existing) {
    if (existing.sourceHash !== hash) throw new Error("输入测试集已变化；请另建输出版本，不覆盖本版快照");
    return existing;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(source);
  const sheet = wb.getWorksheet("SKUs") ?? wb.worksheets[0]!;
  const headers = [1,2,3,4,5].map(i => sheet.getRow(1).getCell(i).text.trim());
  if (headers.join("|") !== "序号|SKU编号|商品标题|颜色尺寸|京东价") throw new Error("测试集列头变化，请核对导入格式");
  const products: ProductInputs["products"] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const sku = row.getCell(2).text.trim();
    if (!/^\d+$/u.test(sku)) throw new Error(`第 ${index} 行 SKU 无效`);
    products.push({ row: Number(row.getCell(1).value), sku, title: row.getCell(3).text.trim(), variant: row.getCell(4).text.trim(), price: typeof row.getCell(5).value === "number" ? row.getCell(5).value as number : null });
  });
  if (new Set(products.map(p => p.row)).size !== products.length) throw new Error("原始序号重复");
  const result = { source, sourceHash: hash, headers, products };
  await saveJson(target, result);
  return result;
}

export async function collect(argv: string[]) {
  const { flags } = parseFlags(argv);
  const inputs = await importProducts(flags.input);
  const path = join(reproDir, "jd-details.json.gz");
  const snapshot: DetailsSnapshot = await loadJson<DetailsSnapshot>(path).catch(() => ({ method: "jingdong.vop.goods.getSkuDetailInfo", queryExtSet: [1,2,3,5,6,9,10,11], items: {} }));
  const unique = [...new Set(inputs.products.map(p => p.sku))];
  const pending = unique.filter(sku => boolFlag(flags.force) || snapshot.items[sku]?.status !== "ok").slice(0, asInt(flags.limit, unique.length));
  if (!pending.length) { console.log(`已缓存 ${unique.length} 个 SKU，无需查询京东`); return; }
  const api = await loadGoodsApi(flags["jd-project"] ?? "/Users/sanheng/Project/sanheng/ai-core", boolFlag(flags.direct));
  const attempts = asInt(flags.attempts, 2), concurrency = Math.min(20, asInt(flags.concurrency, 8));
  let next = 0, completed = 0, requests = 0, writeQueue = Promise.resolve();
  const persist = () => writeQueue = writeQueue.then(() => saveJson(path, snapshot));
  console.log(`测试集 ${inputs.products.length} 行、${unique.length} 个 SKU；本次补取 ${pending.length}，并发 ${Math.min(concurrency, pending.length)}`);
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (next < pending.length) {
      const sku = pending[next++]!;
      let record: DetailRecord = { sku, fetchedAt: new Date().toISOString(), status: "error", attempts: 0 };
      for (let attempt = 1; attempt <= attempts; attempt++) {
        record.attempts = attempt; requests++;
        try {
          const raw = await api.getSkuDetailInfo({ skuId: sku, queryExtSet: snapshot.queryExtSet });
          const detail = Array.isArray(raw) ? raw.find(d => String(d.skuId) === sku) : raw;
          if (detail?.skuId && String(detail.skuId) !== sku) throw new Error("京东返回了不同 SKU，已拒绝混用");
          record = { ...record, status: detail && Object.keys(detail).length ? "ok" : "empty", ...(detail ? { detail } : {}) };
          break;
        } catch (e) {
          record.error = e instanceof Error ? e.message : String(e);
          if (/白名单|IP限制|IP.*允许|IP.*非法/iu.test(record.error)) break;
          if (attempt < attempts) await Bun.sleep(500 * attempt);
        }
      }
      snapshot.items[sku] = record; completed++;
      if (completed % 25 === 0 || completed === pending.length) { await persist(); console.log(`京东详情 ${completed}/${pending.length}，可用 ${Object.values(snapshot.items).filter(x => x.status === "ok").length}`); }
    }
  }));
  await persist();
  const errors = Object.values(snapshot.items).filter(x => x.status !== "ok");
  console.log(JSON.stringify({ skuCount: unique.length, cached: Object.values(snapshot.items).filter(x => x.status === "ok").length, requests, unavailable: errors.map(x => ({ sku: x.sku, status: x.status, error: x.error })) }));
}
if (import.meta.main) await collect(Bun.argv.slice(2));
