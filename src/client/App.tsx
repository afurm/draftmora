import {
  AlertCircle,
  Filter,
  LoaderCircle,
  Monitor,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
  TaskFollowUpMode,
  TaskStatus,
} from "../shared/types";
import { COLUMN_LABELS, TASK_STATUSES } from "../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
type BoardScope = "all" | "ready_now" | "running" | "needs_attention" | "draft";

const VIEW_META: Record<View, { title: string; description: string }> = {
  board: {
    title: "Board",
    description: "Move work from draft to done. Drag cards when a task changes state.",
  },
  settings: {
    title: "Settings",
    description: "Connect OpenAI and manage local board preferences.",
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
  const [activeFocusAreaId, setActiveFocusAreaId] = useState<string | null>(null);
  const [boardScope, setBoardScope] = useState<BoardScope>("all");
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

  const searchAndFocusTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const focusAreaById = new Map(
      (settings?.userProfile.focusAreas ?? []).map((area) => [area.id, area.label]),
    );
    return tasks.filter((task) =>
      (activeFocusAreaId === null || task.focusAreaId === activeFocusAreaId) &&
      (!needle ||
        [
          task.title,
          task.description,
          task.status,
          task.priority,
          task.focusAreaId ? focusAreaById.get(task.focusAreaId) ?? "" : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
    );
  }, [activeFocusAreaId, settings, tasks, query]);

  const filteredTasks = useMemo(
    () => applyBoardScope(searchAndFocusTasks, boardScope),
    [boardScope, searchAndFocusTasks],
  );

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

  const visibleCounts = useMemo(
    () => countTasksByStatus(searchAndFocusTasks),
    [searchAndFocusTasks],
  );

  const focusAreaCounts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const task of tasks) {
      if (task.focusAreaId) {
        next[task.focusAreaId] = (next[task.focusAreaId] ?? 0) + 1;
      }
    }
    return next;
  }, [tasks]);

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

  async function askTaskFollowUp(
    taskId: string,
    prompt: string,
    mode: TaskFollowUpMode = "queue",
  ) {
    const result = await api.createTaskFollowUp(taskId, prompt, mode);
    setTasks((current) => current.map((task) => (task.id === taskId ? result.task : task)));
    setEditingTask((current) => (current?.id === taskId ? result.task : current));
  }

  async function abortTaskRun(taskId: string) {
    const result = await api.abortTaskRun(taskId);
    setTasks((current) => current.map((task) => (task.id === taskId ? result.task : task)));
    setEditingTask((current) => (current?.id === taskId ? result.task : current));
  }

  async function forceTaskFollowUp(taskId: string, executionId: string) {
    const result = await api.forceTaskFollowUp(taskId, executionId);
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
    setView("board");
  }

  function clearBoardFilters() {
    setQuery("");
    setActiveFocusAreaId(null);
    setBoardScope("all");
  }

  const runningCount = searchAndFocusTasks.filter(
    (task) => task.execution?.status === "queued" || task.execution?.status === "running",
  ).length;
  const activeView = VIEW_META[view];
  const activeDescription =
    workspaceMode === "chat"
      ? "Talk with the agent. Each conversation keeps its own saved history."
      : activeView.description;
  const openAiReady = Boolean(
    providerStatuses.find((provider) => provider.provider === "openai")?.configured,
  );
  const focusAreas: FocusArea[] = settings?.userProfile.focusAreas ?? [];
  const activeFocusArea = activeFocusAreaId
    ? focusAreas.find((area) => area.id === activeFocusAreaId) ?? null
    : null;
  const hasActiveBoardFilters =
    query.trim().length > 0 || activeFocusAreaId !== null || boardScope !== "all";
  const boardHeaderDescription = formatBoardStateLine({
    activeFocusArea,
    boardScope,
    filteredCount: filteredTasks.length,
    query,
    runningCount,
    visibleCounts,
  });
  const visibleStatuses = useMemo(
    () => getVisibleStatuses(boardScope, filteredTasks),
    [boardScope, filteredTasks],
  );
  const showBoardHeaderActions = workspaceMode === "board" && view === "board";

  useEffect(() => {
    if (activeFocusAreaId && !focusAreas.some((area) => area.id === activeFocusAreaId)) {
      setActiveFocusAreaId(null);
    }
  }, [activeFocusAreaId, focusAreas]);

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
          focusAreaCounts={focusAreaCounts}
          activeFocusAreaId={activeFocusAreaId}
          chatConversations={chatConversations}
          activeConversationId={activeConversationId}
          chatHistoryLoading={workspaceMode === "chat" && chatHistoryLoading}
          onViewChange={changeView}
          onWorkspaceModeChange={changeWorkspaceMode}
          onFocusAreaChange={setActiveFocusAreaId}
          onChatConversationSelect={selectChatConversation}
          onNewChatConversation={() => void createChatConversation()}
        />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-3 py-3 sm:px-4">
            <SidebarTrigger aria-label="Toggle navigation" title="Toggle navigation" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-medium sm:text-base">
                    {workspaceMode === "chat" ? "Chat" : activeView.title}
                  </h1>
                  {showBoardHeaderActions && (
                    <Badge variant="secondary" className="hidden sm:inline-flex">
                      <Monitor data-icon="inline-start" />
                      {openAiReady ? "OpenAI ready" : "Local board"}
                    </Badge>
                  )}
                </div>
                <p className="hidden truncate text-sm text-muted-foreground xl:block">
                  {workspaceMode === "chat" || view === "settings"
                    ? activeDescription
                    : boardHeaderDescription}
                </p>
              </div>
            </div>
            {showBoardHeaderActions && (
              <>
                <InputGroup className="hidden max-w-sm xl:flex">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, description, focus, priority"
                    aria-label="Search tasks"
                  />
                  {query && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
                {hasActiveBoardFilters && (
                  <Button variant="outline" size="sm" onClick={clearBoardFilters}>
                    <Filter data-icon="inline-start" />
                    <span className="hidden sm:inline">Clear filters</span>
                  </Button>
                )}
                <Button size="sm" onClick={() => setCreatingStatus("draft")} aria-label="New task">
                  <Plus data-icon="inline-start" />
                  <span className="hidden sm:inline">New task</span>
                </Button>
              </>
            )}
          </header>

          <div className="flex flex-1 flex-col gap-5 p-3 sm:p-4 xl:p-5">
            {showBoardHeaderActions && (
              <InputGroup className="xl:hidden">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, description, focus, priority"
                  aria-label="Search tasks"
                />
                {query && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
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
                    className="h-[calc(100dvh-5.5rem)] min-h-[32rem] lg:static lg:h-[calc(100dvh-8rem)] xl:h-[calc(100dvh-8.5rem)]"
                  />
                </Suspense>
              </main>
            ) : (
              <main className="flex min-w-0 flex-col gap-5">
                {view === "board" && (
                  <BoardFocusStrip
                    counts={visibleCounts}
                    runningCount={runningCount}
                    activeScope={boardScope}
                    activeFocusAreaLabel={activeFocusArea?.label}
                    onScopeChange={setBoardScope}
                    onCreateTask={() => setCreatingStatus("draft")}
                    onClearScope={() => setBoardScope("all")}
                  />
                )}

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
                    visibleStatuses={visibleStatuses}
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
              onAskFollowUp={
                editingTask
                  ? (prompt, mode) => askTaskFollowUp(editingTask.id, prompt, mode)
                  : undefined
              }
              onAbortExecution={editingTask ? () => abortTaskRun(editingTask.id) : undefined}
              onForceFollowUp={
                editingTask
                  ? (executionId) => forceTaskFollowUp(editingTask.id, executionId)
                  : undefined
              }
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

function BoardFocusStrip(props: {
  counts: Record<TaskStatus, number>;
  runningCount: number;
  activeScope: BoardScope;
  activeFocusAreaLabel?: string;
  onScopeChange: (scope: BoardScope) => void;
  onCreateTask: () => void;
  onClearScope: () => void;
}) {
  const readyNowCount = props.counts.ready + props.counts.in_progress;
  const activeWorkCount =
    readyNowCount + props.runningCount + props.counts.needs_attention + props.counts.draft;

  if (activeWorkCount === 0) {
    return (
      <Card size="sm" className="border-dashed bg-muted/25">
        <CardHeader>
          <CardTitle>
            {props.activeFocusAreaLabel
              ? `No active ${props.activeFocusAreaLabel} work`
              : "No active work"}
          </CardTitle>
          <CardDescription>
            {props.counts.done > 0
              ? `${formatTaskCount(props.counts.done)} done. Capture a draft when something new appears.`
              : "Capture a draft or create a ready task when something needs attention."}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              {props.activeScope !== "all" && (
                <Button size="sm" variant="ghost" onClick={props.onClearScope}>
                  <X data-icon="inline-start" />
                  Show all
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={props.onCreateTask}>
                <Plus data-icon="inline-start" />
                New task
              </Button>
            </div>
          </CardAction>
        </CardHeader>
      </Card>
    );
  }

  const metrics = ([
    {
      label: "Ready now",
      value: readyNowCount,
      detail: "Ready or in progress",
      scope: "ready_now",
    },
    {
      label: "Running",
      value: props.runningCount,
      detail: "Queued or running",
      scope: "running",
    },
    {
      label: "Needs attention",
      value: props.counts.needs_attention,
      detail: "Blocked or failed",
      scope: "needs_attention",
    },
    {
      label: "Draft ideas",
      value: props.counts.draft,
      detail: "Waiting to refine",
      scope: "draft",
    },
  ] satisfies Array<{
    label: string;
    value: number;
    detail: string;
    scope: BoardScope;
  }>).filter((metric) => metric.value > 0 || props.activeScope === metric.scope);

  return (
    <section className="flex flex-col gap-2" aria-label="Work focus">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <BoardMetricCard
            key={metric.scope}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            active={props.activeScope === metric.scope}
            onActivate={() => props.onScopeChange(metric.scope)}
          />
        ))}
      </div>
      {props.activeScope !== "all" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={props.onClearScope}
        >
          <X data-icon="inline-start" />
          Show all columns
        </Button>
      )}
    </section>
  );
}

function BoardMetricCard(props: {
  label: string;
  value: number;
  detail: string;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      aria-label={`${props.label}: ${props.value}. ${props.detail}`}
      aria-pressed={props.active}
      className={cn(
        "min-h-16 cursor-pointer transition-colors hover:bg-accent/30 sm:min-h-20",
        props.active && "bg-accent/30 ring-2 ring-ring/40",
      )}
      onClick={props.onActivate}
      onKeyDown={(event) => activateOnKeyboard(event, props.onActivate)}
    >
      <CardHeader className="gap-0.5 sm:gap-1">
        <CardDescription className="truncate">{props.label}</CardDescription>
        <CardTitle>{props.value}</CardTitle>
        <CardDescription className="hidden sm:block">{props.detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function activateOnKeyboard(event: KeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function applyBoardScope(tasks: Task[], scope: BoardScope): Task[] {
  if (scope === "ready_now") {
    return tasks.filter((task) => task.status === "ready" || task.status === "in_progress");
  }
  if (scope === "running") {
    return tasks.filter(
      (task) => task.execution?.status === "queued" || task.execution?.status === "running",
    );
  }
  if (scope === "needs_attention") {
    return tasks.filter((task) => task.status === "needs_attention");
  }
  if (scope === "draft") {
    return tasks.filter((task) => task.status === "draft");
  }
  return tasks;
}

function countTasksByStatus(tasks: Task[]): Record<TaskStatus, number> {
  return Object.fromEntries(
    TASK_STATUSES.map((status) => [
      status,
      tasks.filter((task) => task.status === status).length,
    ]),
  ) as Record<TaskStatus, number>;
}

function getVisibleStatuses(scope: BoardScope, tasks: Task[]): TaskStatus[] {
  if (scope === "ready_now") {
    return ["ready", "in_progress"];
  }
  if (scope === "running") {
    const statuses = TASK_STATUSES.filter((status) =>
      tasks.some((task) => task.status === status),
    );
    return statuses.length > 0 ? statuses : ["in_progress"];
  }
  if (scope === "needs_attention") {
    return ["needs_attention"];
  }
  if (scope === "draft") {
    return ["draft"];
  }
  return [...TASK_STATUSES];
}

function formatBoardStateLine(input: {
  activeFocusArea: FocusArea | null;
  boardScope: BoardScope;
  filteredCount: number;
  query: string;
  runningCount: number;
  visibleCounts: Record<TaskStatus, number>;
}): string {
  if (input.boardScope !== "all") {
    return `${BOARD_SCOPE_LABELS[input.boardScope]} - ${formatTaskCount(input.filteredCount)}`;
  }
  if (input.query.trim()) {
    return `Showing ${formatTaskCount(input.filteredCount)} for "${input.query.trim()}"`;
  }
  const focusPrefix = input.activeFocusArea ? `${input.activeFocusArea.label} - ` : "";
  const readyNowCount = input.visibleCounts.ready + input.visibleCounts.in_progress;
  if (
    readyNowCount === 0 &&
    input.visibleCounts.needs_attention === 0 &&
    input.visibleCounts.draft === 0
  ) {
    return `${focusPrefix}${input.visibleCounts.done} done - no active work`;
  }
  return [
    `${focusPrefix}${readyNowCount} ready now`,
    `${input.runningCount} running`,
    `${input.visibleCounts.needs_attention} needs attention`,
  ].join(" - ");
}

function formatTaskCount(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

const BOARD_SCOPE_LABELS: Record<Exclude<BoardScope, "all">, string> = {
  ready_now: "Ready now",
  running: "Running",
  needs_attention: "Needs attention",
  draft: "Draft ideas",
};
