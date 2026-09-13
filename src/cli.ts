import { extname } from "node:path";
import { AiService } from "./ai/service.ts";
import { loadAppConfig } from "./config/env.ts";
import { PostgresAiCatalog } from "./data/ai-catalog.ts";
import {
  excelToJson,
  jsonToExcel,
  jsonToObject,
  objectToJson,
  readTextFile,
  writeTextFile,
} from "./facilities/index.ts";
import {
  DatabaseHub,
  PUBLIC_DATABASE_NAME,
  provisionDatabase,
  publicMigrations,
  scenarioDatabaseName,
} from "./platform/database/index.ts";
import { SecretBox } from "./platform/security/secret-box.ts";
import { getScenario, listScenarios } from "./scenarios/index.ts";

const HELP = `
ai-building - 公司内部运营 AI 命令行项目

命令：
  help
  db:name <场景名>                       查看场景对应数据库名
  db:init public                         创建/迁移公共库
  db:init <场景名>                       创建/迁移已注册场景库
  db:init all                            初始化公共库和全部已注册场景库
  db:ping <public|场景名>                检查数据库连接
  scenario:list                          列出业务场景
  scenario:run <场景名> <命令> [...参数] 运行场景命令
  ai:key:set <服务商> [环境变量名]        加密 API Key 并写入公共库
  ai:chat <服务商> <模型> <问题>          测试 OpenAI 兼容模型
  json:format <输入.json> [输出.json]      格式化 JSON
  excel:to-json <输入.xlsx> [输出.json]    Excel 转 JSON
  json:to-excel <输入.json> <输出.xlsx>    JSON 数组转 Excel

例子：
  bun run cli db:init public
  DEEPSEEK_API_KEY=... bun run cli ai:key:set deepseek
  bun run cli ai:chat deepseek flash "你好"

类目治理：
  bun run cli db:init category_governance
  bun run cli scenario:run category_governance run import ./sanheng-standard-category.raw.json --version=v1 --group-depth=2
  bun run cli scenario:run category_governance run govern --version=v1 --attempts=3 --concurrency=4
  bun run category-governance --concurrency=128 --batch-size=12
`.trim();

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`缺少参数：${label}`);
  return value;
}

function defaultJsonOutput(inputPath: string): string {
  const extension = extname(inputPath);
  return extension ? inputPath.slice(0, -extension.length) + ".json" : `${inputPath}.json`;
}

async function withDatabaseHub<T>(
  run: (hub: DatabaseHub) => Promise<T>,
): Promise<T> {
  const hub = new DatabaseHub(loadAppConfig().postgresUrl);
  try {
    return await run(hub);
  } finally {
    await hub.closeAll();
  }
}

async function initDatabase(target: string): Promise<void> {
  const config = loadAppConfig();

  const initPublic = async () => {
    const result = await provisionDatabase(
      config.postgresUrl,
      PUBLIC_DATABASE_NAME,
      publicMigrations,
    );
    console.log(
      `${result.databaseName}：${result.created ? "已创建" : "已存在"}，新增迁移 ${result.appliedMigrations.length} 个`,
    );
  };

  const initScenario = async (name: string) => {
    const scenario = getScenario(name);
    const result = await provisionDatabase(
      config.postgresUrl,
      scenarioDatabaseName(scenario.name),
      scenario.migrations,
    );
    console.log(
      `${result.databaseName}：${result.created ? "已创建" : "已存在"}，新增迁移 ${result.appliedMigrations.length} 个`,
    );
  };

  if (target === "public") return initPublic();
  if (target === "all") {
    await initPublic();
    for (const scenario of listScenarios()) await initScenario(scenario.name);
    return;
  }
  await initScenario(target);
}

async function runScenario(args: string[]): Promise<void> {
  const scenarioName = required(args.shift(), "场景名");
  const commandName = required(args.shift(), "场景命令");
  const scenario = getScenario(scenarioName);
  const command = scenario.commands[commandName];
  if (!command) throw new Error(`场景 ${scenarioName} 没有命令：${commandName}`);

  await withDatabaseHub(async (databases) => {
    const catalog = new PostgresAiCatalog(databases.publicDatabase());
    const ai = new AiService(catalog, loadAppConfig().masterKey);
    await command({ args, databases, ai });
  });
}

async function setAiKey(providerCode: string, envName?: string): Promise<void> {
  const config = loadAppConfig();
  if (!config.masterKey) {
    throw new Error("缺少 AI_BUILDING_MASTER_KEY，请先在 .env 中设置 32 字节 Base64 主密钥（可用 openssl rand -base64 32 生成）");
  }

  const keyEnvName = envName ?? `${providerCode.toUpperCase()}_API_KEY`;
  const apiKey = Bun.env[keyEnvName];
  if (!apiKey) throw new Error(`环境变量 ${keyEnvName} 为空`);

  await withDatabaseHub(async (databases) => {
    const ciphertext = await new SecretBox(config.masterKey!).encrypt(apiKey);
    await new PostgresAiCatalog(databases.publicDatabase()).setApiKey(
      providerCode,
      ciphertext,
    );
  });
  console.log(`${providerCode} 的 API Key 已加密写入公共库`);
}

async function chat(args: string[]): Promise<void> {
  const providerCode = required(args.shift(), "服务商");
  const modelCode = required(args.shift(), "模型");
  const prompt = required(args.join(" "), "问题");

  await withDatabaseHub(async (databases) => {
    const ai = new AiService(
      new PostgresAiCatalog(databases.publicDatabase()),
      loadAppConfig().masterKey,
    );
    const response = await ai.chat(providerCode, modelCode, {
      messages: [{ role: "user", content: prompt }],
    });
    console.log(response.choices[0]?.message.content ?? "");
  });
}

export async function main(argv: string[] = Bun.argv.slice(2)): Promise<void> {
  const args = [...argv];
  const command = args.shift() ?? "help";

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "db:name": {
      console.log(scenarioDatabaseName(required(args.shift(), "场景名")));
      return;
    }

    case "db:init":
      await initDatabase(required(args.shift(), "public、all 或场景名"));
      return;

    case "db:ping": {
      const target = required(args.shift(), "public 或场景名");
      await withDatabaseHub((hub) =>
        target === "public" ? hub.pingPublic() : hub.pingScenario(target),
      );
      console.log(`${target} 数据库连接正常`);
      return;
    }

    case "scenario:list": {
      const scenarios = listScenarios();
      if (scenarios.length === 0) {
        console.log("尚未注册业务场景");
        return;
      }
      for (const scenario of scenarios) {
        console.log(`${scenario.name}\t${scenario.displayName}\t${scenario.description}`);
      }
      return;
    }

    case "scenario:run":
      await runScenario(args);
      return;

    case "ai:key:set":
      await setAiKey(required(args.shift(), "服务商"), args.shift());
      return;

    case "ai:chat":
      await chat(args);
      return;

    case "json:format": {
      const input = required(args.shift(), "输入 JSON 文件");
      const output = args.shift();
      const formatted = objectToJson(jsonToObject(await readTextFile(input)), {
        pretty: true,
        trailingNewline: true,
      });
      if (output) await writeTextFile(output, formatted);
      else process.stdout.write(formatted);
      return;
    }

    case "excel:to-json": {
      const input = required(args.shift(), "输入 Excel 文件");
      const output = args.shift() ?? defaultJsonOutput(input);
      await writeTextFile(output, await excelToJson(input));
      console.log(`已生成 ${output}`);
      return;
    }

    case "json:to-excel": {
      const input = required(args.shift(), "输入 JSON 文件");
      const output = required(args.shift(), "输出 Excel 文件");
      await jsonToExcel(await readTextFile(input), output);
      console.log(`已生成 ${output}`);
      return;
    }

    default:
      throw new Error(`未知命令：${command}\n\n${HELP}`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
