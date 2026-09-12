const VERSION = "v1";
const ALGORITHM = "AES-GCM";

function decodeMasterKey(base64Key: string): Uint8Array<ArrayBuffer> {
  const key = Uint8Array.from(Buffer.from(base64Key, "base64"));
  if (key.byteLength !== 32) {
    throw new Error("AI_BUILDING_MASTER_KEY 必须是 32 字节的 Base64 字符串");
  }
  return key as Uint8Array<ArrayBuffer>;
}

export class SecretBox {
  readonly #key: Promise<CryptoKey>;

  constructor(base64Key: string) {
    this.#key = crypto.subtle.importKey(
      "raw",
      decodeMasterKey(base64Key),
      ALGORITHM,
      false,
      ["encrypt", "decrypt"],
    );
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      await this.#key,
      new TextEncoder().encode(plaintext),
    );

    return [
      VERSION,
      Buffer.from(iv).toString("base64"),
      Buffer.from(ciphertext).toString("base64"),
    ].join(":");
  }

  async decrypt(payload: string): Promise<string> {
    const [version, ivValue, ciphertextValue, ...extra] = payload.split(":");
    if (
      version !== VERSION ||
      !ivValue ||
      !ciphertextValue ||
      extra.length > 0
    ) {
      throw new Error("无法识别的密文格式");
    }

    const plaintext = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: Uint8Array.from(Buffer.from(ivValue, "base64")),
      },
      await this.#key,
      Uint8Array.from(Buffer.from(ciphertextValue, "base64")),
    );
    return new TextDecoder().decode(plaintext);
  }
}
