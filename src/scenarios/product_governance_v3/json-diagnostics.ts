// Diagnostic-only grammar walk after JSON.parse has rejected the text. It never
// creates a value or repairs input; JSON.parse remains the acceptance boundary.
type Frame = {
  kind: "root" | "object" | "array";
  path: string;
  start: number;
  state: string;
  key?: string;
  index: number;
  objectId?: string;
};
type Fault = { offset: number; path: string; expected: string; reason: string };
const SPACE = /[ \t\r\n]/;
const HEX4 = /^[0-9a-fA-F]{4}$/;

export function jsonLocation(text: string, offset: number) {
  // Offsets/columns use JS UTF-16 code units, not UTF-8 bytes. CRLF is one newline.
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
  return { offset, line: lines.length, column: lines.at(-1)!.length + 1 };
}

export function diagnoseJsonSyntax(json: string, raw: string, rawStart: number) {
  const stack: Frame[] = [{ kind: "root", path: "$", start: 0, state: "value", index: 0 }];
  let pos = 0, lastCompletedPath: string | null = null;
  const fail = (expected: string, path: string, reason = "unexpected_token"): never => {
    throw { offset: pos, expected, path, reason } satisfies Fault;
  };
  const stringToken = (path: string) => {
    const start = pos++;
    while (pos < json.length) {
      const c = json[pos++]!;
      if (c === '"') return JSON.parse(json.slice(start, pos)) as string;
      if (c.charCodeAt(0) < 0x20) { pos--; fail("escaped control character in string", path); }
      if (c === "\\") {
        if (pos === json.length) fail("string escape character", path, "unexpected_eof");
        const escaped = json[pos++]!;
        if (escaped === "u") {
          if (!HEX4.test(json.slice(pos, pos + 4))) fail("four hexadecimal digits after \\u", path);
          pos += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) { pos--; fail("valid JSON string escape", path); }
      }
    }
    return fail("closing double quote", path, "unexpected_eof");
  };
  const propertyPath = (frame: Frame) => /^[A-Za-z_$][\w$]*$/.test(frame.key!)
    ? `${frame.path}.${frame.key}` : `${frame.path}[${JSON.stringify(frame.key)}]`;
  const consumeValue = (frame: Frame, path: string) => {
    const c = json[pos];
    frame.state = "after";
    if (c === "{" || c === "[") {
      if (stack.length >= 256) fail("refer to parser error; diagnostic nesting limit reached", path, "diagnostic_limit");
      stack.push({ kind: c === "{" ? "object" : "array", path, start: pos++, state: "first", index: 0 });
      return;
    }
    if (c === '"') {
      const value = stringToken(path);
      if (frame.kind === "object" && frame.key === "objectId") frame.objectId = value;
    } else if (c !== undefined && /[-0-9]/.test(c)) {
      const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      number.lastIndex = pos;
      if (!number.exec(json)) fail("JSON number", path);
      pos = number.lastIndex;
    } else {
      const literal = ["true", "false", "null"].find(v => json.startsWith(v, pos));
      if (!literal) fail("JSON value (object, array, string, number, true, false or null)", path,
        pos === json.length ? "unexpected_eof" : "unexpected_token");
      pos += literal!.length;
    }
    lastCompletedPath = path;
  };
  const close = () => { lastCompletedPath = stack.pop()!.path; pos++; };
  let fault: Fault;
  try {
    while (true) {
      while (pos < json.length && SPACE.test(json[pos]!)) pos++;
      const frame = stack.at(-1)!, c = json[pos];
      if (frame.kind === "root") {
        if (frame.state === "value") { consumeValue(frame, "$"); continue; }
        if (pos < json.length) fail("end of JSON after the root value", "$");
        // Do not accept a value on this path, even if the walker found no fault.
        fail("refer to the native JSON parser error", "$", "parser_only");
      }
      if (frame.kind === "object") {
        if (frame.state === "first" || frame.state === "key") {
          if (c === "}" && frame.state === "first") { close(); continue; }
          if (c !== '"') fail(frame.state === "first" ? 'quoted property name or "}"' : "quoted property name after object comma", frame.path,
            pos === json.length ? "unexpected_eof" : "unexpected_token");
          frame.key = stringToken(frame.path); frame.state = "colon"; continue;
        }
        if (frame.state === "colon") {
          if (c !== ":") fail('":" after property name', propertyPath(frame));
          pos++; frame.state = "value"; continue;
        }
        if (frame.state === "value") { consumeValue(frame, propertyPath(frame)); continue; }
        if (c === "}") { close(); continue; }
        if (c !== ",") fail('"," or "}" after object value', frame.path,
          pos === json.length ? "unexpected_eof" : "unexpected_token");
        pos++; frame.state = "key"; continue;
      }
      if (frame.state === "first" || frame.state === "value") {
        if (c === "]" && frame.state === "first") { close(); continue; }
        consumeValue(frame, `${frame.path}[${frame.index}]`); continue;
      }
      if (c === "]") { close(); continue; }
      if (c !== ",") fail('"," or "]" after array value', frame.path,
        pos === json.length ? "unexpected_eof" : "unexpected_token");
      pos++; frame.index++; frame.state = "value";
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("offset" in error)) throw error;
    fault = error as Fault;
  }
  const container = stack.at(-1)!, start = Math.max(0, fault.offset - 120), end = Math.min(json.length, fault.offset + 120);
  const objectId = [...stack].reverse().find(f => f.objectId)?.objectId ?? null;
  return {
    kind: "json_syntax" as const,
    reason: fault.reason,
    offsetUnit: "utf16_code_unit" as const,
    offsetBase: 0, lineAndColumnBase: 1,
    location: jsonLocation(json, fault.offset),
    rawLocation: jsonLocation(raw, rawStart + fault.offset),
    path: fault.path.slice(0, 512), pathTruncated: fault.path.length > 512,
    container: { kind: container.kind, path: container.path.slice(0, 512), openOffset: container.start },
    objectId: objectId?.slice(0, 160) ?? null,
    lastCompletedPath: (lastCompletedPath as string | null)?.slice(0, 512) ?? null,
    expected: fault.expected,
    found: fault.offset === json.length ? "end of input" : json[fault.offset],
    excerpt: { startOffset: start, text: json.slice(start, end), caretOffset: fault.offset - start },
    hint: 'Check delimiters/quotes at and before this position; the error location is not an automatic repair suggestion.',
  };
}
