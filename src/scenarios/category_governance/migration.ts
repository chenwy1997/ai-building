import type { Migration } from "../../platform/database/migrations.ts";

export const categoryGovernanceMigrations: readonly Migration[] = [
  {
    id: "001_category_governance_v1",
    description: "类目治理 v1：导入类目、压缩上下文、治理结果和运行记录",
    statements: [
      `CREATE TABLE IF NOT EXISTS category_imports_v1 (
        id BIGSERIAL PRIMARY KEY,
        version TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        source_url TEXT,
        node_count INTEGER NOT NULL,
        leaf_count INTEGER NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS category_nodes_v1 (
        id TEXT PRIMARY KEY,
        import_id BIGINT NOT NULL REFERENCES category_imports_v1(id),
        parent_id TEXT,
        name TEXT NOT NULL,
        level INTEGER NOT NULL,
        path_json JSONB NOT NULL,
        category_id TEXT,
        is_leaf BOOLEAN NOT NULL,
        enabled BOOLEAN NOT NULL,
        payload_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS category_nodes_v1_parent_idx ON category_nodes_v1(parent_id)`,
      `CREATE INDEX IF NOT EXISTS category_nodes_v1_leaf_idx ON category_nodes_v1(is_leaf)`,
      `CREATE TABLE IF NOT EXISTS governance_runs_v1 (
        id BIGSERIAL PRIMARY KEY,
        version TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        group_depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        output_dir TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS attribute_templates_v1 (
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT REFERENCES governance_runs_v1(id),
        version TEXT NOT NULL,
        category_id TEXT NOT NULL,
        category_path_json JSONB NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        template_json JSONB NOT NULL,
        raw_response TEXT,
        validation_status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS attribute_templates_v1_category_idx ON attribute_templates_v1(category_id, version)`,
    ],
  },
];
