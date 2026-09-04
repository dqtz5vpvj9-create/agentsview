import type { Message } from "../api/types.js";

/** Render complete tool input for copying, independently of UI preview limits. */
function formatInput(toolName: string, raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return raw;
  }

  const params = parsed as Record<string, unknown>;
  const excluded = new Set<string>();
  const body: string[] = [];
  const oldKeys = ["old_string", "old_str", "oldString", "oldStr"];
  const newKeys = ["new_string", "new_str", "newString", "newStr"];
  const oldKey = oldKeys.find((key) => typeof params[key] === "string");
  const newKey = newKeys.find((key) => typeof params[key] === "string");

  if ((toolName === "Edit" || params.command === "strReplace") && (oldKey || newKey)) {
    const before = String(oldKey ? params[oldKey] : "").split("\n");
    const after = String(newKey ? params[newKey] : "").split("\n");
    if (oldKey) excluded.add(oldKey);
    if (newKey) excluded.add(newKey);
    body.push(`@@ -1,${before.length} +1,${after.length} @@`);
    for (const line of before) body.push(`-${line}`);
    for (const line of after) body.push(`+${line}`);
  } else if (
    (toolName === "Write" || (toolName === "write" && params.command === "create")) &&
    typeof params.content === "string"
  ) {
    excluded.add("content");
    const lines = params.content.split("\n");
    body.push(`@@ -0,0 +1,${lines.length} @@`);
    for (const line of lines) body.push(`+${line}`);
  }

  const fields = Object.entries(params)
    .filter(([key]) => !excluded.has(key))
    .map(([key, value]) => {
      // Keep multiline strings readable and retain null/false/empty fields.
      const text = typeof value === "string" && value !== ""
        ? value
        : JSON.stringify(value);
      return `${key}: ${text}`;
    });
  return [...fields, ...body].join("\n") || raw;
}

/** Format a complete message, including untruncated tool inputs and results. */
export function formatMessageForCopy(message: Message): string {
  const parts: string[] = [];
  if (message.content) parts.push(message.content);

  for (const tc of message.tool_calls ?? []) {
    let path: unknown;
    if (tc.input_json) {
      try {
        const params: unknown = JSON.parse(tc.input_json);
        if (params !== null && typeof params === "object" && !Array.isArray(params)) {
          const record = params as Record<string, unknown>;
          path = record.file_path ?? record.path ?? record.filePath ?? record.file;
        }
      } catch {
        // Preserve non-JSON input below instead of dropping it.
      }
    }
    parts.push(`[${tc.tool_name}]${typeof path === "string" ? ` file: ${path}` : ""}`);
    if (tc.input_json) parts.push(formatInput(tc.tool_name, tc.input_json));
    if (tc.result_content) parts.push(tc.result_content);
  }
  return parts.join("\n\n");
}
