import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { buildServer } from "./routes";

const port = Number(process.env.PORT ?? 4141);
const host = process.env.HOST ?? "127.0.0.1";
const app = buildServer();
const staticDir = resolveStaticDir();

if (staticDir) {
  await app.register(fastifyStatic, {
    root: staticDir,
    wildcard: false,
  });

  app.get("/assets/*", async (request, reply) => {
    const assetPath = (request.params as { "*": string })["*"];
    return reply.sendFile(path.join("assets", assetPath));
  });

  app.get("/:file", async (request, reply) => {
    const file = (request.params as { file: string }).file;
    if (!PUBLIC_ROOT_FILES.has(file)) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.sendFile(file);
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "Not found" });
  });
}

try {
  await app.listen({ port, host });
  console.log(`Draftmora running at http://${host}:${port}`);
  if (!staticDir) {
    console.log("Web app runs with Vite at http://localhost:5173");
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const PUBLIC_ROOT_FILES = new Set(["favicon.ico", "favicon.png", "favicon.svg", "draftmora-logo.png"]);

function resolveStaticDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DRAFTMORA_STATIC_DIR,
    path.resolve(process.cwd(), "dist/client"),
    path.resolve(moduleDir, "../client"),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}
