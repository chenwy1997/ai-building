import { Blocked } from "./core.ts";
import type { ResponseBody } from "./responses.ts";

export type TerminalStatus = "completed" | "incomplete" | "failed";
export function assertTerminalResponse(value: unknown): asserts value is ResponseBody {
  const v = value as any;
  if (!v || typeof v !== "object" || !Array.isArray(v.output) ||
      !["completed", "incomplete", "failed"].includes(v.status))
    throw new Blocked("incomplete_response", "valid terminal response with output array required");
  if (v.status === "incomplete" && !["max_output_tokens", "content_filter"].includes(v.incomplete_details?.reason))
    throw new Blocked("incomplete_response", "incomplete response has no recognized terminal reason");
  if (v.status === "failed" && (typeof v.error?.code !== "string" || typeof v.error?.message !== "string"))
    throw new Blocked("incomplete_response", "failed response has no structured provider error");
  // Incomplete items may contain partial JSON/calls. Save them, but never execute
  // or parse them as a completed business proposal.
  if (v.status !== "completed") return;
  for (const item of v.output) {
    if (!item || !["function_call", "message", "reasoning"].includes(item.type))
      throw new Blocked("unsupported_output", "unregistered response item type");
    if (item.type === "function_call" && (!item.call_id || typeof item.call_id !== "string" ||
        typeof item.name !== "string" || typeof item.arguments !== "string"))
      throw new Blocked("bad_tool_call", "invalid function call");
  }
}
export function isOutputTruncated(response: ResponseBody) {
  return response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens";
}
export function terminalFailure(response: ResponseBody) {
  return new Blocked(response.status === "failed" ? "provider_failed" : "incomplete_response",
    "provider response " + response.status + ": " + (response.incomplete_details?.reason ?? response.error?.code ?? "unknown"));
}
