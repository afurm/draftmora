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
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  FocusArea,
  FocusAreaColor,
  OpenAiAccountInfo,
  OpenAiAuthState,
  OpenAiCacheRetention,
  OpenAiCodexTransport,
  OpenAiReasoningEffort,
  OpenAiReasoningSummary,
  OpenAiTextVerbosity,
  ProviderAuthMode,
  ProviderConfigPatch,
  ProviderStatus,
} from "../../shared/types";
import {
  OPENAI_CACHE_RETENTIONS,
  OPENAI_CODEX_TRANSPORTS,
  OPENAI_REASONING_EFFORTS,
  OPENAI_REASONING_SUMMARIES,
  OPENAI_TEXT_VERBOSITIES,
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
const DEFAULT_OPTION = "default";

type DefaultOption = typeof DEFAULT_OPTION;

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
  const [organizationId, setOrganizationId] = useState(openAiConfig?.organizationId ?? "");
  const [projectId, setProjectId] = useState(openAiConfig?.projectId ?? "");
  const [maxTokens, setMaxTokens] = useState(openAiConfig?.maxTokens?.toString() ?? "");
  const [temperature, setTemperature] = useState(openAiConfig?.temperature?.toString() ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<
    OpenAiReasoningEffort | DefaultOption
  >(openAiConfig?.reasoningEffort ?? DEFAULT_OPTION);
  const [reasoningSummary, setReasoningSummary] = useState<
    OpenAiReasoningSummary | DefaultOption
  >(openAiConfig?.reasoningSummary ?? DEFAULT_OPTION);
  const [textVerbosity, setTextVerbosity] = useState<
    OpenAiTextVerbosity | DefaultOption
  >(openAiConfig?.textVerbosity ?? DEFAULT_OPTION);
  const [timeoutMs, setTimeoutMs] = useState(openAiConfig?.timeoutMs?.toString() ?? "");
  const [maxRetries, setMaxRetries] = useState(openAiConfig?.maxRetries?.toString() ?? "");
  const [maxRetryDelayMs, setMaxRetryDelayMs] = useState(
    openAiConfig?.maxRetryDelayMs?.toString() ?? "",
  );
  const [cacheRetention, setCacheRetention] = useState<
    OpenAiCacheRetention | DefaultOption
  >(openAiConfig?.cacheRetention ?? DEFAULT_OPTION);
  const [transport, setTransport] = useState<OpenAiCodexTransport>(
    openAiConfig?.transport ?? "auto",
  );
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
        maxTokens: parseOptionalNumber(maxTokens),
        temperature: parseOptionalNumber(temperature),
        reasoningEffort: optionalSelectValue(reasoningEffort),
        reasoningSummary: optionalSelectValue(reasoningSummary),
        textVerbosity: optionalSelectValue(textVerbosity),
        timeoutMs: parseOptionalNumber(timeoutMs),
        maxRetries: parseOptionalNumber(maxRetries),
        maxRetryDelayMs: parseOptionalNumber(maxRetryDelayMs),
        cacheRetention: optionalSelectValue(cacheRetention),
        transport: authMode === "oauth" ? transport : null,
        organizationId: authMode === "api_key" ? organizationId.trim() || null : null,
        projectId: authMode === "api_key" ? projectId.trim() || null : null,
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
                <Field>
                  <FieldLabel htmlFor="openai-organization">Organization ID</FieldLabel>
                  <Input
                    id="openai-organization"
                    value={organizationId}
                    onChange={(event) => setOrganizationId(event.target.value)}
                    placeholder="org_..."
                  />
                  <FieldDescription>Optional `OpenAI-Organization` request header.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="openai-project">Project ID</FieldLabel>
                  <Input
                    id="openai-project"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    placeholder="proj_..."
                  />
                  <FieldDescription>Optional `OpenAI-Project` request header.</FieldDescription>
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

            <OpenAiAdvancedSettings
              authMode={authMode}
              maxTokens={maxTokens}
              temperature={temperature}
              reasoningEffort={reasoningEffort}
              reasoningSummary={reasoningSummary}
              textVerbosity={textVerbosity}
              timeoutMs={timeoutMs}
              maxRetries={maxRetries}
              maxRetryDelayMs={maxRetryDelayMs}
              cacheRetention={cacheRetention}
              transport={transport}
              onMaxTokensChange={setMaxTokens}
              onTemperatureChange={setTemperature}
              onReasoningEffortChange={setReasoningEffort}
              onReasoningSummaryChange={setReasoningSummary}
              onTextVerbosityChange={setTextVerbosity}
              onTimeoutMsChange={setTimeoutMs}
              onMaxRetriesChange={setMaxRetries}
              onMaxRetryDelayMsChange={setMaxRetryDelayMs}
              onCacheRetentionChange={setCacheRetention}
              onTransportChange={setTransport}
            />
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

function OpenAiAdvancedSettings(props: {
  authMode: ProviderAuthMode;
  maxTokens: string;
  temperature: string;
  reasoningEffort: OpenAiReasoningEffort | DefaultOption;
  reasoningSummary: OpenAiReasoningSummary | DefaultOption;
  textVerbosity: OpenAiTextVerbosity | DefaultOption;
  timeoutMs: string;
  maxRetries: string;
  maxRetryDelayMs: string;
  cacheRetention: OpenAiCacheRetention | DefaultOption;
  transport: OpenAiCodexTransport;
  onMaxTokensChange: (value: string) => void;
  onTemperatureChange: (value: string) => void;
  onReasoningEffortChange: (value: OpenAiReasoningEffort | DefaultOption) => void;
  onReasoningSummaryChange: (value: OpenAiReasoningSummary | DefaultOption) => void;
  onTextVerbosityChange: (value: OpenAiTextVerbosity | DefaultOption) => void;
  onTimeoutMsChange: (value: string) => void;
  onMaxRetriesChange: (value: string) => void;
  onMaxRetryDelayMsChange: (value: string) => void;
  onCacheRetentionChange: (value: OpenAiCacheRetention | DefaultOption) => void;
  onTransportChange: (value: OpenAiCodexTransport) => void;
}) {
  return (
    <Item variant="outline" className="items-start">
      <SlidersHorizontal />
      <div className="grid w-full gap-4">
        <div className="grid gap-1">
          <ItemTitle>Advanced request settings</ItemTitle>
          <ItemDescription className="line-clamp-none">
            Tune the OpenAI request used by board work, chat, and memory review.
          </ItemDescription>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="openai-max-tokens">Max output tokens</FieldLabel>
            <Input
              id="openai-max-tokens"
              type="number"
              min={1}
              value={props.maxTokens}
              onChange={(event) => props.onMaxTokensChange(event.target.value)}
              placeholder="Provider default"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="openai-temperature">Temperature</FieldLabel>
            <Input
              id="openai-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={props.temperature}
              onChange={(event) => props.onTemperatureChange(event.target.value)}
              placeholder="Provider default"
            />
          </Field>
          <Field>
            <FieldLabel>Reasoning effort</FieldLabel>
            <Select
              value={props.reasoningEffort}
              onValueChange={(value) =>
                props.onReasoningEffortChange(value as OpenAiReasoningEffort | DefaultOption)
              }
            >
              <SelectTrigger className="w-full" aria-label="Reasoning effort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_OPTION}>Provider default</SelectItem>
                  {OPENAI_REASONING_EFFORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatOptionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Reasoning summary</FieldLabel>
            <Select
              value={props.reasoningSummary}
              onValueChange={(value) =>
                props.onReasoningSummaryChange(value as OpenAiReasoningSummary | DefaultOption)
              }
            >
              <SelectTrigger className="w-full" aria-label="Reasoning summary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_OPTION}>Provider default</SelectItem>
                  {OPENAI_REASONING_SUMMARIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatOptionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Text verbosity</FieldLabel>
            <Select
              value={props.textVerbosity}
              onValueChange={(value) =>
                props.onTextVerbosityChange(value as OpenAiTextVerbosity | DefaultOption)
              }
            >
              <SelectTrigger className="w-full" aria-label="Text verbosity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_OPTION}>Provider default</SelectItem>
                  {OPENAI_TEXT_VERBOSITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatOptionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Prompt cache</FieldLabel>
            <Select
              value={props.cacheRetention}
              onValueChange={(value) =>
                props.onCacheRetentionChange(value as OpenAiCacheRetention | DefaultOption)
              }
            >
              <SelectTrigger className="w-full" aria-label="Prompt cache">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_OPTION}>Provider default</SelectItem>
                  {OPENAI_CACHE_RETENTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatOptionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {props.authMode === "oauth" && (
            <Field>
              <FieldLabel>Codex transport</FieldLabel>
              <Select
                value={props.transport}
                onValueChange={(value) => props.onTransportChange(value as OpenAiCodexTransport)}
              >
                <SelectTrigger className="w-full" aria-label="Codex transport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {OPENAI_CODEX_TRANSPORTS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {formatOptionLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="openai-timeout">Timeout ms</FieldLabel>
            <Input
              id="openai-timeout"
              type="number"
              min={1000}
              value={props.timeoutMs}
              onChange={(event) => props.onTimeoutMsChange(event.target.value)}
              placeholder="Provider default"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="openai-max-retries">Max retries</FieldLabel>
            <Input
              id="openai-max-retries"
              type="number"
              min={0}
              max={10}
              value={props.maxRetries}
              onChange={(event) => props.onMaxRetriesChange(event.target.value)}
              placeholder="Provider default"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="openai-retry-delay">Max retry delay ms</FieldLabel>
            <Input
              id="openai-retry-delay"
              type="number"
              min={0}
              value={props.maxRetryDelayMs}
              onChange={(event) => props.onMaxRetryDelayMsChange(event.target.value)}
              placeholder="Provider default"
            />
          </Field>
        </div>
      </div>
    </Item>
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

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalSelectValue<T extends string>(value: T | DefaultOption): T | null {
  return value === DEFAULT_OPTION ? null : value;
}

function formatOptionLabel(value: string): string {
  return value
    .split(/[-_]/g)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}
