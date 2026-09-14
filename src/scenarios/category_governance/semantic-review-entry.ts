import { revisionMain } from "./attribute-revision-entry.ts";

// 保留原 Bun 命令；历史响应解析器保留在 semantic-review.ts。
if (import.meta.main) revisionMain().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
