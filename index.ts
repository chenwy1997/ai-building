export * from "./src/ai/index.ts";
export * from "./src/config/index.ts";
export * from "./src/data/index.ts";
export * from "./src/facilities/index.ts";
export * from "./src/platform/index.ts";
export * from "./src/scenarios/index.ts";

if (import.meta.main) {
  const { main } = await import("./src/cli.ts");
  await main();
}
