import type {
  OpenAiChatRequest,
  OpenAiChatResponse,
} from "./types.ts";

export interface OpenAiCompatibleClientOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

export class OpenAiCompatibleClient {
  readonly #options: OpenAiCompatibleClientOptions;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.#options = options;
  }

  async chat(request: OpenAiChatRequest): Promise<OpenAiChatResponse> {
    const headers = new Headers({
      "content-type": "application/json",
      ...this.#options.headers,
    });
    if (this.#options.apiKey) {
      headers.set("authorization", `Bearer ${this.#options.apiKey}`);
    }

    const response = await fetch(chatCompletionsUrl(this.#options.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ ...request, stream: false }),
      signal: AbortSignal.timeout(this.#options.timeoutMs ?? 120_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(
        `模型请求失败（HTTP ${response.status}）：${detail || response.statusText}`,
      );
    }

    const result = (await response.json()) as OpenAiChatResponse;
    if (!Array.isArray(result.choices)) {
      throw new Error("服务商返回的内容不符合 OpenAI chat/completions 格式");
    }
    return result;
  }
}
