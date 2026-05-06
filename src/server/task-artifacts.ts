import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TaskExecutionArtifact } from "../shared/types";

const MAX_EXTRACTED_ARTIFACTS = 20;
const MARKDOWN_LINK_PATTERN = /!?\[([^\]\n]{1,180})\]\((https?:\/\/[^)\s]+)\)/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const INLINE_FILE_PATTERN =
  /`((?:\.{1,2}\/|\/|[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_./ -]+\.(?:md|txt|json|log|png|jpe?g|gif|webp|svg|pdf|csv|ts|tsx|js|jsx|mjs|cjs|css|html|yml|yaml))`/gi;
const ABSOLUTE_FILE_PATTERN =
  /(^|[\s([{])((?:\/[^\s"'<>()]+)+\.(?:md|txt|json|log|png|jpe?g|gif|webp|svg|pdf|csv|ts|tsx|js|jsx|mjs|cjs|css|html|yml|yaml))(?=$|[\s)\]},.;:!?])/gi;
const MEDIA_DIRECTIVE_PATTERN = /^MEDIA:\s*(\S.+)$/gim;

export function extractTaskExecutionArtifacts(output: string): TaskExecutionArtifact[] {
  return extractArtifactsFromText(output, { includeFileReferences: true });
}

function extractArtifactsFromText(
  output: string,
  options: { includeFileReferences: boolean },
): TaskExecutionArtifact[] {
  const artifacts: TaskExecutionArtifact[] = [];
  const addArtifact = createArtifactAdder(artifacts);

  for (const match of output.matchAll(MARKDOWN_LINK_PATTERN)) {
    const url = normalizeUrl(match[2]);
    if (!url) {
      continue;
    }
    addArtifact({
      type: "link",
      title: titleForUrl(url, match[1]),
      content: contentForUrl(url),
      url,
    });
  }

  for (const match of output.matchAll(URL_PATTERN)) {
    const url = normalizeUrl(match[0]);
    if (!url) {
      continue;
    }
    addArtifact({
      type: "link",
      title: titleForUrl(url),
      content: contentForUrl(url),
      url,
    });
  }

  if (options.includeFileReferences) {
    for (const match of output.matchAll(INLINE_FILE_PATTERN)) {
      const filePath = normalizeFilePath(match[1]);
      if (!filePath) {
        continue;
      }
      addArtifact(fileArtifact(filePath));
    }

    for (const match of output.matchAll(ABSOLUTE_FILE_PATTERN)) {
      const filePath = normalizeFilePath(match[2]);
      if (!filePath) {
        continue;
      }
      addArtifact(fileArtifact(filePath));
    }
  }

  for (const match of output.matchAll(MEDIA_DIRECTIVE_PATTERN)) {
    const artifact = artifactFromMediaUrl(match[1]);
    if (artifact) {
      addArtifact(artifact);
    }
  }

  return artifacts;
}

export function extractLocalToolResultArtifacts(
  toolName: string,
  content: string,
): TaskExecutionArtifact[] {
  const artifacts: TaskExecutionArtifact[] = [];
  const addArtifact = createArtifactAdder(artifacts);
  const parsed = parseToolJson(content);

  if (toolName === "write_file" && parsed?.ok === true && typeof parsed.path === "string") {
    addArtifact(fileArtifact(parsed.path));
  }

  if (toolName === "run_shell" && parsed) {
    for (const value of [parsed.stdout, parsed.stderr]) {
      if (typeof value === "string" && value.trim()) {
        for (const artifact of extractArtifactsFromText(value, { includeFileReferences: false })) {
          addArtifact(artifact);
        }
      }
    }
  }

  return artifacts;
}

export function mergeTaskExecutionArtifacts(
  artifacts: TaskExecutionArtifact[],
): TaskExecutionArtifact[] {
  const merged: TaskExecutionArtifact[] = [];
  const addArtifact = createArtifactAdder(merged);
  artifacts.forEach(addArtifact);
  return merged;
}

function createArtifactAdder(artifacts: TaskExecutionArtifact[]) {
  const seen = new Set<string>();
  return (artifact: Omit<TaskExecutionArtifact, "id" | "createdAt"> | TaskExecutionArtifact) => {
    if (artifacts.length >= MAX_EXTRACTED_ARTIFACTS) {
      return;
    }
    const key = artifactKey(artifact);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    artifacts.push({
      ...artifact,
      id: "id" in artifact ? artifact.id : "",
      createdAt: "createdAt" in artifact ? artifact.createdAt : "",
    });
  };
}

function artifactKey(artifact: Omit<TaskExecutionArtifact, "id" | "createdAt">) {
  return artifact.url ?? `${artifact.type}:${artifact.title}:${artifact.content}`;
}

function normalizeUrl(value: string | undefined) {
  if (!value) {
    return null;
  }
  let url = value.trim().replace(/^<|>$/g, "");
  while (/[.,;:!?]$/.test(url)) {
    url = url.slice(0, -1);
  }
  while (url.endsWith(")") && countCharacter(url, ")") > countCharacter(url, "(")) {
    url = url.slice(0, -1);
  }
  while (url.endsWith("]") && countCharacter(url, "]") > countCharacter(url, "[")) {
    url = url.slice(0, -1);
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function titleForUrl(url: string, label?: string) {
  const cleanLabel = cleanMarkdownLabel(label);
  if (cleanLabel && cleanLabel !== url) {
    return cleanLabel;
  }

  const parsed = new URL(url);
  const title = titleFromUrlPath(parsed.pathname);
  return title ?? `Link: ${parsed.hostname}`;
}

function contentForUrl(url: string) {
  const parsed = new URL(url);
  return parsed.hostname;
}

function cleanMarkdownLabel(label: string | undefined) {
  const clean = label
    ?.replace(/\\([\\[\]()])/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
}

function titleFromUrlPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean).map(decodeUrlPathSegment);
  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return null;
  }
  const previousSegment = segments.at(-2);
  if (previousSegment && /^\d+$/.test(lastSegment)) {
    return `${singularizeUrlLabel(humanizeUrlSegment(previousSegment))} #${lastSegment}`;
  }
  return humanizeUrlSegment(lastSegment);
}

function decodeUrlPathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function humanizeUrlSegment(segment: string) {
  const clean = segment
    .replace(/\.(?:html?|md)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : segment;
}

function singularizeUrlLabel(label: string) {
  if (label.length <= 3 || /(?:ss|us|is)$/i.test(label)) {
    return label;
  }
  if (/ies$/i.test(label)) {
    return `${label.slice(0, -3)}y`;
  }
  return /s$/i.test(label) ? label.slice(0, -1) : label;
}

function normalizeFilePath(value: string | undefined) {
  if (!value) {
    return null;
  }
  const filePath = value.trim().replace(/^["'(<]+|[)"'>,.;:!?]+$/g, "");
  if (!filePath || filePath.includes("://") || filePath.startsWith("http")) {
    return null;
  }
  return filePath;
}

function artifactFromMediaUrl(value: string | undefined) {
  const url = normalizeUrl(value);
  if (url) {
    return {
      type: "link" as const,
      title: titleForUrl(url),
      content: contentForUrl(url),
      url,
    };
  }
  const filePath = normalizeFilePath(value);
  return filePath ? fileArtifact(filePath) : null;
}

function fileArtifact(filePath: string): Omit<TaskExecutionArtifact, "id" | "createdAt"> {
  const isAbsolute = path.isAbsolute(filePath);
  return {
    type: "output",
    title: `File: ${path.basename(filePath)}`,
    content: filePath,
    url: isAbsolute ? pathToFileURL(filePath).href : undefined,
  };
}

function countCharacter(value: string, character: string) {
  return [...value].filter((item) => item === character).length;
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
