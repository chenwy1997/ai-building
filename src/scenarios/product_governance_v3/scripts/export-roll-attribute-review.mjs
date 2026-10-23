import fs from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { FileBlob, Workbook, SpreadsheetFile } from "@oai/artifact-tool";
import {
  parseLayoutArgs,
  loadReviewLayout,
  applyReviewLayout,
  validateSheetTargets,
} from "./review-workbook-layout.mjs";

const layoutOptions = parseLayoutArgs(process.argv.slice(2));
const layoutConfig = await loadReviewLayout(layoutOptions);
const layoutMaterials = {};
for (const file of [
  "review-workbook-layout.mjs",
  "review-layout.defaults.json",
]) {
  layoutMaterials[file] = createHash("sha256")
    .update(await fs.readFile(new URL(file, import.meta.url)))
    .digest("hex");
}

const reviewWidths = {
  属性方案: [145, 75, 95, 90, 130, 300, 150, 125, 250, 200, 135, 250, 480],
  补充与排除: [170, 165, 270, 390, 250, 320],
  定义与设置: [145, 300, 360, 380, 480, 300, 210, 250, 480],
};
validateSheetTargets(layoutConfig, layoutOptions, Object.keys(reviewWidths));
async function compactExisting(source, target) {
  if (!source || !target || resolve(source) === resolve(target))
    throw Error("--restyle requires separate source and target paths");
  try {
    await fs.access(target);
    throw Error("target exists; preserve the reviewed file");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
  const before = [],
    after = [],
    heights = {};
  for (const [name, widths] of Object.entries(reviewWidths)) {
    const s = wb.worksheets.getItem(name),
      used = s.getUsedRange();
    before.push({ name, values: used.values, formulas: used.formulas });
    heights[name] = await applyReviewLayout(
      wb,
      s,
      widths,
      layoutConfig,
      layoutOptions,
    );
    after.push({ name, values: used.values, formulas: used.formulas });
  }
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("layout edit changed workbook content");
  wb.recalculate();
  const previewDir = join(dirname(target), "compact-previews");
  await fs.mkdir(previewDir, { recursive: true });
  for (const name of Object.keys(reviewWidths)) {
    const picture = await wb.render({
      sheetName: name,
      range:
        name === "属性方案"
          ? "A1:I19"
          : name === "补充与排除"
            ? "A1:E12"
            : "A1:E10",
      scale: 1,
      format: "png",
    });
    await fs.writeFile(
      join(previewDir, name + ".png"),
      new Uint8Array(await picture.arrayBuffer()),
    );
  }
  await (await SpreadsheetFile.exportXlsx(wb)).save(target);
  await fs.writeFile(
    target + ".layout-edit.json",
    JSON.stringify(
      {
        operation: "format_only",
        source: resolve(source),
        target: resolve(target),
        contentUnchanged: true,
        layout: heights,
        defaults: layoutConfig,
        options: layoutOptions,
        layoutMaterials,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      xlsx: resolve(target),
      contentUnchanged: true,
      bodyFont: layoutConfig.bodyFontPt,
      rowHeightPx: layoutConfig.bodyRowHeightPx,
      layout: heights,
    }),
  );
}
if (layoutOptions.restyle) {
  await compactExisting(...layoutOptions.positionals);
  process.exit(0);
}

// A separate review object from export-roll-pilot.mjs: definitions/bindings,
// never SKU facts. Extensions come from the same frozen family as the runtime.
const pilot = resolve(
  layoutOptions.positionals[0] ||
    "outputs/product-governance-v3/roll-real-pilot-20261022",
);
const out = resolve(
  layoutOptions.positionals[1] || join(pilot, "attribute-review-20261023"),
);
const xlsx = join(out, "有芯与无芯小卷纸_类目属性方案主审_20261023.xlsx");
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
const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : canonical(v))
    .digest("hex");
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const snapshot = await read(join(pilot, "prepared/snapshot.raw.json"));
const replay = await read(join(pilot, "replay/pilot-replay.json"));
const lock = await read(new URL("../release.lock.json", import.meta.url));
if (
  replay.familyModels.length !== 2 ||
  replay.familyModels.some(
    (r) =>
      r.releaseId !== lock.id ||
      r.manifest.snapshotVersion !== hash(snapshot) ||
      r.checks.errors.length,
  )
)
  throw Error(
    "attribute review source/release mismatch or blocked modeling result",
  );
// Never overwrite an existing reviewed file or its companion index.
await fs.mkdir(out, { recursive: true });
try {
  await fs.access(xlsx);
  throw Error("output exists; use a new review directory to preserve opinions");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const family = snapshot.families.find((f) =>
  [
    "15216d47-17c6-4b18-9391-83097f6f7447",
    "67adeef9-8c1f-47e2-ad72-462ad35a5a75",
  ].every((id) => f.members.includes(id)),
);
if (!family) throw Error("missing shared roll family");
const notes = {
  "roll.coreless": [
    "建议保留",
    "区分纸芯结构，用于选型与同族对照。",
    "是否无芯在两类都保留已经确认；本次核对定义和填写要求。归属及推导规则另核实后，才能据此填写SKU值。",
  ],
  "roll.layers": [
    "建议保留",
    "比较成品纸张叠层数量。单位固定为层。",
    "不指包装层级；不能仅凭层数判断质量。是否强制填写仍按业务必要性，现阶段先选填。",
  ],
  "roll.declared_mass": [
    "保留并核实口径",
    "比较每卷重量，单位g；含芯等口径须一致。",
    "名称简化，原计量边界不变。来源明示的每卷重量不自动等于去芯净纸重或实测重量；含芯/包装口径需核实。",
  ],
  "roll.raw_material": [
    "建议保留",
    "描述原料，供选型与检索。暂用文本。",
    "纯木浆、原生木浆等措辞不擅自归一。后续有稳定术语表再评估选项，不能用少量SKU认定枚举全集。",
  ],
  "roll.sheet_size": [
    "建议保留",
    "比较纸张尺寸，暂保留完整组合文本。",
    "与卷外径、卷宽、包装尺寸区分。只有长宽各有独立用途时才拆分；轴向不明时不猜。",
  ],
  "roll.perforation": [
    "暂名，计数口径待核实",
    "保留每卷数量及原单位，暂不跨单位比较。",
    "张/节/格的关系未裁定，暂不统一叫每卷张数。舒洁0562-10搜索摘要同标题并列200格与200张/卷，仅是该型号的线索；本批0097/0316技术书未取得。260张与60张冲突不消失，不按层数倍乘，核实后再定名及数值化。",
  ],
  "roll.fragrance": [
    "建议选填保留",
    "按香型选择与检索，统一文本表达。",
    "同一字段保留无香味、具体香型或仅有香味的原词，不另造是否有香味。未说明留未知。具体香型未知写治理备注，不拼接到源文值；同义归一需后续核实词表。",
  ],
};
if (
  family.attributes.length !== Object.keys(notes).length ||
  family.attributes.some((a) => !notes[a.id])
)
  throw Error("unreviewed definition drift; update the review plan explicitly");
const types = {
  boolean: "是否",
  number: "数值",
  text: "文本",
  option: "选项",
  date: "日期",
};
const bool = (v) => (v ? "是" : "否");
const bindings = (a) =>
  family.members.map(
    (id) =>
      family.bindings.find(
        (b) => b.attributeId === a.id && b.categoryId === id,
      ) ??
      family.bindings.find(
        (b) => b.attributeId === a.id && b.categoryId === null,
      ),
  );
const items = family.attributes.map((a) => {
  const bs = bindings(a);
  if (bs.some((b) => !b)) throw Error("missing category binding for " + a.id);
  const [recommendation, purpose, issue] = notes[a.id];
  return {
    id: a.id,
    name: a.name,
    definition: a.definition,
    attribute: a,
    bindings: bs,
    applicability: ["适用", "适用"],
    requirements: bs.map((b) =>
      b.requiredness === "required" ? "必填" : "选填",
    ),
    typeUnit: types[a.fieldType] + (a.unit ? " / " + a.unit : ""),
    recommendation,
    purpose,
    issue,
    implementation: "已接入样板合同，待审",
    status: "modeled_candidate",
    references: "专业研究包；已确认规范2—6节",
  };
});
const extensions = (family.extensionCandidates ?? []).map((c) => ({
  ...c,
  definition: "尚未建立属性定义。潜在用途：" + c.potentialUse,
  issue: c.deferReason + "。启用条件：" + c.activationCriteria,
  implementation: "扩展候选，未接SKU合同",
  status: "extension_candidate",
  references: c.references.map((r) => r.id + "；" + r.quote).join("\n"),
}));
[...items, ...extensions].forEach((a) => {
  a.contentHash = hash(a);
});
const boundaries = [
  ...extensions.map((c) => [c.name, "扩展候选，暂不建属性", c.deferReason,
    "潜在用途：" + c.potentialUse + "。启用条件：" + c.activationCriteria,
    c.references]),
  [
    "品牌",
    "排除重复属性",
    "已有品牌库及品牌字段承载。",
    "核对职责边界；不另造品牌属性。",
    "已确认规范1；职责清单brandId",
  ],
  [
    "供应商",
    "排除重复属性",
    "已有供应商主数据及商品关联。",
    "核对职责边界；不另造供应商属性。",
    "已确认规范1；职责清单vendorId/vendorName",
  ],
  [
    "规格名称",
    "排除重复字段",
    "已有规格名称作为销售规格展示文本。",
    "层数、纸张尺寸等有独立用途的物理参数仍可结构化，不能因规格名称出现过就全排除。",
    "已确认规范1；CategoryKeyConfig.saleSpecKey",
  ],
  [
    "销售单位",
    "排除重复属性",
    "已有基础销售单位。",
    "发现原字段不合理时提出原字段核实意见，不新增同义属性。",
    "已确认规范1；CategoryKeyConfig.saleUnitKey",
  ],
  [
    "销售总卷数",
    "先核对基础职责",
    "已有最小计量单位及销售单位内最小计量数量。",
    "同对象同口径时使用基础字段。当前只确认源码职责，生产映射尚未完整回读。",
    "职责清单unitMinKey/unitMinQuaKey",
  ],
  [
    "每提卷数等内包装数量",
    "待核实独立用途",
    "内包装层级未必等同于销售单位内总数量。",
    "有独立比较或仓配用途且基础字段未覆盖才新增。数量和计数单位合为一项。",
    "已确认规范5；专业研究包包装边界",
  ],
  [
    "数量计量单位",
    "合并到对应参数",
    "单位是相应数量的组成部分。",
    "固定单位用数值及属性级单位；确有可变口径时用规范文本，不单独填一个单位属性。",
    "已确认规范5",
  ],
  [
    "吸收倍率原文等原文字段",
    "不设配套业务属性",
    "原文属于证据记录。",
    "业务值与其原文证据分开保留；也不能把厨房纸的指标照搬到小卷卫生纸。",
    "已确认规范6；专业包适用边界",
  ],
  [
    "去芯净纸重",
    "先核实比较口径",
    "与来源明示的单卷重量不自动相同。",
    "先确定业务想比较哪种质量和测量边界，再决定复用、修订或确有必要另设。",
    "专业研究包质量口径",
  ],
  [
    "纸张定量g/m²",
    "专业核实候选",
    "单位面积质量，区别于每卷质量。",
    "若采购确需比较，应补定义和适用资料；本轮尚未确认，不能用已有单卷质量替代或宣称已覆盖。",
    "专业研究包质量口径",
  ],
  [
    "适配纸架型号",
    "待核实适配用途",
    "可能用于明确器具兼容关系。",
    "不能照搬其他市场产品系统的兼容型号。先核实本类业务需求及SKU适配资料。",
    "专业研究包Tork来源适用边界",
  ],
  [
    "可溶/不堵、无荧光剂、认证",
    "需专项专业定义",
    "性能声明、检测事实与认证不是同一种信息。",
    "业务确需时建立各自定义和证据要求，不以商家宣传或标准页面证明某SKU合格。",
    "专业研究包核实清单；未取得标准全文",
  ],
];
const wb = Workbook.create();
const sheets = ["属性方案", "补充与排除", "定义与设置"].map((n) =>
  wb.worksheets.add(n),
);
const col = (n) => {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const literal = (v) =>
  typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : v;
function table(s, title, lines, headers, rows, widths) {
  const end = col(headers.length - 1),
    last = rows.length + 6;
  s.getRange("A2").values = [[title]];
  lines.forEach((v, i) => {
    s.getRange(`A${i + 3}`).values = [[v]];
  });
  s.getRange(`A6:${end}${last}`).values = [headers, ...rows].map((r) =>
    r.map(literal),
  );
  s.tables.add(
    `A6:${end}${last}`,
    true,
    "SchemaReview" + (sheets.indexOf(s) + 1),
  ).showFilterButton = true;
  widths.forEach((v, i) => {
    s.getRange(`${col(i)}1:${col(i)}${last}`).format.columnWidthPx = v;
  });
  return last;
}
table(
  sheets[0],
  "有芯与无芯小卷纸：类目属性方案",
  [
    "审属性是否该设、定义和同族差异。黄色列填意见，空白表示未审。",
    `${items.length}项共用选填定义；每卷数量口径待核实。${extensions.length}项扩展候选见“补充与排除”，不属待填属性。`,
    "商品试填另行审核。所有治理属性按SKU；具体设置和依据见“定义与设置”。",
  ],
  [
    "属性",
    "有芯",
    "无芯",
    "填写要求",
    "类型 / 单位",
    "用途与口径",
    "建议",
    "审阅结论",
    "修改意见",
    "实现状态",
    "详情行",
    "稳定ID",
    "内容hash",
  ],
  items.map((a, i) => [
    a.name,
    ...a.applicability,
    a.requirements[0] === a.requirements[1]
      ? a.requirements[0]
      : a.requirements.join(" / "),
    a.typeUnit,
    a.purpose,
    a.recommendation,
    null,
    null,
    a.implementation,
    "定义与设置 " + (i + 7) + "行",
    a.id,
    a.contentHash,
  ]),
  [145, 75, 95, 90, 130, 300, 150, 125, 250, 200, 135, 250, 480],
);
sheets[0].tabColor = "#334B6D";
sheets[0].getRange(`H7:I${items.length + 6}`).format.fill =
  layoutConfig.editableFill;
sheets[0].getRange(`H7:H${items.length + 6}`).dataValidation = {
  rule: {
    type: "list",
    values: ["同意该项方案", "修改后再审", "不同意该项", "待专业确认"],
  },
};
table(
  sheets[1],
  "补充、合并和排除的判断",
  [
    "前6项为扩展候选，尚未进入SKU合同；核实具体业务用途后再评估启用。",
    "后续为职责、合并与补充判断。样本缺证不构成删除理由，技术参数存在也不直接准入。",
    "黄色列填写对建议的意见。所有意见仅用于方案修订，不会自动发布或写入线上。",
  ],
  ["候选概念", "建议处理", "理由", "需要确认的边界", "审阅意见", "依据"],
  boundaries.map((r) => [r[0], r[1], r[2], r[3], null, r[4]]),
  [170, 165, 270, 390, 250, 320],
);
sheets[1].getRange(`E7:E${boundaries.length + 6}`).format.fill =
  layoutConfig.editableFill;
function configText(a) {
  if (!a) return "未建立类型配置或SKU绑定；用途和启用条件见待核实点。";
  const empty = (v) => (v === null ? "未设" : String(v));
  const config = [
    "SKU；" + (a.multi ? "多值" : "单值") + "；默认值=" + empty(a.defaultValue),
  ];
  if (a.numberConfig) {
    const n = a.numberConfig;
    config.push(
      "整数=" +
        bool(n.isInt) +
        "；精度=" +
        empty(n.precision) +
        "；最小值=" +
        empty(n.min) +
        "；最大值=" +
        empty(n.max),
    );
  }
  if (a.textConfig) {
    const t = a.textConfig;
    config.push(
      "格式=" +
        t.format +
        "；最少字符=" +
        empty(t.minLength) +
        "；最多字符=" +
        empty(t.maxLength) +
        "；去首尾空格=" +
        bool(t.trim) +
        "；显示方式=" +
        empty(t.displayMethod),
    );
  }
  if (a.optionConfig)
    config.push(
      "选项数：最少=" +
        empty(a.optionConfig.minCount) +
        "；最多=" +
        empty(a.optionConfig.maxCount),
    );
  if (a.enumValues.length) config.push("选项=" + a.enumValues.join("、"));
  return config.join("\n");
}
const detailItems = [...items, ...extensions];
const detailRows = detailItems.map((a) => [
  a.name,
  a.definition,
  a.issue,
  configText(a.attribute),
  a.bindings
    ? a.bindings
        .map(
          (b, i) =>
            (i === 0 ? "有芯" : "无芯") +
            "：" +
            (b.requiredness === "required" ? "必填" : "选填") +
            "；关键规格=" +
            bool(b.isKeySpec) +
            "；公开=" +
            bool(b.isPublic) +
            "；关键词检索=" +
            bool(b.searchable) +
            "；标题=" +
            bool(b.displayInTitle) +
            "；列表=" +
            bool(b.displayInList) +
            "；排序=" +
            b.sortIndex +
            "；用途=" +
            b.uses.join("、") +
            "；理由=" +
            b.requirednessReason +
            "；基线引用=" +
            (b.baselineAttributeId ?? "无") +
            "；差异理由=" +
            (b.differenceReason ?? "无"),
        )
        .join("\n")
    : "未建末级绑定，不把研究候选当作已接入属性。",
  a.references,
  a.implementation,
  a.id,
  a.contentHash,
]);
table(
  sheets[2],
  "属性定义、配置及待核实点",
  [
    "前7项配置来自冻结样板合同；后6项为扩展候选，无类型配置和末级绑定。",
    "关键词检索仅表示当前源码支持的配置，不证明线上搜索或筛选已生效。",
    "专业包为Codex研究候选，未经过纸品专业人审；计数口径未裁定，方案待人工采用。",
  ],
  [
    "属性",
    "完整定义",
    "待核实点",
    "类型约束与默认值",
    "两类绑定设置",
    "依据",
    "实现状态",
    "稳定ID",
    "内容hash",
  ],
  detailRows,
  [145, 300, 360, 380, 480, 300, 210, 250, 480],
);
// Keep actual source attributions together beside this supporting input area.
const sourceRow = detailItems.length + 9;
const sourceRows = [
  ["已读资料", "使用范围", "来源"],
  [
    "GB/T 20810-2018元数据",
    "仅元数据，未读标准全文；2026-10-22记录",
    "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=50A888334D973EAAFDD63029FB8AFBE3",
  ],
  [
    "国家标准委2018年发布说明",
    "区分检测指标与商家声明",
    "https://www.sac.gov.cn/xw/bzhyw/art/2018/art_3c6f41448cbe47ffa153ab3d87fcf838.html",
  ],
  [
    "Tork 110292A技术页",
    "不同市场产品，仅参考结构和计量对象",
    "https://www.torkglobal.com/us/en/product/toilet-paper/refills/other-toilet-paper-and-systems/110292A",
  ],
  [
    "中国政府采购网选购指南",
    "参考选型维度，旧标准号不作为现行依据",
    "https://www.ccgp.gov.cn/specialtopic/zfcgxqbz/xgzn/202001/t20200103_13698397.htm",
  ],
  ["维达VD4169厂家参数", "已读正文；节距/卷高及标签和值需分别核实", "https://professional.vinda.com/product/VD4169.html"],
  ["Tork 100200厂家参数", "已读正文；区分印花/压花和不同长度对象", "https://www.torkglobal.com/gb/en/product/refill/toilet-paper/conventional-roll/100200"],
  ["舒洁0562-10厂家页", "仅搜索摘要，正文超时；张/格同型号线索，未裁定通用等价", "https://www.kcprofessional.com.cn/zh-cn/products/restroom-and-hygiene/hair-and-body-wash/pop-up-box/s059865512/s059865512"],
  ["山东航空采购公告5216", "仅搜索摘要，正文超时；工艺/尺寸用途线索，非本批准入结论", "https://sda.cn/foreign/tenderNotice/purchase/5216.html"],
];
sheets[2].getRange(`A${sourceRow}:C${sourceRow + sourceRows.length - 1}`).values = sourceRows;
const appliedLayouts = {};
for (const s of sheets)
  appliedLayouts[s.name] = await applyReviewLayout(
    wb,
    s,
    reviewWidths[s.name],
    layoutConfig,
    layoutOptions,
  );
wb.recalculate();
await fs.mkdir(join(out, "previews"), { recursive: true });
for (const [i, s] of sheets.entries()) {
  const image = await wb.render({
    sheetName: s.name,
    range: i === 0 ? "A1:H13" : i === 1 ? "A1:E12" : "A1:C12",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    join(out, "previews", s.name + ".png"),
    new Uint8Array(await image.arrayBuffer()),
  );
}
const inspection = await wb.inspect({
  kind: "region",
  sheetId: "属性方案",
  range: "A6:H19",
  tableMaxRows: 14,
  tableMaxCols: 8,
  maxChars: 3000,
});
await fs.writeFile(
  join(out, "inspection.ndjson"),
  inspection.ndjson ?? JSON.stringify(inspection),
);
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#N/A|#NAME\\?|#NUM!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 20 },
  maxChars: 1500,
});
await fs.writeFile(
  join(out, "formula-errors.ndjson"),
  errors.ndjson ?? JSON.stringify(errors),
);
await (await SpreadsheetFile.exportXlsx(wb)).save(xlsx);
await fs.writeFile(
  join(out, "attribute-review-index.json"),
  JSON.stringify(
    {
      reviewObject: "category_attribute_schema",
      status: "pending_human",
      releaseId: lock.id,
      snapshotVersion: hash(snapshot),
      author: "Codex",
      modelCalls: 0,
      productionWrites: 0,
      exporterHash: hash(await fs.readFile(new URL(import.meta.url), "utf8")),
      layoutDefaults: layoutConfig,
      layout: appliedLayouts,
      layoutOptions,
      layoutMaterials,
      modeledCandidates: items.length,
      extensionCandidates: extensions.length,
      attributeOpinionColumns: ["H", "I"],
      autoAdoption: false,
      opinionImporter: "not_implemented_for_attribute_schema",
      items,
      extensions,
      boundaries,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    xlsx,
    reviewObject: "category_attribute_schema",
    modeledCandidates: items.length,
    extensionCandidates: extensions.length,
    productionWrites: 0,
  }),
);
