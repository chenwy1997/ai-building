import { assertScenarioName } from "../platform/database/names.ts";
import type { ScenarioModule } from "./types.ts";
import { categoryGovernanceScenario } from "./category_governance/index.ts";

import { categoryAttributesGovernanceScenario } from "./category_attributes_governance/index.ts";
import { categoryGovernancePlusScenario } from "./category_governance_plus/index.ts";
import { categoryAttributesGovernancePlusScenario } from "./category_attributes_governance_plus/index.ts";

// 新业务模块创建后，在这里导入并加入数组。
const scenarios: readonly ScenarioModule[] = [
  categoryGovernanceScenario,
  categoryAttributesGovernanceScenario,
  categoryGovernancePlusScenario,
  categoryAttributesGovernancePlusScenario,
];

for (const scenario of scenarios) assertScenarioName(scenario.name);

export function listScenarios(): readonly ScenarioModule[] {
  return scenarios;
}

export function getScenario(name: string): ScenarioModule {
  const scenario = scenarios.find((candidate) => candidate.name === name);
  if (!scenario) throw new Error(`未注册业务场景：${name}`);
  return scenario;
}
