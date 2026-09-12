import type { SQL } from "bun";
import type {
  AiCatalog,
  AiModelRecord,
  AiProviderRecord,
  OpenAiChatRequest,
} from "../ai/types.ts";

interface ProviderRow {
  code: string;
  display_name: string;
  base_url: string;
  api_key_ciphertext: string | null;
  extra_headers: Record<string, string>;
  enabled: boolean;
}

interface ModelRow {
  provider_code: string;
  code: string;
  remote_model: string;
  display_name: string;
  defaults: Partial<OpenAiChatRequest>;
  enabled: boolean;
}

export interface UpsertProviderInput {
  code: string;
  displayName: string;
  baseUrl: string;
  apiKeyCiphertext?: string | null;
  extraHeaders?: Record<string, string>;
  enabled?: boolean;
}

export interface UpsertModelInput {
  providerCode: string;
  code: string;
  remoteModel: string;
  displayName: string;
  defaults?: Partial<OpenAiChatRequest>;
  enabled?: boolean;
}

export class PostgresAiCatalog implements AiCatalog {
  readonly #database: SQL;

  constructor(publicDatabase: SQL) {
    this.#database = publicDatabase;
  }

  async getProvider(code: string): Promise<AiProviderRecord | null> {
    const [row] = await this.#database<ProviderRow[]>`
      SELECT code, display_name, base_url, api_key_ciphertext, extra_headers, enabled
      FROM ai_providers
      WHERE code = ${code}
    `;
    return row
      ? {
          code: row.code,
          displayName: row.display_name,
          baseUrl: row.base_url,
          apiKeyCiphertext: row.api_key_ciphertext,
          extraHeaders: row.extra_headers,
          enabled: row.enabled,
        }
      : null;
  }

  async getModel(
    providerCode: string,
    code: string,
  ): Promise<AiModelRecord | null> {
    const [row] = await this.#database<ModelRow[]>`
      SELECT provider_code, code, remote_model, display_name, defaults, enabled
      FROM ai_models
      WHERE provider_code = ${providerCode} AND code = ${code}
    `;
    return row
      ? {
          providerCode: row.provider_code,
          code: row.code,
          remoteModel: row.remote_model,
          displayName: row.display_name,
          defaults: row.defaults,
          enabled: row.enabled,
        }
      : null;
  }

  async upsertProvider(input: UpsertProviderInput): Promise<void> {
    const headers = JSON.stringify(input.extraHeaders ?? {});
    await this.#database`
      INSERT INTO ai_providers (
        code, display_name, base_url, api_key_ciphertext, extra_headers, enabled
      ) VALUES (
        ${input.code}, ${input.displayName}, ${input.baseUrl},
        ${input.apiKeyCiphertext ?? null}, ${headers}::JSONB, ${input.enabled ?? true}
      )
      ON CONFLICT (code) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        base_url = EXCLUDED.base_url,
        api_key_ciphertext = COALESCE(
          EXCLUDED.api_key_ciphertext,
          ai_providers.api_key_ciphertext
        ),
        extra_headers = EXCLUDED.extra_headers,
        enabled = EXCLUDED.enabled,
        updated_at = NOW()
    `;
  }

  async upsertModel(input: UpsertModelInput): Promise<void> {
    const defaults = JSON.stringify(input.defaults ?? {});
    await this.#database`
      INSERT INTO ai_models (
        provider_code, code, remote_model, display_name, defaults, enabled
      ) VALUES (
        ${input.providerCode}, ${input.code}, ${input.remoteModel},
        ${input.displayName}, ${defaults}::JSONB, ${input.enabled ?? true}
      )
      ON CONFLICT (provider_code, code) DO UPDATE SET
        remote_model = EXCLUDED.remote_model,
        display_name = EXCLUDED.display_name,
        defaults = EXCLUDED.defaults,
        enabled = EXCLUDED.enabled,
        updated_at = NOW()
    `;
  }

  async setApiKey(code: string, ciphertext: string): Promise<void> {
    const result = await this.#database`
      UPDATE ai_providers
      SET api_key_ciphertext = ${ciphertext}, updated_at = NOW()
      WHERE code = ${code}
      RETURNING code
    `;
    if (result.length === 0) throw new Error(`AI 服务商不存在：${code}`);
  }
}
