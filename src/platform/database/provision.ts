import { SQL } from "bun";
import type { Migration } from "./migrations.ts";
import { runMigrations } from "./migrations.ts";
import { databaseUrl } from "./names.ts";

interface DatabaseExistsRow {
  exists: boolean;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export interface ProvisionResult {
  databaseName: string;
  created: boolean;
  appliedMigrations: string[];
}

export async function provisionDatabase(
  baseUrl: string,
  databaseName: string,
  migrations: readonly Migration[] = [],
): Promise<ProvisionResult> {
  const admin = new SQL(baseUrl, { max: 1, connectionTimeout: 10 });
  let created = false;

  try {
    const [row] = await admin<DatabaseExistsRow[]>`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      ) AS exists
    `;

    if (!row?.exists) {
      await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      created = true;
    }
  } finally {
    await admin.close();
  }

  const database = new SQL(databaseUrl(baseUrl, databaseName), {
    max: 1,
    connectionTimeout: 10,
  });
  try {
    const appliedMigrations = await runMigrations(database, migrations);
    return { databaseName, created, appliedMigrations };
  } finally {
    await database.close();
  }
}
