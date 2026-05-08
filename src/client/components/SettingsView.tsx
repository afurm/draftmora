import {
  AlertCircle,
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
import { useEffect, useMemo, useRef, useState, type RefCallback } from "react";
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
type SettingsSaveTarget = "openai" | "advanced" | "board";
type OpenAiNumberField =
  | "maxTokens"
  | "temperature"
  | "timeoutMs"
  | "maxRetries"
  | "maxRetryDelayMs";
type OpenAiNumberErrors = Partial<Record<OpenAiNumberField, string>>;

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
  const [savingTarget, setSavingTarget] = useState<SettingsSaveTarget | null>(null);
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingFocusAreaFocusId, setPendingFocusAreaFocusId] = useState<string | null>(null);
  const focusAreaInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

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
  const accountMetadataLoading = authState === null && accountInfo === null;
  const numberErrors = useMemo(
    () =>
      getOpenAiNumberErrors({
        maxTokens,
        temperature,
        timeoutMs,
        maxRetries,
        maxRetryDelayMs,
      }),
    [maxTokens, temperature, timeoutMs, maxRetries, maxRetryDelayMs],
  );
  const hasNumberErrors = Object.values(numberErrors).some(Boolean);
  const focusAreaErrors = useMemo(() => getFocusAreaErrors(focusAreas), [focusAreas]);
  const hasFocusAreaErrors = focusAreaErrors.size > 0;

  useEffect(() => {
    if (!pendingFocusAreaFocusId) {
      return;
    }
    const input = focusAreaInputsRef.current[pendingFocusAreaFocusId];
    if (!input) {
      return;
    }
    input.focus();
    input.select();
    setPendingFocusAreaFocusId(null);
  }, [focusAreas, pendingFocusAreaFocusId]);

  function updateFocusArea(id: string, patch: Partial<FocusArea>): void {
    setSaveError(null);
    setFocusAreas((current) =>
      current.map((area) => (area.id === id ? { ...area, ...patch } : area)),
    );
  }

  function addFocusArea(): void {
    setSaveError(null);
    const nextArea = createFocusArea("New area", focusAreas);
    setFocusAreas((current) => [...current, nextArea]);
    setPendingFocusAreaFocusId(nextArea.id);
  }

  function removeFocusArea(id: string): void {
    setSaveError(null);
    setFocusAreas((current) => current.filter((area) => area.id !== id));
  }

  function setFocusAreaInputRef(id: string): RefCallback<HTMLInputElement> {
    return (input) => {
      focusAreaInputsRef.current[id] = input;
    };
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

  function buildOpenAiProviderPatch(): ProviderConfigPatch {
    return {
      provider: OPENAI_PROVIDER,
      label: "OpenAI",
      model: model.trim() || "gpt-5.5",
      baseUrl: authMode === "api_key" ? baseUrl.trim() || null : null,
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
  }

  async function saveOpenAiSettings(target: Extract<SettingsSaveTarget, "openai" | "advanced">) {
    setSaveError(null);
    if (hasNumberErrors) {
      setSaveError("Fix the highlighted advanced settings before saving.");
      return;
    }
    setSavingTarget(target);
    try {
      await props.onSave(
        {
          ...props.settings,
          selectedProvider: OPENAI_PROVIDER,
          userProfile: props.settings.userProfile,
        },
        [buildOpenAiProviderPatch()],
      );
      setApiKey("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTarget(null);
    }
  }

  async function saveBoardSettings() {
    setSaveError(null);
    if (hasFocusAreaErrors) {
      setSaveError("Fix the highlighted board settings before saving.");
      return;
    }
    setSavingTarget("board");
    try {
      const normalizedFocusAreas = normalizeFocusAreaDrafts(focusAreas);
      await props.onSave(
        {
          ...props.settings,
          userProfile: {
            ...props.settings.userProfile,
            workAreas: normalizedFocusAreas.map((area) => area.label),
            focusAreas: normalizedFocusAreas,
          },
        },
        [],
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTarget(null);
    }
  }

  return (
    <TooltipProvider>
      <Tabs defaultValue="openai" className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="openai" className="flex-1 sm:flex-none">
            <KeyRound data-icon="inline-start" />
            OpenAI
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex-1 sm:flex-none">
            <SlidersHorizontal data-icon="inline-start" />
            Advanced
          </TabsTrigger>
          <TabsTrigger value="board" className="flex-1 sm:flex-none">
            <Palette data-icon="inline-start" />
            Board
          </TabsTrigger>
        </TabsList>

        <TabsContent value="openai">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle>OpenAI connection</CardTitle>
                  <CardDescription>
                    Connect your account, choose the model, and keep task execution ready.
                  </CardDescription>
                </div>
                <Badge variant={openAiReady ? "secondary" : "outline"}>
                  {openAiReady ? (
                    <CheckCircle2 data-icon="inline-start" />
                  ) : (
                    <KeyRound data-icon="inline-start" />
                  )}
                  {openAiReady ? "Connected" : "Setup needed"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <SettingsErrorAlert authError={authError} saveError={saveError} />

                {accountInfo?.currentModelSupported === false && accountInfo.recommendedModel && (
                  <Alert>
                    <AlertCircle />
                    <AlertTitle>Selected model is not available</AlertTitle>
                    <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        {accountInfo.currentModel} is not in this account model list. Use{" "}
                        {accountInfo.recommendedModel} for the next run.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setModel(accountInfo.recommendedModel)}
                      >
                        Use recommended
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
                  <Field>
                    <FieldLabel>Authentication method</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={authMode}
                      onValueChange={(value) => {
                        if (value) {
                          setAuthMode(value as ProviderAuthMode);
                          setSaveError(null);
                        }
                      }}
                      variant="outline"
                      size="sm"
                      spacing={0}
                      className="w-full sm:w-fit"
                      aria-label="Authentication method"
                    >
                      <ToggleGroupItem value="oauth" className="flex-1 sm:flex-none">
                        <LogIn data-icon="inline-start" />
                        OpenAI account
                      </ToggleGroupItem>
                      <ToggleGroupItem value="api_key" className="flex-1 sm:flex-none">
                        <KeyRound data-icon="inline-start" />
                        API key
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>
                      Account auth is the default path. API key mode uses a local key or
                      `OPENAI_API_KEY`.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="openai-model">Model</FieldLabel>
                    {supportedModels.length > 0 ? (
                      <Select
                        value={model}
                        onValueChange={(value) => {
                          setModel(value);
                          setSaveError(null);
                        }}
                      >
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
                        onChange={(event) => {
                          setModel(event.target.value);
                          setSaveError(null);
                        }}
                      />
                    )}
                    <FieldDescription>
                      Used when a task moves into progress or the chat asks OpenAI to help.
                    </FieldDescription>
                  </Field>
                </div>

              {authMode === "api_key" ? (
                <ApiKeyFields
                  apiKey={apiKey}
                  baseUrl={baseUrl}
                  organizationId={organizationId}
                  projectId={projectId}
                  hasStoredApiKey={Boolean(openAiConfig?.hasApiKey)}
                  onApiKeyChange={(value) => {
                    setApiKey(value);
                    setSaveError(null);
                  }}
                  onBaseUrlChange={(value) => {
                    setBaseUrl(value);
                    setSaveError(null);
                  }}
                  onOrganizationIdChange={(value) => {
                    setOrganizationId(value);
                    setSaveError(null);
                  }}
                  onProjectIdChange={(value) => {
                    setProjectId(value);
                    setSaveError(null);
                  }}
                />
              ) : accountMetadataLoading ? (
                <OpenAiMetadataSkeleton />
              ) : (
                <OpenAiAccountPanel
                  authState={authState}
                  accountInfo={accountInfo}
                  selectedModel={model}
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
            <Button
              onClick={() => void saveOpenAiSettings("openai")}
              disabled={savingTarget !== null}
            >
              <Save data-icon="inline-start" />
              {savingTarget === "openai" ? "Saving..." : "Save OpenAI settings"}
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="advanced">
        <Card>
          <CardHeader>
            <CardTitle>Advanced request settings</CardTitle>
            <CardDescription>
              Optional OpenAI request tuning. Provider defaults are usually the right choice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <SettingsErrorAlert saveError={saveError} />
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
                errors={numberErrors}
                onMaxTokensChange={(value) => {
                  setMaxTokens(value);
                  setSaveError(null);
                }}
                onTemperatureChange={(value) => {
                  setTemperature(value);
                  setSaveError(null);
                }}
                onReasoningEffortChange={(value) => {
                  setReasoningEffort(value);
                  setSaveError(null);
                }}
                onReasoningSummaryChange={(value) => {
                  setReasoningSummary(value);
                  setSaveError(null);
                }}
                onTextVerbosityChange={(value) => {
                  setTextVerbosity(value);
                  setSaveError(null);
                }}
                onTimeoutMsChange={(value) => {
                  setTimeoutMs(value);
                  setSaveError(null);
                }}
                onMaxRetriesChange={(value) => {
                  setMaxRetries(value);
                  setSaveError(null);
                }}
                onMaxRetryDelayMsChange={(value) => {
                  setMaxRetryDelayMs(value);
                  setSaveError(null);
                }}
                onCacheRetentionChange={(value) => {
                  setCacheRetention(value);
                  setSaveError(null);
                }}
                onTransportChange={(value) => {
                  setTransport(value);
                  setSaveError(null);
                }}
              />
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              onClick={() => void saveOpenAiSettings("advanced")}
              disabled={savingTarget !== null}
            >
              <Save data-icon="inline-start" />
              {savingTarget === "advanced" ? "Saving..." : "Save advanced settings"}
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="board">
        <Card>
          <CardHeader>
            <CardTitle>Board settings</CardTitle>
            <CardDescription>
              Focus areas appear in task creation, filters, and task card color.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <SettingsErrorAlert saveError={saveError} />
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel>Focus areas</FieldLabel>
                  <FieldDescription>
                    Keep the list short enough to scan while still matching the contexts you
                    work in.
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
                    error={focusAreaErrors.get(area.id)}
                    inputRef={setFocusAreaInputRef(area.id)}
                    onChange={(patch) => updateFocusArea(area.id, patch)}
                    onRemove={() => removeFocusArea(area.id)}
                  />
                ))}
              </ItemGroup>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              onClick={() => void saveBoardSettings()}
              disabled={savingTarget !== null}
            >
              <Save data-icon="inline-start" />
              {savingTarget === "board" ? "Saving..." : "Save board settings"}
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
    </TooltipProvider>
  );
}

function SettingsErrorAlert(props: { authError?: string | null; saveError?: string | null }) {
  const message = props.authError ?? props.saveError;
  if (!message) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{props.authError ? "OpenAI setup failed" : "Settings not saved"}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ApiKeyFields(props: {
  apiKey: string;
  baseUrl: string;
  organizationId: string;
  projectId: string;
  hasStoredApiKey: boolean;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onOrganizationIdChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="openai-api-key">API key</FieldLabel>
        <Input
          id="openai-api-key"
          type="password"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          placeholder={props.hasStoredApiKey ? "Stored key is active" : "sk-..."}
        />
        <FieldDescription>
          Leave blank to keep the existing local key or environment key.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="openai-base-url">Base URL</FieldLabel>
        <Input
          id="openai-base-url"
          value={props.baseUrl}
          onChange={(event) => props.onBaseUrlChange(event.target.value)}
        />
        <FieldDescription>Default OpenAI-compatible endpoint.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="openai-organization">Organization ID</FieldLabel>
        <Input
          id="openai-organization"
          value={props.organizationId}
          onChange={(event) => props.onOrganizationIdChange(event.target.value)}
          placeholder="org_..."
        />
        <FieldDescription>Optional `OpenAI-Organization` request header.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="openai-project">Project ID</FieldLabel>
        <Input
          id="openai-project"
          value={props.projectId}
          onChange={(event) => props.onProjectIdChange(event.target.value)}
          placeholder="proj_..."
        />
        <FieldDescription>Optional `OpenAI-Project` request header.</FieldDescription>
      </Field>
    </div>
  );
}

function OpenAiMetadataSkeleton() {
  return (
    <ItemGroup>
      <Item variant="outline" className="items-start">
        <ItemContent className="gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-full" />
        </ItemContent>
        <ItemActions>
          <Skeleton className="h-8 w-24" />
        </ItemActions>
      </Item>
      <Item variant="outline" className="items-start">
        <ItemMedia variant="icon">
          <Gauge />
        </ItemMedia>
        <ItemContent className="gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full" />
        </ItemContent>
      </Item>
    </ItemGroup>
  );
}

function OpenAiNumberInput(props: {
  id: string;
  label: string;
  description: string;
  value: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const invalid = Boolean(props.error);
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? (props.integer ? 1 : undefined)}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="Provider default"
        aria-invalid={invalid}
      />
      <FieldDescription>{props.description}</FieldDescription>
      <FieldError>{props.error}</FieldError>
    </Field>
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
  errors: OpenAiNumberErrors;
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
    <>
      <Item variant="muted" className="items-start">
        <ItemMedia variant="icon">
          <SlidersHorizontal />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Request tuning</ItemTitle>
          <ItemDescription className="line-clamp-none">
            These settings apply to board work, chat, and memory review. Blank fields use
            provider defaults.
          </ItemDescription>
        </ItemContent>
      </Item>

      <div className="grid gap-6 lg:grid-cols-2">
        <FieldSet>
          <FieldLegend>Output</FieldLegend>
          <FieldDescription>Control response length and detail.</FieldDescription>
          <FieldGroup>
            <OpenAiNumberInput
              id="openai-max-tokens"
              label="Max output tokens"
              description="Blank or a whole number of 1 or higher."
              value={props.maxTokens}
              min={1}
              integer
              error={props.errors.maxTokens}
              onChange={props.onMaxTokensChange}
            />
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
              <FieldDescription>
                Choose how compact or detailed generated text should be.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Reasoning</FieldLegend>
          <FieldDescription>
            Let the model decide unless a workflow needs tighter control.
          </FieldDescription>
          <FieldGroup>
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
              <FieldDescription>
                Higher effort can improve difficult tasks but may take longer.
              </FieldDescription>
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
              <FieldDescription>
                Optional summary detail for reasoning-capable models.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Reliability</FieldLegend>
          <FieldDescription>Set bounds for slow or retrying requests.</FieldDescription>
          <FieldGroup>
            <OpenAiNumberInput
              id="openai-temperature"
              label="Temperature"
              description="Blank or a number from 0 to 2."
              value={props.temperature}
              min={0}
              max={2}
              step={0.1}
              error={props.errors.temperature}
              onChange={props.onTemperatureChange}
            />
            <OpenAiNumberInput
              id="openai-timeout"
              label="Request timeout"
              description="Blank or a whole number of at least 1000 ms."
              value={props.timeoutMs}
              min={1000}
              integer
              error={props.errors.timeoutMs}
              onChange={props.onTimeoutMsChange}
            />
            <OpenAiNumberInput
              id="openai-max-retries"
              label="Max retries"
              description="Blank or a whole number from 0 to 10."
              value={props.maxRetries}
              min={0}
              max={10}
              integer
              error={props.errors.maxRetries}
              onChange={props.onMaxRetriesChange}
            />
            <OpenAiNumberInput
              id="openai-retry-delay"
              label="Retry delay"
              description="Blank or a whole number of 0 ms or higher."
              value={props.maxRetryDelayMs}
              min={0}
              integer
              error={props.errors.maxRetryDelayMs}
              onChange={props.onMaxRetryDelayMsChange}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Transport and cache</FieldLegend>
          <FieldDescription>
            Advanced account transport and prompt cache behavior.
          </FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel>Prompt caching</FieldLabel>
              <Select
                value={props.cacheRetention}
                onValueChange={(value) =>
                  props.onCacheRetentionChange(value as OpenAiCacheRetention | DefaultOption)
                }
              >
                <SelectTrigger className="w-full" aria-label="Prompt caching">
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
              <FieldDescription>
                Provider default is best unless a run needs explicit cache policy.
              </FieldDescription>
            </Field>
            {props.authMode === "oauth" && (
              <Field>
                <FieldLabel>Transport</FieldLabel>
                <Select
                  value={props.transport}
                  onValueChange={(value) => props.onTransportChange(value as OpenAiCodexTransport)}
                >
                  <SelectTrigger className="w-full" aria-label="Transport">
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
                <FieldDescription>
                  Leave on auto unless a specific Codex transport is required.
                </FieldDescription>
              </Field>
            )}
          </FieldGroup>
        </FieldSet>
      </div>
    </>
  );
}

function OpenAiAccountPanel(props: {
  authState: OpenAiAuthState | null;
  accountInfo: OpenAiAccountInfo | null;
  selectedModel: string;
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
        <ItemMedia variant="icon">
          {props.authState?.configured ? <CheckCircle2 /> : <KeyRound />}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>OpenAI account</ItemTitle>
          <ItemDescription className="line-clamp-none">
            {props.authState?.configured
              ? `Connected${props.authState.accountId ? ` as ${props.authState.accountId}` : ""}.`
              : "Connect your OpenAI account to use supported Codex models without pasting an API key."}
          </ItemDescription>
        </ItemContent>
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
          <ItemContent>
            <ItemTitle>Finish sign-in</ItemTitle>
            <ItemDescription className="line-clamp-none">
              {login.progress ?? "Open the sign-in page, then paste the returned code if prompted."}
            </ItemDescription>
          </ItemContent>
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
          <ItemMedia variant="icon">
            <Gauge />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Model catalog</ItemTitle>
            <ItemDescription className="line-clamp-none">
              Selected model: {props.selectedModel}. Recommended model:{" "}
              {props.accountInfo.recommendedModel}. Available models:{" "}
              {props.accountInfo.models.length}. Last refreshed:{" "}
              {formatTimestamp(props.accountInfo.prefetchedAt)}.
            </ItemDescription>
          </ItemContent>
        </Item>
      )}
    </ItemGroup>
  );
}

function FocusAreaEditor(props: {
  area: FocusArea;
  canRemove: boolean;
  error?: string;
  inputRef: RefCallback<HTMLInputElement>;
  onChange: (patch: Partial<FocusArea>) => void;
  onRemove: () => void;
}) {
  const style = getFocusAreaStyle(props.area.color);
  const inputId = `focus-area-${props.area.id}`;
  const invalid = Boolean(props.error);
  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={props.onRemove}
      disabled={!props.canRemove}
      aria-label={`Remove ${props.area.label || "focus area"}`}
      title={props.canRemove ? `Remove ${props.area.label || "focus area"}` : undefined}
    >
      <Trash2 />
    </Button>
  );
  return (
    <Item
      variant="outline"
      className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]"
    >
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor={inputId} className="sr-only">
          {props.area.label || "Focus area"} name
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={inputId}
            ref={props.inputRef}
            value={props.area.label}
            onChange={(event) => props.onChange({ label: event.target.value })}
            aria-label={`${props.area.label || "Focus area"} name`}
            aria-invalid={invalid}
          />
          <InputGroupAddon align="inline-start">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: style.accent }}
            />
          </InputGroupAddon>
        </InputGroup>
        <FieldError>{props.error}</FieldError>
      </Field>
      <Field>
        <FieldLabel className="sr-only">{props.area.label || "Focus area"} color</FieldLabel>
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
      </Field>
      <ItemActions className="justify-end self-center">
        {props.canRemove ? (
          removeButton
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{removeButton}</span>
            </TooltipTrigger>
            <TooltipContent>Keep at least one focus area.</TooltipContent>
          </Tooltip>
        )}
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

function getFocusAreaErrors(areas: FocusArea[]): Map<string, string> {
  const errors = new Map<string, string>();
  for (const area of areas) {
    if (!area.label.trim()) {
      errors.set(area.id, "Enter a focus area name.");
    }
  }
  return errors;
}

function getOpenAiNumberErrors(values: Record<OpenAiNumberField, string>): OpenAiNumberErrors {
  return {
    maxTokens: validateOptionalNumber(values.maxTokens, {
      label: "Max output tokens",
      min: 1,
      integer: true,
    }),
    temperature: validateOptionalNumber(values.temperature, {
      label: "Temperature",
      min: 0,
      max: 2,
    }),
    timeoutMs: validateOptionalNumber(values.timeoutMs, {
      label: "Request timeout",
      min: 1000,
      integer: true,
    }),
    maxRetries: validateOptionalNumber(values.maxRetries, {
      label: "Max retries",
      min: 0,
      max: 10,
      integer: true,
    }),
    maxRetryDelayMs: validateOptionalNumber(values.maxRetryDelayMs, {
      label: "Retry delay",
      min: 0,
      integer: true,
    }),
  };
}

function validateOptionalNumber(
  value: string,
  options: { label: string; min?: number; max?: number; integer?: boolean },
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return `${options.label} must be a number.`;
  }
  if (options.integer && !Number.isInteger(parsed)) {
    return `${options.label} must be a whole number.`;
  }
  if (options.min !== undefined && parsed < options.min) {
    return `${options.label} must be at least ${options.min}.`;
  }
  if (options.max !== undefined && parsed > options.max) {
    return `${options.label} must be ${options.max} or lower.`;
  }
  return undefined;
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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
