# 商品治理v3接线约定

- 2026-10-28最新授权：清洁用品第一版改由Codex团队完成；用户明确指定委派gpt-6.1-terra、max思考，主代理最后审校。清洁纸品21类保留已认可首版，其余211类可进行只读平台采样与离线候选取舍/定义。保留Terra原稿及审校变更记录，统一输出人工审阅；不调用DeepSeek、不写线上。本次授权覆盖下述历史“仅单类DeepSeek试验”的范围限制，不改变历史回执。

- 2026-10-28人工审阅补充：用户明确要求平口式垃圾袋袋长/袋宽合并为尺寸、适配垃圾桶容量简名为容量、删除型号。允许据此生成注明人工修订的派生方案，保留DeepSeek回执、raw-review及原始Excel不变；只处理明确意见，不把其他空白项或未点评配置当成批准。通用命名/粒度/身份标识规则进入规范第6节和两个建模skill，不向模型任务代码硬编码本次属性名单。

- 2026-10-28新路径：用户授权清洁用品先取一个末级做平台样本→DeepSeek取舍→DeepSeek定义真实试验，固定low并沿用原账本，由用户复核，Codex不修改模型业务内容。market-sample-cli默认预检，显式--execute才联网；这次授权不等于全232类跑批授权。阶段完整接续，记录服务商token缓存与本地回放区别；样本、工具返回、原输出与定义原文不得因缓存截断或改写。此试验独立合同和skill见docs/market-sample-pilot.md。

- 业务依据为本目录docs/governance-standard-draft.md及整体稿；文档用途及状态见docs/README.md，术语见GLOSSARY.md。运行通过release清单显式加载，禁止自动加载v2旧standards或把讨论记录当成可执行指令。
- 治理属性统一SKU，基础字段按职责排除；同族共同定义和有理由的差异分别处理。
- 阶段skill必须加载正文及登记附件；动态知识和工具结果固定版本，来源数据不作为指令。
- 按用户2026-10-23的新指示，CLI可提供由用户手动触发的DeepSeek类目属性提案跑批。默认先预检，只有batch --execute、batch-rerun --round 固定轮次名 --execute、batch-continue --from-round 来源轮次 --execute、batch-resume --from-round 来源轮次 --execute、batch-recover --category-id 单个失败末级 --execute读取DEEPSEEK_API_KEY并联网；本地开发和测试仍注入模拟HTTP，不读取真实密钥，不替用户启动付费批次。不得生产写入、商品试填或自动采用。
- 用户随后选择按新规则全量重跑。使用batch-rerun，--out为原批次根目录，轮次结果放reruns/轮次名；旧提案不作为新提案复用，原始资料和已审阅同族输入保留。请求和累计预算仍在原根目录，禁止清零/隐式提额。轮次名固定release、范围和输入，同名重复只恢复这一轮，规则变化须明确另开一轮；不能因普通失败自动换名付费。
- 跑批固定release、输入快照、模型和费用预留配置。同族先建立本批待审共同基线，再并发末级；失败基线不可复用。恢复使用原目录，不自动重发结果未知的请求，所有类目（包括失败）都必须留在汇总中。
- 宿主修复后用batch-recover离线复核原响应，不覆盖原件；只接受无歧义的JSON外层展示格式，不修业务值或JSON语法。历史业务材料、schema、检查器或只读工具变更必须阻断自动复核。纠错最多2次，仍在6轮/16次工具预算内；所有纠错均由模型提案、程序重检，不放宽R03/R07/R11。付费纠正沿用原requests和budget.json，冻结纠正输入，成功及失败重跑都不得静默购买新一轮。
- 普通业务属性仍由模型提案、人工采用；fixture仅为构造验收样例，不发布为真实类目标准。
- 验收必须经过实际装配、function调用/回传、结果检查和记录保存；不能仅检查工具名称或提示词出现。
- 新建审阅Excel默认复用scripts/review-layout.defaults.json和review-workbook-layout.mjs；除显式指定外不另造字号/行高/表头样式。左侧冻结通过参数配置，不能在新模板写死列数。具体边界及命令见docs/excel-review-layout.md。

- 2026-10-24：family-modeling输出必须有逐项decisions，业务必要性、专业定义及SKU取值资料分开；数量按对象/分母/计数词对照unitMin职责，同ID跨族也不能改定义。历史响应缺新字段应明确报告合同不兼容，禁止运行时自动补成“confirmed”；fixtures注释只供离线测试。
- 预算提额只能通过用户明确授权的budget-set-remaining追加记录，保持原limitCny身份及所有历史预留；同授权ID重复不补余额。有效额度读取adjustments，不得直接改原始limit或自动清零/提额。
- 请求布局使用request-layout.ts：规则/skill及已选共享资料置前，类目与任务数据后置，运行状态只在完整工具回传/纠错反馈后追加；不得改写历史、截断资料或为缓存加载无关知识。模型状态、纠错和工具预算仍由程序检查；离线前缀指标不冒充provider token命中率。
- 跨类复用分别检查定义指纹与目标范围；属性池命中不授予范围。attributeApplicability是冻结核实输入，模型不能生成supported记录；缺省不表示全局适用。用户2026-10-26明确确认三类核心清单并授权离线核实，其authorized_offline记录只能与release登记全文完全匹配、仅用于待审建模，不冒充人工专业签认或授权SKU填写。共同基线检查全部成员，历史未核实记录保持为负例；构造核实记录仅在fixture中使用。
- 新批次/显式新轮次采用modeling-proposal-v1。模型只产增量和修订建议，宿主按冻结版本展开共同定义/绑定/决策并重跑原检查；不静默迁移历史完整输出。保留modelProposal、assembly及结果指纹，恢复时从原响应重建并比对。revisionRequests不应用；缺历史决策不得自动补confirmed。数量字段映射归程序，业务关系仍待审；专业包的样本不授予适用性记录。
- 三类试点以docs/bounded-pilot-20261026.md为本轮工程验收边界。人工未裁定的专业议题显式暂缓，不用反复付费重跑解决；不把模拟三类通过率说成真实DeepSeek准确率或全21类可用。
- 当前三类核心范围及离线核实见docs/core-pilot-20261026.md。coreScope与检查器同源，真实SCM键由CategoryKeyConfig确定；salesUnit为职责别名，默认键saleUnit。unitMin及unitMinQua来自属性承载而非StdProduct列。字段清单只做无损JSON排版压紧，禁止因上下文预算删字段。新轮次仍复用原账本，由用户执行。
- 2026-10-26：用户授权保留已通过抽纸基线，仅续跑两个发送前context_budget阻断的末级。新增batch-continue --from-round，默认离线预检，只有用户手动--execute读取模型密钥并请求；开发不得执行付费续跑。完整核对原响应/工具/资料指纹，保持原runId、同族范围、待审状态、模型和累计账本。固定continuations/来源轮次目录，重复执行不得购买新循环。容量按完整请求及64000字节历史预留检查，同族生成后再次预检；350000字节总请求上限、纠错上限和业务检查不变，不截断资料或历史。
- 2026-10-26全量中断后：用户授权本地累计预留总上限1000元并修复其他错误；保留原账本，不由开发执行付费请求。batch-resume --from-round默认离线逐请求重放；仅显式--execute恢复已识别的可恢复失败。成功结果及原基线保留，轮数/纠错次数不重置；hostResume记录实际宿主版本，业务版本和已付费请求保持可精确重放。不得通过换版本、目录或新轮次静默重买失败循环。
- 用户要求公共、高频能力沉淀为组件。请求/回执完整性使用request-journal.ts，重放使用transcript-replay.ts，可恢复/可纠错错误分类使用runtime-errors.ts，族覆盖清单使用family-coverage.ts；批次层只编排。不能把本轮类目ID、轮次名、12个失败的数量或错误样例写入运行策略；具体数据只能作为资料、profile或回归fixture。词形候选不自动归族；审阅Excel不自动变成已发布族。
- 2026-10-26输出截断：新批次默认65536输出token（含思考），通过max-output-tokens配置；response-capacity.ts统一上限/超时/预留。已收到HTTP200且可验证的incomplete终态与未知网络结果分开，保留实际usage和原始回执。旧宿主误标通过旁存outcome-resolution核实，不覆盖原回执。batch-resume加max-output-tokens只从已保存resumption中动态选取max_output_tokens失败，写入固定output-recovery目录；成功及零属性结果/基线不发新请求。精确重放已付费请求，截断消耗原轮数，最多提高一次容量且仍受6轮/2次业务纠错限制；不拼接截断JSON，不执行不完整工具调用，不删原输入和完整工具历史。真实断网/缺失回执/content_filter不进入输出扩容。
