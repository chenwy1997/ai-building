export type TabularRecord = Record<string, unknown>;

export interface ExcelReadOptions {
  /** 工作表名称，或从 1 开始的工作表序号。默认读取第一张表。 */
  sheet?: string | number;
  /** 表头所在行，从 1 开始。 */
  headerRow?: number;
  /** 是否忽略整行为空的数据。 */
  skipEmptyRows?: boolean;
  /** 日期是否保留 Date；默认转换为 ISO 字符串，便于 JSON 序列化。 */
  preserveDates?: boolean;
}

export interface ExcelWriteOptions {
  sheetName?: string;
  /** 显式指定列顺序；未指定时按所有对象 key 的首次出现顺序生成。 */
  columns?: string[];
  freezeHeader?: boolean;
  autoWidth?: boolean;
}
