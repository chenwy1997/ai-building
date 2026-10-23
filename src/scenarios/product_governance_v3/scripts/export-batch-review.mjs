import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { parseLayoutArgs, loadReviewLayout, applyReviewLayout, validateSheetTargets } from "./review-workbook-layout.mjs";
import { BATCH_REVIEW_SHEETS } from "./batch-review-layout.mjs";
import { projectConfigurationReview } from "./configuration-review.mjs";

// Use the bundled artifact runtime; do not install packages or change dependency directories.
const modules = process.env.PGV3_NODE_MODULES ?? join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { createRequire } = await import("node:module");
const requireBundled = createRequire(join(modules, "__pgv3_resolver__.cjs"));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(requireBundled.resolve("@oai/artifact-tool")).href);
const options = parseLayoutArgs(process.argv.slice(2));
if (options.positionals.length !== 1 || options.restyle) throw Error("expected one batch output directory");
const dir = resolve(options.positionals[0]), config = await loadReviewLayout(options);
const body = await fs.readFile(join(dir, "batch.review.json"), "utf8"), source = JSON.parse(body);
if (source.format !== 1 || source.adoption !== "pending_human" || source.productionWrites !== 0 ||
    source.issues.length !== source.categoryCount) throw Error("invalid/incomplete batch review input");
const data = projectConfigurationReview(source),
  ruleSha256 = createHash("sha256").update(await fs.readFile(new URL("configuration-review.mjs", import.meta.url))).digest("hex");
const definitions = BATCH_REVIEW_SHEETS.map((d) => ({ ...d, rows: data[d.key] }));
validateSheetTargets(config, options, definitions.map((d) => d.name));
const revision = createHash("sha256").update(body + ruleSha256 + JSON.stringify(config) + JSON.stringify(BATCH_REVIEW_SHEETS) + JSON.stringify(options.freezeThrough) + options.freezeLeft).digest("hex").slice(0, 12);
const outDir = join(dir, "review"), target = join(outDir, data.root.name.replace(/[\\/:*?"<>|]/g, "_") + "_类目属性方案_" + revision + ".xlsx");
try {
  await fs.access(target);
  console.log(JSON.stringify({ xlsx: target, preservedExisting: true, message: "已有同版审阅表，保留人工意见，不覆盖" }));
  process.exit(0);
} catch (e) { if (e.code !== "ENOENT") throw e; }
await fs.mkdir(outDir, { recursive: true });
const wb = Workbook.create(), layouts = [];
const safeValue = (v) => typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : v;
for (const d of definitions) {
  const sheet = wb.worksheets.add(d.name), count = d.headers.length;
  const rows = d.rows.length ? d.rows : [Array.from({ length: count }, (_, i) => i === 0 ? "本批无可纳入记录，见进度与问题" : null)];
  sheet.getRange("A2").values = [[data.root.name + "：" + d.name + (data.configurationAudit.historical ? "（历史提案专项复审）" : data.mode === "offline" ? "（模拟验收）" : "")]];
  sheet.getRange("A3").values = [[d.note]];
  sheet.getRange("A4").values = [[data.configurationAudit.historical
    ? "仅离线核对已有提案的配置说明，未重新认定整份合同通过。发现冲突" + data.configurationAudit.conflictCount + "项；原始配置、响应及人工意见文件保留。"
    : data.recovery?.kind === "offline_recheck"
    ? "已保存响应的离线复核，本次新增模型请求0。未通过类目及空方案见进度与问题。"
    : data.recovery?.kind === "targeted_model_correction"
      ? "仅纠正指定失败类目及必要同族基线，合并已通过结果。其余缺口见进度与问题。"
      : "程序检查通过仍待人工采用；专业缺口见进度与问题。长文保留原单元格及全文备注。"]];
  sheet.getRange("A5").values = [["批次 " + data.batchId.slice(0, 12) + "；类目 " + data.categoryCount + "；所有治理属性按SKU；没有线上写入。"]];
  sheet.getRangeByIndexes(5, 0, 1, count).values = [d.headers];
  sheet.getRangeByIndexes(6, 0, rows.length, count).values = rows.map((r) => r.map(safeValue));
  d.widths.forEach((w, c) => { sheet.getRangeByIndexes(0, c, rows.length + 6, 1).format.columnWidthPx = w; });
  const end = String.fromCharCode(64 + count);
  const table = sheet.tables.add(`A6:${end}${rows.length + 6}`, true, "BatchReview" + definitions.indexOf(d));
  table.showFilterButton = true;
  table.showBandedRows = true;
  for (const c of d.editable) sheet.getRangeByIndexes(6, c, rows.length, 1).format.fill = config.editableFill;
  if (d.decision !== null && d.rows.length)
    sheet.getRangeByIndexes(6, d.decision, rows.length, 1).dataValidation = { rule: { type: "list", values: ["同意", "需修改", "暂缓", "建议删除"] } };
  layouts.push(await applyReviewLayout(wb, sheet, d.widths, config, options));
}
wb.recalculate();
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!", options: { useRegex: true, maxResults: 20 }, maxChars: 1500 });
await fs.writeFile(join(outDir, "verification-" + revision + ".json"), JSON.stringify({ revision, layouts, errors: errors.ndjson, batchId: data.batchId }, null, 2));
await fs.writeFile(join(outDir, "configuration-audit-" + revision + ".json"), JSON.stringify({
  ...data.configurationAudit, sourcePath: join(dir, "batch.review.json"),
  sourceSha256: createHash("sha256").update(body).digest("hex"), ruleSha256,
}, null, 2));
for (const { name, preview } of definitions) {
  const picture = await wb.render({ sheetName: name, range: preview, scale: 1, format: "png" });
  await fs.writeFile(join(outDir, name + "-" + revision + ".png"), new Uint8Array(await picture.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(target);
console.log(JSON.stringify({ xlsx: target, revision, layouts, attributeRows: data.attributes.length, extensionRows: data.extensions.length, categories: data.categoryCount,
  explanationConflicts: data.configurationAudit.conflictCount, historicalConfigurationAudit: data.configurationAudit.historical, newModelRequests: 0 }));
