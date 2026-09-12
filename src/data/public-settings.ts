import type { SQL } from "bun";
import type { SecretBox } from "../platform/security/secret-box.ts";

interface SettingRow {
  value_json: unknown;
  secret_ciphertext: string | null;
}

export class PublicSettingsRepository {
  readonly #database: SQL;
  readonly #secretBox?: SecretBox;

  constructor(publicDatabase: SQL, secretBox?: SecretBox) {
    this.#database = publicDatabase;
    this.#secretBox = secretBox;
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const row = await this.find(namespace, key);
    return row ? (row.value_json as T) : null;
  }

  async set(
    namespace: string,
    key: string,
    value: unknown,
    description?: string,
  ): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError("公共配置值必须可以序列化为 JSON");

    await this.#database`
      INSERT INTO public_settings (
        namespace, key, value_json, secret_ciphertext, description
      ) VALUES (${namespace}, ${key}, ${json}::JSONB, NULL, ${description ?? null})
      ON CONFLICT (namespace, key) DO UPDATE SET
        value_json = EXCLUDED.value_json,
        secret_ciphertext = NULL,
        description = EXCLUDED.description,
        updated_at = NOW()
    `;
  }

  async getSecret(namespace: string, key: string): Promise<string | null> {
    const row = await this.find(namespace, key);
    if (!row?.secret_ciphertext) return null;
    if (!this.#secretBox) throw new Error("读取敏感配置需要 AI_BUILDING_MASTER_KEY");
    return this.#secretBox.decrypt(row.secret_ciphertext);
  }

  async setSecret(
    namespace: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<void> {
    if (!this.#secretBox) throw new Error("写入敏感配置需要 AI_BUILDING_MASTER_KEY");
    const ciphertext = await this.#secretBox.encrypt(value);

    await this.#database`
      INSERT INTO public_settings (
        namespace, key, value_json, secret_ciphertext, description
      ) VALUES (${namespace}, ${key}, NULL, ${ciphertext}, ${description ?? null})
      ON CONFLICT (namespace, key) DO UPDATE SET
        value_json = NULL,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        description = EXCLUDED.description,
        updated_at = NOW()
    `;
  }

  private async find(namespace: string, key: string): Promise<SettingRow | null> {
    const [row] = await this.#database<SettingRow[]>`
      SELECT value_json, secret_ciphertext
      FROM public_settings
      WHERE namespace = ${namespace} AND key = ${key}
    `;
    return row ?? null;
  }
}
