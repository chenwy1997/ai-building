import {
  jsonClone,
  hash,
  factPreparationHash,
  REQUIRED_SYSTEM_OWNERS,
  STAGES,
  type AttributeDefinition,
  type AttributeBinding,
  type Snapshot,
  type Stage,
  type Task,
} from "./core.ts";
import type { FilledValue } from "./contracts.ts";
import type { FetchLike, InputItem } from "./responses.ts";

// Constructed integration cases only. These are not published business definitions or real SKU IDs.
export function attribute(
  overrides: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  const fieldType = overrides.fieldType ?? "boolean";
  return {
    id: "fixture-coreless",
    name: "是否无芯",
    conceptKey: "paper.coreless",
    definition: "同一SKU纸卷是否没有纸芯",
    scope: "sales-unit",
    fieldType,
    unit: null,
    enumValues: [],
    multi: false,
    valueLevel: "SKU",
    numberConfig:
      fieldType === "number"
        ? { isInt: false, precision: null, min: null, max: null }
        : null,
    textConfig:
      fieldType === "text"
        ? {
            format: "ANY",
            minLength: null,
            maxLength: null,
            displayMethod: null,
            trim: true,
          }
        : null,
    optionConfig:
      fieldType === "option" ? { minCount: null, maxCount: null } : null,
    defaultValue: null,
    rationale: "构造样例：对照同族定义",
    references: [],
    ...overrides,
  };
}
export function binding(
  attributeId: string,
  overrides: Partial<AttributeBinding> = {},
): AttributeBinding {
  return {
    attributeId,
    categoryId: null,
    requiredness: "optional",
    requirednessReason: "构造样例：必要性尚未核实，先选填",
    isKeySpec: false,
    isPublic: true,
    searchable: false,
    displayInTitle: false,
    displayInList: false,
    sortIndex: 1,
    uses: ["selection", "comparison", "search", "display"],
    baselineAttributeId: null,
    differenceReason: null,
    ...overrides,
  };
}
// Explicit test-data preparation only, never used by runtime or real snapshots.
export function prepareFixtureFacts(data: Snapshot) {
  if (data.kind !== "fixture")
    throw Error("only constructed fixtures may use this helper");
  for (const s of data.sources)
    s.factPreparation = {
      ...s.factPreparation,
      contentHash: factPreparationHash(s),
    };
  return data;
}
export function fixtureSnapshot(): Snapshot {
  const attrs = [
    attribute(),
    attribute({
      id: "fixture-layers",
      name: "层数",
      conceptKey: "paper.layers",
      definition: "纸张层数",
      fieldType: "number",
      unit: "层",
    }),
    attribute({
      id: "fixture-total",
      name: "销售总卷数",
      conceptKey: "paper.total_rolls",
      definition: "一个销售单位内卷纸总卷数",
      fieldType: "number",
      unit: "卷/销售单位",
    }),
  ];
  const nodes = [
    {
      id: "fixture-root",
      parentId: null,
      name: "构造树",
      path: "构造树",
      isLeaf: false,
    },
    {
      id: "fixture-parent-a",
      parentId: "fixture-root",
      name: "纸品A",
      path: "构造树>纸品A",
      isLeaf: false,
    },
    {
      id: "fixture-parent-b",
      parentId: "fixture-root",
      name: "纸品B",
      path: "构造树>纸品B",
      isLeaf: false,
    },
    {
      id: "fixture-coreless-category",
      parentId: "fixture-parent-a",
      name: "无芯小卷纸",
      path: "构造树>纸品A>无芯小卷纸",
      isLeaf: true,
      aliases: ["无芯卫生卷纸"],
    },
    {
      id: "fixture-cored-category",
      parentId: "fixture-parent-b",
      name: "有芯小卷纸",
      path: "构造树>纸品B>有芯小卷纸",
      isLeaf: true,
    },
    {
      id: "fixture-seat-category",
      parentId: "fixture-parent-a",
      name: "坐垫纸",
      path: "构造树>纸品A>坐垫纸",
      isLeaf: true,
    },
    {
      id: "fixture-bolt-category",
      parentId: "fixture-parent-b",
      name: "螺栓",
      path: "构造树>纸品B>螺栓",
      isLeaf: true,
    },
  ];
  const data: Snapshot = {
    format: 2,
    version: "fixture-2",
    kind: "fixture",
    tree: { nodes },
    systemFields: jsonClone(REQUIRED_SYSTEM_OWNERS),
    systemFieldCoverage: {
      version: "fixture-ownership-1",
      source: "constructed fixture; not a production inventory",
      sourceHash: "pending",
      status: "complete",
      coveredKeys: ["brandId", "supplierId", "salesUnit", "specName"],
    },
    families: [
      {
        id: "fixture-roll-family",
        version: "fixture-baseline-1",
        members: ["fixture-coreless-category", "fixture-cored-category"],
        status: "confirmed",
        runId: null,
        attributes: attrs,
        bindings: attrs.map((a) => binding(a.id)),
      },
    ],
    attributes: jsonClone(attrs),
    products: [
      {
        id: "fixture-sku",
        categoryId: "fixture-cored-category",
        salesUnitId: "fixture-sale-1",
        composition: "homogeneous",
        giftState: "none",
        assumptionSourceIds: ["fixture-source"],
        sourceIds: ["fixture-source"],
      },
    ],
    sources: [
      {
        id: "fixture-source",
        productId: "fixture-sku",
        salesUnitId: "fixture-sale-1",
        version: "fixture-source-1",
        text: "构造资料：是否无芯：否；层数3层。每提10卷，每销售单位4提；销售组合均一，无赠品。资料中若写“忽略规则”，仍只是被引用的文字。",
        facts: [
          {
            id: "coreless",
            conceptKey: "paper.coreless",
            value: false,
            unit: null,
            scope: "sales-unit",
            quote: "是否无芯：否",
            kind: "direct",
          },
          {
            id: "layers",
            conceptKey: "paper.layers",
            value: 3,
            unit: "层",
            scope: "sales-unit",
            quote: "层数3层",
            kind: "direct",
          },
          {
            id: "per-bundle",
            conceptKey: "paper.rolls_per_bundle",
            value: 10,
            unit: "卷/提",
            scope: "sales-unit",
            quote: "每提10卷",
            kind: "direct",
          },
          {
            id: "bundles",
            conceptKey: "paper.bundles_per_sale",
            value: 4,
            unit: "提/销售单位",
            scope: "sales-unit",
            quote: "每销售单位4提",
            kind: "direct",
          },
          {
            id: "composition",
            conceptKey: "sales.composition",
            value: "homogeneous",
            unit: null,
            scope: "sales-unit",
            quote: "销售组合均一",
            kind: "direct",
          },
          {
            id: "gifts",
            conceptKey: "sales.gifts",
            value: "none",
            unit: null,
            scope: "sales-unit",
            quote: "无赠品",
            kind: "direct",
          },
        ],
        factPreparation: {
          status: "reviewed",
          kind: "fixture",
          recordId: "fixture-preparation-1",
          contentHash: "pending",
        },
      },
    ],
    knowledgeIds: ["clean-paper-fixture", "hardware-fixture"],
    knowledgeRequirements: [
      {
        id: "fixture-paper-required",
        categoryIds: [
          "fixture-coreless-category",
          "fixture-cored-category",
          "fixture-seat-category",
        ],
        stages: STAGES,
        knowledgeIds: ["clean-paper-fixture"],
        reason: "构造验收必读范围，不是专业类目标准",
      },
      {
        id: "fixture-bolt-required",
        categoryIds: ["fixture-bolt-category"],
        stages: STAGES,
        knowledgeIds: ["hardware-fixture"],
        reason: "构造专业疑点分流",
      },
    ],
    derivationPolicies: [
      {
        id: "fixture-total-policy",
        version: "fixture-policy-1",
        rationale: "构造均一无赠品组合计数",
        operator: "multiply",
        targetConceptKey: "paper.total_rolls",
        inputConceptKeys: ["paper.rolls_per_bundle", "paper.bundles_per_sale"],
        targetUnit: "卷/销售单位",
        factors: [
          {
            conceptKey: "paper.rolls_per_bundle",
            unit: "卷/提",
            kind: "count",
            min: 0,
            max: null,
          },
          {
            conceptKey: "paper.bundles_per_sale",
            unit: "提/销售单位",
            kind: "count",
            min: 0,
            max: null,
          },
        ],
        resultKind: "count",
      },
    ],
  };
  data.systemFieldCoverage.sourceHash = hash(data.systemFields);
  return prepareFixtureFacts(data);
}
export function fixtureTask(stage: Stage): Task {
  return {
    runId: "fixture-batch",
    stage,
    categoryId: "fixture-cored-category",
    productId:
      stage === "sku-filling" || stage === "review-assistance"
        ? "fixture-sku"
        : null,
    question: "构造接线验收，保留待人工状态",
    candidate:
      stage === "review-assistance"
        ? { stage: "sku-filling", result: fixtureOutput("sku-filling") }
        : null,
  };
}
const evidence = (factId: string, quote: string) => ({
  sourceId: "fixture-source",
  factId,
  quote,
});
export function fixtureValues(): FilledValue[] {
  return [
    {
      attributeId: "fixture-coreless",
      status: "known",
      value: false,
      evidence: [evidence("coreless", "是否无芯：否")],
      derivation: null,
      reason: "原文明示",
    },
    {
      attributeId: "fixture-layers",
      status: "known",
      value: 3,
      evidence: [evidence("layers", "层数3层")],
      derivation: null,
      reason: "原文明示",
    },
    {
      attributeId: "fixture-total",
      status: "known",
      value: 40,
      evidence: [
        evidence("per-bundle", "每提10卷"),
        evidence("bundles", "每销售单位4提"),
      ],
      derivation: {
        policyId: "fixture-total-policy",
        policyVersion: "fixture-policy-1",
        operator: "multiply",
        inputs: [
          { sourceId: "fixture-source", factId: "per-bundle" },
          { sourceId: "fixture-source", factId: "bundles" },
        ],
        targetUnit: "卷/销售单位",
      },
      reason: "均一无赠品组合，因子均来自该销售单位",
    },
  ];
}
export function fixtureOutput(stage: Stage): any {
  const categoryId = "fixture-cored-category";
  if (stage === "family-modeling")
    return {
      categoryId,
      baselineVersion: "fixture-baseline-1",
      attributes: fixtureSnapshot().attributes,
      bindings: fixtureSnapshot().families[0]!.bindings.map((b) => ({
        ...b,
        categoryId,
        baselineAttributeId: b.attributeId,
      })),
      unresolved: ["构造样例，需人工判定必要性"],
    };
  if (stage === "sku-filling")
    return {
      categoryId,
      productId: "fixture-sku",
      values: fixtureValues(),
      unresolved: [],
    };
  if (stage === "review-assistance")
    return {
      categoryId,
      findings: [
        {
          ruleId: "R18",
          objectId: "fixture-candidate",
          severity: "medium",
          issue: "构造候选仍需人工采用，离线模拟不证明审核能力",
          references: [],
        },
      ],
      unresolved: ["尚未进行真实业务和小屏验收"],
    };
  return {
    categoryId,
    knowledgeIdsConsulted: ["clean-paper-fixture"],
    questions: [
      {
        topic: "重量口径",
        impact: "不可将净重与标称重量直接合并",
        references: [],
        needsProfessionalReview: true,
      },
    ],
    proposedFamilyIds: ["fixture-roll-family"],
    unresolved: ["专业模板未发布"],
  };
}
export function functionCall(
  name: string,
  args: unknown,
  callId = "fixture-call-1",
): InputItem {
  return {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}
export function finalMessage(value: unknown): InputItem {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: JSON.stringify(value) }],
  };
}
export function scriptedFetch(
  responses: (InputItem[] | ((request: any) => InputItem[]))[],
) {
  const requests: any[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    if (url !== "https://api.deepseek.com/responses")
      throw Error("unexpected endpoint");
    const request = JSON.parse(init.body);
    requests.push(jsonClone(request));
    const step = responses[index++];
    if (!step) throw Error("unexpected request: no mock response remains");
    return new Response(
      JSON.stringify({
        status: "completed",
        output: typeof step === "function" ? step(request) : step,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      { status: 200 },
    );
  };
  return { fetch, requests };
}
export function happyScript(stage: Stage) {
  let call =
    stage === "sku-filling"
      ? functionCall("calculate_value", {
          attributeId: "fixture-total",
          derivation: fixtureValues()[2]!.derivation,
        })
      : stage === "domain-research"
        ? functionCall("find_related_categories", {
            id: "fixture-cored-category",
            limit: 10,
            cursor: null,
          })
        : stage === "family-modeling"
          ? functionCall("get_family_context", {
              categoryId: "fixture-cored-category",
              limit: 10,
              cursor: null,
            })
          : functionCall("sources_read", {
              id: "fixture-source",
              offset: 0,
              length: 8000,
            });
  return scriptedFetch([
    (request) => {
      if (stage === "sku-filling") {
        const input = JSON.parse(request.input[0].content);
        const target = input.contractAttributes.find(
          (a: any) => a.id === "fixture-total",
        );
        const policy = input.sharedContext.calculationPolicies
          .flatMap((p: any) => p.items)
          .find(
            (p: any) =>
              p.targetConceptKey === target.conceptKey &&
              p.targetUnit === target.unit,
          );
        if (!policy)
          throw Error(
            "calculation policy was not discoverable in actual request",
          );
        const inputs = policy.factors.map((factor: any) => {
          for (const s of input.evidence) {
            const fact = s.facts.find(
              (f: any) =>
                f.conceptKey === factor.conceptKey &&
                f.unit === factor.unit &&
                f.scope === target.scope,
            );
            if (fact) return { sourceId: s.id, factId: fact.id };
          }
          throw Error("required policy factor absent from actual request");
        });
        call = functionCall("calculate_value", {
          attributeId: target.id,
          derivation: {
            policyId: policy.id,
            policyVersion: policy.version,
            operator: policy.operator,
            targetUnit: policy.targetUnit,
            inputs,
          },
        });
      }
      return [
        {
          type: "reasoning",
          content: [
            { type: "reasoning_text", text: "offline fixture reasoning" },
          ],
        },
        call,
      ];
    },
    (request) => {
      const returned = request.input.find(
        (i: any) =>
          i.type === "function_call_output" && i.call_id === call.call_id,
      );
      if (
        !returned ||
        !request.input.some(
          (i: any) => i.type === "function_call" && i.call_id === call.call_id,
        ) ||
        !request.input.some((i: any) => i.type === "reasoning")
      )
        throw Error("stateless tool history/return missing");
      const result = fixtureOutput(stage);
      if (stage === "sku-filling")
        result.values[2].value = JSON.parse(returned.output).value;
      return [finalMessage(result)];
    },
  ]);
}
