/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, OpenAiAuthState } from "../../shared/types";
import { SettingsView } from "./SettingsView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const settings: AppSettings = {
  selectedProvider: "openai",
  providerConfigs: [
    {
      provider: "openai",
      label: "OpenAI",
      model: "gpt-5.5",
      baseUrl: "https://api.openai.com/v1",
      authMode: "oauth",
      enabled: true,
      fallbackRank: 1,
      hasApiKey: false,
      hasOAuth: false,
    },
  ],
  userProfile: {
    workAreas: ["Personal"],
    focusAreas: [{ id: "personal", label: "Personal", color: "blue" }],
    preferredPlanningStyle: "Clear next steps.",
    recurringCommitments: [],
    learnedPreferences: [],
  },
};

const emptyAuthState: OpenAiAuthState = {
  configured: false,
  login: { phase: "idle" },
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SettingsView", () => {
  it("saves focus area changes", async () => {
    const onSave = vi.fn(async (_nextSettings: AppSettings) => undefined);

    await act(async () => {
      root.render(
        <SettingsView
          settings={settings}
          providerStatuses={[]}
          onSave={onSave}
          onStartOpenAiAuth={vi.fn(async () => emptyAuthState)}
          onGetOpenAiAuth={vi.fn(async () => emptyAuthState)}
          onGetOpenAiAccountInfo={vi.fn(async () => ({
            configured: false,
            prefetchedAt: "2026-05-02T00:00:00.000Z",
            recommendedModel: "gpt-5.5",
            currentModel: "gpt-5.5",
            currentModelSupported: true,
            models: [],
          }))}
          onSubmitOpenAiAuthInput={vi.fn(async () => emptyAuthState)}
          onLogoutOpenAiAuth={vi.fn(async () => emptyAuthState)}
        />,
      );
    });

    expect(container.textContent).toContain("Board settings");
    expect(container.textContent).toContain("Focus areas");

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Personal name"]');
    expect(nameInput).toBeTruthy();

    await act(async () => {
      setInputValue(nameInput!, "Clients");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save board settings"),
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].userProfile.focusAreas[0]).toMatchObject({
      id: "personal",
      label: "Clients",
      color: "blue",
    });
  });

  it("labels settings select triggers for assistive technology", async () => {
    await act(async () => {
      root.render(
        <SettingsView
          settings={{
            ...settings,
            providerConfigs: [
              {
                ...settings.providerConfigs[0],
                hasOAuth: true,
                oauthAccountId: "...abc123",
              },
            ],
          }}
          providerStatuses={[
            {
              provider: "openai",
              label: "OpenAI",
              model: "gpt-5.5",
              authMode: "oauth",
              baseUrl: "https://api.openai.com/v1",
              enabled: true,
              configured: true,
              source: "oauth",
              baseUrlSource: "default",
              fallbackRank: 1,
              accountId: "...abc123",
            },
          ]}
          onSave={vi.fn(async () => undefined)}
          onStartOpenAiAuth={vi.fn(async () => emptyAuthState)}
          onGetOpenAiAuth={vi.fn(async () => ({
            configured: true,
            accountId: "...abc123",
            login: { phase: "idle" as const },
          }))}
          onGetOpenAiAccountInfo={vi.fn(async () => ({
            configured: true,
            accountId: "...abc123",
            prefetchedAt: "2026-05-02T00:00:00.000Z",
            recommendedModel: "gpt-5.5",
            currentModel: "gpt-5.5",
            currentModelSupported: true,
            models: [
              {
                id: "gpt-5.5",
                name: "GPT-5.5",
                contextWindow: 200000,
                maxTokens: 100000,
                reasoning: true,
                input: ["text"],
                recommended: true,
                current: true,
              },
            ],
          }))}
          onSubmitOpenAiAuthInput={vi.fn(async () => emptyAuthState)}
          onLogoutOpenAiAuth={vi.fn(async () => emptyAuthState)}
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Authentication"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Model"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Personal color"]')).toBeTruthy();
    expect(container.textContent).toContain("Connected as ...abc123.");
    expect(container.textContent).not.toContain("00000000-0000-0000");
  });
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}
