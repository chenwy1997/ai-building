import fs from "node:fs/promises";

export function parseLayoutArgs(args) {
  const result = {
    restyle: false,
    positionals: [],
    layoutPath: null,
    freezeLeft: null,
    freezeThrough: {},
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--restyle") {
      if (result.restyle) throw Error("duplicate --restyle");
      result.restyle = true;
    } else if (
      ["--layout", "--freeze-left", "--freeze-through"].includes(arg)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw Error("missing value for " + arg);
      if (arg === "--layout") result.layoutPath = value;
      if (arg === "--freeze-left") {
        if (!/^\d+$/.test(value))
          throw Error("--freeze-left must be a nonnegative integer");
        result.freezeLeft = Number(value);
      }
      if (arg === "--freeze-through") {
        const at = value.indexOf("=");
        if (at < 1 || at === value.length - 1)
          throw Error("--freeze-through expects sheet=column title");
        const name = value.slice(0, at),
          column = value.slice(at + 1);
        if (Object.hasOwn(result.freezeThrough, name))
          throw Error("duplicate freeze sheet " + name);
        result.freezeThrough[name] = column;
      }
    } else if (arg.startsWith("--"))
      throw Error("unknown layout option " + arg);
    else result.positionals.push(arg);
  }
  if (result.positionals.length > 2) throw Error("expected at most two paths");
  return result;
}

export function validateLayout(config) {
  const allowed = [
    "version",
    "fontFamily",
    "bodyFontPt",
    "titleFontPt",
    "noteFontPt",
    "bodyRowHeightPx",
    "headerRowHeightPx",
    "titleRowHeightPx",
    "noteRowHeightPx",
    "topGapPx",
    "headerFill",
    "headerTextColor",
    "bodyTextColor",
    "titleTextColor",
    "editableFill",
    "rowHeightMode",
    "longTextMode",
    "freezeLeftColumns",
    "sheets",
  ];
  for (const key of Object.keys(config))
    if (!allowed.includes(key)) throw Error("unknown layout setting " + key);
  if (config.version !== 1 || !config.fontFamily?.trim())
    throw Error("invalid layout version/font");
  for (const key of allowed.filter((k) => k.endsWith("Pt") || k.endsWith("Px")))
    if (
      !Number.isFinite(config[key]) ||
      config[key] < (key === "topGapPx" ? 0 : 1)
    )
      throw Error("invalid layout setting " + key);
  if (
    !["fixed", "wrap"].includes(config.rowHeightMode) ||
    !["note", "none"].includes(config.longTextMode)
  )
    throw Error("invalid text layout mode");
  if (
    !Number.isInteger(config.freezeLeftColumns) ||
    config.freezeLeftColumns < 0
  )
    throw Error("invalid freezeLeftColumns");
  if (
    !config.sheets ||
    typeof config.sheets !== "object" ||
    Array.isArray(config.sheets)
  )
    throw Error("invalid sheet overrides");
  for (const [name, value] of Object.entries(config.sheets)) {
    if (!name || !value || typeof value !== "object" || Array.isArray(value))
      throw Error("invalid sheet override");
    for (const key of Object.keys(value))
      if (
        !["freezeLeftColumns", "freezeThrough", "rowHeightMode"].includes(key)
      )
        throw Error("unknown sheet setting " + key);
    if (
      value.freezeLeftColumns !== undefined &&
      (!Number.isInteger(value.freezeLeftColumns) ||
        value.freezeLeftColumns < 0)
    )
      throw Error("invalid sheet freezeLeftColumns");
    if (
      value.freezeThrough !== undefined &&
      (typeof value.freezeThrough !== "string" || !value.freezeThrough.trim())
    )
      throw Error("invalid freezeThrough");
    if (
      value.rowHeightMode !== undefined &&
      !["fixed", "wrap"].includes(value.rowHeightMode)
    )
      throw Error("invalid sheet rowHeightMode");
  }
  return config;
}

export async function loadReviewLayout(options) {
  const defaults = JSON.parse(
    await fs.readFile(
      new URL("review-layout.defaults.json", import.meta.url),
      "utf8",
    ),
  );
  const patch = options.layoutPath
    ? JSON.parse(await fs.readFile(options.layoutPath, "utf8"))
    : {};
  return validateLayout({
    ...defaults,
    ...patch,
    sheets: { ...defaults.sheets, ...patch.sheets },
  });
}

export function sheetLayout(config, options, name, headers) {
  const override = config.sheets[name] ?? {};
  const layout = { ...config, ...override };
  const through =
    options.freezeThrough[name] ??
    (options.freezeLeft === null ? override.freezeThrough : undefined);
  let left =
    options.freezeLeft ??
    override.freezeLeftColumns ??
    config.freezeLeftColumns;
  if (through !== undefined) {
    const matches = headers.flatMap((v, i) => (v === through ? [i + 1] : []));
    if (matches.length !== 1)
      throw Error(
        "freeze column missing or ambiguous: " + name + "=" + through,
      );
    left = matches[0];
  }
  if (!Number.isInteger(left) || left < 0 || left > headers.length)
    throw Error("frozen prefix exceeds columns: " + name);
  return { ...layout, freezeLeftColumns: left, freezeThrough: through ?? null };
}

export function validateSheetTargets(config, options, names) {
  for (const name of new Set([
    ...Object.keys(config.sheets),
    ...Object.keys(options.freezeThrough),
  ]))
    if (!names.includes(name)) throw Error("unknown layout sheet " + name);
}

export function lineCount(value, width, fontPt) {
  const available = Math.max(30, width * 0.94 - 12),
    scale = fontPt / 10;
  return String(value ?? "")
    .split("\n")
    .reduce(
      (n, line) =>
        n +
        Math.max(
          1,
          Math.ceil(
            [...line].reduce(
              (w, c) => w + (c.charCodeAt(0) > 255 ? 11.3 : 5.9) * scale,
              0,
            ) / available,
          ),
        ),
      0,
    );
}

export async function applyReviewLayout(
  wb,
  sheet,
  widths,
  config,
  options,
  headerRow = 6,
) {
  const inspection = await wb.inspect({
    select: "$.sheets[*]",
    include: ["name", "range", "notes", "threads"],
  });
  const meta = (
    inspection.records ??
    inspection.ndjson
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s))
  ).find((s) => s.name === sheet.name);
  const lastRow = Number(/\d+$/.exec(meta?.range ?? "")?.[0]);
  if (!Number.isInteger(lastRow) || lastRow < headerRow)
    throw Error("missing sheet data bounds");
  const used = sheet.getRangeByIndexes(0, 0, lastRow, widths.length),
    matrix = used.values;
  const headers = matrix[headerRow - 1].slice(0, widths.length);
  const layout = sheetLayout(config, options, sheet.name, headers);
  const end = ((n) => {
    let s = "";
    for (n++; n; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  })(widths.length - 1);
  used.format.font.name = layout.fontFamily;
  used.format.font.size = layout.bodyFontPt;
  used.format.font.color = layout.bodyTextColor;
  used.format.verticalAlignment = "center";
  sheet.showGridLines = false;
  sheet.getRange("A2").format.font = {
    name: layout.fontFamily,
    size: layout.titleFontPt,
    bold: true,
    color: layout.titleTextColor,
  };
  sheet.getRange("A2:H5").format.wrapText = false;
  sheet.getRange("A3:H5").format.font.size = layout.noteFontPt;
  sheet.getRange(`A${headerRow}:${end}${headerRow}`).format = {
    fill: layout.headerFill,
    font: {
      name: layout.fontFamily,
      size: layout.bodyFontPt,
      bold: true,
      color: layout.headerTextColor,
    },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: false,
    rowHeightPx: layout.headerRowHeightPx,
  };
  const annotated = new Set(
    [...(meta?.notes ?? []), ...(meta?.threads ?? [])].map((n) => n.range),
  );
  let notesAdded = 0;
  matrix.slice(headerRow).forEach((row, i) => {
    let maxLines = 1;
    row.slice(0, widths.length).forEach((value, j) => {
      const lines = lineCount(value, widths[j], layout.bodyFontPt);
      maxLines = Math.max(maxLines, lines);
      if (
        layout.longTextMode !== "note" ||
        typeof value !== "string" ||
        lines <= 1
      )
        return;
      let column = "",
        n = j + 1;
      for (; n; n = Math.floor((n - 1) / 26))
        column = String.fromCharCode(65 + ((n - 1) % 26)) + column;
      const address = column + (headerRow + i + 1);
      sheet.getRange(address).format.verticalAlignment = "top";
      if (annotated.has(address)) return; // Keep existing human notes and comments.
      wb.notes.add({
        id: "review-layout:" + sheet.name + ":" + address,
        target: {
          cell: { sheetName: sheet.name, sheetId: sheet.sheetId, address },
        },
        authorId: "",
        createdAt: "",
        body: { plainText: value },
      });
      notesAdded++;
    });
    const range = sheet.getRangeByIndexes(headerRow + i, 0, 1, widths.length);
    range.format.wrapText = true;
    range.format.rowHeightPx =
      layout.rowHeightMode === "fixed"
        ? layout.bodyRowHeightPx
        : Math.max(
            layout.bodyRowHeightPx,
            (maxLines * 17 * layout.bodyFontPt) / 10 + 3,
          );
  });
  sheet.getRange("A1:H1").format.rowHeightPx = layout.topGapPx;
  sheet.getRange("A2:H2").format.rowHeightPx = layout.titleRowHeightPx;
  sheet.getRange("A3:H5").format.rowHeightPx = layout.noteRowHeightPx;
  sheet.freezePanes.unfreeze();
  sheet.freezePanes.freezeRows(headerRow);
  if (layout.freezeLeftColumns)
    sheet.freezePanes.freezeColumns(layout.freezeLeftColumns);
  return {
    name: sheet.name,
    bodyFontPt: layout.bodyFontPt,
    bodyRowHeightPx: layout.bodyRowHeightPx,
    rowHeightMode: layout.rowHeightMode,
    freezeLeftColumns: layout.freezeLeftColumns,
    freezeThrough: layout.freezeThrough,
    notesAdded,
  };
}
