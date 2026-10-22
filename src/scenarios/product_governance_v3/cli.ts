import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { read, save, STAGES, type Stage, type Task } from "./core.ts";
import { freezeRelease, loadRelease } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { CategoryIndex } from "./catalog.ts";
import { assemble } from "./context.ts";
import { offlineAcceptance } from "./acceptance.ts";

const USAGE = `商品治理v3：当前仅离线入口，不提供付费跑批或生产写入。
  bun src/scenarios/product_governance_v3/cli.ts offline-acceptance --out outputs/product-governance-v3/offline
  bun src/scenarios/product_governance_v3/cli.ts plan --snapshot /abs/snapshot.json --category-id ID --stage family-modeling --run-id BATCH --out /abs/plan.json
  bun src/scenarios/product_governance_v3/cli.ts tree-search --tree scratch-category-baseline-20261010/mapped-tree.json --query 小卷纸 --limit 10
  bun src/scenarios/product_governance_v3/cli.ts freeze-release
  bun test ./src/scenarios/product_governance_v3
sku-filling/review-assistance另需--product-id；审核另需--candidate文件。分页可传--cursor，树检索可传--scope-id。
freeze-release仅更新本地材料/代码指纹，不能替代规范内容的人类评审。`;
export async function main(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      out: { type: "string" },
      snapshot: { type: "string" },
      "category-id": { type: "string" },
      stage: { type: "string" },
      "run-id": { type: "string" },
      "product-id": { type: "string" },
      candidate: { type: "string" },
      tree: { type: "string" },
      query: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
      "scope-id": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const required = (key: keyof typeof values) => {
    const v = values[key];
    if (typeof v !== "string" || !v) throw Error("--" + key + " required");
    return v;
  };
  if (values.help || !positionals.length) return { help: USAGE };
  if (positionals.length !== 1) throw Error("one command required");
  switch (positionals[0]) {
    case "freeze-release":
      return freezeRelease();
    case "offline-acceptance":
      return offlineAcceptance(resolve(required("out")));
    case "plan": {
      const stage = required("stage") as Stage;
      if (!STAGES.includes(stage)) throw Error("unknown stage");
      const task: Task = {
        runId: required("run-id"),
        stage,
        categoryId: required("category-id"),
        productId: values["product-id"] ?? null,
        question: "离线上下文预检",
        candidate: values.candidate
          ? await read(resolve(values.candidate))
          : null,
      };
      const release = await loadRelease(),
        snapshot = new DataSnapshot(await read(resolve(required("snapshot")))),
        plan = await assemble(release, snapshot, task);
      const path = resolve(required("out"));
      await save(path, {
        manifest: plan.manifest,
        instructions: plan.instructions,
        input: plan.input,
        tools: plan.tools.definitions,
        outputSchema: plan.schema,
      });
      return {
        mode: "offline-plan",
        path,
        releaseId: release.id,
        snapshotVersion: snapshot.version,
        networkCalls: 0,
      };
    }
    case "tree-search": {
      const tree = new CategoryIndex(await read(resolve(required("tree")))),
        query = required("query"),
        scopeId = values["scope-id"] ?? null;
      return tree.page(
        tree.search(query, scopeId),
        { query, scopeId },
        Number(values.limit ?? "20"),
        values.cursor ?? null,
      );
    }
    default:
      throw Error(
        "unknown/offline-only command: " + positionals[0] + "\n" + USAGE,
      );
  }
}
if (import.meta.main)
  main(Bun.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(String(error));
      process.exitCode = 1;
    });
