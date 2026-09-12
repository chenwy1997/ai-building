export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  postgresUrl: string;
  masterKey?: string;
  logLevel: LogLevel;
}

const DEFAULT_POSTGRES_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

export function loadAppConfig(
  env: Record<string, string | undefined> = Bun.env,
): AppConfig {
  const logLevelValue = env.AI_BUILDING_LOG_LEVEL ?? "info";

  if (!LOG_LEVELS.has(logLevelValue as LogLevel)) {
    throw new Error(
      `AI_BUILDING_LOG_LEVEL 不合法：${logLevelValue}，可选 debug/info/warn/error`,
    );
  }

  return {
    postgresUrl: env.AI_BUILDING_POSTGRES_URL ?? DEFAULT_POSTGRES_URL,
    masterKey: env.AI_BUILDING_MASTER_KEY || undefined,
    logLevel: logLevelValue as LogLevel,
  };
}
