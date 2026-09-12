import type { Migration } from "./migrations.ts";

export const publicMigrations: readonly Migration[] = [
  {
    id: "001_public_settings",
    description: "公共配置和敏感配置",
    statements: [
      `
        CREATE TABLE public_settings (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json JSONB,
          secret_ciphertext TEXT,
          description TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (namespace, key),
          CONSTRAINT public_settings_one_value CHECK (
            (value_json IS NOT NULL)::INTEGER +
            (secret_ciphertext IS NOT NULL)::INTEGER = 1
          )
        )
      `,
    ],
  },
  {
    id: "002_ai_catalog",
    description: "OpenAI 兼容服务商和模型目录",
    statements: [
      `
        CREATE TABLE ai_providers (
          code TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key_ciphertext TEXT,
          extra_headers JSONB NOT NULL DEFAULT '{}'::JSONB,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE ai_models (
          provider_code TEXT NOT NULL REFERENCES ai_providers(code),
          code TEXT NOT NULL,
          remote_model TEXT NOT NULL,
          display_name TEXT NOT NULL,
          defaults JSONB NOT NULL DEFAULT '{}'::JSONB,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (provider_code, code)
        )
      `,
    ],
  },
  {
    id: "003_deepseek_defaults",
    description: "内置 DeepSeek 服务商及模型",
    statements: [
      `
        INSERT INTO ai_providers (code, display_name, base_url)
        VALUES ('deepseek', 'DeepSeek', 'https://api.deepseek.com')
        ON CONFLICT (code) DO NOTHING
      `,
      `
        INSERT INTO ai_models (
          provider_code, code, remote_model, display_name, defaults
        ) VALUES
          ('deepseek', 'flash', 'deepseek-v4-flash', 'DeepSeek V4 Flash', '{}'::JSONB),
          ('deepseek', 'pro', 'deepseek-v4-pro', 'DeepSeek V4 Pro', '{}'::JSONB)
        ON CONFLICT (provider_code, code) DO NOTHING
      `,
    ],
  },
];
