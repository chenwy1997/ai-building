export type LogFormat = "human" | "json" | "quiet";
export function logFormat(value = "human"): LogFormat {
  if (!["human", "json", "quiet"].includes(value)) throw Error("--log-format must be human, json or quiet");
  return value as LogFormat;
}
export function progressLogger(format: LogFormat,
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error) {
  return (event: Record<string, unknown>) => {
    if (format === "quiet") return;
    const failed = event.status === "program_blocked";
    const phase = event.phase === "family-seed" ? "同族基线" : "类目方案";
    const name = String(event.category ?? event.categoryId ?? "");
    const label = event.event === "started" ? "开始" : event.event === "model-request"
      ? "模型请求" : event.event === "output-capacity-recovery" ? "输出截断续跑" : event.event === "model-response" ? event.cached ? "读取缓存" : "模型响应"
      : failed ? "阻断" : event.proposalReadiness === "no_admitted_attributes"
        ? "零属性，建模缺口待审" : "已有方案，待人工审阅";
    const line = format === "json" ? JSON.stringify(event) :
      `[${label}] ${phase} · ${name}${event.code ? " · " + event.code : ""}${event.code === "budget_exhausted" ? "（本地预留额度触顶，不代表账号余额不足）" : ""}`;
    (failed ? err : out)(line + (format === "human" && event.round ? " · 第" + event.round + "轮" : "") +
      (format === "human" && event.model ? " · " + event.model + " / 思考=" + event.reasoningEffort : "") +
      (format === "human" && event.event === "output-capacity-recovery" ? " · 输出上限=" + event.maxOutputTokens : ""));
  };
}
