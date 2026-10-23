import { Blocked, hash } from "./core.ts";

// Only remove a presentation envelope. Never repair keys, values, quotes or JSON syntax.
export function parseResultJson(raw: string) {
  let json = raw.trim(), envelope: "none" | "single_json_fence" = "none";
  try {
    return { result: JSON.parse(json) as unknown, envelope,
      rawTextHash: hash(raw), jsonTextHash: hash(json), businessValuesModified: false as const };
  } catch { /* A single, unambiguous Markdown block may contain otherwise valid JSON. */ }
  const blocks = [...raw.matchAll(/(?:^|\n)```(?:json)?[^\S\n]*\r?\n([\s\S]*?)\r?\n```[^\S\n]*(?=\r?\n|$)/g)];
  if (blocks.length !== 1 || (raw.match(/```/g) ?? []).length !== 2)
    throw new Blocked("final_json", "expected strict JSON or exactly one JSON code fence");
  const block = blocks[0]!, outside = raw.slice(0, block.index) + raw.slice(block.index! + block[0].length);
  if (/[{}\[\]]/.test(outside))
    throw new Blocked("final_json", "other structured content outside JSON fence is ambiguous");
  json = block[1]!;
  envelope = "single_json_fence";
  try {
    return { result: JSON.parse(json) as unknown, envelope,
      rawTextHash: hash(raw), jsonTextHash: hash(json), businessValuesModified: false as const };
  } catch {
    throw new Blocked("final_json", "JSON inside presentation envelope is invalid; no syntax repair performed");
  }
}

export function responseText(output: Record<string, any>[]) {
  const texts = output.filter((i) => i.type === "message").flatMap((i) =>
    Array.isArray(i.content) ? i.content.filter((c: any) => c.type === "output_text").map((c: any) => c.text) : []);
  if (texts.length !== 1 || typeof texts[0] !== "string")
    throw new Blocked("final_output", "exactly one JSON output_text required");
  return texts[0] as string;
}
