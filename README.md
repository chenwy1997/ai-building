# ai-building

公司内部运营需求的本地 AI 工程。没有 Web 界面，以 **Bun + TypeScript + 命令行 + PostgreSQL** 为主；每个真实业务场景是一个独立模块和一个独立数据库。

## 分层

```text
src/
├── facilities/              # 公共设施层：纯数据/文件转换，不依赖业务、AI、数据库
│   ├── json/                # JSON、对象、文件、JSONL
│   └── excel/               # Excel 与对象/JSON 互转
├── ai/                      # AI 层：原生 OpenAI chat/completions 格式
├── data/                    # 公共库 Repository
├── platform/
│   ├── database/            # PostgreSQL 连接、命名、建库、迁移
│   └── security/            # 敏感数据 AES-256-GCM 加解密
├── scenarios/               # 真实业务场景；一个目录对应一个业务库
│   └── _template/           # 未注册的场景模板
└── cli.ts                   # 统一命令行入口
```

数据库命名：

- 公共库固定为 `ai-building-public`
- 场景 `product_match` 对应 `ai-building-product_match`
- 场景名统一使用 `snake_case`

公共库保存公共配置、AI 服务商、模型和加密后的 API Key。每个业务场景的数据只进入自己的场景库。

## 初始化

```bash
bun install
cp .env.example .env
```

编辑 `.env`：

```dotenv
AI_BUILDING_POSTGRES_URL=postgresql://用户名:密码@127.0.0.1:5432/postgres
# 使用 openssl rand -base64 32 生成；后续不要随意更换，否则旧密文无法解密
AI_BUILDING_MASTER_KEY=这里放生成的主密钥
DEEPSEEK_API_KEY=这里放DeepSeek密钥
```

初始化公共库，并把 DeepSeek Key 加密写入公共库：

```bash
bun run cli db:init public
bun run cli ai:key:set deepseek
```

写入成功后可以从 `.env` 删除 `DEEPSEEK_API_KEY`；运行时只需要主密钥解密公共库中的 Key。

已预置 DeepSeek 的 OpenAI 兼容地址 `https://api.deepseek.com`，以及模型别名：

- `flash` → `deepseek-flash`（DeepSeek V4 Flash 的当前官方别名）
- `pro` → `deepseek-v4-pro`

测试：

```bash
bun run cli ai:chat deepseek flash "用一句话介绍你自己"
```

类目治理完成导入后可直接启动全量治理；不传 `--category` 时会覆盖全部末级类目：

```bash
bun run category-governance --concurrency=128 --batch-size=12
```

## 公共设施层

代码调用：

```ts
import {
  excelToJson,
  excelToObjects,
  jsonToExcel,
  jsonToObject,
  objectToJson,
  objectsToExcel,
  readJsonFile,
  writeJsonFile,
} from "./index.ts";

const value = jsonToObject<{ name: string }>(`{"name":"运营任务"}`);
const json = objectToJson(value, { pretty: true });
const rows = await excelToObjects("input.xlsx");
await objectsToExcel(rows, "output.xlsx");
```

命令行调用：

```bash
bun run cli excel:to-json ./input.xlsx ./output.json
bun run cli json:to-excel ./input.json ./output.xlsx
bun run cli json:format ./input.json ./formatted.json
```

说明：Excel 的第一行默认作为表头；日期默认转成 ISO 字符串；嵌套对象写入 Excel 时会转成 JSON 字符串。

## 新增业务场景

1. 复制 `src/scenarios/_template`，例如创建 `src/scenarios/product_match`。
2. 把模块的 `name` 改为 `product_match`，定义自己的迁移和 CLI 命令。
3. 在 `src/scenarios/registry.ts` 导入并加入 `scenarios` 数组。
4. 初始化并运行：

```bash
bun run cli db:init product_match
bun run cli scenario:run product_match run [...参数]
```

场景通过 `databases.scenarioDatabase("product_match")` 使用自己的库，通过 `ai.chat(...)` 使用公共 AI 能力。公共设施函数直接按需导入。

## 开发检查

```bash
bun run check
```
