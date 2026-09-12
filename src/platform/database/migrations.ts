import type { SQL } from "bun";

export interface Migration {
  id: string;
  description: string;
  statements: readonly string[];
}

interface AppliedMigrationRow {
  id: string;
}

export async function runMigrations(
  database: SQL,
  migrations: readonly Migration[],
): Promise<string[]> {
  await database.unsafe(`
    CREATE TABLE IF NOT EXISTS _ai_building_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const rows = await database<AppliedMigrationRow[]>`
    SELECT id FROM _ai_building_migrations
  `;
  const applied = new Set(rows.map((row) => row.id));
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    await database.begin(async (transaction) => {
      for (const statement of migration.statements) {
        await transaction.unsafe(statement);
      }
      await transaction`
        INSERT INTO _ai_building_migrations (id, description)
        VALUES (${migration.id}, ${migration.description})
      `;
    });
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
