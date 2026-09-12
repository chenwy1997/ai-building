import { SecretBox } from "../platform/security/secret-box.ts";
import { OpenAiCompatibleClient } from "./openai-client.ts";
import type {
  AiCatalog,
  OpenAiChatRequest,
  OpenAiChatResponse,
} from "./types.ts";

export class AiService {
  readonly #catalog: AiCatalog;
  readonly #masterKey?: string;

  constructor(catalog: AiCatalog, masterKey?: string) {
    this.#catalog = catalog;
    this.#masterKey = masterKey;
  }

  async chat(
    providerCode: string,
    modelCode: string,
    request: Omit<OpenAiChatRequest, "model">,
  ): Promise<OpenAiChatResponse> {
    const [provider, model] = await Promise.all([
      this.#catalog.getProvider(providerCode),
      this.#catalog.getModel(providerCode, modelCode),
    ]);

    if (!provider?.enabled) throw new Error(`AI 服务商不存在或未启用：${providerCode}`);
    if (!model?.enabled) throw new Error(`AI 模型不存在或未启用：${modelCode}`);

    let apiKey: string | undefined;
    if (provider.apiKeyCiphertext) {
      if (!this.#masterKey) {
        throw new Error("缺少 AI_BUILDING_MASTER_KEY，无法解密模型 API Key");
      }
      apiKey = await new SecretBox(this.#masterKey).decrypt(
        provider.apiKeyCiphertext,
      );
    }

    const client = new OpenAiCompatibleClient({
      baseUrl: provider.baseUrl,
      apiKey,
      headers: provider.extraHeaders,
    });

    return client.chat({
      ...model.defaults,
      ...request,
      model: model.remoteModel,
      messages: request.messages,
      stream: false,
    });
  }
}
