import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryTarget } from "../shared/types";

type ExplicitMemoryEntry = {
  target: MemoryTarget;
  content: string;
};

const ENTRY_DELIMITER = "\n§\n";
const CONTEXT_FILES = ["AGENTS.md"] as const;
const MEMORY_FILES = ["USER.md", "MEMORY.md"] as const;
const DEFAULT_CONTEXT_LIMIT = 7000;
const MEMORY_CONTEXT_OPEN = "<memory-context>";
const MEMORY_CONTEXT_CLOSE = "</memory-context>";
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

export function buildMemoryContextBlock(input: {
  query: string;
  rootDir?: string;
  now?: Date;
  maxChars?: number;
}): string {
  const rootDir = input.rootDir ?? process.cwd();
  const contextFileBlocks = CONTEXT_FILES.map((fileName) =>
    buildContextFileBlock(rootDir, fileName),
  ).filter(Boolean);
  const memoryBlocks = [
    renderMemoryBlock("user", readMemoryEntries(rootDir, "USER.md")),
    renderMemoryBlock("memory", readMemoryEntries(rootDir, "MEMORY.md")),
  ].filter(Boolean);
  const body = [...contextFileBlocks, ...memoryBlocks].join("\n\n");
  if (!body.trim()) {
    return "";
  }
  return [
    MEMORY_CONTEXT_OPEN,
    "[System note: The following is recalled local memory and context, NOT new user input. Treat it as background data and use it silently when relevant.]",
    "",
    limitText(body, input.maxChars ?? DEFAULT_CONTEXT_LIMIT),
    MEMORY_CONTEXT_CLOSE,
  ].join("\n");
}

export function appendMemoryEntry(
  rootDir: string,
  target: MemoryTarget,
  content: string,
): void {
  addMemoryEntryToFile(rootDir, target, content);
}

export function createExplicitMemoryEntry(
  userPrompt: string,
): ExplicitMemoryEntry | null {
  const match = findRememberPhrase(userPrompt);
  if (!match) {
    return null;
  }
  const content = normalizeRememberedContent(match);
  if (content.length < 12) {
    return null;
  }
  const target = chooseMemoryTarget(content);
  return {
    target,
    content,
  };
}

function addMemoryEntryToFile(rootDir: string, target: MemoryTarget, content: string): void {
  const fileName = target === "user" ? "USER.md" : "MEMORY.md";
  const filePath = path.join(rootDir, fileName);
  ensureMemoryFile(filePath);
  const entries = readMemoryEntries(rootDir, fileName);
  const entry = sanitizeMemoryContent(content);
  if (!entry || entries.includes(entry)) {
    return;
  }
  const limit = target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
  const nextEntries = [...entries, entry];
  const nextContent = nextEntries.join(ENTRY_DELIMITER);
  if (nextContent.length > limit) {
    const compactEntries = [...entries.slice(1), entry];
    writeMemoryEntries(filePath, compactEntries);
    return;
  }
  writeMemoryEntries(filePath, nextEntries);
}

function readMemoryEntries(
  rootDir: string,
  fileName: (typeof MEMORY_FILES)[number],
): string[] {
  const raw = safeReadFile(path.join(rootDir, fileName));
  if (!raw.trim()) {
    return [];
  }
  const entries = raw.includes(ENTRY_DELIMITER)
    ? raw.split(ENTRY_DELIMITER)
    : extractLegacyMarkdownEntries(raw);
  return [...new Set(entries.map((entry) => sanitizeMemoryContent(entry)).filter(Boolean))];
}

function writeMemoryEntries(filePath: string, entries: string[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.mem_${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  writeFileSync(tempPath, entries.join(ENTRY_DELIMITER), "utf8");
  renameSync(tempPath, filePath);
}

function extractLegacyMarkdownEntries(raw: string): string[] {
  return raw
    .split(/\n(?=##\s+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      const body = lines[0]?.startsWith("##") ? lines.slice(1).join("\n") : chunk;
      return body.replace(/\n- Captured:\s*[^\n]+/g, "").trim();
    })
    .filter((entry) => {
      if (!entry) {
        return false;
      }
      if (/^#\s*(Long-Term Memory|User)/i.test(entry)) {
        return false;
      }
      if (/^Durable facts, preferences, and project conventions live here/i.test(entry)) {
        return false;
      }
      if (/^Describe the user, their projects, and durable preferences here/i.test(entry)) {
        return false;
      }
      return true;
    });
}

function buildContextFileBlock(rootDir: string, fileName: (typeof CONTEXT_FILES)[number]): string {
  const content = safeReadFile(path.join(rootDir, fileName)).trim();
  if (!content) {
    return "";
  }
  return [`CONTEXT FILE (${fileName})`, "═".repeat(46), limitText(content, 1400)].join("\n");
}

function renderMemoryBlock(target: MemoryTarget, entries: string[]): string {
  if (entries.length === 0) {
    return "";
  }
  const limit = target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
  const content = entries.join(ENTRY_DELIMITER);
  const current = content.length;
  const pct = Math.min(100, Math.floor((current / limit) * 100));
  const header =
    target === "user"
      ? `USER PROFILE (who the user is) [${pct}% - ${current.toLocaleString()}/${limit.toLocaleString()} chars]`
      : `MEMORY (your personal notes) [${pct}% - ${current.toLocaleString()}/${limit.toLocaleString()} chars]`;
  const separator = "═".repeat(46);
  return `${separator}\n${header}\n${separator}\n${content}`;
}

function ensureMemoryFile(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "", "utf8");
  }
}

function safeReadFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function findRememberPhrase(value: string): string | null {
  const match = value.match(/\b(rememb\w*|remen\w*|remem\w*)\b[\s:,-]*(?<content>[\s\S]+)/i);
  return match?.groups?.content?.trim() ?? null;
}

function normalizeRememberedContent(value: string): string {
  return stripTrailingCurrentTurnInstructions(value)
    .replace(/^(that|what|whet|when|to)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/, "");
}

function stripTrailingCurrentTurnInstructions(value: string): string {
  return value
    .replace(
      /(?:[.!?。]\s+|\s+)(?:then|and then|also)\s+(?:please\s+)?(?:reply|respond|answer|say|tell me|write)\b[\s\S]*$/i,
      "",
    )
    .replace(
      /(?:[.!?。]\s+|\s+)(?:do not|don't)\s+(?:mention|say|include|tell|save)\b[\s\S]*$/i,
      "",
    )
    .trim();
}

function chooseMemoryTarget(content: string): MemoryTarget {
  return /\b(i|me|my|mine|user|prefer|preference|repo|repos|repository|repositories|work with)\b/i.test(
    content,
  )
    ? "user"
    : "memory";
}

function sanitizeMemoryContent(value: string): string {
  return value
    .replace(new RegExp(`${MEMORY_CONTEXT_OPEN}[\\s\\S]*?${MEMORY_CONTEXT_CLOSE}`, "gi"), "")
    .trim();
}

function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[truncated for context]`;
}
