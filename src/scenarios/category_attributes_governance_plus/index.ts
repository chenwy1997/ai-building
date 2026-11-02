import type { ScenarioModule } from "../types.ts";
import { categoryAttributesGovernancePlusMigrations } from "./migration.ts";
import { exportCommand, planCommand } from "./runner.ts";

export const categoryAttributesGovernancePlusScenario: ScenarioModule = {
  name: "category_attributes_governance_plus",
  displayName: "diff 式增量属性治理",
  description: "按类目 op 分桶：未变整份继承、merge/split 调和为草稿、add 占位待治理；只产出变化行的 diff",
  migrations: categoryAttributesGovernancePlusMigrations,
  commands: {
    plan: ({ args, databases }) => planCommand(databases, args),
    export: ({ args, databases }) => exportCommand(databases, args),
  },
};

export * from "./plan.ts";
