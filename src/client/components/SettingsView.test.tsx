/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, OpenAiAuthState, ProviderConfigPatch } from "../../shared/types";
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
    const onSave = vi.fn(
      async (_nextSettings: AppSettings, _providerPatches: ProviderConfigPatch[]) => undefined,
    );

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

    await clickButtonByText("Board");

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
    expect(onSave.mock.calls[0][1]).toEqual([]);
  });

  it("labels settings controls for assistive technology", async () => {
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

    expect(container.querySelector('[aria-label="Authentication method"]')).toBeTruthy();
    expect(container.textContent).toContain("OpenAI account");
    expect(container.textContent).toContain("API key");
    expect(container.querySelector('button[aria-label="Model"]')).toBeTruthy();
    expect(container.textContent).toContain("Connected as ...abc123.");
    expect(container.textContent).not.toContain("00000000-0000-0000");

    await clickButtonByText("Board");

    expect(container.querySelector('button[aria-label="Personal color"]')).toBeTruthy();
  });

  it("saves advanced OpenAI request settings", async () => {
    const onSave = vi.fn(
      async (_nextSettings: AppSettings, _providerPatches: ProviderConfigPatch[]) => undefined,
    );

    await act(async () => {
      root.render(
        <SettingsView
          settings={{
            ...settings,
            providerConfigs: [
              {
                ...settings.providerConfigs[0],
                authMode: "api_key",
                organizationId: "org_existing",
              },
            ],
          }}
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

    const orgInput = container.querySelector<HTMLInputElement>("#openai-organization");
    const projectInput = container.querySelector<HTMLInputElement>("#openai-project");
    expect(orgInput).toBeTruthy();
    expect(projectInput).toBeTruthy();

    await act(async () => {
      setInputValue(orgInput!, "org_saved");
      orgInput!.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(projectInput!, "proj_saved");
      projectInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await clickButtonByText("Advanced");

    const maxTokensInput = container.querySelector<HTMLInputElement>("#openai-max-tokens");
    const timeoutInput = container.querySelector<HTMLInputElement>("#openai-timeout");
    expect(maxTokensInput).toBeTruthy();
    expect(timeoutInput).toBeTruthy();

    await act(async () => {
      setInputValue(maxTokensInput!, "8192");
      maxTokensInput!.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(timeoutInput!, "90000");
      timeoutInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save advanced settings"),
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1][0]).toMatchObject({
      provider: "openai",
      authMode: "api_key",
      maxTokens: 8192,
      timeoutMs: 90000,
      organizationId: "org_saved",
      projectId: "proj_saved",
    });
  });

  it("blocks invalid advanced numeric values", async () => {
    const onSave = vi.fn(
      async (_nextSettings: AppSettings, _providerPatches: ProviderConfigPatch[]) => undefined,
    );

    await act(async () => {
      root.render(
        <SettingsView
          settings={{
            ...settings,
            providerConfigs: [
              {
                ...settings.providerConfigs[0],
                authMode: "api_key",
              },
            ],
          }}
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

    await clickButtonByText("Advanced");

    const temperatureInput = container.querySelector<HTMLInputElement>("#openai-temperature");
    expect(temperatureInput).toBeTruthy();

    await act(async () => {
      setInputValue(temperatureInput!, "3");
      temperatureInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButtonByText("Save advanced settings");

    expect(container.textContent).toContain("Temperature must be 2 or lower.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("focuses a new focus area after adding it", async () => {
    await act(async () => {
      root.render(
        <SettingsView
          settings={settings}
          providerStatuses={[]}
          onSave={vi.fn(async () => undefined)}
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

    await clickButtonByText("Board");
    await clickButtonByText("Add area");

    const newAreaInput = container.querySelector<HTMLInputElement>('input[aria-label="New area name"]');
    expect(newAreaInput).toBeTruthy();
    expect(document.activeElement).toBe(newAreaInput);
  });

  it("blocks empty focus area names", async () => {
    const onSave = vi.fn(
      async (_nextSettings: AppSettings, _providerPatches: ProviderConfigPatch[]) => undefined,
    );

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

    await clickButtonByText("Board");

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Personal name"]');
    expect(nameInput).toBeTruthy();

    await act(async () => {
      setInputValue(nameInput!, "");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButtonByText("Save board settings");

    expect(container.textContent).toContain("Enter a focus area name.");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Focus area name"]')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

async function clickButtonByText(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    button!.click();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}
