import {
  CheckCircle2,
  ExternalLink,
  Gauge,
  KeyRound,
  LogIn,
  LogOut,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  FocusArea,
  FocusAreaColor,
  OpenAiAccountInfo,
  OpenAiAuthState,
  ProviderAuthMode,
  ProviderConfigPatch,
  ProviderStatus,
} from "../../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOCUS_AREA_COLOR_OPTIONS,
  createFocusArea,
  createFocusAreaId,
  getFocusAreaLabel,
  getFocusAreaStyle,
} from "../focus-areas";

const OPENAI_PROVIDER = "openai";

export function SettingsView(props: {
  settings: AppSettings;
  providerStatuses: ProviderStatus[];
  onSave: (
    settings: AppSettings,
    providerPatches: ProviderConfigPatch[],
  ) => Promise<void>;
  onStartOpenAiAuth: () => Promise<OpenAiAuthState>;
  onGetOpenAiAuth: () => Promise<OpenAiAuthState>;
  onGetOpenAiAccountInfo: () => Promise<OpenAiAccountInfo>;
  onSubmitOpenAiAuthInput: (loginId: string, input: string) => Promise<OpenAiAuthState>;
  onLogoutOpenAiAuth: () => Promise<OpenAiAuthState>;
}) {
  const openAiConfig = props.settings.providerConfigs.find(
    (config) => config.provider === OPENAI_PROVIDER,
  );
  const providerStatus = props.providerStatuses.find(
    (provider) => provider.provider === OPENAI_PROVIDER,
  );
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>(() =>
    normalizeFocusAreaDrafts(
      props.settings.userProfile.focusAreas.length > 0
        ? props.settings.userProfile.focusAreas
        : props.settings.userProfile.workAreas.map((label, index) => ({
            id: createFocusAreaId(label, []),
            label,
            color: FOCUS_AREA_COLOR_OPTIONS[index % FOCUS_AREA_COLOR_OPTIONS.length].value,
          })),
    ),
  );
  const [authMode, setAuthMode] = useState<ProviderAuthMode>(
    openAiConfig?.authMode ?? "oauth",
  );
  const [model, setModel] = useState(openAiConfig?.model ?? "gpt-5.5");
  const [baseUrl, setBaseUrl] = useState(openAiConfig?.baseUrl ?? "https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [authState, setAuthState] = useState<OpenAiAuthState | null>(null);
  const [accountInfo, setAccountInfo] = useState<OpenAiAccountInfo | null>(null);
  const [loginInput, setLoginInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([props.onGetOpenAiAuth(), props.onGetOpenAiAccountInfo()]).then(
      ([authResult, accountResult]) => {
        if (!active) {
          return;
        }
        if (authResult.status === "fulfilled") {
          setAuthState(authResult.value);
        }
        if (accountResult.status === "fulfilled") {
          setAccountInfo(accountResult.value);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const supportedModels = useMemo(() => accountInfo?.models ?? [], [accountInfo]);
  const openAiReady = Boolean(providerStatus?.configured || authState?.configured);
  const login = authState?.login;

  function updateFocusArea(id: string, patch: Partial<FocusArea>): void {
    setFocusAreas((current) =>
      current.map((area) => (area.id === id ? { ...area, ...patch } : area)),
    );
  }

  function addFocusArea(): void {
    setFocusAreas((current) => [...current, createFocusArea("New area", current)]);
  }

  function removeFocusArea(id: string): void {
    setFocusAreas((current) => current.filter((area) => area.id !== id));
  }

  async function refreshOpenAi() {
    setChecking(true);
    setAuthError(null);
    try {
      const [nextAuth, nextAccount] = await Promise.all([
        props.onGetOpenAiAuth(),
        props.onGetOpenAiAccountInfo(),
      ]);
      setAuthState(nextAuth);
      setAccountInfo(nextAccount);
      if (nextAccount.recommendedModel && !nextAccount.currentModelSupported) {
        setModel(nextAccount.recommendedModel);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function startOpenAiAuth() {
    setChecking(true);
    setAuthError(null);
    try {
      const state = await props.onStartOpenAiAuth();
      setAuthState(state);
      if (state.login.authUrl) {
        window.open(state.login.authUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function submitOpenAiInput() {
    const code = loginInput.trim();
    if (!login?.loginId || !code) {
      return;
    }
    setChecking(true);
    setAuthError(null);
    try {
      const state = await props.onSubmitOpenAiAuthInput(login.loginId, code);
      setAuthState(state);
      setLoginInput("");
      await refreshOpenAi();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function logoutOpenAi() {
    setChecking(true);
    setAuthError(null);
    try {
      const state = await props.onLogoutOpenAiAuth();
      setAuthState(state);
      await refreshOpenAi();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const normalizedFocusAreas = normalizeFocusAreaDrafts(focusAreas);
      const providerPatch: ProviderConfigPatch = {
        provider: OPENAI_PROVIDER,
        label: "OpenAI",
        model,
        baseUrl: authMode === "api_key" ? baseUrl : null,
        authMode,
        enabled: true,
        fallbackRank: 1,
        apiKey: apiKey.trim() || undefined,
      };
      await props.onSave(
        {
          ...props.settings,
          selectedProvider: OPENAI_PROVIDER,
          providerConfigs: props.settings.providerConfigs,
          userProfile: {
            ...props.settings.userProfile,
            workAreas: normalizedFocusAreas.map((area) => area.label),
            focusAreas: normalizedFocusAreas,
          },
        },
        [providerPatch],
      );
      setApiKey("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>OpenAI connection</CardTitle>
              <CardDescription>
                Connect with your OpenAI account or use an API key for task execution.
              </CardDescription>
            </div>
            <Badge variant={openAiReady ? "secondary" : "outline"}>
              {openAiReady ? <CheckCircle2 data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
              {openAiReady ? "Connected" : "Setup needed"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {authError && (
              <Alert variant="destructive">
                <AlertTitle>OpenAI setup failed</AlertTitle>
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Field>
                <FieldLabel>Authentication</FieldLabel>
                <Select value={authMode} onValueChange={(value) => setAuthMode(value as ProviderAuthMode)}>
                  <SelectTrigger className="w-full" aria-label="Authentication">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="oauth">OpenAI account</SelectItem>
                      <SelectItem value="api_key">API key</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Account auth uses your OpenAI login. API key mode uses the key stored locally or in `OPENAI_API_KEY`.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="openai-model">Model</FieldLabel>
                {supportedModels.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full" aria-label="Model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {supportedModels.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="openai-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                )}
                <FieldDescription>
                  {accountInfo?.currentModelSupported === false
                    ? `${accountInfo.currentModel} is not in the current account model list.`
                    : "Used when a task is moved into progress."}
                </FieldDescription>
              </Field>
            </div>

            {authMode === "api_key" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="openai-api-key">API key</FieldLabel>
                  <Input
                    id="openai-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={openAiConfig?.hasApiKey ? "Stored key is active" : "sk-..."}
                  />
                  <FieldDescription>
                    Leave blank to keep the existing local key or environment key.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="openai-base-url">Base URL</FieldLabel>
                  <Input
                    id="openai-base-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                  <FieldDescription>Default OpenAI-compatible endpoint.</FieldDescription>
                </Field>
              </div>
            ) : (
              <OpenAiAccountPanel
                authState={authState}
                accountInfo={accountInfo}
                checking={checking}
                loginInput={loginInput}
                onLoginInputChange={setLoginInput}
                onStartAuth={startOpenAiAuth}
                onSubmitInput={submitOpenAiInput}
                onRefresh={refreshOpenAi}
                onLogout={logoutOpenAi}
              />
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={saving}>
            <Save data-icon="inline-start" />
            {saving ? "Saving..." : "Save OpenAI settings"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Board settings</CardTitle>
          <CardDescription>
            Focus areas appear in the task dropdown and color task cards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel>Focus areas</FieldLabel>
                <FieldDescription>
                  Use focus areas for scanning and filtering work by context.
                </FieldDescription>
              </FieldContent>
              <Button type="button" variant="outline" size="sm" onClick={addFocusArea}>
                <Plus data-icon="inline-start" />
                Add area
              </Button>
            </Field>
            <ItemGroup className="gap-2">
              {focusAreas.map((area) => (
                <FocusAreaEditor
                  key={area.id}
                  area={area}
                  canRemove={focusAreas.length > 1}
                  onChange={(patch) => updateFocusArea(area.id, patch)}
                  onRemove={() => removeFocusArea(area.id)}
                />
              ))}
            </ItemGroup>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={saving}>
            <Save data-icon="inline-start" />
            {saving ? "Saving..." : "Save board settings"}
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

function OpenAiAccountPanel(props: {
  authState: OpenAiAuthState | null;
  accountInfo: OpenAiAccountInfo | null;
  checking: boolean;
  loginInput: string;
  onLoginInputChange: (value: string) => void;
  onStartAuth: () => Promise<void>;
  onSubmitInput: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const login = props.authState?.login;
  return (
    <ItemGroup>
      <Item variant="outline" className="items-start">
        <ItemTitle>OpenAI account</ItemTitle>
        <ItemDescription className="line-clamp-none">
          {props.authState?.configured
            ? `Connected${props.authState.accountId ? ` as ${props.authState.accountId}` : ""}.`
            : "Connect your OpenAI account to use supported Codex models without pasting an API key."}
        </ItemDescription>
        <ItemActions className="flex-wrap justify-end">
          <Button type="button" variant="outline" size="sm" onClick={props.onRefresh} disabled={props.checking}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          {props.authState?.configured ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onLogout} disabled={props.checking}>
              <LogOut data-icon="inline-start" />
              Disconnect
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={props.onStartAuth} disabled={props.checking}>
              <LogIn data-icon="inline-start" />
              Connect
            </Button>
          )}
        </ItemActions>
      </Item>

      {login?.authUrl && login.phase !== "complete" && (
        <Item variant="muted" className="items-start">
          <ItemTitle>Finish sign-in</ItemTitle>
          <ItemDescription className="line-clamp-none">
            {login.progress ?? "Open the sign-in page, then paste the returned code if prompted."}
          </ItemDescription>
          <ItemActions className="flex-wrap justify-end">
            <Button asChild type="button" variant="outline" size="sm">
              <a href={login.authUrl} target="_blank" rel="noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open
              </a>
            </Button>
          </ItemActions>
          {login.manualInputAllowed && login.loginId && (
            <div className="col-span-full grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={props.loginInput}
                onChange={(event) => props.onLoginInputChange(event.target.value)}
                placeholder="Paste sign-in code"
                aria-label="OpenAI sign-in code"
              />
              <Button type="button" onClick={props.onSubmitInput} disabled={props.checking || !props.loginInput.trim()}>
                Submit code
              </Button>
            </div>
          )}
        </Item>
      )}

      {props.accountInfo && (
        <Item variant="outline" className="items-start">
          <Gauge />
          <div className="grid gap-1">
            <ItemTitle>Model catalog</ItemTitle>
            <ItemDescription className="line-clamp-none">
              Recommended model: {props.accountInfo.recommendedModel}. Available models:{" "}
              {props.accountInfo.models.length}.
            </ItemDescription>
          </div>
        </Item>
      )}
    </ItemGroup>
  );
}

function FocusAreaEditor(props: {
  area: FocusArea;
  canRemove: boolean;
  onChange: (patch: Partial<FocusArea>) => void;
  onRemove: () => void;
}) {
  const style = getFocusAreaStyle(props.area.color);
  return (
    <Item variant="outline" className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: style.accent }}
        />
        <Input
          value={props.area.label}
          onChange={(event) => props.onChange({ label: event.target.value })}
          aria-label={`${props.area.label || "Focus area"} name`}
        />
      </div>
      <Select
        value={props.area.color}
        onValueChange={(value) => props.onChange({ color: value as FocusAreaColor })}
      >
        <SelectTrigger
          className="w-full"
          aria-label={`${props.area.label || "Focus area"} color`}
        >
          <Palette data-icon="inline-start" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {FOCUS_AREA_COLOR_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <FocusAreaColorOption color={option.value} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <ItemActions className="justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={props.onRemove}
          disabled={!props.canRemove}
          aria-label={`Remove ${props.area.label || "focus area"}`}
          title={`Remove ${props.area.label || "focus area"}`}
        >
          <Trash2 />
        </Button>
      </ItemActions>
    </Item>
  );
}

function FocusAreaColorOption(props: { color: FocusAreaColor }) {
  const style = getFocusAreaStyle(props.color);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.accent }}
      />
      <span>{getFocusAreaLabel(props.color)}</span>
    </span>
  );
}

function normalizeFocusAreaDrafts(areas: FocusArea[]): FocusArea[] {
  const used = new Set<string>();
  return areas
    .map((area, index) => {
      const label = area.label.trim();
      if (!label) {
        return null;
      }
      const baseId = area.id || createFocusAreaId(label, []);
      let id = baseId;
      let suffix = 2;
      while (used.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      used.add(id);
      return {
        id,
        label,
        color: area.color ?? FOCUS_AREA_COLOR_OPTIONS[index % FOCUS_AREA_COLOR_OPTIONS.length].value,
      };
    })
    .filter((area): area is FocusArea => Boolean(area));
}
