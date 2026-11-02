import { main } from "../../cli.ts";

if (import.meta.main) {
  main(["scenario:run", "category_governance_plus", ...Bun.argv.slice(2)]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
