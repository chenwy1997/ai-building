export type OpenAiRole = "developer" | "system" | "user" | "assistant" | "tool";

export interface OpenAiMessage {
  role: OpenAiRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: Record<string, unknown>;
  thinking?: { type: "enabled" | "disabled" };
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: false;
}

export interface OpenAiChatChoice {
  index: number;
  message: OpenAiMessage;
  finish_reason: string | null;
}

export interface OpenAiUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
}

export interface OpenAiChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiChatChoice[];
  usage?: OpenAiUsage;
}

export interface AiProviderRecord {
  code: string;
  displayName: string;
  baseUrl: string;
  apiKeyCiphertext: string | null;
  extraHeaders: Record<string, string>;
  enabled: boolean;
}

export interface AiModelRecord {
  providerCode: string;
  code: string;
  remoteModel: string;
  displayName: string;
  defaults: Partial<OpenAiChatRequest>;
  enabled: boolean;
}

export interface AiCatalog {
  getProvider(code: string): Promise<AiProviderRecord | null>;
  getModel(providerCode: string, code: string): Promise<AiModelRecord | null>;
}
