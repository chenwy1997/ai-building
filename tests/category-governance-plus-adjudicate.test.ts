import { describe, expect, test } from "bun:test";
import {
  adjudicateAll,
  buildEvidencePack,
  buildSystemPrompt,
  computeAgreement,
  parseVerdict,
  renderAdjudicateReport,
  renderUserMessage,
  specRefsForOp,
  specSections,
} from "../src/scenarios/category_governance_plus/adjudicate.ts";
import type { AdjudicateItem, ChatFn } from "../src/scenarios/category_governance_plus/adjudicate.ts";
import { materialize } from "../src/scenarios/category_governance_plus/engine.ts";
import type { Category } from "../src/scenarios/category_attributes_governance/types.ts";

const MINI_SPEC = `# 类目设计规范

## 1. 分组维度唯一性

1. 同一父级同一维度。

## 4. 类目唯一性与合并

1. 重复一律 merge。
2. 同名不同物看父级语义域。

## 7. 分组维度取向

1. 食品类按对象分。
2. 通用品按品类分。
`;

const node = (id: string, parentId: string | null, name = id, enabled = true): Category => ({
  id, parentId, name, enabled, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});

const tree = (...nodes: Category[]): Category[] => materialize(nodes);

const fixture = () => tree(
  node("root", null, "标准类目"),
  node("hw", "root", "五金工具"),
  node("misc", "hw", "五金杂品"),
  node("s1", "misc", "小五金"),
  node("a", "s1", "接线板"),
  node("peer", "s1", "拉手"),
  node("elec", "root", "电气类"),
  node("aux", "elec", "电气辅材"),
  node("b", "aux", "接线板"),
  node("peer2", "aux", "电缆"),
);

const mergeOp = {
  type: "merge" as const,
  params: { sources: ["a", "b"], target: "b", reason: "归一化重名" },
  evidence: { kind: "归一化重名" },
};

describe("规范条款解析与映射", () => {
  test("specSections：整节 + 第 7 节单条", () => {
    const sections = specSections(MINI_SPEC);
    expect(sections.get("1")).toContain("同一父级同一维度");
    expect(sections.get("4")).toContain("同名不同物看父级语义域");
    expect(sections.get("7.1")).toBe("1. 食品类按对象分。");
    expect(sections.get("7.2")).toBe("2. 通用品按品类分。");
  });

  test("specRefsForOp：merge→1/4/7.1/7.2，空壳 merge→3，rename→2/7.3，disable→5", () => {
    expect(specRefsForOp("merge", "归一化重名")).toEqual(["1", "4", "7.1", "7.2"]);
    expect(specRefsForOp("merge", "空壳中间层")).toEqual(["3"]);
    expect(specRefsForOp("rename", null)).toEqual(["2", "7.3"]);
    expect(specRefsForOp("disable", null)).toEqual(["5"]);
  });
});

describe("裁决包组装", () => {
  test("merge：涉及节点角色/路径/兄弟结构 + 条款摘录 + 商品证据", () => {
    const sections = specSections(MINI_SPEC);
    const pack = buildEvidencePack(mergeOp, fixture(), sections, [
      { id: "a", productCount: 1, sampleTitles: ["艾科智泊 19/20款接线板"] },
    ]);
    expect(pack.kind).toBe("归一化重名");
    expect(pack.nodes).toHaveLength(2);
    const [loser, target] = pack.nodes;
    expect(loser!.role).toBe("源（被并）");
    expect(loser!.path.join(" > ")).toBe("标准类目 > 五金工具 > 五金杂品 > 小五金 > 接线板");
    expect(loser!.siblings).toEqual(["拉手"]);
    expect(target!.role).toBe("存续者 target");
    expect(target!.siblings).toEqual(["电缆"]);
    expect(pack.specExcerpts.map((excerpt) => excerpt.ref)).toEqual(["1", "4", "7.1", "7.2"]);
    expect(pack.productEvidence[0]!.productCount).toBe(1);
  });

  test("id 不在树中标记 missing，不抛错", () => {
    const pack = buildEvidencePack(
      { type: "disable", params: { id: "ghost" } },
      fixture(),
      specSections(MINI_SPEC),
    );
    expect(pack.nodes[0]!.missing).toBe(true);
  });

  test("renderUserMessage 含路径/兄弟/样本/条款", () => {
    const pack = buildEvidencePack(mergeOp, fixture(), specSections(MINI_SPEC), [
      { id: "b", productCount: 3, sampleTitles: ["排插 8 位", "接线板 国标"] },
    ]);
    const user = renderUserMessage(pack);
    expect(user).toContain("标准类目 > 电气类 > 电气辅材 > 接线板");
    expect(user).toContain("兄弟：电缆");
    expect(user).toContain("挂载 3");
    expect(user).toContain("「排插 8 位」");
    expect(user).toContain("[4] ## 4. 类目唯一性与合并");
  });
});

describe("verdict 解析", () => {
  test("正常输出（含 targetOverride）", () => {
    const parsed = parseVerdict('{"verdict":"approve","confidence":0.9,"specRefs":["4.1"],"reason":"同域重复","targetOverride":"id-1"}');
    expect(parsed).toEqual({ ok: true, verdict: { verdict: "approve", confidence: 0.9, specRefs: ["4.1"], reason: "同域重复", targetOverride: "id-1" } });
  });

  test("坏 JSON / 非法 verdict / 越界 confidence / 缺 reason 全部拒绝", () => {
    expect(parseVerdict("not json").ok).toBe(false);
    expect(parseVerdict('{"verdict":"yes","confidence":0.5,"specRefs":[],"reason":"x"}').ok).toBe(false);
    expect(parseVerdict('{"verdict":"approve","confidence":1.5,"specRefs":[],"reason":"x"}').ok).toBe(false);
    expect(parseVerdict('{"verdict":"approve","confidence":0.5,"specRefs":[]}').ok).toBe(false);
    expect(parseVerdict('{"verdict":"approve","confidence":0.5,"specRefs":"4.1","reason":"x"}').ok).toBe(false);
  });
});

describe("裁决执行", () => {
  const item = (id: string): AdjudicateItem => ({
    id,
    op: mergeOp,
    pack: buildEvidencePack(mergeOp, fixture(), specSections(MINI_SPEC)),
  });
  const SYSTEM = buildSystemPrompt(MINI_SPEC);
  const good = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 20 } });

  test("正常裁决：一次成功，usage 计费含缓存命中", async () => {
    const chat: ChatFn = async () => good('{"verdict":"approve","confidence":0.8,"specRefs":["4.1"],"reason":"同域"}');
    const batch = await adjudicateAll(chat, [item("x")], { model: "m", systemPrompt: SYSTEM });
    expect(batch.outcomes[0]).toMatchObject({ id: "x", attempts: 1 });
    expect(batch.outcomes[0]!.verdict.verdict).toBe("approve");
    expect(batch.usage.requests).toBe(1);
    expect(batch.usage.cny).toBeCloseTo((80 * 0.04 + 20 * 2 + 20 * 8) / 1e6, 8);
  });

  test("解析失败重试 1 次后仍失败 → uncertain 记 error", async () => {
    let calls = 0;
    const chat: ChatFn = async () => {
      calls += 1;
      return good(calls === 1 ? "garbage" : '{"verdict":"reject","confidence":0.7,"specRefs":[],"reason":"域不同"}');
    };
    const ok = await adjudicateAll(chat, [item("x")], { model: "m", systemPrompt: SYSTEM });
    expect(ok.outcomes[0]).toMatchObject({ attempts: 2 });
    expect(ok.outcomes[0]!.verdict.verdict).toBe("reject");

    const bad = await adjudicateAll(async () => good("still garbage"), [item("y")], { model: "m", systemPrompt: SYSTEM });
    expect(bad.outcomes[0]!.attempts).toBe(2);
    expect(bad.outcomes[0]!.verdict.verdict).toBe("uncertain");
    expect(bad.outcomes[0]!.error).toContain("JSON");
  });

  test("预算闸：预算不足即停，剩余标 skipped", async () => {
    const chat: ChatFn = async () => good('{"verdict":"approve","confidence":0.9,"specRefs":[],"reason":"x"}');
    const batch = await adjudicateAll(chat, [item("a"), item("b"), item("c")], {
      model: "m", systemPrompt: SYSTEM, budgetCny: 0.000001,
    });
    expect(batch.stoppedByBudget).toBe(true);
    expect(batch.outcomes.every((outcome) => outcome.skipped || outcome.attempts > 0)).toBe(true);
    expect(batch.outcomes.some((outcome) => outcome.skipped)).toBe(true);
  });

  test("前缀稳定：system 不随案例变，user 随案例变", async () => {
    const systems = new Set<string>();
    const users: string[] = [];
    const chat: ChatFn = async (request) => {
      systems.add(request.messages[0]!.content ?? "");
      users.push(request.messages[1]!.content ?? "");
      return good('{"verdict":"approve","confidence":0.9,"specRefs":[],"reason":"x"}');
    };
    await adjudicateAll(chat, [item("a"), item("b")], { model: "m", systemPrompt: SYSTEM });
    expect(systems.size).toBe(1);
    expect(users[0]).toBe(users[1]); // 同 op 同 pack → user 也一致（渲染确定）
    expect(SYSTEM).toContain("类目设计规范");
    expect(SYSTEM).toContain("示例 1");
  });
});

describe("一致率与报告", () => {
  test("computeAgreement：方向一致为准，uncertain 记不一致，target 单独统计", () => {
    const result = computeAgreement([
      { id: "c1", expected: { verdict: "approve" }, actual: { verdict: "approve", confidence: 0.9, specRefs: [], reason: "x" } },
      { id: "c2", expected: { verdict: "reject" }, actual: { verdict: "approve", confidence: 0.8, specRefs: [], reason: "y" } },
      { id: "c3", expected: { verdict: "approve", targetOverride: "t-1" }, actual: { verdict: "uncertain", confidence: 0, specRefs: [], reason: "z" } },
    ]);
    expect(result.total).toBe(3);
    expect(result.agreed).toBe(1);
    expect(result.rate).toBeCloseTo(1 / 3, 5);
    expect(result.mismatches.map((mismatch) => mismatch.id)).toEqual(["c2", "c3"]);
    expect(result.targetChecked).toBe(1);
    expect(result.targetAgreed).toBe(0);
  });

  test("renderAdjudicateReport：按 verdict 分组、confidence 降序", () => {
    const items = [0, 1, 2].map((index) => ({
      id: `op-${index}`,
      op: mergeOp,
      pack: buildEvidencePack(mergeOp, fixture(), specSections(MINI_SPEC)),
    }));
    const report = renderAdjudicateReport(items, {
      outcomes: [
        { id: "op-0", verdict: { verdict: "approve", confidence: 0.6, specRefs: ["4.1"], reason: "低" }, attempts: 1, raw: "" },
        { id: "op-1", verdict: { verdict: "approve", confidence: 0.95, specRefs: ["4.1"], reason: "高" }, attempts: 1, raw: "" },
        { id: "op-2", verdict: { verdict: "reject", confidence: 0.7, specRefs: [], reason: "域不同" }, attempts: 1, raw: "" },
      ],
      usage: { requests: 3, promptTokens: 300, cacheHitTokens: 200, completionTokens: 60, cny: 0.001 },
      stoppedByBudget: false,
    }, "测试报告");
    expect(report).toContain("approve 2，reject 1，uncertain 0");
    const approveSection = report.slice(report.indexOf("## approve"));
    expect(approveSection.indexOf("高")).toBeLessThan(approveSection.indexOf("低"));
    expect(report).toContain("缓存命中 66.7%");
  });
});
