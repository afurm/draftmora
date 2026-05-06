import {
  AlertCircle,
  LoaderCircle,
  Monitor,
  Plus,
  Search,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  AssistantChatConversation,
  AssistantChatMessage,
  AssistantProposedAction,
  FocusArea,
  OpenAiAccountInfo,
  OpenAiAuthState,
  ProviderConfigPatch,
  ProviderStatus,
  Task,
  TaskCreateInput,
  TaskStatus,
} from "../shared/types";
import { COLUMN_LABELS, TASK_STATUSES } from "../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "./api";
import {
  preserveTransientProposedActions,
  rememberTransientProposedActions,
  removeProposedActionFromMessages,
  removeTransientProposedAction,
  type TransientProposedActionCache,
} from "./chat-proposals";
import { BoardView } from "./components/BoardView";
import { Sidebar } from "./components/Sidebar";

const AssistantChatPanel = lazy(() =>
  import("./components/AssistantChatPanel").then((module) => ({
    default: module.AssistantChatPanel,
  })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((module) => ({ default: module.SettingsView })),
);
const TaskModal = lazy(() =>
  import("./components/TaskModal").then((module) => ({ default: module.TaskModal })),
);

type View = "board" | "settings";
type WorkspaceMode = "board" | "chat";
type HistoryWriteMode = "push" | "replace";

const VIEW_META: Record<View, { title: string; description: string }> = {
  board: {
    title: "Board",
    description: "Move work from draft to done. Drag cards when a task changes state.",
  },
  settings: {
    title: "Settings",
    description: "Manage focus areas for your local board.",
  },
};

function readTaskIdFromUrl() {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get("task");
}

function writeTaskIdToUrl(taskId: string | null, mode: HistoryWriteMode = "push") {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (taskId) {
    url.searchParams.set("task", taskId);
  } else {
    url.searchParams.delete("task");
  }
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (current === next) {
    return;
  }
  window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", next);
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("board");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("board");
  const [chatConversations, setChatConversations] = useState<AssistantChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<AssistantChatMessage[]>([]);
  const transientProposedActionsRef = useRef<TransientProposedActionCache>(new Map());
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => readTaskIdFromUrl());
  const [creatingStatus, setCreatingStatus] = useState<TaskStatus | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [tasksResponse, settingsResponse, providersResponse] = await Promise.all([
      api.listTasks(),
      api.settings(),
      api.providerStatus(),
    ]);
    setTasks(tasksResponse.tasks);
    setSettings(settingsResponse);
    setProviderStatuses(providersResponse.providers);
    setError(null);
  }, []);

  const loadAppData = useCallback(async () => {
    setLoadingApp(true);
    try {
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingApp(false);
    }
  }, [reload]);

  useEffect(() => {
    void loadAppData();
  }, [loadAppData]);

  useEffect(() => {
    const syncSelectedTaskFromUrl = () => {
      setSelectedTaskId(readTaskIdFromUrl());
    };
    window.addEventListener("popstate", syncSelectedTaskFromUrl);
    return () => window.removeEventListener("popstate", syncSelectedTaskFromUrl);
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setEditingTask(null);
      return;
    }
    let cancelled = false;
    setWorkspaceMode("board");
    setView("board");
    void api
      .getTask(selectedTaskId)
      .then((response) => {
        if (!cancelled) {
          setEditingTask(response.task);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setEditingTask(null);
        if (message === "Task not found") {
          setSelectedTaskId(null);
          writeTaskIdToUrl(null, "replace");
        }
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  useEffect(() => {
    const hasActiveExecution = tasks.some(
      (task) => task.execution?.status === "queued" || task.execution?.status === "running",
    );
    if (!hasActiveExecution) {
      return;
    }
    const timer = window.setInterval(() => {
      void reload().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [reload, tasks]);

  useEffect(() => {
    if (!editingTask) {
      return;
    }
    const refreshed = tasks.find((task) => task.id === editingTask.id);
    let cancelled = false;
    if (
      refreshed &&
      (refreshed.updatedAt !== editingTask.updatedAt ||
        refreshed.execution?.updatedAt !== editingTask.execution?.updatedAt)
    ) {
      void api
        .getTask(editingTask.id)
        .then((response) => {
          if (!cancelled) {
            setEditingTask(response.task);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [editingTask, tasks]);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const focusAreaById = new Map(
      (settings?.userProfile.focusAreas ?? []).map((area) => [area.id, area.label]),
    );
    if (!needle) {
      return tasks;
    }
    return tasks.filter((task) =>
      [
        task.title,
        task.description,
        task.status,
        task.priority,
        task.focusAreaId ? focusAreaById.get(task.focusAreaId) ?? "" : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [settings, tasks, query]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        TASK_STATUSES.map((status) => [
          status,
          tasks.filter((task) => task.status === status).length,
        ]),
      ) as Record<TaskStatus, number>,
    [tasks],
  );

  async function createOrUpdateTask(input: TaskCreateInput) {
    if (editingTask) {
      const result = await api.updateTask(editingTask.id, input);
      setTasks((current) =>
        current.map((task) => (task.id === editingTask.id ? result.task : task)),
      );
      setEditingTask(result.task);
      return;
    }
    const result = await api.createTask(input);
    setTasks((current) => [...current, result.task]);
    setCreatingStatus(null);
  }

  async function moveTask(id: string, status: TaskStatus) {
    const previous = tasks;
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, status } : task)),
    );
    try {
      const result = await api.updateTask(id, { status });
      setTasks((current) => current.map((task) => (task.id === id ? result.task : task)));
    } catch (err) {
      setTasks(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function askTaskFollowUp(taskId: string, prompt: string) {
    const result = await api.createTaskFollowUp(taskId, prompt);
    setTasks((current) => current.map((task) => (task.id === taskId ? result.task : task)));
    setEditingTask((current) => (current?.id === taskId ? result.task : current));
  }

  async function abortTaskRun(taskId: string) {
    const result = await api.abortTaskRun(taskId);
    setTasks((current) => current.map((task) => (task.id === taskId ? result.task : task)));
    setEditingTask((current) => (current?.id === taskId ? result.task : current));
  }

  async function createDraftTask(input: TaskCreateInput) {
    const result = await api.createTask(input);
    setTasks((current) => [...current, result.task]);
  }

  function openTaskEditor(task: Task) {
    setEditingTask(task);
    setSelectedTaskId(task.id);
    writeTaskIdToUrl(task.id);
  }

  function closeTaskEditor() {
    setEditingTask(null);
    setSelectedTaskId(null);
    writeTaskIdToUrl(null);
  }

  async function deleteTask(id: string) {
    const deletingOpenTask = selectedTaskId === id || editingTask?.id === id;
    await api.deleteTask(id);
    setTasks((current) => current.filter((task) => task.id !== id));
    if (deletingOpenTask) {
      setEditingTask(null);
      setSelectedTaskId(null);
      writeTaskIdToUrl(null, "replace");
    }
  }

  async function applyProposedAction(action: AssistantProposedAction) {
    const result =
      action.type === "create_task"
        ? await api.createTask({
            ...action.task,
            providerSource: action.task.providerSource ?? "local",
          })
        : action.type === "move_task"
          ? await api.updateTask(action.taskId, { status: action.status })
          : await api.updateTask(action.taskId, action.patch);
    setTasks((current) =>
      current.some((task) => task.id === result.task.id)
        ? current.map((task) => (task.id === result.task.id ? result.task : task))
        : [...current, result.task],
    );
  }

  async function saveSettings(nextSettings: AppSettings, providerPatches: ProviderConfigPatch[]) {
    const result = await api.patchSettings({
      selectedProvider: nextSettings.selectedProvider,
      userProfile: nextSettings.userProfile,
      providerConfigs: providerPatches,
    });
    setSettings(result);
    const providers = await api.providerStatus();
    setProviderStatuses(providers.providers);
  }

  async function refreshSettingsAndProviders() {
    const [settingsResponse, providersResponse] = await Promise.all([
      api.settings(),
      api.providerStatus(),
    ]);
    setSettings(settingsResponse);
    setProviderStatuses(providersResponse.providers);
  }

  async function startOpenAiAuth(): Promise<OpenAiAuthState> {
    const state = await api.startOpenAiAuth();
    await refreshSettingsAndProviders();
    return state;
  }

  async function getOpenAiAuth(): Promise<OpenAiAuthState> {
    const state = await api.openAiAuth();
    await refreshSettingsAndProviders();
    return state;
  }

  async function getOpenAiAccountInfo(): Promise<OpenAiAccountInfo> {
    return api.openAiAccountInfo();
  }

  async function submitOpenAiAuthInput(loginId: string, input: string): Promise<OpenAiAuthState> {
    const state = await api.submitOpenAiAuthInput(loginId, input);
    await refreshSettingsAndProviders();
    return state;
  }

  async function logoutOpenAiAuth(): Promise<OpenAiAuthState> {
    const state = await api.logoutOpenAiAuth();
    await refreshSettingsAndProviders();
    return state;
  }

  const loadAssistantChatHistory = useCallback(async (conversationId?: string | null) => {
    setChatHistoryLoading(true);
    try {
      const history = await api.assistantChatHistory(conversationId ?? activeConversationId);
      const messages = preserveTransientProposedActions(
        history.messages,
        transientProposedActionsRef.current,
      );
      setChatConversations(history.conversations);
      setActiveConversationId(history.activeConversationId);
      setChatMessages(messages);
      return { ...history, messages };
    } finally {
      setChatHistoryLoading(false);
    }
  }, [activeConversationId]);

  const askAssistant = useCallback(
    async (
      conversationId: string | null,
      messages: Parameters<typeof api.askAssistant>[0],
    ) => {
      const response = await api.askAssistant(messages, conversationId);
      setChatConversations(response.conversations);
      setActiveConversationId(response.conversation.id);
      return response;
    },
    [],
  );

  const handleChatMessagesChange = useCallback((messages: AssistantChatMessage[]) => {
    rememberTransientProposedActions(transientProposedActionsRef.current, messages);
    setChatMessages(messages);
  }, []);

  const resolveProposedAction = useCallback((actionId: string) => {
    removeTransientProposedAction(transientProposedActionsRef.current, actionId);
    setChatMessages((current) => removeProposedActionFromMessages(current, actionId));
  }, []);

  async function createChatConversation() {
    const history = await api.createAssistantChatConversation();
    setChatConversations(history.conversations);
    setActiveConversationId(history.activeConversationId);
    setChatMessages(history.messages);
    setWorkspaceMode("chat");
  }

  function selectChatConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setWorkspaceMode("chat");
  }

  function changeView(nextView: View) {
    setView(nextView);
    setWorkspaceMode("board");
  }

  function changeWorkspaceMode(nextMode: WorkspaceMode) {
    setWorkspaceMode(nextMode);
    if (nextMode === "board") {
      setView("board");
    }
  }

  const readyNowCount = counts.ready + counts.in_progress;
  const attentionCount = counts.needs_attention;
  const activeView = VIEW_META[view];
  const activeDescription =
    workspaceMode === "chat"
      ? "Talk with the agent. Each conversation keeps its own saved history."
      : activeView.description;
  const openAiReady = Boolean(
    providerStatuses.find((provider) => provider.provider === "openai")?.configured,
  );
  const focusAreas: FocusArea[] = settings?.userProfile.focusAreas ?? [];
  const activeConversation =
    chatConversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const createInitialTask =
    creatingStatus === null
      ? null
      : ({
          id: "",
          title: "",
          description: "",
          status: creatingStatus,
          priority: "medium",
          focusAreaId: null,
          tags: [],
          providerSource: "local",
          execution: null,
          createdAt: "",
          updatedAt: "",
        } satisfies Task);

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen>
        <Sidebar
          activeView={view}
          workspaceMode={workspaceMode}
          counts={counts}
          focusAreas={focusAreas}
          chatConversations={chatConversations}
          activeConversationId={activeConversationId}
          chatHistoryLoading={workspaceMode === "chat" && chatHistoryLoading}
          onViewChange={changeView}
          onWorkspaceModeChange={changeWorkspaceMode}
          onChatConversationSelect={selectChatConversation}
          onNewChatConversation={() => void createChatConversation()}
        />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-3 py-3 sm:px-4">
            <SidebarTrigger aria-label="Toggle navigation" title="Toggle navigation" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-medium sm:text-base">
                    {workspaceMode === "chat" ? "Chat" : activeView.title}
                  </h1>
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    <Monitor data-icon="inline-start" />
                    {openAiReady ? "OpenAI ready" : "Local board"}
                  </Badge>
                </div>
                <p className="hidden truncate text-sm text-muted-foreground xl:block">
                  {activeDescription}
                </p>
              </div>
            </div>
            {workspaceMode === "board" && (
              <>
                <InputGroup className="hidden max-w-sm xl:flex">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tasks"
                  />
                  <InputGroupAddon align="inline-end">
                    <Kbd>⌘K</Kbd>
                  </InputGroupAddon>
                </InputGroup>
                <Button size="sm" onClick={() => setCreatingStatus("draft")} aria-label="New task">
                  <Plus data-icon="inline-start" />
                  <span className="hidden sm:inline">New task</span>
                </Button>
              </>
            )}
          </header>

          <div className="flex flex-1 flex-col gap-5 p-3 sm:p-4 xl:p-5">
            {workspaceMode === "board" && (
              <InputGroup className="xl:hidden">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tasks"
                />
              </InputGroup>
            )}

            {!settings ? (
              <main className="min-w-0">
                <AppDataStateCard
                  loading={loadingApp}
                  error={error}
                  onRetry={() => void loadAppData()}
                />
              </main>
            ) : workspaceMode === "chat" ? (
              <main className="min-w-0">
                <Suspense fallback={<WorkspaceLoadingCard title="Loading chat" />}>
                  <AssistantChatPanel
                    openAiReady={openAiReady}
                    conversationId={activeConversationId}
                    conversationTitle={activeConversation?.title}
                    boardCounts={counts}
                    focusAreas={focusAreas}
                    onOpenSettings={() => changeView("settings")}
                    onNewConversation={createChatConversation}
                    onApproveProposedAction={applyProposedAction}
                    onResolveProposedAction={resolveProposedAction}
                    onLoadHistory={loadAssistantChatHistory}
                    onAsk={askAssistant}
                    onMessagesChange={handleChatMessagesChange}
                    className="min-h-[calc(100dvh-8rem)] lg:static lg:h-[calc(100dvh-8rem)] xl:h-[calc(100dvh-8.5rem)]"
                  />
                </Suspense>
              </main>
            ) : (
              <main className="flex min-w-0 flex-col gap-5">
                <section
                  className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                  aria-label="Workspace summary"
                >
                  <SummaryCard label="Ready now" value={readyNowCount} detail="Ready or in progress" />
                  <SummaryCard label="Needs attention" value={attentionCount} detail="Failed or blocked work" />
                  <SummaryCard label="Draft ideas" value={counts.draft} detail="Waiting to refine" />
                </section>

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>Something needs attention</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {view === "settings" ? (
                  <Suspense fallback={<WorkspaceLoadingCard title="Loading settings" />}>
                    <SettingsView
                      settings={settings}
                      providerStatuses={providerStatuses}
                      onSave={saveSettings}
                      onStartOpenAiAuth={startOpenAiAuth}
                      onGetOpenAiAuth={getOpenAiAuth}
                      onGetOpenAiAccountInfo={getOpenAiAccountInfo}
                      onSubmitOpenAiAuthInput={submitOpenAiAuthInput}
                      onLogoutOpenAiAuth={logoutOpenAiAuth}
                    />
                  </Suspense>
                ) : (
                  <BoardView
                    tasks={filteredTasks}
                    focusAreas={focusAreas}
                    onCreateTask={setCreatingStatus}
                    onEditTask={openTaskEditor}
                    onMoveTask={moveTask}
                  />
                )}
              </main>
            )}
          </div>
        </SidebarInset>

        {(editingTask || createInitialTask) && (
          <Suspense fallback={null}>
            <TaskModal
              task={editingTask ?? createInitialTask!}
              title={editingTask ? "Edit task" : `Add task to ${COLUMN_LABELS[creatingStatus!]}`}
              focusAreas={focusAreas}
              onClose={() => {
                if (editingTask) {
                  closeTaskEditor();
                } else {
                  setCreatingStatus(null);
                }
              }}
              onDelete={editingTask ? () => deleteTask(editingTask.id) : undefined}
              onAskFollowUp={editingTask ? (prompt) => askTaskFollowUp(editingTask.id, prompt) : undefined}
              onAbortExecution={editingTask ? () => abortTaskRun(editingTask.id) : undefined}
              onCreateDraft={editingTask ? createDraftTask : undefined}
              onSave={createOrUpdateTask}
            />
          </Suspense>
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AppDataStateCard(props: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (props.loading) {
    return <WorkspaceLoadingCard title="Loading board" />;
  }
  return (
    <Card size="sm" className="min-h-48">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle />
          Board data unavailable
        </CardTitle>
        <CardDescription>
          The app could not load saved tasks or settings, so no empty board is shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{props.error ?? "Unable to reach the local API."}</AlertDescription>
        </Alert>
        <Button type="button" className="w-fit" onClick={props.onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkspaceLoadingCard(props: { title: string }) {
  return (
    <Card size="sm" className="min-h-48">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LoaderCircle className="animate-spin" />
          {props.title}
        </CardTitle>
        <CardDescription>Restoring the local workspace.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

function SummaryCard(props: { label: string; value: number; detail: string }) {
  return (
    <Card size="sm" className="min-h-20">
      <CardHeader>
        <CardDescription className="truncate">{props.label}</CardDescription>
        <CardTitle>{props.value}</CardTitle>
        <CardDescription className="hidden sm:block">{props.detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}
