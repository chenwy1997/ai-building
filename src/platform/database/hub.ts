import { SQL } from "bun";
import {
  databaseUrl,
  PUBLIC_DATABASE_NAME,
  scenarioDatabaseName,
} from "./names.ts";

export class DatabaseHub implements AsyncDisposable {
  readonly #baseUrl: string;
  readonly #clients = new Map<string, SQL>();

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  publicDatabase(): SQL {
    return this.database(PUBLIC_DATABASE_NAME);
  }

  scenarioDatabase(scenarioName: string): SQL {
    return this.database(scenarioDatabaseName(scenarioName));
  }

  database(databaseName: string): SQL {
    const existing = this.#clients.get(databaseName);
    if (existing) return existing;

    const client = new SQL(databaseUrl(this.#baseUrl, databaseName), {
      max: 5,
      idleTimeout: 30,
      connectionTimeout: 10,
    });
    this.#clients.set(databaseName, client);
    return client;
  }

  async pingPublic(): Promise<void> {
    await this.publicDatabase()`SELECT 1`;
  }

  async pingScenario(scenarioName: string): Promise<void> {
    await this.scenarioDatabase(scenarioName)`SELECT 1`;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.close()));
    this.#clients.clear();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.closeAll();
  }
}
