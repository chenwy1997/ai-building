import type { Migration } from "../../platform/database/migrations.ts";

export const categoryAttributesGovernancePlusMigrations: readonly Migration[] = [
  {
    id: "001_category_attributes_governance_plus",
    description: "diff 式增量属性治理：模板版本（对齐类目版本号）与 diff 报告",
    statements: [
      `CREATE TABLE IF NOT EXISTS attribute_template_versions (
        version_no INTEGER NOT NULL,
        category_id TEXT NOT NULL,
        bucket TEXT NOT NULL,
        provenance TEXT NOT NULL,
        attributes JSONB NOT NULL,
        conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (version_no, category_id)
      )`,
      `CREATE TABLE IF NOT EXISTS attribute_template_diffs (
        from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL,
        summary JSONB NOT NULL,
        rows JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (from_version, to_version)
      )`,
    ],
  },
];
