import { describe, expect, it } from "vitest";
import type { ToolCall } from "@mariozechner/pi-ai";
import { executeLocalToolCall } from "./local-agent-tools";

describe("local agent tools", () => {
  it("marks failed shell commands as errors with readable output", async () => {
    const result = await executeLocalToolCall({
      type: "toolCall",
      id: "call-fail",
      name: "run_shell",
      arguments: {
        cmd: "node -e \"console.error('lint failed: trailing whitespace'); process.exit(2)\"",
      },
    } satisfies ToolCall);

    expect(result.message.isError).toBe(true);
    expect(result.summary).toContain("run_shell");
    expect(result.summary).toContain("failed");
    expect(result.summary).toContain("exit code: 2");
    expect(result.summary).toContain("lint failed: trailing whitespace");
  });
});
