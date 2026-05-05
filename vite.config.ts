import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const webPort = readPort(env, ["WEB_PORT"], 5173);
  const apiPort = readPort(env, ["API_PORT", "PORT"], 4141);
  const webHost = env.WEB_HOST ?? "0.0.0.0";
  const apiHost = normalizeProxyHost(env.API_HOST ?? env.HOST ?? "127.0.0.1");
  const apiTarget = `http://${formatHttpHost(apiHost)}:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: webHost,
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": apiTarget,
      },
    },
    preview: {
      host: webHost,
      port: webPort,
      strictPort: true,
    },
  };
});

function readPort(env: Record<string, string | undefined>, names: string[], fallback: number) {
  for (const name of names) {
    const raw = env[name]?.trim();
    if (!raw) {
      continue;
    }
    const port = Number(raw);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }
    throw new Error(`${name} must be a port number between 1 and 65535.`);
  }
  return fallback;
}

function normalizeProxyHost(host: string) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function formatHttpHost(host: string) {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host;
  }
  return host.includes(":") ? `[${host}]` : host;
}
