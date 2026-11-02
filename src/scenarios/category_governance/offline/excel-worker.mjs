// Run artifact-tool in the bundled Node runtime; the pipeline itself remains Bun.
import { writeExcel } from "./excel.ts";
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
await writeExcel(JSON.parse(input), process.argv[2]);
