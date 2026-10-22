import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const dir = resolve(
  process.argv[2] || "outputs/product-governance-v3/roll-real-pilot-20261022",
);
const load = async (p) => JSON.parse(await fs.readFile(join(dir, p), "utf8"));
const snapshot = await load("prepared/snapshot.raw.json"),
  skus = await load("prepared/pilot-skus.json"),
  nativeFields = await load("prepared/pilot-native-fields.json"),
  inputIssues = await load("prepared/input-issues.json"),
  replay = await load("replay/pilot-replay.json");
const inventory = JSON.parse(
  await fs.readFile(
    new URL("../scm-field-responsibilities.json", import.meta.url),
    "utf8",
  ),
);
const canonical = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}";
const digest = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : canonical(v))
    .digest("hex");
const lock = JSON.parse(
  await fs.readFile(new URL("../release.lock.json", import.meta.url), "utf8"),
);
if (
  [...replay.results, ...replay.familyModels].some(
    (r) =>
      r.releaseId !== lock.id ||
      r.manifest.snapshotVersion !== digest(snapshot),
  )
)
  throw Error(
    "review export source/release drift; regenerate the offline replay",
  );
if (
  replay.results.some((r) => r.checks.errors.length) ||
  replay.familyModels.some((r) => r.checks.errors.length)
)
  throw Error("blocked candidates cannot become a review workbook");
const wb = Workbook.create(),
  out = join(dir, "review"),
  sourceDir = join(out, "source-text");
await fs.mkdir(sourceDir, { recursive: true });
const sheets = new Map(
  ["事实审阅", "同族属性", "SKU与问题", "字段职责", "原文材料"].map((n) => [
    n,
    wb.worksheets.add(n),
  ]),
);
const col = (i) => {
  let s = "";
  for (i++; i; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const text = (v) => (typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : v);
function table(name, title, subtitle, headers, rows, widths, header = 6) {
  const s = sheets.get(name),
    last = header + rows.length,
    end = col(headers.length - 1);
  const area = s.getRange(`A1:${end}${last}`);
  area.format.font = { name: "Arial", size: 11, color: "#202B3B" };
  area.format.verticalAlignment = "center";
  area.format.wrapText = true;
  s.showGridLines = false;
  s.getRange("A2").values = [[title]];
  s.getRange("A2").format.font = {
    name: "Arial",
    size: 15,
    bold: true,
    color: "#263D5A",
  };
  s.getRange("A2:H2").format.wrapText = false;
  s.getRange("A3").values = [[subtitle]];
  s.getRange("A3:H3").format.wrapText = false;
  s.getRange("A3").format.font = { name: "Arial", size: 10, color: "#586579" };
  s.getRange(`A${header}:${end}${last}`).values = [headers, ...rows].map((r) =>
    r.map(text),
  );
  const t = s.tables.add(
    `A${header}:${end}${last}`,
    true,
    "PilotTable" + (sheets.size + [...sheets.keys()].indexOf(name)),
  );
  t.showFilterButton = true;
  s.getRange(`A${header}:${end}${header}`).format = {
    fill: "#334B6D",
    font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    rowHeightPx: 38,
  };
  widths.forEach((w, i) => {
    s.getRange(`${col(i)}1:${col(i)}${last}`).format.columnWidthPx = w;
  });
  s.getRange(`A${header + 1}:${end}${last}`).format.autofitRows();
  s.freezePanes.freezeRows(header);
  s.freezePanes.freezeColumns(1);
  s.getRange("A1:H1").format.rowHeightPx = 8;
  s.getRange("A2:H2").format.rowHeightPx = 27;
  s.getRange("A3:H3").format.rowHeightPx = 21;
  return { s, last };
}
const sourceRows = [],
  sourceRow = new Map(),
  nativeLinks = [];
for (const source of snapshot.sources) {
  const sku = skus.find((s) => s.productId === source.productId),
    path = join(sourceDir, source.id.replaceAll(":", "_") + ".txt");
  await fs.writeFile(path, source.text);
  const body = source.text.split("\n").slice(1).join("\n"),
    preview =
      body.length > 380
        ? body.slice(0, 380) + "\n【预览截断，全文见右侧入口】"
        : body;
  sourceRow.set(source.id, sourceRows.length + 7);
  sourceRows.push([
    sku.label,
    source.text.split("\n")[0].replace("原始字段：", ""),
    preview,
    "全文.txt",
    source.origin.sourceKind === "legacy_parameter_evidence"
      ? "旧参数证据"
      : "原生商品字段",
    source.origin.capturedAt,
    source.id,
    source.version,
    source.origin.jsonPointer,
    source.origin.capturePath,
    source.origin.captureHash,
    path,
  ]);
}
const src = table(
  "原文材料",
  "原文材料与证据入口",
  "预览保持原文；长HTML明确截断。全文.txt及原始JSON可复核完整内容。",
  [
    "SKU",
    "原始字段",
    "原文预览（长文另开全文）",
    "完整原文入口",
    "来源性质",
    "采集时间UTC",
    "来源ID",
    "来源版本",
    "原始JSON位置",
    "只读回执文件",
    "回执内容hash",
    "全文路径",
  ],
  sourceRows,
  [75, 165, 495, 140, 170, 185, 260, 280, 390, 420, 280, 420],
);
sourceRows.forEach((r, i) => {
  src.s.getRange(`D${i + 7}`).values = [["打开全文"]];
  src.s.getRange(`D${i + 7}`).format.font.color = "#235A9E";
  nativeLinks.push({
    sheet: 5,
    cell: `D${i + 7}`,
    target: pathToFileURL(r[11]).href,
    label: "打开全文",
  });
  src.s.getRange(`A${i + 7}:L${i + 7}`).format.rowHeightPx = Math.min(
    305,
    Math.max(
      48,
      (String(r[2]).split("\n").length + Math.ceil(String(r[2]).length / 48)) *
        17,
    ),
  );
});
src.s.getRange("A28").values = [["专业知识来源（研究候选，待专业人审）"]];
src.s.getRange("A28:D28").format.wrapText = false;
src.s.getRange("A28").format.font = { name: "Arial", size: 13, bold: true };
const knowledgeRows = [
  [
    "国家标准平台",
    "标准元数据已读，正文未取得",
    "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=50A888334D973EAAFDD63029FB8AFBE3",
    "2026-10-22",
  ],
  [
    "国家标准委",
    "发布说明已读，不作SKU检测证明",
    "https://www.sac.gov.cn/xw/bzhyw/art/2018/art_3c6f41448cbe47ffa153ab3d87fcf838.html",
    "2026-10-22",
  ],
  [
    "Tork技术页",
    "仅参考计量对象与包装层级，不套用SKU值",
    "https://www.torkglobal.com/us/en/product/toilet-paper/refills/other-toilet-paper-and-systems/110292A",
    "2026-10-22",
  ],
  [
    "政府采购网",
    "仅用尺寸/层数/数量的选型提示",
    "https://www.ccgp.gov.cn/specialtopic/zfcgxqbz/xgzn/202001/t20200103_13698397.htm",
    "2026-10-22",
  ],
];
src.s.getRange("A30:D34").values = [
  ["来源", "已读范围 / 适用边界", "网址", "查阅日期"],
  ...knowledgeRows,
];
src.s.getRange("A30:D30").format = {
  fill: "#334B6D",
  font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
  rowHeightPx: 34,
};
src.s.getRange("A31:D34").format = {
  font: { name: "Arial", size: 11 },
  wrapText: true,
  rowHeightPx: 105,
  verticalAlignment: "center",
};
const reviewRows = [],
  bundleRows = [],
  index = {
    format: 1,
    kind: "roll_pilot_review_index",
    releaseId: replay.results[0].releaseId,
    snapshotVersion: replay.results[0].manifest.snapshotVersion,
    candidates: [],
    workbookHeaders: [],
  };
for (const artifact of replay.results) {
  const sku = skus.find((s) => s.productId === artifact.result.productId),
    bundle = artifact.factPreparation;
  if (!bundle) throw Error("missing preparation bundle");
  const bundlePath = join(out, "bundles", sku.label + ".json");
  await fs.mkdir(join(out, "bundles"), { recursive: true });
  await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2));
  const reviewTemplate = {
    bundleHash: bundle.bundleHash,
    reviewer: "",
    reviewedAt: "",
    decisions: bundle.candidates.map((c) => ({
      candidateId: c.id,
      candidateHash: c.candidateHash,
      decision: "defer",
      conceptConfirmed: false,
      scopeConfirmed: false,
      unitConfirmed: false,
      conflictsChecked: false,
      note: "待人工核实；本模板不是采用记录",
    })),
  };
  await fs.mkdir(join(out, "review-templates"), { recursive: true });
  await fs.writeFile(
    join(out, "review-templates", sku.label + ".json"),
    JSON.stringify(reviewTemplate, null, 2),
  );
  for (const a of snapshot.attributes) {
    const candidates = bundle.candidates.filter((c) => c.attributeId === a.id);
    for (const c of candidates.length ? candidates : [null]) {
      const source = c
        ? snapshot.sources.find((s) => s.id === c.sourceId)
        : null;
      const value = c
        ? typeof c.value === "boolean"
          ? c.value
            ? "是"
            : "否"
          : c.value
        : null;
      const question = bundle.unresolved
        .filter(
          (u) =>
            u.includes(a.name) ||
            (a.id === "roll.perforation" &&
              /60张|张\/节|张\/节|280格|数量/.test(u)) ||
            (a.id === "roll.declared_mass" && /质量|净纸重/.test(u)) ||
            (a.id === "roll.coreless" && /芯/.test(u)),
        )
        .join("；");
      const row = [
        sku.label,
        (sku.label.startsWith("有芯")
          ? sku.label === "有芯3"
            ? "维达"
            : "洁柔"
          : "舒洁") +
          " " +
          (sku.spec || "规格未填").replace(/\s*【[^】]*】/g, ""),
        a.name,
        value,
        c ? "“" + c.quote + "”" : null,
        c ? "待核实候选" : "未知（缺资料）",
        null,
        null,
        null,
        null,
        null,
        null,
        c ? "查看原文" : null,
        question
          ? "有原文/专业疑点，见SKU与问题"
          : !c
            ? "缺少直接证据，不能猜值"
            : "概念、对象、单位及冲突待核实",
        c?.id ?? null,
        c?.candidateHash ?? null,
        bundle.bundleHash,
        sku.productId,
        c?.sourceId ?? null,
        c?.sourceVersion ?? null,
        c?.start ?? null,
        c?.end ?? null,
        source?.origin.jsonPointer ?? null,
      ];
      reviewRows.push(row);
      if (c) {
        const excelRow = reviewRows.length + 6;
        index.candidates.push({
          excelRow,
          skuLabel: sku.label,
          productId: sku.productId,
          attributeId: a.id,
          candidateId: c.id,
          candidateHash: c.candidateHash,
          bundleHash: bundle.bundleHash,
          bundlePath,
          sourceId: c.sourceId,
          immutableCells: row.map((v, i) => (i >= 6 && i <= 12 ? null : v)),
        });
      }
    }
  }
  bundleRows.push({
    sku: sku.label,
    bundleHash: bundle.bundleHash,
    bundlePath,
  });
}
const factHeaders = [
  "SKU",
  "商品/规格摘要",
  "属性",
  "候选值",
  "原文摘录",
  "事实状态",
  "人工结论",
  "核实理由",
  "概念核实",
  "对象口径核实",
  "单位核实",
  "冲突已查看",
  "原文入口",
  "待核实事项",
  "候选ID",
  "候选内容hash",
  "审阅包hash",
  "商品ID",
  "来源ID",
  "来源版本",
  "起始位置",
  "结束位置",
  "原始JSON位置",
];
index.workbookHeaders = factHeaders;
const fact = table(
  "事实审阅",
  "有芯 / 无芯小卷纸 · 真实样板审阅",
  "6个SKU｜28条候选｜全部待人工核实；黄色格为填写区，ID与版本在右侧。",
  factHeaders,
  reviewRows,
  [
    75, 165, 110, 150, 200, 115, 115, 180, 110, 140, 110, 125, 110, 320, 260,
    280, 280, 280, 260, 280, 100, 100, 420,
  ],
);
fact.s.getRange("A4").values = [
  [
    "采用前请填写右侧四项核实，以及“SKU与问题”页的审核人和UTC时间。导出意见仅生成本地JSON。",
  ],
];
fact.s.getRange("A4:N4").format.wrapText = false;
fact.s.getRange("A4").format.font = {
  name: "Arial",
  size: 10,
  color: "#586579",
};
fact.s.getRange(`G7:L${fact.last}`).format.fill = "#FFF2CD";
fact.s.getRange(`G7:G${fact.last}`).dataValidation = {
  rule: { type: "list", values: ["采用候选", "驳回候选", "暂缓核实"] },
};
fact.s.getRange(`I7:L${fact.last}`).dataValidation = {
  rule: { type: "list", values: ["是", "否", "待核实"] },
};
fact.s.getRange(`G7:G${fact.last}`).conditionalFormats.add("containsText", {
  text: "驳回",
  format: { fill: "#FDE5E2", font: { color: "#9C2C26" } },
});
reviewRows.forEach((r, i) => {
  const row = i + 7;
  if (typeof r[3] === "number") {
    const a = snapshot.attributes.find((a) => a.name === r[2]);
    fact.s
      .getRange(`D${row}`)
      .setNumberFormat(
        (Number.isInteger(r[3]) ? "0" : "0.###") + '" ' + a.unit + '"',
      );
  }
  if (r[18]) {
    fact.s.getRange(`M${row}`).values = [["查看原文"]];
    fact.s.getRange(`M${row}`).format.font.color = "#235A9E";
    nativeLinks.push({
      sheet: 1,
      cell: `M${row}`,
      location: `'原文材料'!C${sourceRow.get(r[18])}`,
      label: "查看原文",
    });
  }
  if (!r[14]) {
    fact.s.getRange(`G${row}:L${row}`).format.fill = "#F1F3F6";
  }
  fact.s.getRange(`A${row}:W${row}`).format.rowHeightPx = 48;
});
const defs = snapshot.attributes.map((a) => [
  a.name,
  "选填｜共用定义",
  "选填｜共用定义",
  a.fieldType + (a.unit ? " · " + a.unit : ""),
  a.definition,
  a.rationale,
  "待业务/专业人审",
  a.references.map((r) => r.quote).join("；"),
  a.id,
  a.scope,
]);
table(
  "同族属性",
  "同族共同属性方案（研究候选）",
  "两类共用同一组9项定义，均先选填；不是已发布标准。",
  [
    "属性",
    "有芯小卷纸",
    "无芯小卷纸",
    "类型 / 单位",
    "口径",
    "业务用途与理由",
    "采用状态",
    "知识依据摘录",
    "属性ID",
    "计量对象",
  ],
  defs,
  [120, 145, 145, 110, 300, 270, 140, 400, 220, 280],
);
const skuData = skus.map((s) => [
  s.label,
  s.title,
  s.spec,
  s.saleUnit,
  s.categoryName,
  "启用 / " + s.status.skuSaleStatus,
  s.stableMountedCategoryId === s.categoryId
    ? "挂载目录为本类"
    : "挂载为上游目录，需区分标识",
  s.productId,
  s.productInstanceId,
  s.categoryInstanceId,
  s.stableMountedCategoryId,
  s.standardCategoryId,
]);
const sku = table(
  "SKU与问题",
  "真实商品与待核实问题",
  "样本为两类最新各3件；非随机准确率样本，不代表在售商品总体。",
  [
    "SKU",
    "原始商品名称",
    "规格名称",
    "销售单位",
    "治理类目",
    "样本原始状态",
    "目录承载说明",
    "业务SKU ID",
    "商品实例ID",
    "挂载目录实例ID",
    "挂载稳定类目ID",
    "标准类目ID",
  ],
  skuData,
  [65, 380, 235, 85, 115, 125, 240, 280, 280, 280, 280, 280],
);
sku.s.getRange("A4").values = [["审核人"]];
sku.s.getRange("B4").values = [[null]];
sku.s.getRange("C4").values = [["审核时间（UTC ISO）"]];
sku.s.getRange("D4:F4").values = [[null, null, null]];
sku.s.getRange("B4").format.fill = "#FFF2CD";
sku.s.getRange("D4:F4").format.fill = "#FFF2CD";
sku.s.getRange("A4:F4").format.wrapText = false;
const questions = [
  ...inputIssues.map((i) => ({
    sku: skus.find((s) => s.productId === i.productId).label,
    kind: i.kind,
    issue: i.issue,
  })),
  ...replay.results.flatMap((r) =>
    r.result.unresolved
      .filter((u) => !/所读文字未提供足够直接证据/.test(u))
      .map((u) => ({
        sku: skus.find((s) => s.productId === r.result.productId).label,
        kind: "原文/专业待核实",
        issue: u,
      })),
  ),
];
const qrow = 16;
sku.s.getRange(`A${qrow}:D${qrow + questions.length}`).values = [
  ["SKU", "待核实问题", "处理边界", "问题类型"],
  ...questions.map((q) => [
    q.sku,
    q.issue,
    "人工核实或补充资料；本轮不自动改值/重挂",
    q.kind === "base_sales_unit"
      ? "销售单位"
      : q.kind === "core_structure_unproven"
        ? "芯结构证据"
        : "原文/专业",
  ]),
];
sku.s.getRange(`A${qrow}:D${qrow}`).format = {
  fill: "#334B6D",
  font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
  rowHeightPx: 34,
};
sku.s.getRange(`A${qrow + 1}:D${qrow + questions.length}`).format = {
  font: { name: "Arial", size: 11 },
  wrapText: true,
  rowHeightPx: 105,
  verticalAlignment: "center",
};
const role = {
  base_business: "基础业务字段",
  technical: "技术/映射字段",
  evidence_container: "证据容器",
  relation: "关系字段",
  legacy_parameter: "旧业务参数",
  unresolved: "职责未明",
};
const fieldRows = [
  ...inventory.fields.map((f) => [
    role[f.role],
    f.comment || f.key,
    f.key,
    f.model,
    f.role === "base_business"
      ? "已有职责，不重复治理"
      : f.role === "evidence_container"
        ? "容器不治理；内容可作参数证据"
        : "不自动作为治理属性",
    "本地代码核对；生产部署/业务语义仍待复核",
    "prisma/schema.prisma:" + f.line,
    inventory.sources[0].sha256,
  ]),
  ...nativeFields.map((f) => [
    role[f.role],
    f.title,
    f.key || "（无key）",
    f.category,
    f.reason,
    "真实样本原生配置；不是新属性标准",
    f.propertyInstanceId,
    f.sourceHash,
  ]),
];
const roleOrder = {
  基础业务字段: 0,
  证据容器: 1,
  旧业务参数: 2,
  "技术/映射字段": 3,
  关系字段: 4,
};
fieldRows.sort((a, b) => roleOrder[a[0]] - roleOrder[b[0]]);
table(
  "字段职责",
  "供应链字段职责清单",
  "233个代码字段 + 74个样本原生属性实例；完整性仅限声明范围，仍待业务复核。",
  [
    "职责类型",
    "字段含义 / 原标题",
    "原始key",
    "模型 / 样本类目",
    "治理处理",
    "核对边界",
    "来源定位 / 实例ID",
    "来源内容hash",
  ],
  fieldRows,
  [145, 265, 230, 150, 330, 340, 350, 280],
);
await fs.writeFile(
  join(out, "review-index.json"),
  JSON.stringify({ ...index, bundles: bundleRows }, null, 2),
);
wb.recalculate();
await fs.mkdir(join(out, "previews"), { recursive: true });
for (const [name, s] of sheets) {
  const preview = await wb.render({
    sheetName: name,
    range:
      name === "SKU与问题"
        ? "A1:G12"
        : name === "原文材料"
          ? "A1:D10"
          : name === "同族属性"
            ? "A1:G12"
            : name === "字段职责"
              ? "A1:F13"
              : "A1:H13",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    join(out, "previews", name + ".png"),
    new Uint8Array(await preview.arrayBuffer()),
  );
}
const inspection = await wb.inspect({
  kind: "region",
  sheetId: "事实审阅",
  range: "A6:H14",
  maxChars: 2500,
  tableMaxRows: 9,
  tableMaxCols: 8,
});
await fs.writeFile(
  join(out, "inspection.ndjson"),
  inspection.ndjson ?? JSON.stringify(inspection),
);
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#N/A|#NAME\\?|#NUM!",
  options: { useRegex: true, maxResults: 20 },
  maxChars: 1500,
});
await fs.writeFile(
  join(out, "formula-errors.ndjson"),
  errors.ndjson ?? JSON.stringify(errors),
);
const xlsx = join(out, "有芯与无芯小卷纸_真实样板_人工审阅.xlsx");
await (await SpreadsheetFile.exportXlsx(wb)).save(xlsx);
// Artifact Tool does not implement HYPERLINK evaluation or a native hyperlink API.
// Add only standard OOXML hyperlink nodes/relationships; do not alter cell values/styles.
const linkFile = join(out, "native-links.json");
await fs.writeFile(linkFile, JSON.stringify(nativeLinks));
execFileSync(
  process.env.PGV3_PYTHON || "python3",
  [
    fileURLToPath(new URL("native-hyperlinks.py", import.meta.url)),
    xlsx,
    linkFile,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
console.log(
  JSON.stringify({
    xlsx,
    sheets: [...sheets.keys()],
    candidateRows: index.candidates.length,
    unknownRows: reviewRows.filter((r) => !r[14]).length,
    productionWrites: 0,
  }),
);
