import { AiService } from "../../ai/service.ts";
import { loadAppConfig } from "../../config/env.ts";
import { PostgresAiCatalog } from "../../data/ai-catalog.ts";
import {
  DatabaseHub,
  PUBLIC_DATABASE_NAME,
  provisionDatabase,
  publicMigrations,
  scenarioDatabaseName,
} from "../../platform/database/index.ts";
import { parseFlags, asInt, boolFlag } from "./util.ts";
import { categoryGovernanceScenario } from "./index.ts";
import {
  importAndBuildContext,
  runGovernance,
} from "./runner.ts";
import { workspaceRoot } from "./storage.ts";

const DEFAULT_CONCURRENCY = 64;
const MAX_CONCURRENCY = 256;

const HELP = `
标准类目治理快捷入口

默认行为：读取已生成的 v1 上下文，对全部末级类目并发治理。

用法：
  bun run category-governance
  bun run category-governance --concurrency=128 --batch-size=12 --attempts=3
  bun run category-governance --category="办公用品"
  bun run category-governance --input=/path/to/category.raw.json

参数：
  --concurrency=64       并发请求数；传 max 使用 256，传 auto 使用 64，最高允许 256
  --batch-size=12        每次请求包含的末级类目数
  --attempts=1           每个批次最多尝试次数；失败会带着校验原因重试
  --category=...         可选：类目 ID、短 ID、名称或完整路径；不传则全量
  --category-id=...      --category 的别名
  --input=...            可选：先导入新类目文件，再开始治理
  --group-depth=2        分片深度；2 对应接口的一级子类
  --version=v1           当前数据库版本
  --provider=deepseek    AI 服务商
  --model=flash          AI 模型别名
  --dry-run              只生成请求文件，不调用模型
  --workspace=...        覆盖类目治理 workspace
`.trim();

function concurrencyValue(value: string | undefined): number {
  if (!value || value === "auto") return DEFAULT_CONCURRENCY;
  if (value === "max") return MAX_CONCURRENCY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`并发数不合法：${value}`);
  }
  return Math.min(MAX_CONCURRENCY, Math.floor(parsed));
}

async function ensureDatabases(config: ReturnType<typeof loadAppConfig>): Promise<void> {
  const publicResult = await provisionDatabase(
    config.postgresUrl,
    PUBLIC_DATABASE_NAME,
    publicMigrations,
  );
  const scenarioResult = await provisionDatabase(
    config.postgresUrl,
    scenarioDatabaseName(categoryGovernanceScenario.name),
    categoryGovernanceScenario.migrations,
  );
  if (publicResult.appliedMigrations.length > 0 || scenarioResult.appliedMigrations.length > 0) {
    console.log("数据库迁移已完成");
  }
}

export async function main(argv: string[] = Bun.argv.slice(2)): Promise<void> {
  const { positionals, flags } = parseFlags(argv);
  if (flags.help === "true" || flags.h === "true" || flags["?"] === "true" || positionals[0] === "help") {
    console.log(HELP);
    return;
  }
  if (positionals.length > 0) {
    throw new Error(`不支持位置参数：${positionals.join(" ")}；类目治理请使用 --category 或 --input`);
  }

  const config = loadAppConfig();
  await ensureDatabases(config);

  const version = flags.version ?? "v1";
  const groupDepth = asInt(flags["group-depth"], 2);
  const batchSize = asInt(flags["batch-size"], 12);
  const attempts = asInt(flags.attempts, 1);
  const concurrency = concurrencyValue(flags.concurrency ?? Bun.env.CATEGORY_GOVERNANCE_CONCURRENCY);
  const provider = flags.provider ?? "deepseek";
  const model = flags.model ?? "flash";
  const dryRun = boolFlag(flags["dry-run"]);
  const workspace = flags.workspace ?? workspaceRoot();
  const categorySelector = flags.category ?? flags["category-id"];

  const databases = new DatabaseHub(config.postgresUrl);
  try {
    const database = databases.scenarioDatabase(categoryGovernanceScenario.name);
    const ai = new AiService(
      new PostgresAiCatalog(databases.publicDatabase()),
      config.masterKey,
    );

    if (flags.input) {
      const imported = await importAndBuildContext({
        database,
        inputPath: flags.input,
        version,
        workspace,
        groupDepth,
      });
      console.log(`已导入 ${imported.document.nodes.length} 个类目，末级 ${imported.document.leafCount}`);
    }

    console.log(`开始治理：${categorySelector ? `类目 ${categorySelector}` : "全部末级类目"}，并发 ${concurrency}，批量 ${batchSize}，重复 ${attempts}`);
    const result = await runGovernance({
      database,
      ai,
      workspace,
      version,
      groupDepth,
      batchSize,
      concurrency,
      attempts,
      dryRun,
      provider,
      model,
      categorySelector,
      onProgress: (progress) => {
        if (progress.completed === progress.total || progress.completed % 10 === 0) {
          console.log(`进度 ${progress.completed}/${progress.total}，已生成 ${progress.success} 个类目结果，失败 ${progress.errors}`);
        }
      },
    });
    console.log(`治理完成：请求 ${result.requestCount}，成功类目 ${result.successCount}，失败请求 ${result.errorCount}`);
    console.log(`输出目录：${result.outputDir}`);
  } finally {
    await databases.closeAll();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
