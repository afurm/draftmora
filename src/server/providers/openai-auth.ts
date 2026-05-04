import { randomUUID } from "node:crypto";
import { getModels } from "@mariozechner/pi-ai";
import {
  loginOpenAICodex,
  refreshOpenAICodexToken,
  type OAuthCredentials,
  type OAuthPrompt,
} from "@mariozechner/pi-ai/oauth";
import type { OpenAiAccountInfo, OpenAiAuthState, OpenAiOAuthLoginState } from "../../shared/types";
import { formatPublicAccountIdentifier, type BoardStore, type OpenAiOAuthCredential } from "../db";

type PendingLogin = {
  id: string;
  state: OpenAiOAuthLoginState;
  input?: (value: string) => void;
  completion: Promise<void>;
};

const pendingLogins = new Map<string, PendingLogin>();
const RECOMMENDED_MODEL = "gpt-5.5";

export async function getOpenAiAuthState(store: BoardStore): Promise<OpenAiAuthState> {
  cleanupPendingLogin();
  return buildAuthState(store);
}

export async function startOpenAiOAuthLogin(store: BoardStore): Promise<OpenAiAuthState> {
  cleanupPendingLogin();
  const id = randomUUID();
  const pending: PendingLogin = {
    id,
    state: {
      phase: "starting",
      loginId: id,
      progress: "Starting OpenAI sign-in.",
      manualInputAllowed: true,
    },
    completion: Promise.resolve(),
  };
  pending.completion = runOpenAiLogin(store, pending);
  pendingLogins.set(id, pending);
  await waitForAuthUrl(pending);
  return buildAuthState(store, pending.state);
}

export async function submitOpenAiOAuthInput(
  store: BoardStore,
  input: { loginId: string; input: string },
): Promise<OpenAiAuthState> {
  const pending = pendingLogins.get(input.loginId);
  if (!pending?.input) {
    return buildAuthState(store, {
      phase: "failed",
      error: "No OpenAI login is waiting for input.",
    });
  }
  pending.input(input.input);
  pending.state = {
    ...pending.state,
    phase: "waiting",
    progress: "Checking the OpenAI sign-in code.",
  };
  await Promise.race([pending.completion, delay(1500)]);
  return buildAuthState(store, pending.state);
}

export async function clearOpenAiOAuthLogin(store: BoardStore): Promise<OpenAiAuthState> {
  store.clearOpenAiOAuthCredential();
  pendingLogins.clear();
  return buildAuthState(store, { phase: "idle" });
}

export async function resolveOpenAiOAuthAccess(
  store: BoardStore,
): Promise<{ apiKey: string; credential: OpenAiOAuthCredential } | null> {
  const credential = store.getOpenAiOAuthCredential();
  if (!credential) {
    return null;
  }
  const refreshed = await refreshCredentialIfNeeded(credential);
  if (refreshed !== credential) {
    store.setOpenAiOAuthCredential(refreshed);
  }
  return {
    apiKey: refreshed.access,
    credential: refreshed,
  };
}

export async function getOpenAiAccountInfo(store: BoardStore): Promise<OpenAiAccountInfo> {
  const settings = store.getSettings();
  const config = settings.providerConfigs.find((entry) => entry.provider === "openai");
  const credential = store.getOpenAiOAuthCredential();
  const models = getModels("openai-codex");
  const currentModel = config?.model ?? RECOMMENDED_MODEL;
  return {
    configured: Boolean(credential) || store.resolveApiKeyForProvider("openai").source !== "missing",
    accountId: formatPublicAccountIdentifier(credential?.accountId),
    oauthExpiresAt: credential?.expires ? new Date(credential.expires).toISOString() : undefined,
    prefetchedAt: new Date().toISOString(),
    recommendedModel: RECOMMENDED_MODEL,
    currentModel,
    currentModelSupported: models.some((model) => model.id === currentModel),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: Boolean(model.reasoning),
      input: [...model.input],
      recommended: model.id === RECOMMENDED_MODEL,
      current: model.id === currentModel,
    })),
    usage: {
      windows: [],
    },
  };
}

async function runOpenAiLogin(store: BoardStore, pending: PendingLogin): Promise<void> {
  try {
    const credential = await loginOpenAICodex({
      onAuth: (info) => {
        pending.state = {
          phase: "waiting",
          loginId: pending.id,
          authUrl: info.url,
          progress: info.instructions ?? "Open the sign-in page and approve access.",
          manualInputAllowed: true,
        };
      },
      onPrompt: (prompt) => waitForManualInput(pending, prompt),
      onManualCodeInput: () =>
        waitForManualInput(pending, {
          message: "Paste the OpenAI sign-in code.",
          allowEmpty: false,
        }),
      onProgress: (message) => {
        pending.state = {
          ...pending.state,
          progress: message,
        };
      },
      originator: "draftmora",
    });
    store.setOpenAiOAuthCredential({
      ...credential,
      accountId: extractAccountId(credential),
    });
    pending.state = {
      phase: "complete",
      progress: "OpenAI is connected.",
    };
  } catch (err) {
    pending.state = {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function waitForManualInput(pending: PendingLogin, prompt: OAuthPrompt): Promise<string> {
  pending.state = {
    ...pending.state,
    phase: "waiting",
    progress: prompt.message,
    manualInputAllowed: true,
  };
  return new Promise((resolve) => {
    pending.input = resolve;
  });
}

async function waitForAuthUrl(pending: PendingLogin): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pending.state.authUrl || pending.state.phase === "failed") {
      return;
    }
    await delay(100);
  }
}

async function refreshCredentialIfNeeded(
  credential: OpenAiOAuthCredential,
): Promise<OpenAiOAuthCredential> {
  if (credential.expires > Date.now() + 60_000) {
    return credential;
  }
  const refreshed = await refreshOpenAICodexToken(credential.refresh);
  return {
    ...refreshed,
    accountId: credential.accountId ?? extractAccountId(refreshed),
  };
}

function buildAuthState(
  store: BoardStore,
  login: OpenAiOAuthLoginState = { phase: "idle" },
): OpenAiAuthState {
  const credential = store.getOpenAiOAuthCredential();
  return {
    configured: Boolean(credential),
    accountId: formatPublicAccountIdentifier(credential?.accountId),
    oauthExpiresAt: credential?.expires ? new Date(credential.expires).toISOString() : undefined,
    login,
  };
}

function cleanupPendingLogin(): void {
  for (const [id, pending] of pendingLogins) {
    if (pending.state.phase === "complete" || pending.state.phase === "failed") {
      pendingLogins.delete(id);
    }
  }
}

function extractAccountId(credential: OAuthCredentials): string | undefined {
  for (const key of ["accountId", "account_id", "id", "userId", "user_id"]) {
    const value = credential[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
