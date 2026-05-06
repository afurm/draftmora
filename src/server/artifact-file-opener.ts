import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskExecutionArtifact } from "../shared/types";

export type ArtifactOpenCommand = {
  command: string;
  args: string[];
};

export type ArtifactFileOpenResult =
  | { ok: true; path: string }
  | { ok: false; path: string; error: string };

export function resolveArtifactFilePath(artifact: TaskExecutionArtifact): string | null {
  if (artifact.url?.startsWith("file://")) {
    try {
      return fileURLToPath(artifact.url);
    } catch {
      return null;
    }
  }
  return artifact.type === "output" && artifact.content && path.isAbsolute(artifact.content)
    ? artifact.content
    : null;
}

export function resolveArtifactRevealCommand(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): ArtifactOpenCommand {
  if (platform === "darwin") {
    return { command: "open", args: ["-R", filePath] };
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [`/select,${filePath}`] };
  }
  return { command: "xdg-open", args: [path.dirname(filePath)] };
}

export async function revealArtifactFile(filePath: string): Promise<ArtifactFileOpenResult> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() && !fileStat.isDirectory()) {
      return { ok: false, path: filePath, error: "artifact path is not a file or folder" };
    }
    await access(filePath);
    await execArtifactOpenCommand(resolveArtifactRevealCommand(filePath));
    return { ok: true, path: filePath };
  } catch {
    return { ok: false, path: filePath, error: "failed to reveal artifact file" };
  }
}

function execArtifactOpenCommand(command: ArtifactOpenCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command.command, command.args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
