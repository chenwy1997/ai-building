import { Blocked } from "./core.ts";

export const INVALID_CURSOR_MESSAGE = "cursor does not match query/version";
// Only known argument errors enter bounded model correction. Source integrity,
// permissions, unsupported tools and infrastructure failures stay distinct.
export function correctableToolError(error: unknown): Blocked | null {
  if (error instanceof Blocked && error.code === "pool_scope") return error;
  if (error instanceof Error && error.message === INVALID_CURSOR_MESSAGE)
    return new Blocked("tool_arguments", "Invalid pagination cursor. For the first page use JSON null (not the string \"null\"); for later pages use the exact nextCursor returned for the same query/version. To restart a changed query use cursor:null. No page was returned for this call.");
  return null;
}
export function resumableFailure(job: { status: string; code: string | null; error: string | null }):
  "local_budget_stop" | "cursor_feedback_host_fix" | null {
  if (job.status !== "program_blocked") return null;
  if (job.code === "budget_exhausted" ||
      (job.code === "batch_stopped" && job.error?.includes("batch cumulative reservation exceeds limit"))) return "local_budget_stop";
  if (job.code === "stage_error" && job.error === "Error: " + INVALID_CURSOR_MESSAGE) return "cursor_feedback_host_fix";
  return null;
}
