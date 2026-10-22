import { resolve, join } from "node:path";
import {
  read,
  save,
  hash,
  factPreparationHash,
  type Snapshot,
  type Source,
  type AttributeDefinition,
  type AttributeBinding,
} from "./core.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ROLL_CATEGORIES, type ReadCapture } from "./scm-readonly.ts";
import { systemFieldsFromInventory, fieldRole } from "./scm-field-inventory.ts";
import { loadRelease } from "./release.ts";
import { runStage } from "./runner.ts";
import { Budget } from "./budget.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import type { FactExtraction } from "./fact-preparation.ts";

export const PILOT_RUN = "roll-real-pilot-20261022";
export const PAPER_KNOWLEDGE = "small-roll-paper-research-20261022";
export const FIELD_KNOWLEDGE = "scm-field-responsibilities-20261022";
// Agent proposal grounded in the research pack; not an approved family publication.
export async function rollDefinitions(): Promise<AttributeDefinition[]> {
  const release = await loadRelease(),
    k = release.knowledge[PAPER_KNOWLEDGE]!;
  const rows = [
    [
      "coreless",
      "是否无芯",
      "boolean",
      null,
      "single-roll-core",
      "纸卷是否没有纸芯；两类共用，值不可由类目名代填",
      "有芯和无芯小卷纸应先使用同一组共同定义。",
    ],
    [
      "layers",
      "层数",
      "number",
      "层",
      "finished-paper-ply",
      "成品纸张叠层数量，不是包装或托盘层数",
      "层数是成品纸张叠层；不能与托盘层数、包装层级混淆。",
    ],
    [
      "declared_mass",
      "单卷标称质量",
      "number",
      "g",
      "single-roll-declared-mass",
      "来源明确按一卷标称的质量；不宣称去芯净纸重或实测",
      "单卷标称质量表示来源明确按一卷标称的质量。",
    ],
    [
      "raw_material",
      "原料描述",
      "text",
      null,
      "finished-paper-material",
      "商家对原料的原文描述，不能由品牌推定",
      "原料描述保留商家确切措辞",
    ],
    [
      "sheet_size",
      "纸张尺寸",
      "text",
      null,
      "finished-paper-sheet-size",
      "单张纸尺寸完整文本；不猜轴向或包装尺寸",
      "纸张尺寸与纸卷尺寸、包装尺寸分开",
    ],
    [
      "perforation",
      "单卷分节规格",
      "text",
      null,
      "single-roll-perforation",
      "来源明示的每卷节/格/张数量与单位合并文本；不偷做等价转换",
      "单卷分节数量可按已明示的“260张/卷”“280格/卷”保留规范文本",
    ],
    [
      "printed",
      "是否印花",
      "boolean",
      null,
      "finished-paper-print",
      "纸张是否印花；与压花分别核实",
      "印花和压花是不同工艺",
    ],
    [
      "embossed",
      "是否压花",
      "boolean",
      null,
      "finished-paper-emboss",
      "纸张是否压花；未说明不是否",
      "印花和压花是不同工艺",
    ],
    [
      "fragrance",
      "香型描述",
      "text",
      null,
      "finished-paper-fragrance",
      "保留原文香型，未说明不补无香",
      "无相关文字不等于否",
    ],
  ] as const;
  const rationales: Record<string, string> = {
    coreless: "区分纸芯结构，便于纸架选型及同族对照；必要性待核实",
    layers: "对照成品纸张叠层；不以层数推定质量",
    declared_mass: "按明确的单卷标称量比较，避免与商品物流重量混用",
    raw_material: "按原料声明检索；保留厂商措辞，不推断检测结论",
    sheet_size: "比较单张纸尺寸，避免误用包装尺寸",
    perforation: "按每卷分节规格比较；保留原计数口径",
    printed: "展示印花工艺，与压花分别说明",
    embossed: "比较压花工艺，不把印花当作压花",
    fragrance: "按原文香型供选择与搜索；缺失不默认无香",
  };
  return rows.map(([key, name, fieldType, unit, scope, definition, quote]) => ({
    id: "roll." + key,
    name,
    conceptKey: "paper." + key,
    definition,
    scope,
    fieldType,
    unit,
    enumValues: [],
    multi: false,
    valueLevel: "SKU",
    numberConfig:
      fieldType === "number"
        ? {
            isInt: key === "layers",
            precision: key === "layers" ? null : 3,
            min: key === "layers" ? 1 : 0,
            max: null,
          }
        : null,
    textConfig:
      fieldType === "text"
        ? {
            format: "ANY",
            minLength: 1,
            maxLength: 300,
            displayMethod: null,
            trim: true,
          }
        : null,
    optionConfig: null,
    defaultValue: null,
    rationale: rationales[key]!,
    references: [
      { kind: "knowledge", id: PAPER_KNOWLEDGE, version: k.sha256, quote },
    ],
  }));
}
export function rollBindings(attrs: AttributeDefinition[]): AttributeBinding[] {
  return attrs.map((a, i) => ({
    attributeId: a.id,
    categoryId: null,
    requiredness: "optional",
    requirednessReason: "业务必要性尚未核实，先选填；不按样本覆盖率设必填",
    isKeySpec: false,
    isPublic: true,
    searchable: a.fieldType === "text",
    displayInTitle: false,
    displayInList: false,
    sortIndex: i + 1,
    uses: [
      "selection",
      "comparison",
      "display",
      ...(a.fieldType === "text" ? ["search" as const] : []),
    ],
    baselineAttributeId: null,
    differenceReason: null,
  }));
}

export function typedNativeValue(v: any) {
  const type = v.propertyInstance?.valueType?.toLowerCase();
  if (
    !type ||
    !["string", "number", "boolean", "option", "date", "file"].includes(type)
  )
    throw Error("unregistered native valueType");
  return { field: type + "Value", value: v[type + "Value"] };
}
export async function prepareRollPilot(
  captureDir: string,
  outDir: string,
  treePath: string,
) {
  const tree = await read<any>(treePath),
    roots = tree.nodes as any[];
  for (const c of ROLL_CATEGORIES) {
    const n = roots.find((n) => n.id === c.id);
    if (
      !n ||
      n.standardCategoryId !== c.standardCategoryId ||
      n.name !== c.name
    )
      throw Error("governance/standard category mapping mismatch");
  }
  const captures = await Promise.all(
    ROLL_CATEGORIES.map((c) =>
      read<ReadCapture>(resolve(captureDir, "raw", c.id + ".json")),
    ),
  );
  const manifest = await read<any>(
    resolve(captureDir, "capture-manifest.json"),
  );
  const details = await read<ReadCapture>(
    resolve(captureDir, "raw/details.json"),
  );
  const all = [...captures, details];
  if (
    all.some(
      (c) =>
        c.format !== 1 ||
        c.kind !== "scm_readonly_capture" ||
        c.responseHash !== hash(c.response) ||
        c.endpoint !== `https://sc.sanheng.com/api/external/${c.action}`,
    )
  )
    throw Error("read capture corrupted");
  if (
    captures.some((c) => c.action !== "getProductListByStdCategoryIds") ||
    details.action !== "getProductInfo"
  )
    throw Error("wrong capture action");
  const selected = captures.flatMap((c) => (c.response as any).items);
  if (
    !selected.length ||
    selected.length > 6 ||
    hash(selected.map((p) => p.id)) !== hash(manifest.selectedIds)
  )
    throw Error("invalid bounded real capture");
  const attrs = await rollDefinitions(),
    sources: Source[] = [],
    products: Snapshot["products"] = [],
    origins: any[] = [],
    nativeFields: any[] = [],
    skuRows: any[] = [],
    issues: any[] = [];
  for (let ci = 0; ci < captures.length; ci++) {
    const capture = captures[ci]!,
      category = ROLL_CATEGORIES[ci]!;
    if (
      hash(capture.request) !==
      hash({
        stdCategoryIds: [category.standardCategoryId],
        page: 1,
        pageSize: manifest.perCategory,
      })
    )
      throw Error("capture query namespace/scope drift");
    for (const [pi, item] of (capture.response as any).items.entries()) {
      if (
        item.standardCategoryId !== category.standardCategoryId ||
        item.standardCategory.id !== category.standardCategoryId ||
        item.standardCategory.name !== category.name
      )
        throw Error("captured SKU category mapping drift");
      const detail = (details.response as any[]).find((d) => d.sku === item.id);
      if (!detail || !item.productInstanceId)
        throw Error("missing native detail/archive identity");
      const salesUnitId = "native-sales-instance:" + item.productInstanceId;
      const product = {
        id: item.id,
        categoryId: category.id,
        salesUnitId,
        composition: "unknown" as const,
        giftState: "unknown" as const,
        assumptionSourceIds: [],
        sourceIds: [] as string[],
      };
      const values = item.propertyValueInstanceOnProductInstances as any[];
      for (const [vi, link] of values.entries()) {
        const v = link.propertyValueInstance,
          def = v.propertyInstance,
          typed = typedNativeValue(v),
          key = def.key ?? "",
          title = def.title ?? "";
        const role =
          fieldRole(key) === "unresolved"
            ? ((
                {
                  规格参数: "evidence_container",
                  节能商品类型: "base_business",
                  质保说明: "base_business",
                  商品类型: "base_business",
                  备注: "technical",
                  是否信创: "base_business",
                  容量: "legacy_parameter",
                  包装清单: "base_business",
                  是否臻选年礼: "base_business",
                  主站上下架状态: "base_business",
                } as Record<string, string>
              )[title] ?? "unresolved")
            : fieldRole(key);
        nativeFields.push({
          category: category.name,
          propertyId: def.propertyId,
          propertyInstanceId: def.id,
          key,
          title,
          valueType: def.valueType,
          asSpec: def.asSpec,
          role,
          reason:
            role === "legacy_parameter"
              ? "旧业务参数不自动复用为新标准"
              : role === "unresolved"
                ? "职责待查，不自动治理"
                : "职责按来源字段与对象判定；存于属性表不等于治理参数",
          sourceHash: capture.responseHash,
        });
        const eligible =
          [
            "title",
            "MAIN_TITLE",
            "saleSpec",
            "SPEC_TITLE",
            "OTHER_ATTR",
            "parameter",
            "DETAIL_PARAMS",
            "detailText",
            "detailHtml",
            "DETAIL_HTML",
          ].includes(key) || title === "规格参数";
        if (!eligible || typeof typed.value !== "string" || !typed.value.trim())
          continue;
        // Image-only HTML and link lists remain in raw captures; do not manufacture textual evidence from them.
        if (
          (key === "DETAIL_HTML" ||
            key === "detailHtml" ||
            key === "parameter") &&
          !typed.value
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]*>/g, "")
            .trim()
        )
          continue;
        const id =
            "native-source:" +
            hash([item.productInstanceId, def.id, v.id]).slice(0, 24),
          text = `原始字段：${title} [${key || "无key"}]\n原文：${typed.value}`;
        const origin = {
          sourceId: id,
          productId: item.id,
          productInstanceId: item.productInstanceId,
          governanceCategoryId: category.id,
          standardCategoryId: category.standardCategoryId,
          categoryInstanceId: item.categoryInstanceId ?? null,
          stableMountedCategoryId: item.categoryInstance?.categoryId ?? null,
          propertyId: def.propertyId,
          propertyInstanceId: def.id,
          propertyValueInstanceId: v.id,
          jsonPointer: `/items/${pi}/propertyValueInstanceOnProductInstances/${vi}/propertyValueInstance/${typed.field}`,
          capturePath: resolve(captureDir, "raw", category.id + ".json"),
          captureHash: capture.responseHash,
          rawValueHash: hash(typed.value),
          capturedAt: capture.capturedAt,
          sourceKind:
            ["OTHER_ATTR", "parameter", "DETAIL_PARAMS"].includes(key) ||
            title === "规格参数"
              ? "legacy_parameter_evidence"
              : "native_original_field",
          derivedText: false,
        };
        const source: Source = {
          id,
          productId: item.id,
          salesUnitId,
          version: hash(origin),
          text,
          facts: [],
          origin,
          factPreparation: {
            status: "candidate",
            kind: "agent",
            recordId: "raw-source:" + hash(origin),
            contentHash: "pending",
          },
        };
        source.factPreparation.contentHash = factPreparationHash(source);
        sources.push(source);
        product.sourceIds.push(id);
        origins.push(origin);
      }
      products.push(product);
      const byKey = (keys: string[]) =>
        values
          .filter((z) =>
            keys.includes(z.propertyValueInstance.propertyInstance.key),
          )
          .map((z) => typedNativeValue(z.propertyValueInstance).value)
          .find((v) => v !== null && v !== undefined && v !== "");
      const title = byKey(["title", "MAIN_TITLE"]),
        spec = byKey(["saleSpec", "SPEC_TITLE"]),
        saleUnit = byKey(["saleUnit", "SPEC_UNITS"]);
      skuRows.push({
        label:
          (category.name === "有芯小卷纸" ? "有芯" : "无芯") +
          String((capture.response as any).items.indexOf(item) + 1),
        productId: item.id,
        categoryId: category.id,
        categoryName: category.name,
        title,
        spec,
        saleUnit,
        productInstanceId: item.productInstanceId,
        categoryInstanceId: item.categoryInstanceId,
        stableMountedCategoryId: item.categoryInstance?.categoryId ?? null,
        mountedCategoryName: item.categoryInstance?.name ?? null,
        standardCategoryId: category.standardCategoryId,
        sourceBucket: item.categoryInstance?.category?.bucket ?? null,
        status: {
          isSkuEnable: item.isSkuEnable,
          skuSaleStatus: item.skuSaleStatus,
          isSpuEnable: item.isSpuEnable,
          spuSaleStatus: item.spuSaleStatus,
        },
        detailAgreesWithRawTitle: detail.title === title,
      });
      if (detail.title !== title)
        issues.push({
          productId: item.id,
          kind: "detail_title_mapping",
          issue: "聚合详情标题与原生字段不同，保留两份来源核实",
        });
      if (saleUnit === "个" && /27卷/.test(String(spec)))
        issues.push({
          productId: item.id,
          kind: "base_sales_unit",
          issue:
            "销售单位为个，规格名称含27卷；基础字段销售口径待核实，不能自动换算或新增销售总数量属性",
        });
      if (category.name === "无芯小卷纸")
        issues.push({
          productId: item.id,
          kind: "core_structure_unproven",
          issue:
            "当前分类无芯，但所读文字未明示无芯；实际挂载上游目录与治理类目不同，不自动补值或重挂",
        });
    }
  }
  if (nativeFields.some((f) => f.role === "unresolved"))
    throw Error("sample contains unclassified native field responsibilities");
  const inventory = await read<any>(
      resolve(import.meta.dir, "scm-field-responsibilities.json"),
    ),
    fields = systemFieldsFromInventory(inventory, nativeFields);
  const snapshot: Snapshot = {
    format: 2,
    version: "raw-roll-pilot:" + hash(all.map((c) => c.responseHash)),
    kind: "local",
    tree: { nodes: roots, rootId: tree.rootId },
    systemFields: fields,
    systemFieldCoverage: {
      version: hash(fields),
      source:
        "scm-field-responsibilities.json + pilot-native-fields.json; complete only within declared code/6-SKU scope, business review pending",
      sourceHash: hash(fields),
      status: "complete",
      coveredKeys: fields.map((f) => f.key),
    },
    families: [
      {
        id: "candidate-small-roll-family",
        version: hash(attrs),
        members: ROLL_CATEGORIES.map((c) => c.id),
        status: "candidate",
        runId: PILOT_RUN,
        attributes: attrs,
        bindings: rollBindings(attrs),
      },
    ],
    attributes: attrs,
    sources,
    products,
    knowledgeIds: [PAPER_KNOWLEDGE, FIELD_KNOWLEDGE],
    knowledgeRequirements: [
      {
        id: "roll-pilot-required-input",
        categoryIds: ROLL_CATEGORIES.map((c) => c.id),
        stages: [
          "family-modeling",
          "fact-extraction",
          "sku-filling",
          "domain-research",
          "review-assistance",
        ],
        knowledgeIds: [PAPER_KNOWLEDGE, FIELD_KNOWLEDGE],
        reason:
          "两类样板需实际读取纸品专业口径和供应链完整职责资料；知识仍待专家/业务人审",
      },
    ],
    derivationPolicies: [],
  };
  new DataSnapshot(snapshot);
  await save(join(outDir, "snapshot.raw.json"), snapshot);
  await save(join(outDir, "source-origins.json"), origins);
  await save(join(outDir, "pilot-native-fields.json"), [
    ...new Map(nativeFields.map((f) => [f.propertyInstanceId, f])).values(),
  ]);
  await save(join(outDir, "pilot-skus.json"), skuRows);
  await save(join(outDir, "input-issues.json"), issues);
  await save(join(outDir, "preparation-manifest.json"), {
    kind: "real_readonly_input",
    treePath: resolve(treePath),
    treeHash: hash(tree),
    captureHashes: all.map((c) => c.responseHash),
    snapshotVersion: new DataSnapshot(snapshot).version,
    skuCount: products.length,
    sourceCount: sources.length,
    fieldInventoryId: FIELD_KNOWLEDGE,
    professionalKnowledgeId: PAPER_KNOWLEDGE,
    agentProposalStatus: "pending_human",
    modelCalls: 0,
    productionWrites: 0,
  });
  return {
    skuCount: products.length,
    sourceCount: sources.length,
    nativeFieldCount: new Set(nativeFields.map((f) => f.propertyInstanceId))
      .size,
  };
}

// A recorded agent proposal exercises the production runner. It is not a live DeepSeek evaluation.
export async function replayRollExtraction(
  snapshotPath: string,
  proposalsPath: string,
  outDir: string,
) {
  const snapshot = new DataSnapshot(await read(snapshotPath)),
    release = await loadRelease();
  const proposals = await read<{
    kind: string;
    author: string;
    results: FactExtraction[];
  }>(proposalsPath);
  if (
    proposals.kind !== "recorded_agent_proposals" ||
    !proposals.author ||
    proposals.results.length !== snapshot.data.products.length ||
    new Set(proposals.results.map((r) => r.productId)).size !==
      proposals.results.length
  )
    throw Error(
      "explicit recorded agent proposal for each selected SKU required",
    );
  const results = [],
    familyModels = [];
  for (const c of ROLL_CATEGORIES) {
    const family = snapshot.data.families[0]!,
      dir = join(outDir, "family", c.id);
    let round = 0;
    const client = new ResponsesClient(
      {
        mode: "offline",
        transportId: "recorded-family-agent:" + hash(proposals),
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          const output =
            round++ === 0
              ? [
                  {
                    type: "function_call",
                    name: "get_family_context",
                    call_id: "family-pilot-read",
                    arguments: JSON.stringify({
                      categoryId: c.id,
                      limit: 50,
                      cursor: null,
                    }),
                  },
                ]
              : [
                  {
                    type: "message",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          categoryId: c.id,
                          baselineVersion: family.version,
                          attributes: family.attributes,
                          bindings: family.bindings.map((b) => ({
                            ...b,
                            categoryId: c.id,
                            baselineAttributeId: b.attributeId,
                          })),
                          unresolved: [
                            "Codex研究提案，两类9项共用定义均选填，必要性和专业适用性待人工采用；未发布为业务标准",
                          ],
                        }),
                      },
                    ],
                  },
                ];
          if (
            round === 2 &&
            !body.input.some(
              (i: any) =>
                i.type === "function_call_output" &&
                i.call_id === "family-pilot-read",
            )
          )
            throw Error("family context tool return disconnected");
          return new Response(JSON.stringify({ status: "completed", output }), {
            status: 200,
          });
        },
      },
      dir,
      new Budget(dir, 0, "roll-pilot-offline"),
    );
    familyModels.push(
      await runStage({
        release,
        snapshot,
        task: {
          runId: PILOT_RUN,
          stage: "family-modeling",
          categoryId: c.id,
          productId: null,
          question:
            "核对有芯/无芯共用研究候选定义与独立绑定，不以样本覆盖率决定业务必要性；人工采用前不发布。",
          candidate: null,
        },
        client,
        outDir: dir,
      }),
    );
  }
  for (const p of snapshot.data.products) {
    const result = proposals.results.find((r) => r.productId === p.id);
    if (!result) throw Error("missing SKU proposal");
    let round = 0;
    const fetcher: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body),
        context = JSON.parse(body.input[0].content);
      if (
        context.sharedContext.snapshotKind !== "local" ||
        !context.sharedContext.knowledge.some(
          (k: any) => k.id === PAPER_KNOWLEDGE,
        ) ||
        !context.sharedContext.knowledge.some(
          (k: any) => k.id === FIELD_KNOWLEDGE,
        ) ||
        !context.evidence.length ||
        !context.contractAttributes?.length
      )
        throw Error("real extraction context/knowledge/contract disconnected");
      const output =
        round++ === 0
          ? [
              {
                type: "function_call",
                name: "sources_read",
                call_id: "real-pilot-read",
                arguments: JSON.stringify({
                  id: p.sourceIds[0],
                  offset: 0,
                  length: 8000,
                }),
              },
            ]
          : [
              {
                type: "message",
                role: "assistant",
                content: [
                  { type: "output_text", text: JSON.stringify(result) },
                ],
              },
            ];
      if (
        round === 2 &&
        !body.input.some(
          (i: any) =>
            i.type === "function_call_output" &&
            i.call_id === "real-pilot-read",
        )
      )
        throw Error("source tool result not returned");
      return new Response(JSON.stringify({ status: "completed", output }), {
        status: 200,
      });
    };
    const dir = join(outDir, p.id),
      client = new ResponsesClient(
        {
          mode: "offline",
          transportId: "recorded-agent:" + hash(proposals),
          fetch: fetcher,
        },
        dir,
        new Budget(dir, 0, "roll-pilot-offline"),
      );
    const artifact = await runStage({
      release,
      snapshot,
      task: {
        runId: PILOT_RUN,
        stage: "fact-extraction",
        categoryId: p.categoryId,
        productId: p.id,
        question:
          "按共同合同从本SKU冻结原文字段提取候选，定位并保留冲突、未知；人工核实前不授权known。",
        candidate: null,
      },
      client,
      outDir: dir,
    });
    results.push(artifact);
  }
  const report = {
    kind: "real_input_recorded_agent_offline_replay",
    author: proposals.author,
    familyModels,
    results,
    realSkuCount: snapshot.data.products.length,
    liveDeepSeekCalls: 0,
    productionWrites: 0,
    humanAdoptions: 0,
  };
  await save(join(outDir, "pilot-replay.json"), report);
  return {
    realSkuCount: report.realSkuCount,
    programBlocked: [...results, ...familyModels].filter(
      (r) => r.checks.errors.length,
    ).length,
    candidateCount: results.reduce(
      (s, r) => s + (r.factPreparation?.candidates.length ?? 0),
      0,
    ),
    familyModels: familyModels.length,
    liveDeepSeekCalls: 0,
    productionWrites: 0,
  };
}
