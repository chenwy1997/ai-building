# 小卷纸样板：离线准备、回放与人工意见

在仓库根目录运行。Bun负责准备/工具循环；只读HTTPS使用Python 3标准库；工作簿使用Codex bundled Node及`@oai/artifact-tool`。这里没有批量、并发、付费模型或线上写入命令。

## 复核本次已有材料

```sh
# 已有真实回执，无网络请求；保留原文与原生标识
bun src/scenarios/product_governance_v3/cli.ts prepare-roll-pilot --capture outputs/product-governance-v3/roll-real-pilot-20261022 --tree outputs/category-id-refresh-20261021/mapped-tree.updated.json --out outputs/product-governance-v3/roll-real-pilot-20261022/prepared

# 使用当前会话已整理的候选录制，实际装配/工具回传/检查；不是调用DeepSeek
bun src/scenarios/product_governance_v3/cli.ts replay-roll-pilot --snapshot outputs/product-governance-v3/roll-real-pilot-20261022/prepared/snapshot.raw.json --proposals outputs/product-governance-v3/roll-real-pilot-20261022/recorded-agent-proposals.json --out outputs/product-governance-v3/roll-real-pilot-20261022/replay
```

录制文件的`kind`必须为`recorded_agent_proposals`，明确author，每个已选SKU有一个提取结果。合同字段见`contracts.ts`的fact-extraction；精确定位和候选内容由runner检查，不是改个文件名就算合法。新商品或源内容变化后必须重新提取，不套用本次录制。当前7项定义为本样板Codex研究提案，另有6项扩展候选，不能当全品类生成器。

上面命令保留初次样板的路径。2026-10-23准入修订采用新目录`outputs/product-governance-v3/roll-attribute-refinement-20261023`，重新准备/验证当前合同；原始采集仍读取初次capture，不访问生产。旧录制中5条印花/压花提取在3件SKU上被当前合同拒绝，保留为`replay-legacy-negative`；新版`recorded-agent-proposals.revised.json`明确记录源hash，只把这5条移为`deferred-extension-observations.json`研究线索，其余23条原候选不改值、不改引文，仍经过当前runner检查。最终同版材料位于该目录的`final/`，其中`prepared/replay/review/offline-acceptance`为本版结果，录制修订文件在父目录。不能用初次录制直接冒充同版通过。具体证据见[修订记录](attribute-admission-refinement-20261023.md)。

## 如需重新读取或盘点本地代码

这两条是显式准备动作；不要为了离线重放再读生产。新读取使用新目录保留旧回执。本次任务已执行完所需读取。

```sh
# 唯一联网读取入口，固定两类、最新各3件；读取本地SANHENG_API_KEY，不打印凭据
bun src/scenarios/product_governance_v3/cli.ts capture-roll-pilot --out /新的采集目录

# 只读本地供应链代码；新字段未分类会报错，不自动重写发布清单
bun src/scenarios/product_governance_v3/cli.ts inventory-scm-fields --source-root /Users/sanheng/Project/sanheng/uece-base --out /新的职责盘点.json
```

## 生成和使用审阅工作簿

当前首先审核类目属性方案，见[审阅对象纠正记录](review-object-correction-20261023.md)。下面两个导出器面向不同任务，不能用事实核实表替代方案审核。

Codex先用`load_workspace_dependencies`取得bundled路径。下面是本机路径；其他机器按工具返回值设置，不下载安装替代依赖。若脚本目录没有node_modules，创建指向bundled目录的符号链接；已有链接不覆盖。

```sh
PGV3_NODE=/Users/sanheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
PGV3_MODULES=/Users/sanheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
export PGV3_PYTHON=/Users/sanheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3

# 首次设置一次；node_modules为被Git忽略的本机依赖链接
ln -s "$PGV3_MODULES" src/scenarios/product_governance_v3/scripts/node_modules

# 当前主审：类目属性定义、同族绑定及补充/排除判断
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs outputs/product-governance-v3/roll-real-pilot-20261022 /新的属性方案审阅目录

# 后续独立任务：SKU原文提取与初次事实核实
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-pilot.mjs outputs/product-governance-v3/roll-real-pilot-20261022
```

属性方案导出器拒绝覆盖已有工作簿，生成`reviewObject=category_attribute_schema`索引，意见列为“属性方案”H/I及“补充与排除”E。主表只含7项合同属性，6项扩展候选从同一冻结族的extensionCandidates生成，位于补充与排除的前6行；无绑定、类型配置或待填值。计数口径待核实点在主表及定义页保留。目前没有自动回收和采用属性意见的入口。后续`export-roll-review-json`与`import-fact-review`仅适用于事实工作簿。

只需收紧已有表格的字体/行高时，使用`"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs --restyle /已保存的审阅表.xlsx /新的紧凑版.xlsx`，不会重新生成或清空已保存的业务内容和意见。输出目标必须不存在，原文件保留。

各sheet的默认样式、长文全文备注和可选冻结参数统一见[Excel样式配置](excel-review-layout.md)。`--freeze-left 1`固定左侧1列，`--freeze-left 0`取消左侧冻结；`--freeze-through '属性方案=无芯'`将此页冻结边界设为“无芯”列，含其左侧列。新建导出和`--restyle`使用相同选项，特殊样式才传`--layout /覆盖配置.json`。

事实导出器核对快照和当前release，生成同一份xlsx、原文文本、审阅包、索引及空意见模板。需要保留已填意见时，先复制整个review目录或使用新的交付目录；**不要重新生成覆盖已填写的工作簿**。全文使用相对链接，分享时保留xlsx与source-text的目录关系。生成库缺少原生超链接能力，局部OOXML补充仅增加超链接节点/关系，不改值和样式，并检查导出文件没有错误缓存单元格。

在事实审阅页填写人工结论/理由，采用候选还需I—L四项均为“是”。在SKU与问题页B4填写审核人，D4填写有效UTC时间，例如`2026-10-22T12:00:00Z`。不改候选值、引文、ID或hash；需要修订候选时返还提取阶段。未知项可以留补资料意见，不能直接采用为空事实。

```sh
# 从已填写表导出意见，不采用、不联网、不改源工作簿
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-review-json.mjs /已填审阅表.xlsx /对应review-index.json /新的意见导出目录

# 仅在真实人工核实后，将对应SKU初始事实导入新的本地快照
bun src/scenarios/product_governance_v3/cli.ts import-fact-review --snapshot /prepared/snapshot.raw.json --bundle /review/bundles/有芯1.json --review /意见导出目录/有芯1.review.json --out /新的本地核实结果目录
```

未填意见导出0条决定；模板空审核人/时间不能导入。导入逐条核对来源、合同、发布材料、稳定候选内容及语义确认，拒绝冲突同时采用。当前一次导入只承接一个SKU的初始空事实来源；多个SKU汇总、已核实事实修订合并和业务属性方案采用另待实现，不能反复覆盖同一输出冒充合并完成。

```sh
bun test ./src/scenarios/product_governance_v3
./node_modules/.bin/tsc -p src/scenarios/product_governance_v3/tsconfig.json --noEmit
bun src/scenarios/product_governance_v3/cli.ts offline-acceptance --out /离线构造验收目录
```

修改已冻结材料应先审阅，再显式freeze-release；freeze不是业务确认或人工核实。工作簿、请求/响应和原始回执属于内部业务资料，默认不提交Git。实际状态及剩余缺口见[第3步实施记录](implementation-phase3-20261022.md)。
