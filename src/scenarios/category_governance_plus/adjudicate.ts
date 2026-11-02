import type { Category } from "../category_attributes_governance/types.ts";
import type { AddParams, DisableParams, MergeParams, MoveParams, OpParams, OpType, RenameParams, SplitParams } from "./ops.ts";

/**
 * LLM 裁决器（机器初审）：证据打包/prompt/verdict 解析/一致率/报告全部纯函数；
 * LLM 调用经注入的 chat 执行，单轮 JSON 模式，一次裁一条。
 * 原则：校准先行；实战只产报告，不自动 approve/apply。
 */

// ---------------------------------------------------------------- 规范条款

/** 把 CATEGORY-DESIGN-SPEC.md 切成条款：「1」~「7」整节 + 第 7 节的「7.1」~「7.4」单条。 */
export function specSections(specText: string): Map<string, string> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of specText.split("\n")) {
    const heading = /^## (\d+)\./u.exec(line);
    if (heading) {
      current = heading[1]!;
      sections.set(current, [line]);
      continue;
    }
    if (current === null) continue;
    sections.get(current)!.push(line);
    if (current === "7") {
      const bullet = /^(\d+)\. /u.exec(line);
      if (bullet) sections.set(`7.${bullet[1]}`, [line]);
    }
  }
  return new Map([...sections.entries()].map(([key, lines]) => [key, lines.join("\n").trim()]));
}

/** op 类型（+ evidence.kind）→ 规范条款映射。空壳 merge 走第 3 节；重名 merge 走 1/4/7.1/7.2。 */
export function specRefsForOp(opType: OpType, kind: string | null): string[] {
  if (opType === "merge" && kind === "空壳中间层") return ["3"];
  switch (opType) {
    case "merge": return ["1", "4", "7.1", "7.2"];
    case "rename": return ["2", "7.3"];
    case "disable": return ["5"];
    case "move": return ["1", "7.1", "7.2"];
    case "split": return ["1", "3"];
    case "add": return ["2"];
  }
}

// ---------------------------------------------------------------- 证据打包

export interface PackNode {
  id: string;
  role: string;
  path: string[];
  siblings: string[];
  children: string[];
  missing?: boolean;
}

export interface ProductEvidenceItem {
  id: string;
  productCount: number;
  sampleTitles: string[];
}

export interface EvidencePack {
  opType: OpType;
  kind: string | null;
  params: OpParams;
  reason: string | null;
  specExcerpts: Array<{ ref: string; text: string }>;
  nodes: PackNode[];
  productEvidence: ProductEvidenceItem[];
  /** 补充说明（兄弟挂载统计、同域/跨域标记等扫描类证据），渲染进 user 消息 */
  notes?: string[];
}

interface OpLike {
  type: OpType;
  params: OpParams;
  evidence?: unknown;
}

const evidenceKind = (evidence: unknown): string | null => {
  if (typeof evidence !== "object" || evidence === null) return null;
  const kind = (evidence as Record<string, unknown>).kind;
  return typeof kind === "string" ? kind : null;
};

/** 各类 op 涉及的节点及角色：merge=源/存续者，move=节点/目标父级，rename/disable/split=节点，add=父级。 */
export function involvedIds(op: OpLike): Array<{ id: string; role: string }> {
  switch (op.type) {
    case "merge": {
      const params = op.params as MergeParams;
      return [
        ...params.sources.filter((id) => id !== params.target).map((id) => ({ id, role: "源（被并）" })),
        { id: params.target, role: "存续者 target" },
      ];
    }
    case "move": {
      const params = op.params as MoveParams;
      return [
        { id: params.id, role: "节点" },
        { id: params.parentId, role: "目标父级" },
      ];
    }
    case "rename":
    case "disable":
      return [{ id: (op.params as RenameParams | DisableParams).id, role: "节点" }];
    case "split":
      return [{ id: (op.params as SplitParams).source, role: "节点（待拆）" }];
    case "add":
      return [{ id: (op.params as AddParams).parentId, role: "父级" }];
  }
}

/** 组装裁决包：op + 涉及节点路径/兄弟/孩子（最新版本树）+ 规范条款摘录 + 商品证据（外部注入，可为空）。 */
export function buildEvidencePack(
  op: OpLike,
  nodes: Category[],
  sections: Map<string, string>,
  productEvidence: ProductEvidenceItem[] = [],
  notes: string[] = [],
): EvidencePack {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = (id: string): Category[] =>
    nodes.filter((node) => node.parentId === id).sort((a, b) => (a.name < b.name ? -1 : 1));
  const kind = evidenceKind(op.evidence);
  const packNodes: PackNode[] = involvedIds(op).map(({ id, role }) => {
    const node = byId.get(id);
    if (!node) return { id, role, path: [], siblings: [], children: [], missing: true };
    return {
      id,
      role,
      path: node.pathNames,
      siblings: node.parentId
        ? childrenOf(node.parentId).filter((sibling) => sibling.id !== id).map((sibling) => sibling.name)
        : [],
      children: childrenOf(id).map((child) => child.name),
    };
  });
  const reason = (op.params as { reason?: unknown }).reason;
  return {
    opType: op.type,
    kind,
    params: op.params,
    reason: typeof reason === "string" ? reason : null,
    specExcerpts: specRefsForOp(op.type, kind)
      .map((ref) => ({ ref, text: sections.get(ref) ?? "" }))
      .filter((excerpt) => excerpt.text !== ""),
    nodes: packNodes,
    productEvidence,
    notes,
  };
}

/** 裁决包 → user 消息（每案唯一变化的部分）。 */
export function renderUserMessage(pack: EvidencePack): string {
  const lines: string[] = [
    `【待裁决 op】${pack.opType}${pack.kind ? `（${pack.kind}）` : ""}`,
    `params：${JSON.stringify(pack.params)}`,
  ];
  if (pack.reason) lines.push(`提案理由：${pack.reason}`);
  lines.push(``, `【涉及类目（路径｜同级兄弟｜孩子）】`);
  for (const node of pack.nodes) {
    if (node.missing) {
      lines.push(`- [${node.role}] ${node.id}：当前版本树中不存在`);
      continue;
    }
    lines.push(
      `- [${node.role}] ${node.path.join(" > ")}`,
      `  兄弟：${node.siblings.join("、") || "（无）"}${node.children.length > 0 ? `｜孩子：${node.children.join("、")}` : ""}`,
    );
  }
  lines.push(``, `【商品库证据】`);
  if (pack.productEvidence.length === 0) lines.push(`（无）`);
  for (const item of pack.productEvidence) {
    const node = pack.nodes.find((candidate) => candidate.id === item.id);
    const label = node && node.path.length > 0 ? node.path.join(" > ") : item.id;
    lines.push(
      `- ${label}：挂载 ${item.productCount}`,
      ...item.sampleTitles.map((title) => `  - 「${title}」`),
    );
  }
  lines.push(``, `【规范相关条款】`);
  for (const excerpt of pack.specExcerpts) lines.push(`[${excerpt.ref}] ${excerpt.text}`);
  if (pack.notes && pack.notes.length > 0) {
    lines.push(``, `【补充说明】`, ...pack.notes.map((note) => `- ${note}`));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- prompt

/** 4 个固定示例（2 批 2 拒，选自已结案案例；固定不动保前缀缓存，且不进校准考卷）。 */
export const EXAMPLE_CASE_IDS = ["dup:警示灯", "dup:警戒带", "dup:奶粉", "dup:静电消除剂"];

const EXAMPLES = `
【示例 1】op=merge「警示灯」×3：道路警示/专用灯具/安全警示灯 三个分支各一个末级「警示灯」；挂载 1/0/0，唯一实物样本是爆闪警示灯。
裁决：{"verdict":"approve","confidence":0.9,"specRefs":["4.1","4.3"],"reason":"三分支同名同物（警示灯），域相近（安防/照明均指向警示用途），仅道路警示有实物挂载，按存续者优先级并入道路警示","targetOverride":null}
【示例 2】op=merge「警戒带」×2：安全警示标识 vs 道路警示各一个末级「警戒带」；挂载 15 vs 2，样本都是警示胶带/警戒线。
裁决：{"verdict":"approve","confidence":0.95,"specRefs":["4.1","4.3"],"reason":"同在安防消防下同域重复，样本同质（警戒带/警示胶带），存续者取挂载多、兄弟结构完整的安全警示标识"}
【示例 3】op=merge「奶粉」×2：猫狗医疗保健 > 奶粉 vs 母婴 > 奶粉；挂载 0 vs 9，后者样本均为婴幼儿/成人奶粉。
裁决：{"verdict":"reject","confidence":0.95,"specRefs":["4.2"],"reason":"上一级即分野：宠物医疗 vs 母婴，宠物奶粉与婴儿奶粉同名不同物，规范 4.2 看父级语义域不看名字"}
【示例 4】op=merge「静电消除剂」×2：清洁化学品 vs 设备维护清洗各一个；样本一为地板静电吸尘埃剂、一为衣服防静电喷雾。
裁决：{"verdict":"reject","confidence":0.9,"specRefs":["4.2"],"reason":"商品证据分野：地板除尘剂 vs 衣物喷雾，同名不同物"}
`;

const RULES = `
【裁决规则】
1. 看路径语境，不看名字：父级/祖先语义域不同 → 同名不同物 → reject（规范 4.2）。
1b. 但"同名不同物"的结论是看概念本体（类目名的通用定义）是否同一物，父级域不同只是信号不是结论：本体明确相同（如精密锉就是锉刀、接线板就是电源排插），即使父级域不同、甚至双方零挂载，也按分支冗余 approve（规范 4.1）。
2. 域相同看分支冗余：同域同义、兄弟结构重复 → approve（规范 4.1）。
3. 拿不准看商品证据：挂载样本标题是否一类东西；样本分野明显 → reject；样本同质或皆空 → 回到 1/1b/2 判。
3b. 样本证明的是"该类目实际挂载了什么"，不等于类目概念本身：样本明显与类目名不符（错挂，如马桶垫挂在宠物尿垫、道闸端子板挂在接线板）时，该样本不构成"同名不同物"的证据；只有两边样本都贴合各自类目名、且明显不是一类东西时，样本分野才判 reject。错挂商品在 reason 注明"错挂进 Step 3 人工队列"，不阻塞 approve。
4. 占位名（其他/其它/通用/万能/各种/杂项/特殊商品）永不合并，只 disable/split/重挂（规范 5）。
5. 存续者优先级：分组维度一致 > 兄弟结构完整 > 挂载商品多 > 路径更规范（规范 4.3）。op 的 target 不合适时填 targetOverride（必须是 sources 中的 id）。
6. 空壳中间层（父只有 1 个 enabled 孩子）：原则上父子合并、存续者=子 → approve（规范 3.2）；但若父子语义确实不同层（父是合法分组维度、子只是暂未细分）→ uncertain 并说明。
7. rename/move/disable/add 按对应条款判；分组维度冲突参照第 1 节与 7.1/7.2 的取向。
7b. move 只判归位方向是否符合规范取向；目标父级下疑似同类节点是下一个 merge 议题，不构成 move 的 reject/uncertain 理由。
7c. disable（零挂载类）判「建议禁用 vs 保留观察」：占位/杂类名、明显冗余、整支无货的枯枝（兄弟合计挂载也为 0）→ approve；正常品类只是暂无商品（兄弟分支有货、命名具体合规）→ reject（保留观察）。零挂载不等于该砍。
8. 你只是机器初审：证据不足、规则冲突、拿不准 → uncertain，不要硬判；uncertain 不是失败，是交人审。零挂载本身不是 uncertain 的理由（回到 1b）。
`;

const OUTPUT_SCHEMA = `
【输出】只输出一个 JSON 对象（不要输出其他文字）：
{"verdict":"approve"|"reject"|"uncertain","confidence":0到1的小数,"specRefs":["4.1"],"reason":"≤100字","targetOverride":"可选，不需要时省略或 null"}
`;

/** system 消息：规范全文 + 裁决规则 + 固定示例。不随案例变，吃 KV 缓存。 */
export function buildSystemPrompt(specText: string): string {
  return [
    "你是类目治理裁决器，对一条类目变更 op 做机器初审，只做选择题（approve/reject/uncertain），裁决准绳是下面的《类目设计规范》。",
    "",
    "【类目设计规范（全文）】",
    specText.trim(),
    RULES,
    OUTPUT_SCHEMA,
    EXAMPLES,
  ].join("\n");
}

// ---------------------------------------------------------------- verdict 解析

export interface Verdict {
  verdict: "approve" | "reject" | "uncertain";
  confidence: number;
  specRefs: string[];
  reason: string;
  targetOverride?: string;
}

export type ParsedVerdict = { ok: true; verdict: Verdict } | { ok: false; error: string };

export function parseVerdict(text: string): ParsedVerdict {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: `输出不是合法 JSON：${text.slice(0, 120)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "输出不是 JSON 对象" };
  }
  const record = value as Record<string, unknown>;
  if (record.verdict !== "approve" && record.verdict !== "reject" && record.verdict !== "uncertain") {
    return { ok: false, error: `verdict 非法：${String(record.verdict)}` };
  }
  const confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: `confidence 非法：${String(record.confidence)}` };
  }
  if (!Array.isArray(record.specRefs) || record.specRefs.some((ref) => typeof ref !== "string")) {
    return { ok: false, error: "specRefs 必须是字符串数组" };
  }
  if (typeof record.reason !== "string" || record.reason.trim() === "") {
    return { ok: false, error: "reason 缺失或为空" };
  }
  const verdict: Verdict = {
    verdict: record.verdict,
    confidence,
    specRefs: record.specRefs,
    reason: record.reason.trim(),
  };
  if (typeof record.targetOverride === "string" && record.targetOverride.trim() !== "") {
    verdict.targetOverride = record.targetOverride.trim();
  }
  return { ok: true, verdict };
}

// ---------------------------------------------------------------- 计费

/** DeepSeek Flash 官方高峰价（2026-09-15 核，保守）：命中 0.04 / 未命中 2 / 输出 8 元每百万 token。 */
export const FLASH_PRICE = { hit: 0.04, miss: 2, output: 8 };

export interface UsageSum {
  requests: number;
  promptTokens: number;
  cacheHitTokens: number;
  completionTokens: number;
  cny: number;
}

export const emptyUsage = (): UsageSum => ({ requests: 0, promptTokens: 0, cacheHitTokens: 0, completionTokens: 0, cny: 0 });

export function addUsage(sum: UsageSum, usage: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number } | undefined): void {
  sum.requests += 1;
  const prompt = usage?.prompt_tokens ?? 0;
  const hit = Math.min(prompt, usage?.prompt_cache_hit_tokens ?? 0);
  const completion = usage?.completion_tokens ?? 0;
  sum.promptTokens += prompt;
  sum.cacheHitTokens += hit;
  sum.completionTokens += completion;
  sum.cny += (hit * FLASH_PRICE.hit + (prompt - hit) * FLASH_PRICE.miss + completion * FLASH_PRICE.output) / 1e6;
}

export function usageSummaryLine(sum: UsageSum): string {
  const hitRate = sum.promptTokens > 0 ? (sum.cacheHitTokens / sum.promptTokens * 100).toFixed(1) : "0.0";
  return `请求 ${sum.requests}，输入 token ${sum.promptTokens}（缓存命中 ${hitRate}%），输出 token ${sum.completionTokens}，按 Flash 高峰价估算 ¥${sum.cny.toFixed(4)}`;
}

// ---------------------------------------------------------------- 裁决执行

export interface ChatMessage { role: "system" | "user"; content: string }
export type ChatFn = (request: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: Record<string, unknown>;
  thinking?: { type: "enabled" | "disabled" };
}) => Promise<{ choices: Array<{ message: { content: string | null } }>; usage?: Parameters<typeof addUsage>[1] }>;

export interface AdjudicateItem {
  id: string;
  op: OpLike;
  pack: EvidencePack;
}

export interface AdjudicateOutcome {
  id: string;
  verdict: Verdict;
  attempts: number;
  raw: string;
  /** 解析两次都失败时 verdict=uncertain 且此字段记录错误 */
  error?: string;
  /** 预算停止而未裁决 */
  skipped?: boolean;
}

export interface AdjudicateBatchResult {
  outcomes: AdjudicateOutcome[];
  usage: UsageSum;
  stoppedByBudget: boolean;
}

export interface AdjudicateOptions {
  model: string;
  systemPrompt: string;
  concurrency?: number;
  budgetCny?: number;
  maxTokens?: number;
  /** 单条解析失败后的重试次数（默认 1） */
  retries?: number;
}

const uncertain = (reason: string): Verdict => ({ verdict: "uncertain", confidence: 0, specRefs: [], reason });

/** 批量裁决：并发池 + 预算闸（保守预留，超预算即停，剩余标 skipped）。一次调用裁一条，JSON 模式单轮。 */
export async function adjudicateAll(
  chat: ChatFn,
  items: AdjudicateItem[],
  options: AdjudicateOptions,
): Promise<AdjudicateBatchResult> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const budget = options.budgetCny ?? Number.POSITIVE_INFINITY;
  const maxTokens = options.maxTokens ?? 1500;
  const retries = options.retries ?? 1;
  const usage = emptyUsage();
  const outcomes = new Array<AdjudicateOutcome | null>(items.length).fill(null);
  let cursor = 0;
  let stoppedByBudget = false;

  const adjudicateOne = async (item: AdjudicateItem): Promise<AdjudicateOutcome> => {
    const user = renderUserMessage(item.pack);
    let raw = "";
    let error: string | undefined;
    for (let attempt = 1; attempt <= 1 + retries; attempt += 1) {
      const response = await chat({
        model: options.model,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // 关思考：选择题不需要推理链，思考烧光 max_tokens 会返回空 content（校准第 1 轮实测）
        thinking: { type: "disabled" },
      });
      addUsage(usage, response.usage);
      raw = response.choices[0]?.message.content ?? "";
      const parsed = parseVerdict(raw);
      if (parsed.ok) return { id: item.id, verdict: parsed.verdict, attempts: attempt, raw };
      error = parsed.error;
    }
    return {
      id: item.id,
      verdict: uncertain(`裁决输出解析失败（重试 ${retries} 次仍失败）：${error}`),
      attempts: 1 + retries,
      raw,
      error,
    };
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length || stoppedByBudget) return;
      const item = items[index]!;
      // 预算闸：system+user 字节数保守按 miss 计费预留
      const reserveBytes = Buffer.byteLength(options.systemPrompt, "utf8") + Buffer.byteLength(renderUserMessage(item.pack), "utf8") + 4096;
      const reserve = (reserveBytes * FLASH_PRICE.miss + maxTokens * FLASH_PRICE.output) / 1e6;
      if (usage.cny + reserve > budget) {
        stoppedByBudget = true;
        outcomes[index] = { id: item.id, verdict: uncertain("预算停止，未裁决"), attempts: 0, raw: "", skipped: true };
        return;
      }
      outcomes[index] = await adjudicateOne(item);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    outcomes: outcomes.map((outcome, index) => outcome ?? { id: items[index]!.id, verdict: uncertain("预算停止，未裁决"), attempts: 0, raw: "", skipped: true }),
    usage,
    stoppedByBudget,
  };
}

// ---------------------------------------------------------------- 校准

export interface CalibrationExpectation {
  verdict: "approve" | "reject";
  targetOverride?: string;
  reason?: string;
}

export interface AgreementRow {
  id: string;
  expected: CalibrationExpectation;
  actual: Verdict | null;
}

export interface AgreementResult {
  total: number;
  agreed: number;
  rate: number;
  targetChecked: number;
  targetAgreed: number;
  mismatches: Array<{
    id: string;
    expectedVerdict: string;
    actualVerdict: string;
    expectedTarget?: string;
    actualTarget?: string;
    actualReason: string;
    expectedReason?: string;
  }>;
}

/** 一致率：verdict 方向一致为准（uncertain 记不一致）；targetOverride 单独统计。 */
export function computeAgreement(rows: AgreementRow[]): AgreementResult {
  let agreed = 0;
  let targetChecked = 0;
  let targetAgreed = 0;
  const mismatches: AgreementResult["mismatches"] = [];
  for (const row of rows) {
    const actualVerdict = row.actual?.verdict ?? "uncertain";
    const ok = actualVerdict === row.expected.verdict;
    if (ok) agreed += 1;
    if (row.expected.targetOverride !== undefined) {
      targetChecked += 1;
      const actualTarget = row.actual?.targetOverride;
      if (ok && actualTarget === row.expected.targetOverride) targetAgreed += 1;
    }
    if (!ok) {
      mismatches.push({
        id: row.id,
        expectedVerdict: row.expected.verdict,
        actualVerdict,
        expectedTarget: row.expected.targetOverride,
        actualTarget: row.actual?.targetOverride,
        actualReason: row.actual?.reason ?? "（未裁决）",
        expectedReason: row.expected.reason,
      });
    }
  }
  const total = rows.length;
  return {
    total,
    agreed,
    rate: total === 0 ? 0 : agreed / total,
    targetChecked,
    targetAgreed,
    mismatches,
  };
}

// ---------------------------------------------------------------- 报告

const opTitle = (item: AdjudicateItem): string => {
  const names = item.pack.nodes.map((node) => (node.path.length > 0 ? (node.path.at(-1) ?? node.id) : node.id));
  return `${item.op.type}${item.pack.kind ? `（${item.pack.kind}）` : ""}：${names.join("、")}`;
};

/** 实战报告：按 verdict 分组，approve/reject 按 confidence 降序，人审友好。 */
export function renderAdjudicateReport(
  items: AdjudicateItem[],
  batch: AdjudicateBatchResult,
  title: string,
): string {
  const byId = new Map(items.map((item) => [item.id, item]));
  const groups: Record<"approve" | "reject" | "uncertain", Array<{ item: AdjudicateItem; outcome: AdjudicateOutcome }>> = { approve: [], reject: [], uncertain: [] };
  for (const outcome of batch.outcomes) {
    const item = byId.get(outcome.id)!;
    groups[outcome.verdict.verdict].push({ item, outcome });
  }
  const judged = batch.outcomes.filter((outcome) => !outcome.skipped);
  const avgConfidence = judged.length === 0 ? 0
    : judged.reduce((sum, outcome) => sum + outcome.verdict.confidence, 0) / judged.length;
  const lines: string[] = [
    `# ${title}`,
    ``,
    `裁决 ${judged.length}/${items.length} 条：approve ${groups.approve.length}，reject ${groups.reject.length}，uncertain ${groups.uncertain.length}（含解析失败 ${batch.outcomes.filter((outcome) => outcome.error).length}、预算跳过 ${batch.outcomes.filter((outcome) => outcome.skipped).length}）`,
    `平均置信度 ${avgConfidence.toFixed(3)}；${usageSummaryLine(batch.usage)}${batch.stoppedByBudget ? "；预算停止" : ""}`,
    `本报告仅为机器初审结果，未改 DB、未 propose/apply，请抽验后再走人工流程。`,
    ``,
  ];
  for (const verdict of ["approve", "reject", "uncertain"] as const) {
    const rows = groups[verdict].sort((a, b) => verdict === "uncertain"
      ? a.item.id.localeCompare(b.item.id)
      : b.outcome.verdict.confidence - a.outcome.verdict.confidence);
    lines.push(`## ${verdict}（${rows.length}）`, ``);
    for (const { item, outcome } of rows) {
      const target = outcome.verdict.targetOverride ? `；targetOverride=${outcome.verdict.targetOverride}` : "";
      lines.push(
        `- [${outcome.verdict.confidence.toFixed(2)}] ${opTitle(item)}`,
        `  ${outcome.verdict.reason}（依据 ${outcome.verdict.specRefs.join("、") || "无"}${target}）`,
      );
    }
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}

/** 校准报告：一致率 + 不一致案例对比明细。 */
export function renderCalibrationReport(result: AgreementResult, rows: AgreementRow[], round: number): string {
  const lines: string[] = [
    `# 校准第 ${round} 轮`,
    ``,
    `计分案例 ${result.total}（prompt 示例 ${EXAMPLE_CASE_IDS.length} 案不参与计分）：一致 ${result.agreed}，一致率 ${(result.rate * 100).toFixed(1)}%`,
    `targetOverride：${result.targetChecked} 案考察，命中 ${result.targetAgreed}`,
    ``,
    `## 不一致明细（${result.mismatches.length}）`,
    ``,
  ];
  for (const mismatch of result.mismatches) {
    lines.push(
      `### ${mismatch.id}`,
      `- expected：${mismatch.expectedVerdict}${mismatch.expectedTarget ? `（target=${mismatch.expectedTarget}）` : ""}${mismatch.expectedReason ? `｜${mismatch.expectedReason}` : ""}`,
      `- actual：${mismatch.actualVerdict}${mismatch.actualTarget ? `（targetOverride=${mismatch.actualTarget}）` : ""}｜${mismatch.actualReason}`,
      ``,
    );
  }
  lines.push(`## 全量对照`, ``);
  for (const row of rows) {
    const mark = row.actual?.verdict === row.expected.verdict ? "✓" : "✗";
    lines.push(`- ${mark} ${row.id}：expected ${row.expected.verdict} / actual ${row.actual?.verdict ?? "未裁决"}（confidence ${row.actual?.confidence.toFixed(2) ?? "-"}）`);
  }
  return `${lines.join("\n")}\n`;
}
