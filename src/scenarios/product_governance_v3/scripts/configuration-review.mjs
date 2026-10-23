// Shared by the checker, request assembler and workbook exporter. Never edits model values.
export const CONFIGURATION_REVIEW_VERSION = "configuration-explanations-v1";
const types = { number: "数值", text: "文本", boolean: "是否", option: "选项", date: "日期" };
const shown = (v) => v === null ? "未设置（null）" : typeof v === "boolean" ? v ? "是" : "否" : String(v);
const fieldLabel = (field) => ({ "numberConfig.precision": "小数精度", "numberConfig.min": "数值下限",
  "numberConfig.max": "数值上限", requiredness: "填写要求", searchable: "搜索开关", isPublic: "公开开关", fieldType: "属性类型" })[field] ?? field;
const claimValue = (field, value) => field === "numberConfig.precision" && typeof value === "number" ? value + "位"
  : field === "requiredness" ? value === "required" ? "必填" : "选填" : field === "fieldType" ? types[value] : shown(value);

/** @param {any} a @param {any} [binding] @returns {Record<string, any>} */
export function configurationFacts(a, binding = null) {
  const facts = { fieldType: a.fieldType, unit: a.unit, valueLevel: a.valueLevel,
    multi: a.multi, defaultValue: a.defaultValue };
  for (const config of ["numberConfig", "textConfig", "optionConfig"])
    if (a[config]) for (const [key, value] of Object.entries(a[config])) facts[config + "." + key] = value;
  if (binding) for (const key of ["requiredness", "isKeySpec", "isPublic", "searchable", "displayInTitle", "displayInList"])
    facts[key] = binding[key];
  return facts;
}

/** @param {any} a @param {any} [binding] */
export function configurationSummary(a, binding = null) {
  const parts = [types[a.fieldType] + (a.unit ? " / " + a.unit : "；无属性单位"), "逐" + a.valueLevel];
  if (binding) parts.push(binding.requiredness === "required" ? "必填" : "选填");
  if (a.numberConfig) {
    const n = a.numberConfig;
    parts.push("整数=" + shown(n.isInt), "小数精度=" + shown(n.precision),
      "下限=" + shown(n.min), "上限=" + shown(n.max));
  }
  if (a.textConfig) {
    const t = a.textConfig;
    parts.push("格式=" + (t.format === "ANY" ? "任意" : shown(t.format)), "最少字/位数=" + shown(t.minLength),
      "最多字/位数=" + shown(t.maxLength), "去首尾空白=" + shown(t.trim), "显示方式=" + shown(t.displayMethod));
  }
  if (a.fieldType === "option") parts.push("多选=" + shown(a.multi),
    "最少选项=" + shown(a.optionConfig?.minCount ?? null), "最多选项=" + shown(a.optionConfig?.maxCount ?? null),
    "枚举=" + a.enumValues.join("、"));
  parts.push("默认值=" + shown(a.defaultValue));
  if (binding) parts.push("公开=" + shown(binding.isPublic), "搜索=" + shown(binding.searchable),
    "关键规格=" + shown(binding.isKeySpec), "标题展示=" + shown(binding.displayInTitle), "列表展示=" + shown(binding.displayInList));
  return parts.join("；");
}

export function configurationBasisNotes(a) {
  // The current contract has attribute-level references, not field-level precision provenance.
  // This is an evidence-registration gap, not proof that no source exists and not a hard failure.
  return a.numberConfig?.precision != null
    ? ["当前小数精度为" + a.numberConfig.precision + "位；合同未逐字段登记精度依据，须核实。配置存在不等于行业要求已确认；冻结定义如需改变，另提共享修订。"] : [];
}

const labels = [
  ["numberConfig.precision", /(?:numberConfig\.precision|小数位数|小数精度|精度)/g],
  ["numberConfig.min", /(?:numberConfig\.min\b|数值下限|下限|最小值)/g],
  ["numberConfig.max", /(?:numberConfig\.max\b|数值上限|上限|最大值)/g],
];
const numberValue = "(?:null|未设置|未设|不设置|空值|[-+]?\\d+(?:\\.\\d+)?)";
const scalar = (v) => /^(?:null|未设置|未设|不设置|空值)$/i.test(v) ? null : Number(v);
function assertions(segment, inheritedPaths) {
  const claims = [], paths = labels.filter(([, re]) => { re.lastIndex = 0; return re.test(segment); }).map(([key]) => key);
  // Only explicit present-tense assertions are checked. Questions, examples and proposed changes stay human questions.
  if (/[?？]|(?:^|[：:])\s*(?:若|如果|假设|例如|原文)|原(?:配置|方案|合同|版本|记录|说明)|旧(?:配置|方案|合同|版本)|此前|曾经|不能(?:写|说|声称)|不应(?:写|说|声称)|建议|拟将|计划|应当|应为|应设|是否(?:应|需要|要|设置|设为|改|调整)|能否|要不要|改为|改成|调整为/.test(segment))
    return { claims, paths, proposed: true };
  for (const [path, label] of labels) {
    const direct = new RegExp("(?:" + label.source + ")\\s*(?:当前|目前)?\\s*(?:均|都)?\\s*(?:留|为|是|设为|设置为|设置成|=|：|:)\\s*[`'\"]?(" + numberValue + ")", "gi");
    for (const match of segment.matchAll(direct)) claims.push({ field: path, claimed: scalar(match[1]) });
    const unset = new RegExp("(?:" + label.source + ")\\s*(?:均|都)?\\s*(?:未设置|未设|留空)", "i");
    if (unset.test(segment)) claims.push({ field: path, claimed: null });
  }
  const collective = segment.match(new RegExp("(?:均|都|全部|一律)\\s*(?:留|为|是|设为|设置为|设置成)\\s*[`'\"]?(" + numberValue + ")", "i"));
  if (collective) for (const field of paths.length ? paths : inheritedPaths)
    claims.push({ field, claimed: scalar(collective[1]) });
  if (/(?:均|都|全部|一律)\s*(?:未设置|未设|留空)/.test(segment))
    for (const field of paths.length ? paths : inheritedPaths) claims.push({ field, claimed: null });
  const decimals = segment.match(/保留\s*(\d+)\s*位小数/);
  if (decimals) claims.push({ field: "numberConfig.precision", claimed: Number(decimals[1]) });
  for (const [field, re, values] of [
    ["requiredness", /(?:填写要求|必填性|requiredness)\s*(?:为|是|=|：|:)\s*(必填|选填|required|optional)/i, { 必填: "required", 选填: "optional", required: "required", optional: "optional" }],
    ["searchable", /(?:搜索开关|可搜索|searchable)\s*(?:为|是|=|：|:)\s*(true|false|开启|关闭|是|否)/i, { true: true, false: false, 开启: true, 关闭: false, 是: true, 否: false }],
    ["isPublic", /(?:公开开关|公开属性|isPublic)\s*(?:为|是|=|：|:)\s*(true|false|开启|关闭|是|否)/i, { true: true, false: false, 开启: true, 关闭: false, 是: true, 否: false }],
    ["fieldType", /(?:字段类型|属性类型|fieldType)\s*(?:为|是|=|：|:)\s*(数值|文本|是否|选项|日期|number|text|boolean|option|date)/i, { 数值: "number", 文本: "text", 是否: "boolean", 选项: "option", 日期: "date", number: "number", text: "text", boolean: "boolean", option: "option", date: "date" }],
  ]) {
    const match = segment.match(re);
    if (match) claims.push({ field, claimed: values[match[1].toLowerCase()] });
  }
  return { claims, paths, proposed: false };
}

export function reviewConfigurationStatements(attributes, bindings, texts) {
  const claims = [], conflicts = [], unscoped = [];
  for (const entry of texts) {
    const source = typeof entry === "string" ? { text: entry, source: "unresolved", attributeId: null } : entry;
    for (const sentence of source.text.split(/[。；;\n]/).filter(Boolean)) {
      let targets = [], inheritedPaths = [];
      for (const segment of sentence.split(/[,，]/).filter(Boolean)) {
        const named = attributes.filter((a) => segment.includes(a.name) || segment.includes(a.id));
        if (named.length) targets = named;
        else if (/(?:全部|所有|各项)(?:的)?数值属性/.test(segment)) targets = attributes.filter((a) => a.fieldType === "number");
        else if (/(?:全部|所有|各项)属性/.test(segment)) targets = attributes;
        else if (!targets.length && source.attributeId) targets = attributes.filter((a) => a.id === source.attributeId);
        const parsed = assertions(segment, inheritedPaths);
        if (parsed.proposed) { inheritedPaths = []; continue; }
        if (parsed.paths.length) inheritedPaths = parsed.paths;
        if (!parsed.claims.length) continue;
        for (const claim of parsed.claims) {
          if (!targets.length) { unscoped.push({ ...claim, text: sentence, source: source.source }); continue; }
          for (const a of targets) {
            const facts = configurationFacts(a, bindings.find((b) => b.attributeId === a.id));
            if (!Object.hasOwn(facts, claim.field)) continue;
            const record = { ...claim, attributeId: a.id, attributeName: a.name, actual: facts[claim.field],
              text: sentence, source: source.source };
            if (!claims.some((c) => JSON.stringify(c) === JSON.stringify(record))) {
              claims.push(record);
              if (record.actual !== record.claimed) conflicts.push(record);
            }
          }
        }
      }
    }
  }
  return { version: CONFIGURATION_REVIEW_VERSION, claims, conflicts, unscoped,
    scope: "仅核对明确指向属性及字段的当前配置断言；未识别的自然语言仍需人审", businessValuesModified: false };
}

export function modelConfigurationReview(result) {
  const texts = result.unresolved.map((text) => ({ text, source: "unresolved", attributeId: null }));
  for (const a of result.attributes) {
    for (const key of ["definition", "rationale"]) texts.push({ text: a[key], source: "attributes." + a.id + "." + key, attributeId: a.id });
    const b = result.bindings.find((b) => b.attributeId === a.id);
    if (b) for (const key of ["requirednessReason", "differenceReason"])
      if (b[key]) texts.push({ text: b[key], source: "bindings." + a.id + "." + key, attributeId: a.id });
  }
  return reviewConfigurationStatements(result.attributes, result.bindings, texts);
}

// Export-only projection. It does not revalidate a historical contract or make it reusable.
export function projectConfigurationReview(data) {
  const attributes = [], issues = [], configuration = [], reports = [];
  const historical = data.configurationReview?.version !== CONFIGURATION_REVIEW_VERSION;
  const issueIds = data.issues.map((r) => r[8]), seen = new Set();
  if (new Set(issueIds).size !== issueIds.length) throw Error("duplicate review category identity");
  const sourceRows = data.attributes.map((row) => {
    const definition = JSON.parse(row[15]), key = definition.categoryId + ":" + definition.id;
    if (!issueIds.includes(definition.categoryId) || row[0] !== definition.name || row[12] !== definition.id ||
        definition.attributeId !== definition.id || seen.has(key)) throw Error("review row/configuration identity mismatch");
    seen.add(key);
    return { row, definition };
  });
  for (const issue of data.issues) {
    const selected = sourceRows.filter((r) => r.definition.categoryId === issue[8]),
      rows = selected.map((r) => r.row), definitions = selected.map((r) => r.definition);
    const report = modelConfigurationReview({ attributes: definitions, bindings: definitions, unresolved: [String(issue[2] ?? "")] });
    reports.push({ categoryId: issue[8], ...report });
    const basis = definitions.flatMap((a) => configurationBasisNotes(a).map((note) => a.name + "：" + note));
    const conflictNotes = report.conflicts.map((c) => c.attributeName + "：" + fieldLabel(c.field) + "当前=" + claimValue(c.field, c.actual) + "，原说明=" + claimValue(c.field, c.claimed));
    const assertionsText = new Set(report.claims.map((c) => c.text));
    const questions = String(issue[2] ?? "").split("\n").filter((line) => ![...assertionsText].some((t) => line.includes(t)));
    const issueText = [...conflictNotes.map((s) => "说明冲突，待复审：" + s), ...basis,
      ...(report.unscoped.length ? ["有未能定位到具体属性的配置断言，需人工核对原文，未自动判定一致。"] : []),
      ...questions.map((s) => s ? "原记录（业务疑点仍待核实）：" + s : "")].filter(Boolean).join("\n");
    const state = report.conflicts.length ? "说明冲突，待复审" : historical && (rows.length || String(issue[1]).startsWith("程序通过"))
      ? rows.length ? "原程序通过，待复审" : "原程序通过，空方案待复审" : issue[1];
    issues.push([issue[0], state, issueText, ...issue.slice(3), issue[2]]);
    for (const [i, a] of definitions.entries()) {
      const b = a, conflicts = report.conflicts.filter((c) => c.attributeId === a.id),
        notes = configurationBasisNotes(a), summary = configurationSummary(a, b),
        state = conflicts.length ? "说明冲突，待复审" : notes.length ? "配置依据待核实" : "未检出明确冲突";
      attributes.push([...rows[i], summary, state, notes.join("\n")]);
      const focus = conflicts.map((c) => fieldLabel(c.field) + "=" + claimValue(c.field, c.actual)).join("；");
      configuration.push([issue[0], a.name, state, focus ? focus + "；" + summary : summary,
        [...conflicts.map((c) => fieldLabel(c.field) + "：当前=" + claimValue(c.field, c.actual) + "，原说明=" + claimValue(c.field, c.claimed) + "；需纠正说明，不能自动改配置"), ...notes].join("\n"),
        conflicts.map((c) => c.text).join("\n"), "", conflicts.map((c) => c.field).join("、"), rows[i][15]]);
    }
  }
  return { ...data, attributes, issues, configuration,
    configurationAudit: { version: CONFIGURATION_REVIEW_VERSION, historical,
      contractRevalidated: false, newModelRequests: 0, productionWrites: 0, businessValuesModified: false,
      reports, conflictCount: reports.reduce((n, r) => n + r.conflicts.length, 0) } };
}
