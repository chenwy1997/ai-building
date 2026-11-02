import type { ScenarioModule } from "../types.ts";
import { categoryGovernancePlusMigrations } from "./migration.ts";
import {
  adjudicateCalibrateCommand,
  adjudicateCommand,
  applyCommand,
  approveCommand,
  auditCommand,
  exportCommand,
  importCommand,
  mountScanCommand,
  nearDupCommand,
  proposeCommand,
  rejectCommand,
  statusCommand,
  suggestCommand,
  traceCommand,
  treeCommand,
} from "./runner.ts";

const NAME = "category_governance_plus";

export const categoryGovernancePlusScenario: ScenarioModule = {
  name: NAME,
  displayName: "op 式类目变更引擎",
  description: "人不直接编辑树，只审批 op；树是 op 日志的物化结果，任意版本可回放、可导出",
  migrations: categoryGovernancePlusMigrations,
  commands: {
    import: ({ args, databases }) => importCommand(databases.scenarioDatabase(NAME), args),
    propose: ({ args, databases }) => proposeCommand(databases.scenarioDatabase(NAME), args),
    approve: ({ args, databases }) => approveCommand(databases.scenarioDatabase(NAME), args),
    reject: ({ args, databases }) => rejectCommand(databases.scenarioDatabase(NAME), args),
    apply: ({ args, databases }) => applyCommand(databases.scenarioDatabase(NAME), args),
    export: ({ args, databases }) => exportCommand(databases.scenarioDatabase(NAME), args),
    status: ({ databases }) => statusCommand(databases.scenarioDatabase(NAME)),
    suggest: ({ args, databases }) => suggestCommand(databases.scenarioDatabase(NAME), args),
    audit: ({ args, databases }) => auditCommand(databases.scenarioDatabase(NAME), args),
    tree: ({ args, databases }) => treeCommand(databases.scenarioDatabase(NAME), args),
    trace: ({ args, databases }) => traceCommand(databases.scenarioDatabase(NAME), args),
    adjudicate: ({ args, databases }) => adjudicateCommand(databases.scenarioDatabase(NAME), args),
    "adjudicate-calibrate": ({ args }) => adjudicateCalibrateCommand(args),
    "mount-scan": ({ args, databases }) => mountScanCommand(databases.scenarioDatabase(NAME), args),
    "near-dup": ({ args, databases }) => nearDupCommand(databases.scenarioDatabase(NAME), args),
  },
};

export * from "./ops.ts";
export * from "./engine.ts";
export * from "./suggest.ts";
export * from "./audit.ts";
export * from "./tree.ts";
export * from "./trace.ts";
export * from "./adjudicate.ts";
export * from "./mount-scan.ts";
export * from "./near-dup.ts";
