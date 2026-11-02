import type { Migration } from "../../platform/database/migrations.ts";

export const categoryGovernancePlusMigrations: readonly Migration[] = [
  {
    id: "001_category_governance_plus",
    description: "op 式类目变更：版本、op 日志、墓碑、每版本物化节点",
    statements: [
      `CREATE TABLE IF NOT EXISTS category_versions (
        version_no INTEGER PRIMARY KEY,
        base_version_no INTEGER,
        applied_op_count INTEGER NOT NULL DEFAULT 0,
        tree_hash TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        leaf_count INTEGER NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS category_ops (
        op_id TEXT PRIMARY KEY,
        base_version_no INTEGER NOT NULL,
        type TEXT NOT NULL,
        params JSONB NOT NULL,
        evidence JSONB,
        status TEXT NOT NULL DEFAULT 'proposed',
        decided_by TEXT,
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS category_ops_status_idx ON category_ops(status, base_version_no)`,
      `CREATE TABLE IF NOT EXISTS category_tombstones (
        old_id TEXT PRIMARY KEY,
        new_id TEXT,
        op_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS category_tombstones_new_id_idx ON category_tombstones(new_id)`,
      `CREATE TABLE IF NOT EXISTS category_version_nodes (
        version_no INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        path_json JSONB NOT NULL,
        enabled BOOLEAN NOT NULL,
        is_leaf BOOLEAN NOT NULL,
        category_id TEXT,
        PRIMARY KEY (version_no, node_id)
      )`,
      `CREATE INDEX IF NOT EXISTS category_version_nodes_leaf_idx ON category_version_nodes(version_no, is_leaf, enabled)`,
    ],
  },
];
