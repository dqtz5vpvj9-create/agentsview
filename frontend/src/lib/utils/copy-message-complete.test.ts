import { describe, expect, it } from "vite-plus/test";
import type { Message } from "../api/types.js";
import { formatMessageForCopy } from "./copy-message.js";

function copy(tool: string, input: string): string {
  return formatMessageForCopy({
    content: "Explanation",
    tool_calls: [{ tool_name: tool, input_json: input, result_content: "Result" }],
  } as Message);
}

describe("complete message copying", () => {
  it("retains the last lines of long commands and patches", () => {
    const lines = Array.from({ length: 350 }, (_, i) => `line ${i}`).join("\n");
    expect(copy("Bash", JSON.stringify({ command: lines }))).toContain("line 349");
    const edit = copy("Edit", JSON.stringify({ old_string: lines, new_string: "replacement" }));
    expect(edit).toContain("-line 349\n+replacement");
    expect(edit).not.toContain("lines total");
  });

  it("copies a complete new file rather than its preview", () => {
    const content = Array.from({ length: 350 }, (_, i) => `value ${i}`).join("\n");
    expect(copy("Write", JSON.stringify({ content }))).toContain("+value 349");
  });

  it("includes agent prompts and nested custom input", () => {
    expect(copy("Agent", JSON.stringify({ prompt: "Investigate the complete trace" })))
      .toContain("prompt: Investigate the complete trace");
    expect(copy("custom", '{"options":{"enabled":false},"limit":null,"text":""}'))
      .toContain('options: {"enabled":false}\nlimit: null\ntext: ""');
  });

  it.each(["not json\nsecond line", "null", "[1,2,3]", '"literal"', "false"])(
    "preserves unsupported input %s and still includes the result",
    (input) => {
      const text = copy("custom", input);
      expect(text).toContain(input);
      expect(text).toContain("Explanation");
      expect(text).toContain("Result");
    },
  );

  it("preserves full paths and camelCase edit content", () => {
    const text = copy("Edit", JSON.stringify({
      filePath: "/workspace/project/src/feature.ts",
      oldString: "before",
      newString: "after",
      replaceAll: false,
    }));
    expect(text).toContain("file: /workspace/project/src/feature.ts");
    expect(text).toContain("-before\n+after");
    expect(text).toContain("replaceAll: false");
  });
});
