export type OpType = "rename" | "move" | "disable" | "add" | "merge" | "split";
export type OpStatus = "proposed" | "approved" | "applied" | "rejected";

export interface RenameParams { id: string; name: string }
export interface MoveParams { id: string; parentId: string }
export interface DisableParams { id: string; reason?: string }
export interface AddParams { parentId: string; name: string; categoryId?: string | null }
export interface MergeParams { sources: string[]; target: string; reason?: string }
export interface SplitChild { name: string; categoryId?: string | null }
export interface SplitParams { source: string; children: SplitChild[]; reason?: string }
export type OpParams = RenameParams | MoveParams | DisableParams | AddParams | MergeParams | SplitParams;

export interface CategoryOp<P = OpParams> {
  opId: string;
  type: OpType;
  params: P;
  evidence?: unknown;
}

export interface Tombstone {
  oldId: string;
  newId: string | null;
  opId: string;
  reason: string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 可排序 ULID：时间高位 + 随机低位，propose 时生成 op_id。 */
export function ulid(now = Date.now()): string {
  let time = "";
  let value = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[value % 32] + time;
    value = Math.floor(value / 32);
  }
  let random = "";
  for (let i = 0; i < 16; i += 1) random += CROCKFORD[Math.floor(Math.random() * 32)];
  return time + random;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** propose 入口的结构校验，返回错误列表（空数组=可入库）；目标存在性等语义校验在 apply 时重新做。 */
export function validateOpShape(entry: unknown): string[] {
  if (!isRecord(entry)) return ["op 必须是对象"];
  const errors: string[] = [];
  const type = entry.type;
  if (typeof type !== "string" || !["rename", "move", "disable", "add", "merge", "split"].includes(type)) {
    errors.push(`未知 op 类型：${String(type)}`);
  }
  const params = entry.params;
  if (!isRecord(params)) return [...errors, "params 必须是对象"];
  switch (type) {
    case "rename":
      if (!nonEmpty(params.id)) errors.push("rename 需要 id");
      if (!nonEmpty(params.name)) errors.push("rename 需要 name");
      break;
    case "move":
      if (!nonEmpty(params.id)) errors.push("move 需要 id");
      if (!nonEmpty(params.parentId)) errors.push("move 需要 parentId");
      break;
    case "disable":
      if (!nonEmpty(params.id)) errors.push("disable 需要 id");
      break;
    case "add":
      if (!nonEmpty(params.parentId)) errors.push("add 需要 parentId");
      if (!nonEmpty(params.name)) errors.push("add 需要 name");
      break;
    case "merge":
      if (!Array.isArray(params.sources) || params.sources.length === 0 || params.sources.some((s) => !nonEmpty(s))) {
        errors.push("merge 需要非空 sources 字符串数组");
      }
      if (!nonEmpty(params.target)) errors.push("merge 需要 target（存续者，必须在 sources 中或是已存在类目）");
      break;
    case "split":
      if (!nonEmpty(params.source)) errors.push("split 需要 source");
      if (!Array.isArray(params.children) || params.children.length < 2
        || params.children.some((c) => !isRecord(c) || !nonEmpty(c.name))) {
        errors.push("split 需要至少两个带 name 的 children");
      }
      break;
    default:
      break;
  }
  return errors;
}
