import { afterEach, describe, expect, test } from "bun:test";
import { OpenAiCompatibleClient } from "../src/ai/openai-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI 兼容客户端", () => {
  test("使用原生 fetch 发送 chat/completions 请求", async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("https://api.example.com/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-key",
      );
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "test-model",
        stream: false,
      });

      return new Response(
        JSON.stringify({
          id: "response-1",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const client = new OpenAiCompatibleClient({
      baseUrl: "https://api.example.com/v1/",
      apiKey: "test-key",
    });
    const response = await client.chat({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.choices[0]?.message.content).toBe("ok");
  });
});
