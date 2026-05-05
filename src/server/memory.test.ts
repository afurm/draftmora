import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyMemoryReviewPatch,
  buildMemoryContextBlock,
  buildMemoryReviewPrompt,
  buildMemoryReviewSystemPrompt,
  parseMemoryReviewEntries,
  parseMemoryReviewPatch,
  reviewAndApplyMemory,
} from "./memory";
import type { CompletionRequest, CompletionResult } from "./providers/types";

describe("memory helpers", () => {
  it("filters sensitive reviewer output and normalizes plain entries", () => {
    const entries = parseMemoryReviewEntries(
      JSON.stringify({
        entries: [
          {
            target: "user",
            content: "The user's OpenAI API key is sk-test1234567890abcdef.",
          },
          {
            target: "user",
            content: "The user prefers concise § repo summaries.",
          },
        ],
      }),
    );

    expect(entries).toEqual([
      {
        target: "user",
        content: "The user prefers concise repo summaries.",
      },
    ]);
  });

  it("includes existing memory as duplicate-prevention context for the reviewer", () => {
    const prompt = buildMemoryReviewPrompt({
      existingMemoryContext: "The user's name is Andrii.",
      messages: [{ role: "user", content: "what is my name?" }],
    });

    expect(prompt).toContain("<existing-memory>");
    expect(prompt).toContain("The user's name is Andrii.");
    expect(prompt).toContain("Use existing memory only to avoid duplicates");
  });

  it("tells the reviewer to infer durable memory without fixed wording", () => {
    const systemPrompt = buildMemoryReviewSystemPrompt();
    const prompt = buildMemoryReviewPrompt({
      messages: [{ role: "user", content: "I usually want short repo summaries." }],
    });

    expect(systemPrompt).toContain("infer durable memory from meaning rather than fixed wording");
    expect(systemPrompt).toContain("include it exactly in remove");
    expect(prompt).toContain("Prioritize new durable facts from the latest user message");
  });

  it("parses reviewer removals for corrected durable memory", () => {
    const patch = parseMemoryReviewPatch(
      JSON.stringify({
        remove: [{ target: "user", content: "The user's name is Andrii." }],
        entries: [{ target: "user", content: "The user's name is Bohdan." }],
      }),
    );

    expect(patch).toEqual({
      remove: [{ target: "user", content: "The user's name is Andrii." }],
      entries: [{ target: "user", content: "The user's name is Bohdan." }],
    });
  });

  it("parses fenced reviewer JSON", () => {
    const patch = parseMemoryReviewPatch([
      "```json",
      JSON.stringify({
        entries: [{ target: "memory", content: "Draftmora uses semantic memory review." }],
        remove: [],
      }),
      "```",
    ].join("\n"));

    expect(patch.entries).toEqual([
      { target: "memory", content: "Draftmora uses semantic memory review." },
    ]);
    expect(patch.remove).toEqual([]);
  });

  it("applies reviewer corrections and keeps durable files deduped", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "draftmora-memory-"));
    try {
      writeFileSync(
        path.join(dir, "USER.md"),
        [
          "The user's name is Andrii.",
          "§",
          "The user prefers concise repo summaries.",
        ].join("\n"),
        "utf8",
      );

      applyMemoryReviewPatch(
        dir,
        parseMemoryReviewPatch(
          JSON.stringify({
            remove: [{ target: "user", content: "The user's name is Andrii." }],
            entries: [
              { target: "user", content: "The user's name is Bohdan." },
              { target: "user", content: "the user prefers concise repo summaries." },
            ],
          }),
        ),
      );

      const userMemory = readFileSync(path.join(dir, "USER.md"), "utf8");
      expect(userMemory).not.toContain("Andrii");
      expect(userMemory).toContain("The user's name is Bohdan.");
      expect(userMemory.match(/concise repo summaries/gi) ?? []).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not inject secret-shaped memory entries into provider context", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "draftmora-memory-"));
    try {
      writeFileSync(
        path.join(dir, "USER.md"),
        [
          "The user's API key is sk-test1234567890abcdef.",
          "§",
          "The user prefers concise repo summaries.",
        ].join("\n"),
        "utf8",
      );

      const context = buildMemoryContextBlock({ query: "status", rootDir: dir });

      expect(context).toContain("The user prefers concise repo summaries.");
      expect(context).not.toContain("sk-test1234567890abcdef");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compacts oldest memory entries when the durable file exceeds its limit", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "draftmora-memory-"));
    try {
      applyMemoryReviewPatch(dir, {
        remove: [],
        entries: Array.from({ length: 80 }, (_, index) => ({
          target: "user",
          content: `Preference ${index.toString().padStart(3, "0")}: ${"durable repo workflow ".repeat(4)}`,
        })),
      });

      const userMemory = readFileSync(path.join(dir, "USER.md"), "utf8");
      expect(userMemory.length).toBeLessThanOrEqual(4000);
      expect(userMemory).not.toContain("Preference 000");
      expect(userMemory).toContain("Preference 079");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies provider-reviewed memory through the shared helper", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "draftmora-memory-"));
    const requests: CompletionRequest[] = [];
    try {
      const providerRouter = {
        complete: async (request: CompletionRequest): Promise<CompletionResult> => {
          requests.push(request);
          return {
            content: JSON.stringify({
              entries: [
                {
                  target: "memory",
                  content: "Draftmora task review saves completed durable project facts.",
                },
              ],
              remove: [],
            }),
            raw: {} as CompletionResult["raw"],
          };
        },
      };

      const result = await reviewAndApplyMemory({
        providerRouter,
        provider: "openai",
        model: "gpt-5.5",
        memoryRoot: dir,
        source: "task",
        query: "release validation",
        messages: [
          { role: "user", content: "Run release validation." },
          { role: "assistant", content: "Completed typecheck, tests, and build." },
        ],
      });

      expect(result.applied).toBe(true);
      expect(requests[0]?.messages[0]?.content).toContain("completed Draftmora task execution");
      expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain(
        "completed durable project facts",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the selected model and warns on invalid reviewer output", async () => {
    const requests: CompletionRequest[] = [];
    const logger = { warn: vi.fn() };

    const result = await reviewAndApplyMemory({
      providerRouter: {
        complete: async (request: CompletionRequest): Promise<CompletionResult> => {
          requests.push(request);
          return { content: "not json", raw: {} as CompletionResult["raw"] };
        },
      },
      provider: "openai",
      model: "gpt-5.5",
      source: "chat",
      query: "remember this",
      messages: [{ role: "user", content: "remember my preferred model" }],
      logger,
    });

    expect(result).toMatchObject({ applied: false, model: "gpt-5.5", reason: "invalid_json" });
    expect(requests[0]?.model).toBe("gpt-5.5");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("returned invalid JSON"),
    );
  });
});
