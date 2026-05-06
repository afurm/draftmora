import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  Boolean as TypeBoolean,
  Number as TypeNumber,
  Object as TypeObject,
  Optional,
  String as TypeString,
} from "typebox";
import type { Tool, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import type { TaskExecutionArtifact } from "../shared/types";
import { extractLocalToolResultArtifacts } from "./task-artifacts";

const DEFAULT_OUTPUT_LIMIT = 30_000;
const MAX_OUTPUT_LIMIT = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const DEFAULT_FILE_BYTES = 80_000;
const MAX_FILE_BYTES = 300_000;
const DEFAULT_LIST_DEPTH = 2;
const MAX_LIST_DEPTH = 8;
const SKIPPED_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

export const LOCAL_AGENT_TOOLS: Tool[] = [
  {
    name: "list_files",
    description:
      "List files and folders under a directory. Use this before changing an unfamiliar workspace.",
    parameters: TypeObject({
      path: Optional(TypeString({ description: "Directory to inspect. Relative paths use cwd." })),
      cwd: Optional(TypeString({ description: "Base directory for relative paths." })),
      maxDepth: Optional(TypeNumber({ description: "Directory depth to include. Default 2." })),
    }),
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 file from disk. Use this to inspect source, docs, configs, and errors before editing.",
    parameters: TypeObject({
      path: TypeString({ description: "File path to read. Relative paths use cwd." }),
      cwd: Optional(TypeString({ description: "Base directory for relative paths." })),
      maxBytes: Optional(TypeNumber({ description: "Maximum bytes to return. Default 80000." })),
    }),
  },
  {
    name: "write_file",
    description:
      "Create or replace a UTF-8 file on disk, creating parent directories when needed. Use append only for logs or short notes.",
    parameters: TypeObject({
      path: TypeString({ description: "File path to write. Relative paths use cwd." }),
      content: TypeString({ description: "Complete UTF-8 file content to write or append." }),
      cwd: Optional(TypeString({ description: "Base directory for relative paths." })),
      append: Optional(TypeBoolean({ description: "Append instead of replacing the file." })),
    }),
  },
  {
    name: "run_shell",
    description:
      "Run a shell command locally for checks, setup, validation, inspection, and other task work. Use this when the task needs real execution.",
    parameters: TypeObject({
      cmd: TypeString({ description: "Shell command to run." }),
      cwd: Optional(TypeString({ description: "Working directory. Defaults to the app workspace." })),
      timeoutMs: Optional(TypeNumber({ description: "Timeout in milliseconds. Default 120000." })),
      maxOutputChars: Optional(TypeNumber({ description: "Output character limit. Default 30000." })),
    }),
  },
];

export type ExecutedLocalTool = {
  message: ToolResultMessage;
  summary: string;
  artifacts: TaskExecutionArtifact[];
};

export async function executeLocalToolCall(
  call: ToolCall,
  options: { signal?: AbortSignal } = {},
): Promise<ExecutedLocalTool> {
  const started = Date.now();
  try {
    throwIfToolRunCancelled(options.signal);
    const content = await executeToolByName(
      call.name,
      asRecord(call.arguments),
      options,
    );
    throwIfToolRunCancelled(options.signal);
    const isError = !toolResultOk(content);
    return {
      message: buildToolResult(call, content, isError),
      summary: summarizeToolCall(call, content, Date.now() - started),
      artifacts: isError ? [] : extractLocalToolResultArtifacts(call.name, content),
    };
  } catch (err) {
    if (isToolRunCancellationError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const content = JSON.stringify({ ok: false, error: message }, null, 2);
    return {
      message: buildToolResult(call, content, true),
      summary: `${call.name} failed: ${message}`,
      artifacts: [],
    };
  }
}

async function executeToolByName(
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal },
): Promise<string> {
  if (name === "list_files") {
    throwIfToolRunCancelled(options.signal);
    return listFiles(args);
  }
  if (name === "read_file") {
    throwIfToolRunCancelled(options.signal);
    return readTextFile(args);
  }
  if (name === "write_file") {
    throwIfToolRunCancelled(options.signal);
    return writeTextFile(args);
  }
  if (name === "run_shell") {
    return runShell(args, options);
  }
  throw new Error(`Unknown local tool: ${name}`);
}

async function listFiles(args: Record<string, unknown>): Promise<string> {
  const root = resolveToolPath(
    typeof args.path === "string" && args.path.trim() ? args.path : ".",
    stringArg(args.cwd),
  );
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error(`${root} is not a directory.`);
  }
  const maxDepth = clampNumber(args.maxDepth, DEFAULT_LIST_DEPTH, 0, MAX_LIST_DEPTH);
  const entries = await collectEntries(root, root, maxDepth, 0);
  return JSON.stringify(
    {
      ok: true,
      path: root,
      count: entries.length,
      entries,
    },
    null,
    2,
  );
}

async function collectEntries(
  root: string,
  current: string,
  maxDepth: number,
  depth: number,
): Promise<string[]> {
  const dirents = await readdir(current, { withFileTypes: true });
  const results: string[] = [];
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(current, dirent.name);
    const relativePath = path.relative(root, fullPath) || ".";
    if (dirent.isDirectory()) {
      results.push(`${relativePath}/`);
      if (depth < maxDepth && !SKIPPED_DIRS.has(dirent.name)) {
        results.push(...(await collectEntries(root, fullPath, maxDepth, depth + 1)));
      }
      continue;
    }
    results.push(relativePath);
  }
  return results;
}

async function readTextFile(args: Record<string, unknown>): Promise<string> {
  const target = resolveToolPath(requiredString(args.path, "path"), stringArg(args.cwd));
  const maxBytes = clampNumber(args.maxBytes, DEFAULT_FILE_BYTES, 1, MAX_FILE_BYTES);
  const buffer = await readFile(target);
  const truncated = buffer.byteLength > maxBytes;
  return JSON.stringify(
    {
      ok: true,
      path: target,
      bytes: buffer.byteLength,
      truncated,
      content: buffer.subarray(0, maxBytes).toString("utf8"),
    },
    null,
    2,
  );
}

async function writeTextFile(args: Record<string, unknown>): Promise<string> {
  const target = resolveToolPath(requiredString(args.path, "path"), stringArg(args.cwd));
  const content = requiredString(args.content, "content");
  await mkdir(path.dirname(target), { recursive: true });
  if (args.append === true) {
    await appendFile(target, content, "utf8");
  } else {
    await writeFile(target, content, "utf8");
  }
  return JSON.stringify(
    {
      ok: true,
      path: target,
      bytes: Buffer.byteLength(content, "utf8"),
      mode: args.append === true ? "append" : "replace",
    },
    null,
    2,
  );
}

async function runShell(
  args: Record<string, unknown>,
  options: { signal?: AbortSignal },
): Promise<string> {
  const cmd = requiredString(args.cmd, "cmd");
  const cwd = resolveToolPath(".", stringArg(args.cwd));
  const timeoutMs = clampNumber(
    args.timeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
    1_000,
    MAX_COMMAND_TIMEOUT_MS,
  );
  const maxOutputChars = clampNumber(
    args.maxOutputChars,
    DEFAULT_OUTPUT_LIMIT,
    1_000,
    MAX_OUTPUT_LIMIT,
  );
  const result = await spawnShell(cmd, cwd, timeoutMs, maxOutputChars, options.signal);
  return JSON.stringify({ ok: result.exitCode === 0, cmd, cwd, ...result }, null, 2);
}

function spawnShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
  maxOutputChars: number,
  signal?: AbortSignal,
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    throwIfToolRunCancelled(signal);
    const child = spawn(cmd, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    function cleanup() {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
      signal?.removeEventListener("abort", abortRun);
    }

    function abortRun() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortRun);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_500);
      reject(createToolRunCancellationError(signal));
    }

    timer = setTimeout(() => {
      child.kill("SIGTERM");
      truncated = true;
      settled = true;
      cleanup();
      resolve({
        exitCode: null,
        signal: "SIGTERM",
        timedOut: true,
        stdout,
        stderr,
        truncated,
      });
    }, timeoutMs);
    signal?.addEventListener("abort", abortRun, { once: true });

    const append = (value: Buffer, target: "stdout" | "stderr") => {
      const text = value.toString("utf8");
      if (target === "stdout") {
        stdout = truncateMiddle(stdout + text, maxOutputChars);
      } else {
        stderr = truncateMiddle(stderr + text, maxOutputChars);
      }
      truncated ||= stdout.length >= maxOutputChars || stderr.length >= maxOutputChars;
    };

    child.stdout?.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.on("error", (err) => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("close", (exitCode, signal) => {
      cleanup();
      if (!settled) {
        settled = true;
        resolve({
          exitCode,
          signal,
          timedOut: false,
          stdout,
          stderr,
          truncated,
        });
      }
    });
  });
}

function throwIfToolRunCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  throw createToolRunCancellationError(signal);
}

function createToolRunCancellationError(signal?: AbortSignal) {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "Task run cancelled.");
  error.name = "AbortError";
  return error;
}

function isToolRunCancellationError(err: unknown) {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.name === "AbortError" || /\b(abort|aborted|cancelled|canceled)\b/i.test(err.message);
}

function buildToolResult(
  call: ToolCall,
  content: string,
  isError: boolean,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text: content }],
    isError,
    timestamp: Date.now(),
  };
}

function summarizeToolCall(call: ToolCall, content: string, elapsedMs: number): string {
  const args = asRecord(call.arguments);
  const target =
    call.name === "run_shell"
      ? stringArg(args.cmd)
      : call.name === "read_file" || call.name === "write_file" || call.name === "list_files"
        ? stringArg(args.path)
        : undefined;
  const parsed = parseToolJson(content);
  const status = parsed?.ok === false ? "failed" : "completed";
  const base = [call.name, target ? `(${target})` : "", `${status} in ${elapsedMs}ms`]
    .filter(Boolean)
    .join(" ");
  if (call.name !== "run_shell" || parsed?.ok !== false) {
    return base;
  }
  const stderr = typeof parsed.stderr === "string" ? parsed.stderr.trim() : "";
  const stdout = typeof parsed.stdout === "string" ? parsed.stdout.trim() : "";
  const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : null;
  const details = [
    exitCode === null ? "" : `exit code: ${exitCode}`,
    stderr ? `stderr:\n${truncateMiddle(stderr, 2_400)}` : "",
    stdout ? `stdout:\n${truncateMiddle(stdout, 2_400)}` : "",
  ].filter(Boolean);
  return details.length ? `${base}\n${details.join("\n")}` : base;
}

function toolResultOk(content: string): boolean {
  return parseToolJson(content)?.ok !== false;
}

function parseToolJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resolveToolPath(target: string, cwd?: string): string {
  const base = cwd ? path.resolve(cwd) : process.cwd();
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(base, target);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const marker = "\n...[output truncated]...\n";
  const half = Math.floor((maxLength - marker.length) / 2);
  return `${value.slice(0, half)}${marker}${value.slice(-half)}`;
}
