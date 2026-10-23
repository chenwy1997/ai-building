import { homedir } from "node:os";
import { join } from "node:path";
import { exists } from "./core.ts";
import { ROOT } from "./release.ts";

export async function validateBatchExport(layoutArgs: string[] = []) {
  const { parseLayoutArgs, loadReviewLayout, validateSheetTargets, sheetLayout } =
    await import("./scripts/review-workbook-layout.mjs");
  const options = parseLayoutArgs(layoutArgs), config = await loadReviewLayout(options);
  const { BATCH_REVIEW_SHEETS } = await import("./scripts/batch-review-layout.mjs");
  validateSheetTargets(config, options, BATCH_REVIEW_SHEETS.map((d) => d.name));
  for (const { name, headers } of BATCH_REVIEW_SHEETS) sheetLayout(config, options, name, headers);
}

export async function exportBatchReview(outDir: string, layoutArgs: string[] = []) {
  await validateBatchExport(layoutArgs);
  const node = process.env.PGV3_NODE_PATH ?? join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
  if (!await exists(node))
    throw Error("未找到审阅表导出运行时；设置PGV3_NODE_PATH到Codex附带Node。结果JSON已保存，补齐后运行batch-export，不需再次调用模型。");
  const processHandle = Bun.spawn([node, join(ROOT, "scripts/export-batch-review.mjs"), outDir, ...layoutArgs], {
    stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const [code, stdout, stderr] = await Promise.all([
    processHandle.exited, new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(),
  ]);
  if (code !== 0) throw Error("审阅表导出失败；模型结果已保存，可用batch-export重做：" + stderr.slice(-3000));
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}
