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

op 式类目变更（人只审批 op，树按 op 日志物化新版本）：

```bash
bun run category-governance-plus import --source=src/scenarios/category_governance/workspace/context/v1/category-tree.json
bun run category-governance-plus propose --file=ops.json
bun run category-governance-plus approve --op=<op_id> --by=名字
bun run category-governance-plus:apply
bun run category-governance-plus export --version=2 --out=./out
bun run category-governance-plus status
```

ES 类目查询先区分 ID 体系：当前真实目录子树用 `categoryIds`，直接挂载用 `categoryInstance.categoryId`；`standardCategory.id/idPath` 表示另一套标准映射归属。下述旧标准树工具使用后者，不能把真实目录 ID 直接传入，也不能把结果当当前目录挂载量。SPU 按 `spuProductId` 去重，不等于 SKU 文档数。详见 [ES 类目范围与 SPU 统计口径](src/scenarios/product_governance_v4/docs/es-category-scope-and-counting.md)。

op 提案生成器：对指定标准类目范围从公司 ES 商品库拉标准映射证据（filter `isStdProduct=true`；叶子归属量用 `term standardCategory.id`，scope 采样用 `term standardCategory.idPath`，均需标准树 ID），产出 merge/split/disable/add 候选（ops.json 可直接给 propose；同目录生成 markdown 证据报告）。需先在 `.env` 配置 `ES_NODE/ES_USERNAME/ES_PASSWORD`（从 sanheng/ai-core 的 .env 复制）；没有密钥时可用 `--fixture` 喂预抓的 stats JSON 完全离线运行：

```bash
bun run category-governance-plus:suggest --scope=电动铆接工具 --size=200 --min-products=50 --out=ops.json
bun run category-governance-plus:suggest --scope=电动铆接工具 --fixture=src/scenarios/category_governance_plus/fixtures/rivet-tools.stats.json --out=ops.json
```

树内治理审计（第一步，不依赖商品、不依赖 AI）：对最新版本树做确定性检查，产出归一化重名/空壳中间层 merge 候选（ops.json）+ 括号变体/杂类命名/禁用/深度异常 markdown 报告（杂类命名只进 review 不出 op）。

```bash
bun run category-governance-plus:audit                      # 全树
bun run category-governance-plus:audit --scope=电动工具 --out=audit-ops.json
```

子树结构人审渲染（层级标注 [一级]~[四级(品名)]，禁用节点带标注，`--counts` 追加商品库标准映射归属量——末级按 `standardCategory.id`、分支按 `standardCategory.idPath`，不是当前真实目录挂载量；未配 ES 时降级为纯结构渲染并提示）：

```bash
bun run category-governance-plus:tree --scope=宠物生活
bun run category-governance-plus:tree --scope=电烙铁 --counts
bun run category-governance-plus:tree --scope=五金工具 --max-depth=2
```

旧类目追溯（商品迁移依据）：任意类目 id 的版本状态 + 墓碑去向链；export 的 migration-map.json 输出链式解析后的最终映射（A→B→C 记为 A→C，附 hops 细节）：

```bash
bun run category-governance-plus:trace --id=<类目id>
```

LLM 裁决器（机器初审，DeepSeek flash）：对 ops.json 逐条出 approve/reject/uncertain + 置信度 + 规范依据，只产报告不改库。system 前缀固定（规范全文+裁决规则+4 个固定示例）吃 KV 缓存，一次调用裁一条、JSON 模式单轮、关思考。校准考卷 23 案（`calibration/cases.json`，含静态证据快照；4 个 prompt 示例不计分），预算默认校准 ¥5 / 实战 ¥10：

```bash
bun run category-governance-plus:adjudicate-calibrate                          # 校准（自动递增 round-N）
bun run category-governance-plus:adjudicate --file=ops.json --out=workspace/shell-v4   # 实战（只产 verdicts.jsonl + report.md）
```

全树体检扫描（只产报告和裁决提案，不改库）：mount-scan 一次 terms agg 拿全末级挂载分布 + 零挂载清单（带枯枝/裸奔/杂类标记和兄弟挂载），零挂载自动生成 disable 提案过裁决器（>1500 条先跑等距样本 500）；near-dup 扫归一化不同但 bigram ≥0.75 的末级对（同域分组、跨域单独标记，候选 >800 自动收紧到 0.85），merge 提案（target=挂载多者、仅作建议）全量过裁决器：

```bash
bun run category-governance-plus:mount-scan
bun run category-governance-plus:near-dup
```

diff 式增量属性治理（按类目版本分桶：未变继承、merge/split 调和、add 占位，只产出变化行）：

```bash
bun run category-attributes-governance-plus plan --version=2 --base-template=base-template.json
bun run category-attributes-governance-plus export --version=2 --out=模板.xlsx
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
