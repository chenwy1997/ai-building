export interface AgentContext {
  signal?: AbortSignal;
}

/** 业务场景可实现的最小 Agent 契约；不绑定任何智能体框架。 */
export interface Agent<TInput, TOutput> {
  readonly name: string;
  run(input: TInput, context?: AgentContext): Promise<TOutput>;
}
