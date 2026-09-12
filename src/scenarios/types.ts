import type { AiService } from "../ai/service.ts";
import type { DatabaseHub } from "../platform/database/hub.ts";
import type { Migration } from "../platform/database/migrations.ts";

export interface ScenarioCommandContext {
  args: string[];
  databases: DatabaseHub;
  ai: AiService;
}

export type ScenarioCommand = (
  context: ScenarioCommandContext,
) => Promise<void>;

export interface ScenarioModule {
  /** snake_case；数据库会自动命名为 ai-building-<name>。 */
  name: string;
  displayName: string;
  description: string;
  migrations: readonly Migration[];
  commands: Record<string, ScenarioCommand>;
}
