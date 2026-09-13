import type { ScenarioModule } from "../types.ts";
import { categoryGovernanceMigrations } from "./migration.ts";
import { runCommand } from "./runner.ts";

export const categoryGovernanceScenario: ScenarioModule = {
  name: "category_governance",
  displayName: "标准类目治理",
  description: "拉取、压缩三横标准类目，并生成可追溯的 AI 属性模板",
  migrations: categoryGovernanceMigrations,
  commands: {
    run: async ({ args, databases, ai }) => runCommand({ args, database: databases.scenarioDatabase("category_governance"), ai }),
  },
};

export * from "./category-tree.ts";
export * from "./std-text.ts";
export * from "./template-codec.ts";
export * from "./prompt.ts";
export * from "./types.ts";
export * from "./storage.ts";
export * from "./consensus.ts";
export * from "./semantic-review.ts";
