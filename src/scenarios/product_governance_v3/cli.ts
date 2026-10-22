import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { read, save, STAGES, type Stage, type Task } from "./core.ts";
import { freezeRelease, loadRelease } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { CategoryIndex } from "./catalog.ts";
import { assemble } from "./context.ts";
import { offlineAcceptance } from "./acceptance.ts";
import {
  captureRollPilot,
  nativeReadTransport,
  localReadKey,
} from "./scm-readonly.ts";
import { prepareRollPilot, replayRollExtraction } from "./roll-pilot.ts";
import { inventorySource } from "./scm-field-inventory.ts";
import {
  importFactReview,
  type PreparationBundle,
  type FactReview,
} from "./fact-preparation.ts";

const USAGE = `商品治理v3：离线准备/验收及固定小样本只读采集；不提供付费跑批或生产写入。
  bun src/scenarios/product_governance_v3/cli.ts offline-acceptance --out outputs/product-governance-v3/offline
  bun src/scenarios/product_governance_v3/cli.ts plan --snapshot /abs/snapshot.json --category-id ID --stage family-modeling --run-id BATCH --out /abs/plan.json
  bun src/scenarios/product_governance_v3/cli.ts tree-search --tree scratch-category-baseline-20261010/mapped-tree.json --query 小卷纸 --limit 10
  bun src/scenarios/product_governance_v3/cli.ts freeze-release
  bun src/scenarios/product_governance_v3/cli.ts capture-roll-pilot --out /new/capture-dir
  bun src/scenarios/product_governance_v3/cli.ts inventory-scm-fields --source-root /local/scm-repository --out /abs/inventory.json
  bun src/scenarios/product_governance_v3/cli.ts prepare-roll-pilot --capture /capture-dir --tree /mapped-tree.json --out /prepared-dir
  bun src/scenarios/product_governance_v3/cli.ts replay-roll-pilot --snapshot /prepared-dir/snapshot.raw.json --proposals /recorded-agent-proposals.json --out /replay-dir
  bun src/scenarios/product_governance_v3/cli.ts import-fact-review --snapshot /prepared-dir/snapshot.raw.json --bundle /bundle.json --review /human.review.json --out /new/reviewed-snapshot-dir
  bun test ./src/scenarios/product_governance_v3
sku-filling/fact-extraction另需--product-id；SKU审核需--product-id，审核另需--candidate文件。分页可传--cursor，树检索可传--scope-id。
capture-roll-pilot是唯一联网读取入口：仅两类各最多3件，无自动重试；仅此命令读取本地供应链密钥。replay使用录制候选，不发送DeepSeek请求。
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
      capture: { type: "string" },
      proposals: { type: "string" },
      bundle: { type: "string" },
      review: { type: "string" },
      "source-root": { type: "string" },
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
    case "inventory-scm-fields": {
      const inventory = await inventorySource(resolve(required("source-root")));
      await save(resolve(required("out")), inventory);
      return {
        fields: inventory.fields.length,
        unmapped: inventory.unknown.length,
        status: inventory.status,
        productionWrites: 0,
      };
    }
    case "capture-roll-pilot":
      return captureRollPilot(
        resolve(required("out")),
        nativeReadTransport(await localReadKey()),
      );
    case "prepare-roll-pilot":
      return prepareRollPilot(
        resolve(required("capture")),
        resolve(required("out")),
        resolve(required("tree")),
      );
    case "replay-roll-pilot":
      return replayRollExtraction(
        resolve(required("snapshot")),
        resolve(required("proposals")),
        resolve(required("out")),
      );
    case "import-fact-review": {
      const output = await importFactReview(
        new DataSnapshot(await read(required("snapshot"))),
        await read<PreparationBundle>(required("bundle")),
        await read<FactReview>(required("review")),
      );
      const dir = resolve(required("out"));
      await save(resolve(dir, "snapshot.reviewed.json"), output.snapshot.data);
      await save(resolve(dir, "review-receipt.json"), output.receipt);
      return {
        acceptedFacts: output.receipt.acceptedFacts,
        remainingCandidates: output.receipt.remainingCandidates,
        productionWrites: 0,
      };
    }
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
