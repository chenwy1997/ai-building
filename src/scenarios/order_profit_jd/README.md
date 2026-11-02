# 订单商品京东比价

最近 1,000 条默认状态订单商品，以 `productSku` 去重查询，再按 `orderItemRealTimeId` 回填全部订单行。每行保留实际订单销售单价，不用商品目录价替代。

接口已通过 Chrome 登录会话确认：

| 用途 | 接口与参数 |
| --- | --- |
| 订单商品毛利列表 | `POST /manage/report/order-item-profit/api/getList`，`page`、`pageSize:100`、`orderStatus:["ALL_SHIPPED","FINISHED"]` |
| 原始及参考链接、销售单位 | `POST /manage/product/api/findMany`，`skuCodeList` 每批最多 100，完整请求见 `collect-in-browser.js` |
| 商品名称、品牌、规格 | `POST /api/external/getProductInfo`，`{skus:[...]}`，已有环境变量授权 |
| 京东同品检索 | `jingdong.vop.goods.searchSku`，每个商品最多两个检索词、每次前 20 个候选 |
| 京东候选详情 | `jingdong.vop.goods.getSkuDetailInfo`，核对品牌、型号、规格、包装、销售单位 |
| 京东当前价格 | `jingdong.vop.goods.getSellPrice`，`sku` 逗号分隔，每批最多 100，`num` 对应全部为 1 |

有京东 `sourceUrl` 时先核验该 SKU。没有 `sourceUrl` 时可核验京东 `compareUrl`；不匹配或没有可用链接时搜索同品。非京东原始链接不阻止同品搜索。`skuId` 属性本身不作为已确认京东链接。精确 SKU 属性通过实例关系连接，不能串用相邻颜色/规格的属性。

`jdPrice` 是京东价，`salePrice` 是 VOP 协议价。两者均取价格接口，保留采集时间。不把当前价格当作历史订单时点价格，也不把销售价差当作原订单实际毛利。

批量价格失败时，`2004`、`3553` 或“不在客户/用户商品池”会隔离显式报错 SKU；没有明确 SKU 的批次按二分拆开重试。异常价格为空，不填 0，不用搜索接口展示价格补足。正常 SKU 的结果保留。

## 运行

1. 登录报告页，按 `collect-in-browser.js` 从浏览器只读采集，将下载文件存为目标输出目录的 `source.json`。当前批次原始数据已经保存在 `outputs/order-profit-jd-batch-20261015/source.json`。不要复制认证 Cookie 到输出中。
2. 在当前项目根目录运行：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  bun --env-file=.env \
  --env-file=/Users/sanheng/Project/sanheng/ai-core/.env \
  --env-file=/Users/sanheng/Project/sanheng/ai-core/.env.local \
  src/scenarios/order_profit_jd/run.ts --concurrency=12
```

可用 `--out=/absolute/output/directory`、`--source=/absolute/source.json`、`--limit=3`。不带 `--limit` 处理该源文件全部去重商品。`AI_CORE_PROJECT` 可覆盖已有京东客户端所在项目路径。同品核验使用项目已配置的 `OPENAI_API_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`，仅发送商品资料和候选详情。

`matches.jsonl` 是逐商品检查点，重跑复用输入和版本未变的已完成结果，失败项重试。`cache/` 保存详情、搜索及核验响应，`progress.json` 保存进度。查价每次重新获取。扩大全量范围时应重新采集订单范围并复用同一缓存目录；新的商品资料会触发重新核验。

主要输出：`comparison.json` 全部订单行加京东比价字段；`sku-results.json` 去重核验依据及价格；`prices.json` 京东 SKU 价格；`price-api-audit.jsonl` 批量请求与异常拆分记录；`summary.json` 本轮统计。

同品结果属于基于商品资料的自动核验。`needs_review` 为证据不足，`no_match` 为本轮检索未确认，不表示京东全站绝无同品。继续扩大范围前可按业务需要抽查匹配依据。

本批次取接口默认排序前 1,000 行，并非另按 `submittedAt` 重新排序。下单时间范围见输出。复核决定保存在 `review-overrides.json`，仅作用于相同商品、相同候选和相同资料哈希。单瓶/单罐销售价不得与整箱京东价直接相减，按箱规下单也不能当成按箱计价。

`--reuse-prices=/absolute/prices-observed.json` 仅用于同一批次复核后的重新汇总，保留原查价时间并避免重复请求。正常新批次请省略该参数，重新获取当前价格。复核移出的候选保留在 `reviewedCandidate`，其价格仅作参考，不参与价差。

## 2026-10-15 全量任务

用户已授权扩大到默认状态（待收货、已完成）全部订单商品。`collect-full-in-browser.js` 在已登录的 Chrome 报表标签页内只读采集，订单每页 1,000 行、并发 4，商品属性每批 100 个、并发 2。IndexedDB `codex-order-profit-full-20261015` 按页面和 SKU 保存检查点。正式全量源文件下载为 `~/Downloads/order-profit-full-source-20261015.json`。采集期间应保留该标签页；执行出错后可在同一标签页重贴脚本续跑，已采集页面和属性会跳过。最初顺序试采的 5,000 行 `order-profit-full-orders-20261015.json` 不是完整源文件，不作为全量运行输入。

`full-run.ts` 是持久运行器，输出为 `outputs/order-profit-jd-full-20261015/`。自动等待完整源文件下载，再复制为本地 `source.json`。直接复用上轮最终 `sku-results.json` 的全部 880 个商品（包括人工复核、未找到同品、商品池异常），不以原始 `matches.jsonl` 覆盖复核结果。订单重复 SKU 共用结果；新增 SKU 每批 100 个，核验并发 8，批次完成后归并价格、结果与分类文件。价格按 JD SKU 去重复用并保留实际查价时间，已知商品池错误不重复查价。

- `progress.json`：全量阶段、总数、当前批次、累计结果和 PID。
- `chunks/<首SKU>-<末SKU>/progress.json`：当前批次逐 10 个商品更新的进度。
- `results.jsonl`：新增商品的持久结果检查点；`sku-results.json` 合并旧结果与新增结果。
- `not-in-customer-pool.json`：价格或详情核验中出现商品池异常的商品。
- `no-same-product.json`：本轮检索未确认同品。
- `needs-review.json`：规格、包装、单位或精确 SKU 属性不足。
- `errors.json`：其他查询失败或价格缺失；与商品池异常分开。
- `comparison.jsonl`：全部完成后逐订单行回填比价，保留各行真实销售单价。
- `source-audit.json`：初末总数、去重行数、采集时间。分页接口不提供快照，采集期间业务数据变化可能造成数量差异，不能把分页结果声称为事务快照。

恢复任务使用相同环境执行 `bun src/scenarios/order_profit_jd/full-run.ts`（环境加载和代理处理同上）。PID 锁避免重复启动；成功归并的全部 SKU 会跳过；未归并批次通过匹配/详情缓存恢复。发生认证、额度或集中上游故障会停止并记录错误，避免持续消耗请求。任务不会修改线上商品或订单。

### 并发试跑与自动回调

全量调度器每批读取输出目录的 `runtime-settings.json`，通过 `concurrency` 设置核验并发，范围 1–32。2026-10-15 按用户要求从 8 提升到 16 试跑；每批仍最多 100 个商品，价格接口批量和商品池隔离逻辑不变。设置更新在下一批生效，无需再次重启。

批次摘要记录实际 `concurrency`、`retries`、`rateLimitErrors` 和 `timeoutErrors`。出现限流，或一批至少 3 次超时、至少 5 个查询错误时，下一批自动将并发减半，最低回到 8；集中上游故障仍触发原有停止保护。同一批中相同详情、搜索或核验请求共享进行中的请求，避免并发重复调用。

调度器恢复时会校验并接纳“子进程已完整结束、父进程尚未归并”的批次结果，避免切换调度器时重复核验和查价。既有最终结果优先，不会被恢复批次覆盖。
