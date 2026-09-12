import type { ScenarioModule } from "../types.ts";

/**
 * 复制此目录并改名后实现真实业务，再到 scenarios/registry.ts 注册。
 * 模板本身不会注册，也不会创建数据库。
 */
export const scenarioTemplate: ScenarioModule = {
  name: "replace_me",
  displayName: "替换为业务名称",
  description: "描述输入、处理过程和输出",
  migrations: [
    {
      id: "001_initial",
      description: "业务初始表",
      statements: [
        `
          CREATE TABLE jobs (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            input JSONB NOT NULL,
            output JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
      ],
    },
  ],
  commands: {
    async run({ args, databases }) {
      const database = databases.scenarioDatabase("replace_me");
      await database`
        INSERT INTO jobs (input)
        VALUES (${JSON.stringify({ args })}::JSONB)
      `;
      console.log("replace_me 场景任务已创建");
    },
  },
};
