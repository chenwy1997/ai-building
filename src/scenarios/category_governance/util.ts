export function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unnamed";
}

export function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    if (equal >= 0) {
      flags[arg.slice(2, equal)] = arg.slice(equal + 1);
    } else {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[arg.slice(2)] = next;
        i += 1;
      } else flags[arg.slice(2)] = "true";
    }
  }
  return { positionals, flags };
}

export function asInt(value: string | undefined, fallback: number, min = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : fallback;
}

export function boolFlag(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}
import { createHash } from "node:crypto";

export function shortCategoryId(id: string): string {
  return createHash("sha256").update(id).digest("base64url").slice(0, 10);
}
