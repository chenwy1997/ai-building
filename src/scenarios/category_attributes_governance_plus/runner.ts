import type { SQL } from "bun";
import type { DatabaseHub } from "../../platform/database/hub.ts";
import { readTextFile } from "../../facilities/json/files.ts";
import { objectsToExcel } from "../../facilities/excel/excel.ts";
import { asInt, parseFlags } from "../category_governance/util.ts";
import type { Attribute } from "../category_attributes_governance/types.ts";
import { appliedOpsForBase, latestVersionNo, tombstonesForBase } from "../category_governance_plus/storage.ts";
import { diffTemplates, planBuckets } from "./plan.ts";
import type { BaseTemplate } from "./plan.ts";

const PLUS = "category_governance_plus";
const NAME = "category_attributes_governance_plus";

export async function planCommand(databases: DatabaseHub, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const baseFile = flags["base-template"];
  if (!baseFile) throw new Error("缺少 --base-template=<模板 JSON 路径>");
  const plus = databases.scenarioDatabase(PLUS);
  const database = databases.scenarioDatabase(NAME);
  const latest = await latestVersionNo(plus);
  if (latest === null) throw new Error("category_governance_plus 还没有版本；请先 import/apply");
  const versionNo = flags.version ? asInt(flags.version, latest) : latest;
  if (versionNo > latest) throw new Error(`类目版本 v${versionNo} 不存在（当前最新 v${latest}）`);

  const leafRows = await plus<Array<{ node_id: string; name: string }>>`
    SELECT node_id, name FROM category_version_nodes
    WHERE version_no = ${versionNo} AND is_leaf AND enabled ORDER BY node_id
  `;
  if (leafRows.length === 0) throw new Error(`类目版本 v${versionNo} 不存在或没有启用的末级类目`);
  const ops = versionNo > 1 ? await appliedOpsForBase(plus, versionNo - 1) : [];
  const tombstones = versionNo > 1 ? await tombstonesForBase(plus, versionNo - 1) : [];

  const base = JSON.parse(await readTextFile(baseFile)) as BaseTemplate;
  if (!base || !Array.isArray(base.rows)) throw new Error("base 模板必须是 {version, rows:[{categoryId, attributes}]} 结构");

  const plans = planBuckets(leafRows.map((row) => ({ id: row.node_id, name: row.name })), ops, tombstones, base, versionNo);
  const diff = diffTemplates(base.rows, plans.map((plan) => ({ categoryId: plan.categoryId, attributes: plan.attributes })));
  const parsedBaseVersion = Number(base.version);
  const fromVersion = Number.isInteger(parsedBaseVersion) ? parsedBaseVersion : versionNo - 1;

  await database.begin(async (tx: SQL) => {
    // 幂等重跑：同版本先清后写。
    await tx`DELETE FROM attribute_template_versions WHERE version_no = ${versionNo}`;
    for (const plan of plans) {
      await tx`
        INSERT INTO attribute_template_versions (version_no, category_id, bucket, provenance, attributes, conflicts)
        VALUES (${versionNo}, ${plan.categoryId}, ${plan.bucket}, ${plan.provenance},
                ${JSON.stringify(plan.attributes)}::jsonb, ${JSON.stringify(plan.conflicts)}::jsonb)
      `;
    }
    if (fromVersion !== versionNo) {
      await tx`
        INSERT INTO attribute_template_diffs (from_version, to_version, summary, rows)
        VALUES (${fromVersion}, ${versionNo}, ${JSON.stringify(diff.summary)}::jsonb, ${JSON.stringify(diff.rows)}::jsonb)
        ON CONFLICT (from_version, to_version) DO UPDATE SET summary = EXCLUDED.summary, rows = EXCLUDED.rows
      `;
    }
  });

  const count = (bucket: string): number => plans.filter((plan) => plan.bucket === bucket).length;
  const conflictCount = plans.reduce((sum, plan) => sum + plan.conflicts.length, 0);
  console.log(`v${versionNo} 分桶：unchanged ${count("unchanged")}，derived ${count("derived")}，added ${count("added")}；conflict ${conflictCount} 条`);
  console.log(`diff v${fromVersion}→v${versionNo}：新增 ${diff.summary.added}，删除 ${diff.summary.removed}，变更 ${diff.summary.changed}，未变 ${diff.summary.unchanged}`);
}

const TYPE_LABEL: Record<Attribute[2], string> = {
  text: "文本", number: "数值", boolean: "布尔", single: "单选", multi: "多选", date: "日期",
};
const REQUIREMENT_LABEL: Record<Attribute[3], string> = {
  required: "必填", conditional: "条件必填", optional: "选填",
};

export async function exportCommand(databases: DatabaseHub, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const out = flags.out;
  if (!out) throw new Error("缺少 --out=<xlsx 路径>");
  const plus = databases.scenarioDatabase(PLUS);
  const database = databases.scenarioDatabase(NAME);
  let versionNo = flags.version ? asInt(flags.version, 0) : 0;
  if (versionNo === 0) {
    const rows = await database<Array<{ max: number | null }>>`SELECT MAX(version_no) AS max FROM attribute_template_versions`;
    versionNo = rows[0]?.max ?? 0;
  }
  if (versionNo === 0) throw new Error("还没有 plan 过的模板版本");

  // bun:sql 把 jsonb 列作为字符串返回，读取侧统一解析。
  const parseJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) as T : value as T);
  const templates = await database<Array<{ category_id: string; provenance: string; attributes: unknown }>>`
    SELECT category_id, provenance, attributes FROM attribute_template_versions
    WHERE version_no = ${versionNo} ORDER BY category_id
  `;
  if (templates.length === 0) throw new Error(`v${versionNo} 尚未 plan，没有可导出的模板`);
  const pathRows = await plus<Array<{ node_id: string; path_json: unknown }>>`
    SELECT node_id, path_json FROM category_version_nodes WHERE version_no = ${versionNo}
  `;
  const pathById = new Map(pathRows.map((row) => {
    const path = parseJson<string[]>(row.path_json);
    return [row.node_id, Array.isArray(path) ? path.join(" > ") : ""];
  }));

  const rows: Array<Record<string, unknown>> = [];
  for (const template of templates) {
    for (const attr of parseJson<Attribute[]>(template.attributes)) {
      rows.push({
        类目路径: pathById.get(template.category_id) ?? template.category_id,
        属性标识: attr[0],
        属性名: attr[1],
        属性说明: attr[7],
        类型: TYPE_LABEL[attr[2]] ?? attr[2],
        必填: REQUIREMENT_LABEL[attr[3]] ?? attr[3],
        单位: attr[4],
        选项: attr[5].join("|"),
        条件: attr[6],
        格式: attr[8],
        // Attribute 元组没有示例字段，示例列留空待治理回填。
        示例: "",
        provenance: template.provenance,
      });
    }
  }
  await objectsToExcel(rows, out, {
    sheetName: "属性模板",
    columns: ["类目路径", "属性标识", "属性名", "属性说明", "类型", "必填", "单位", "选项", "条件", "格式", "示例", "provenance"],
  });
  console.log(`已导出 v${versionNo} 共 ${rows.length} 行到 ${out}`);
}
