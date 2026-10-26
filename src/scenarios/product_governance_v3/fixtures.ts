import { needsQuantityMapping, definitionFingerprint, type ModelingDecision } from "./modeling-contract.ts";
import { MODELING_PROPOSAL_VERSION } from "./modeling-proposal.ts";
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

// Historical regression setup only. prepareBatch builds today's default input;
// these recordings predate the user's core approval and must retain their old
// permission/evidence boundary. Never call this when preparing a real round.
export function preCoreReplaySnapshot(snapshot: Snapshot): Snapshot {
  const data = jsonClone(snapshot);
  const added = new Set(["wash-tissue-core-review-20261026", "native-quantity-carrier-20261026",
    "scm-field-responsibilities-compact-20261026"]);
  data.knowledgeIds = data.knowledgeIds.filter(id => !added.has(id));
  data.knowledgeRequirements = data.knowledgeRequirements
    .filter(r => r.id !== "wash-tissue-core-review-20261026")
    .map(r => ({ ...r, knowledgeIds: r.knowledgeIds.map(id => id === "scm-field-responsibilities-compact-20261026"
      ? "scm-field-responsibilities-20261022" : id) }));
  data.attributeApplicability = data.attributeApplicability?.filter(r => r.reviewKind !== "authorized_offline");
  // Before this review the default profile supplied definitions through families,
  // not standalone copies injected for selected categories outside those families.
  data.attributes = data.attributes.filter(a => !["roll.layers", "roll.raw_material", "roll.sheet_size"].includes(a.id));
  return data;
}

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
    requirednessReason: "构造样例：强制填写必要性尚未核实，先选填",
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
    systemFields: [...jsonClone(REQUIRED_SYSTEM_OWNERS), {key: "unitMin", names: ["最小计量单位"], conceptKeys: ["sales.min_unit"]}],
    systemFieldCoverage: {
      version: "fixture-ownership-1",
      source: "constructed fixture; not a production inventory",
      sourceHash: "pending",
      status: "complete",
      coveredKeys: ["brandId", "supplierId", "salesUnit", "specName", "unitMin"],
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
      stage === "sku-filling" ||
      stage === "review-assistance" ||
      stage === "fact-extraction"
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
  if (stage === "fact-extraction") {
    const s = fixtureSnapshot().sources[0]!,
      quote = "层数3层",
      start = s.text.indexOf(quote);
    return {
      categoryId,
      productId: "fixture-sku",
      candidates: [
        {
          id: "fixture-extracted-layer",
          attributeId: "fixture-layers",
          sourceId: s.id,
          sourceVersion: s.version,
          start,
          end: start + quote.length,
          quote,
          value: 3,
          normalization: "identity",
          rationale: "构造原文定位",
        },
      ],
      unresolved: ["构造提取仅验证接线，仍需人工核实"],
    };
  }
  if (stage === "family-modeling")
    return withFixtureDecisions({
      categoryId,
      baselineVersion: "fixture-baseline-1",
      attributes: fixtureSnapshot().attributes,
      bindings: fixtureSnapshot().families[0]!.bindings.map((b) => ({
        ...b,
        categoryId,
        baselineAttributeId: b.attributeId,
      })),
      extensionCandidates: fixtureSnapshot().families[0]!.extensionCandidates ?? [],
      unresolved: ["构造样例，需人工判定必要性"],
    });
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

// Explicit annotations for constructed/offline test responses. Not a model-result migration.
// Decision tests explicitly override the facts under test; these annotations are never evidence of business correctness.
export function withFixtureDecisions<T extends {attributes: any[]; bindings: any[]; extensionCandidates: any[]}>(output: T): T & {decisions: ModelingDecision[]} {
  return {...output, decisions: [...output.attributes, ...output.extensionCandidates].map(item => {
    const admitted = output.attributes.some(a => a.id === item.id);
    return {
      objectId: item.id, disposition: admitted ? "admitted" : "extension",
      businessNeed: admitted ? "confirmed" : "pending", admissionBasis: "business_need",
      businessReason: "离线构造的业务决策注释，仅用于检查接线，不是已完成人工确认",
      requiredNecessity: output.bindings.find(b => b.attributeId === item.id)?.requiredness === "required" ? "confirmed" : "pending",
      requirednessBasis: "business_need", professionalReadiness: admitted ? "defined" : "pending",
      professionalReason: "离线构造的定义就绪注释；不代表真实专业验收", valueEvidence: "unassessed",
      quantity: needsQuantityMapping(item) ? {
        measure: "contents_per_package", countedObject: "构造纸张", denominator: "package", countTerms: ["张"],
        systemFieldKeys: ["unitMin"], relation: "conditional", sameWhen: "销售单位=包且最小单位=张，口径相同",
        differentWhen: "销售单位=提且最小单位=包，包内张数是另一个参数", overlapAction: "reuse_system_field",
        reason: "仅构造两种单位层级，用于离线检查；不从商品缺值推导准入",
      } : null,
    } as ModelingDecision;
  })};
}

// Test-author convenience only: encode explicitly synthetic expected output as
// the requested wire shape. Not used by runtime or for migrating recorded results.
export function fixtureWireResult(full: any, request: any) {
  const input = JSON.parse(request.input[0].content);
  if (input.task.candidate?.modelingContractVersion !== MODELING_PROPOSAL_VERSION) return full;
  const base = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable);
  const inherited = new Set((base?.attributes ?? []).map((a: any) => a.id));
  const pool = input.sharedContext.attributePool.items.filter((a: any) => a.kind !== "context_definition_reference");
  const reused = full.attributes.filter((a: any) => !inherited.has(a.id) &&
    pool.some((p: any) => p.id === a.id && definitionFingerprint(p) === definitionFingerprint(a)));
  const omit = (value: any, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));
  return {
    contractVersion: MODELING_PROPOSAL_VERSION, baselineVersion: full.baselineVersion,
    reuse: reused.map((a: any) => ({ attributeId: a.id, definitionHash: definitionFingerprint(a) })),
    newAttributes: full.attributes.filter((a: any) => !reused.some((p: any) => p.id === a.id) && (!inherited.has(a.id) ||
      hash(a) !== hash(base.attributes.find((b: any) => b.id === a.id))))
      .map((a: any) => omit(a, ["valueLevel", "defaultValue"])),
    newBindings: full.bindings.filter((b: any) => !inherited.has(b.attributeId))
      .map((b: any) => omit(b, ["categoryId", "baselineAttributeId"])),
    newExtensionCandidates: full.extensionCandidates.filter((c: any) =>
      !base?.extensionCandidates?.some((e: any) => hash(e) === hash(c))).map((c: any) => ({
        ...omit(c, ["activationCriteria"]), activationRequirements: [{ kind: "professional_definition", question: c.activationCriteria }],
      })),
    decisions: full.decisions.filter((d: any) => !base?.decisions?.some((b: any) => b.objectId === d.objectId)).map((d: any) => ({
      ...omit(d, ["admissionBasis", "requirednessBasis", "quantity"]), quantity: d.quantity
        ? omit(d.quantity, ["systemFieldKeys", "denominator", "sameWhen", "differentWhen", "overlapAction"]) : null,
    })),
    revisionRequests: [], unresolved: full.unresolved,
  };
}

// Synthetic output for the approved *coverage*, not a real model or adopted definitions.
// Test callers use this explicitly; raw recorded results must never pass through it.
export function fixtureCoreAttributes(input: any): AttributeDefinition[] | null {
  const core = input.sharedContext.coreScope?.groups.flatMap((g: any) => g.core);
  if (!core) return null;
  return core.map((c: any) => {
    if (c.sharedAttributeId) {
      const a = input.sharedContext.attributePool.items.find((a: any) => a.id === c.sharedAttributeId && !a.kind);
      if (!a) throw Error("reviewed shared definition not present in actual input: " + c.sharedAttributeId);
      return jsonClone(a);
    }
    return attribute({ id: "constructed." + c.conceptKey, name: c.name, conceptKey: c.conceptKey,
      fieldType: c.fieldType, scope: c.scope,
      definition: c.name === "内装数量" ? (c.conceptKey.startsWith("facial.") ? "一盒或一包抽取式面巾纸的抽取次数或成品纸张数，保留抽/张及分母，不乘层数；同原生口径时复用基础字段" :
        "一包或一盒成品洗脸巾的片数或原计数数量，保留来源片/张/抽及分母；不把片数换算为纸张抽数；同原生口径时复用基础字段") :
        c.name === "单张尺寸" ? "单片成品洗脸巾的组合尺寸原文，保留单位与来源状态，不改为纸张或包装尺寸" :
        "成品洗脸巾与皮肤接触基材的原文，不把纸浆定义用于非织造柔巾；仅构造验收",
      rationale: "用户确认核心范围内的构造模型回答，仅供离线检查，非已采用定义" });
  });
}
