export const PUBLIC_DATABASE_NAME = "ai-building-public";

const SCENARIO_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

export function assertScenarioName(name: string): void {
  if (!SCENARIO_NAME_PATTERN.test(name)) {
    throw new Error(
      `业务场景名不合法：${name}。请使用 snake_case，例如 product_match`,
    );
  }
}

export function scenarioDatabaseName(scenarioName: string): string {
  assertScenarioName(scenarioName);
  return `ai-building-${scenarioName}`;
}

export function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function redactDatabaseUrl(urlValue: string): string {
  const url = new URL(urlValue);
  if (url.password) url.password = "***";
  return url.toString();
}
