import { describe, expect, test } from "bun:test";
import { auditTree, normalizeCategoryName } from "../src/scenarios/category_governance_plus/audit.ts";
import { applyOps, materialize } from "../src/scenarios/category_governance_plus/engine.ts";
import { validateOpShape } from "../src/scenarios/category_governance_plus/ops.ts";
import type { Category } from "../src/scenarios/category_attributes_governance/types.ts";

const node = (id: string, parentId: string | null, name = id, enabled = true): Category => ({
  id, parentId, name, enabled, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});

const tree = (...nodes: Category[]): Category[] => materialize(nodes);

const mergeOpsOf = (nodes: Category[], kind = "归一化重名") =>
  auditTree(nodes).ops.filter((op) => op.type === "merge" && op.evidence.kind === kind);

describe("audit 树内治理", () => {
  test("归一化：全角→半角、去空白、括号统一、大小写折叠", () => {
    expect(normalizeCategoryName("热风枪（国标）")).toBe(normalizeCategoryName("热风枪(国标)"));
    expect(normalizeCategoryName("ＡＢＣ扳手")).toBe(normalizeCategoryName("abc扳手"));
    expect(normalizeCategoryName(" 热风 枪 ")).toBe("热风枪");
    expect(normalizeCategoryName("热风枪【工业】")).toBe("热风枪(工业)");
  });

  test("归一化重名：全半角/括号差异的同名末级检出 merge，存续者取路径浅者", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "电动工具"),
      node("a1", "a", "热风枪（国标）"),
      node("b", "root", "五金"),
      node("b1", "b", "热风枪(国标)"),
    );
    const merges = mergeOpsOf(nodes);
    expect(merges).toHaveLength(1);
    const params = merges[0]!.params as { sources: string[]; target: string };
    expect(params.sources.sort()).toEqual(["a1", "b1"]);
    expect(params.target).toBe("a1"); // 路径并列时取 id 小者
    const evidence = merges[0]!.evidence as { kind: string; nodes: Array<{ path: string[]; id: string }> };
    expect(evidence.kind).toBe("归一化重名");
    expect(evidence.nodes.map((n) => n.path.join(" > ")).join()).toContain("电动工具 > 热风枪（国标）");
  });

  test("跨分支同名：存续者取路径更浅者，证据列出全部重名路径", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "甲"),
      node("a1", "a", "电钻"),
      node("b", "root", "乙"),
      node("bb", "b", "乙二"),
      node("b1", "bb", "电钻"),
      node("b2", "bb", "电钻 "),
    );
    const merges = mergeOpsOf(nodes);
    expect(merges).toHaveLength(1);
    const params = merges[0]!.params as { sources: string[]; target: string };
    expect(params.target).toBe("a1"); // 3 层路径 < 4 层路径
    expect(params.sources).toHaveLength(3);
    const evidence = merges[0]!.evidence as { sameParent: boolean; nodes: Array<{ id: string }> };
    expect(evidence.sameParent).toBe(false);
    expect(evidence.nodes).toHaveLength(3);
  });

  test("括号变体：主干相同仅括号后缀不同，只进 review 不出 op", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "电动热缩工具"),
      node("a1", "a", "插电式热风器（标准型）"),
      node("a2", "a", "插电式热风器（数显型）"),
      node("x", "root", "备用叶"),
    );
    const result = auditTree(nodes);
    expect(result.ops).toHaveLength(0);
    expect(result.summary.bracketVariantGroups).toBe(1);
    expect(result.report).toContain("括号变体");
    expect(result.report).toContain("插电式热风器（标准型）");
  });

  test("杂类命名命中词表，只进 review 并统计挂载子类", () => {
    // 两个同名杂类末级：占位语义不算重复，不出 merge op
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "电动工具"),
      node("misc", "a", "其他电动工具"),
      node("a2", "a", "电钻"),
      node("m1", "misc", "电动破锡机"),
      node("m2", "misc", "电烙铁"),
      node("b", "root", "五金"),
      node("misc2", "b", "其他电动工具"),
      node("b2", "b", "扳手"),
      node("x", "root", "备用叶"),
    );
    const result = auditTree(nodes);
    expect(result.ops).toHaveLength(0);
    expect(result.summary.genericNameNodes).toBe(2);
    expect(result.report).toContain("杂类命名");
    expect(result.report).toContain("enabled 末级后代 2 个");
  });

  test("占位名「特殊商品」跨分支同名：不算重复，不出 merge，只进杂类 review", () => {
    // 照明/搬运存储/五金的「特殊商品」是三个不同的东西，同名是占位语义
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "照明"),
      node("a1", "a", "特殊商品"),
      node("b", "root", "搬运存储"),
      node("b1", "b", "特殊商品"),
      node("c", "root", "五金工具"),
      node("c1", "c", "特殊商品"),
    );
    expect(mergeOpsOf(nodes)).toHaveLength(0);
    expect(auditTree(nodes).summary.genericNameNodes).toBe(3);
  });

  test("空壳中间层：父子合并提案，存续者=子；链式空壳去重只出一条", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("shell", "root", "空壳层"),
      node("child", "shell", "真实类目"),
      node("leaf", "child", "真实末级"),
      node("other", "root", "备用支"),
      node("o1", "other", "支叶一"),
      node("o2", "other", "支叶二"),
    );
    // shell 只有 1 个孩子 child，child 也只有 1 个孩子 leaf：两级空壳，去重后出一条
    const merges = mergeOpsOf(nodes, "空壳中间层");
    expect(merges).toHaveLength(1);
    const params = merges[0]!.params as { sources: string[]; target: string };
    expect(params.sources).toEqual(["shell", "child"]);
    expect(params.target).toBe("child");
    expect((merges[0]!.evidence as { kind: string }).kind).toBe("空壳中间层");

    // 提案可直接 apply：shell 消失，child 上移到 root 下，子树完整
    const result = applyOps(nodes, merges.map((op, i) => ({ opId: `op-${i + 1}`, type: op.type, params: op.params })), 2);
    expect(result.nodes.some((n) => n.id === "shell")).toBe(false);
    const child = result.nodes.find((n) => n.id === "child")!;
    expect(child.parentId).toBe("root");
    expect(result.nodes.find((n) => n.id === "leaf")!.pathNames).toEqual(["标准类目", "真实类目", "真实末级"]);
    expect(result.tombstones).toEqual([{ oldId: "shell", newId: "child", opId: "op-1", reason: expect.any(String) }]);
    expect(result.migrationMap).toEqual({ shell: "child" });
  });

  test("空壳的禁用孩子随父删除而上移且不丢失", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("shell", "root", "空壳层"),
      node("child", "shell", "真实末级"),
      node("dead", "shell", "历史末级", false),
      node("other", "root", "备用支"),
      node("o1", "other", "支叶一"),
      node("o2", "other", "支叶二"),
    );
    const merges = mergeOpsOf(nodes, "空壳中间层");
    expect(merges).toHaveLength(1);
    const result = applyOps(nodes, [{ opId: "op-1", type: "merge", params: merges[0]!.params }], 2);
    const dead = result.nodes.find((n) => n.id === "dead")!;
    expect(dead.parentId).toBe("root");
    expect(dead.enabled).toBe(false);
  });

  test("禁用节点与深度异常只进报告不出 op", () => {
    // 每个非叶都给 2 个 enabled 孩子以避开空壳检测；深层链挂在 d2..d6 上
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "甲"),
      node("off", "a", "停用类目", false),
      node("x", "a", "叶X"),
      node("d2", "a", "二"),
      node("y2", "d2", "叶Y2"),
      node("d3", "d2", "三"),
      node("y3", "d3", "叶Y3"),
      node("d4", "d3", "四"),
      node("y4", "d4", "叶Y4"),
      node("d5", "d4", "五"),
      node("y5", "d5", "叶Y5"),
      node("d6", "d5", "六"),
      node("mix", "root", "混合父"),
      node("mixleaf", "mix", "混合叶"),
      node("mixbranch", "mix", "混合支"),
      node("mbl1", "mixbranch", "支下叶一"),
      node("mbl2", "mixbranch", "支下叶二"),
    );
    const result = auditTree(nodes);
    expect(result.ops).toHaveLength(0);
    expect(result.summary.disabledNodes).toBe(1);
    expect(result.summary.deepNodes).toBe(4); // 叶Y4、五（6 层）+ 叶Y5、六（7 层）
    expect(result.summary.mixedDepthParents).toBe(5); // 甲/二/三/四/混合父
    expect(result.report).toContain("禁用节点");
    expect(result.report).toContain("深度异常");
  });

  test("产出的 ops 全部通过 validateOpShape", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "甲"),
      node("a1", "a", "电钻"),
      node("b", "root", "乙"),
      node("b1", "b", "电钻"),
      node("shell", "root", "空壳"),
      node("shellchild", "shell", "壳下末级"),
    );
    const { ops } = auditTree(nodes);
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(validateOpShape({ type: op.type, params: op.params, evidence: op.evidence })).toEqual([]);
    }
  });

  test("scope 限定范围：只审计子树内的节点", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("a", "root", "甲"),
      node("a1", "a", "电钻"),
      node("ax", "a", "甲叶二"),
      node("b", "root", "乙"),
      node("b1", "b", "电钻"),
      node("bx", "b", "乙叶二"),
    );
    const scope = nodes.find((n) => n.id === "a")!;
    const { ops, summary } = auditTree(nodes, scope);
    expect(ops).toHaveLength(0); // 重名对分属两个分支，scope=甲 内只有一个
    expect(summary.duplicateMerges).toBe(0);
  });
});
