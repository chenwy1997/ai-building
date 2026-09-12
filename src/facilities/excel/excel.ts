import ExcelJS from "exceljs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { jsonToObjects, objectToJson } from "../json/index.ts";
import type {
  ExcelReadOptions,
  ExcelWriteOptions,
  TabularRecord,
} from "./types.ts";

function getWorksheet(
  workbook: ExcelJS.Workbook,
  sheet: string | number | undefined,
): ExcelJS.Worksheet {
  const worksheet =
    typeof sheet === "string"
      ? workbook.getWorksheet(sheet)
      : workbook.worksheets[(sheet ?? 1) - 1];

  if (!worksheet) {
    throw new Error(`找不到工作表：${sheet ?? 1}`);
  }
  return worksheet;
}

function normalizeHeader(value: ExcelJS.CellValue, column: number): string {
  const header = normalizeCellValue(value, false);
  const text = header == null ? "" : String(header).trim();
  return text || `column_${column}`;
}

function makeHeadersUnique(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const count = (counts.get(header) ?? 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header}_${count}`;
  });
}

function normalizeCellValue(
  value: ExcelJS.CellValue,
  preserveDates: boolean,
): unknown {
  if (value == null) return null;
  if (value instanceof Date) return preserveDates ? value : value.toISOString();
  if (typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return value.toString("base64");

  if ("result" in value) {
    return normalizeCellValue(value.result ?? null, preserveDates);
  }
  if ("richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("text" in value) return value.text;
  if ("error" in value) return value.error;

  return String(value);
}

function toExcelCellValue(value: unknown): ExcelJS.CellValue {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  return objectToJson(value);
}

function collectColumns(rows: readonly TabularRecord[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return [...columns];
}

/** 将 Excel 第一张（或指定）工作表转换成对象数组。 */
export async function excelToObjects<T extends TabularRecord = TabularRecord>(
  inputPath: string,
  options: ExcelReadOptions = {},
): Promise<T[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const worksheet = getWorksheet(workbook, options.sheet);
  const headerRowNumber = options.headerRow ?? 1;
  const headerRow = worksheet.getRow(headerRowNumber);
  const columnCount = Math.max(headerRow.cellCount, worksheet.actualColumnCount);

  if (columnCount === 0) return [];

  const headers = makeHeadersUnique(
    Array.from({ length: columnCount }, (_, index) =>
      normalizeHeader(headerRow.getCell(index + 1).value, index + 1),
    ),
  );
  const result: T[] = [];

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= worksheet.actualRowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    const record: TabularRecord = {};
    let hasValue = false;

    for (let column = 1; column <= columnCount; column += 1) {
      const value = normalizeCellValue(
        row.getCell(column).value,
        options.preserveDates ?? false,
      );
      record[headers[column - 1]!] = value;
      if (value !== null && value !== "") hasValue = true;
    }

    if ((options.skipEmptyRows ?? true) && !hasValue) continue;
    result.push(record as T);
  }

  return result;
}

/** 将对象数组写成 xlsx 文件。嵌套对象和数组会写为 JSON 字符串。 */
export async function objectsToExcel(
  rows: readonly TabularRecord[],
  outputPath: string,
  options: ExcelWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(options.sheetName ?? "Sheet1");
  const columns = options.columns ?? collectColumns(rows);

  worksheet.addRow(columns);
  for (const row of rows) {
    worksheet.addRow(columns.map((column) => toExcelCellValue(row[column])));
  }

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };

  if (options.freezeHeader ?? true) {
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  if (options.autoWidth ?? true) {
    worksheet.columns.forEach((column) => {
      let width = 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const text = cell.value == null ? "" : String(cell.value);
        width = Math.max(width, Math.min(text.length + 2, 60));
      });
      column.width = width;
    });
  }

  await workbook.xlsx.writeFile(outputPath);
}

export async function excelToJson(
  inputPath: string,
  options: ExcelReadOptions & { pretty?: boolean | number } = {},
): Promise<string> {
  const { pretty = true, ...readOptions } = options;
  return objectToJson(await excelToObjects(inputPath, readOptions), {
    pretty,
    trailingNewline: true,
  });
}

export async function jsonToExcel(
  json: string,
  outputPath: string,
  options: ExcelWriteOptions = {},
): Promise<void> {
  await objectsToExcel(jsonToObjects<TabularRecord>(json), outputPath, options);
}
