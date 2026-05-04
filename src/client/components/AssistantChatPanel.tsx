import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Layers3,
  ListChecks,
  LoaderCircle,
  MemoryStick,
  MessageSquareText,
  Plus,
  Send,
  Settings2,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { COLUMN_LABELS, type FocusArea, type TaskStatus } from "../../shared/types";
import type {
  AssistantChatHistoryResponse,
  AssistantChatMessage,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantProposedAction,
} from "../../shared/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { api } from "../api";
import { MarkdownMessage } from "./MarkdownMessage";

type AssistantChatPanelProps = {
  openAiReady: boolean;
  conversationId: string | null;
  conversationTitle?: string;
  boardCounts?: Record<TaskStatus, number>;
  focusAreas?: FocusArea[];
  memoryAvailable?: boolean;
  onOpenSettings: () => void;
  onNewConversation?: () => void | Promise<void>;
  onApproveProposedAction?: (action: AssistantProposedAction) => Promise<void>;
  onResolveProposedAction?: (actionId: string) => void;
  onLoadHistory?: (conversationId: string | null) => Promise<AssistantChatHistoryResponse>;
  onAsk?: (
    conversationId: string | null,
    messages: AssistantChatRequest["messages"],
  ) => Promise<AssistantChatResponse>;
  onMessagesChange?: (messages: AssistantChatMessage[]) => void;
  className?: string;
};

type ActionState = "approving" | "approved" | "dismissed" | "failed";

const EMPTY_COUNTS: Record<TaskStatus, number> = {
  draft: 0,
  ready: 0,
  in_progress: 0,
  needs_attention: 0,
  done: 0,
};

const PROMPT_STARTERS = [
  {
    label: "Plan today",
    prompt:
      "Plan my next work session from the current board. Prioritize ready and in-progress tasks, then propose any task changes for approval.",
    icon: ListChecks,
  },
  {
    label: "Break down drafts",
    prompt:
      "Review my draft tasks and suggest smaller ready tasks where the next step is unclear.",
    icon: Layers3,
  },
  {
    label: "Review stuck work",
    prompt:
      "Look for tasks that seem stuck or overloaded and propose one practical board cleanup.",
    icon: ClipboardCheck,
  },
] as const;

export function AssistantChatPanel({
  openAiReady,
  conversationId,
  conversationTitle,
  boardCounts = EMPTY_COUNTS,
  focusAreas = [],
  memoryAvailable = true,
  onOpenSettings,
  onNewConversation,
  onApproveProposedAction,
  onResolveProposedAction,
  onLoadHistory = api.assistantChatHistory,
  onAsk = (activeConversationId, messages) => api.askAssistant(messages, activeConversationId),
  onMessagesChange,
  className,
}: AssistantChatPanelProps) {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const canSend = draft.trim().length > 0 && openAiReady && !loadingHistory && !sending;

  useEffect(() => {
    setDraft("");
    setError(null);
    setActionStates({});
  }, [conversationId]);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages, sending, error]);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    onLoadHistory(conversationId)
      .then((history) => {
        if (!cancelled) {
          setMessages(history.messages);
          onMessagesChange?.(history.messages);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, onLoadHistory, onMessagesChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendContent(draft);
  }

  async function sendContent(value: string) {
    const content = value.trim();
    if (!content || sending || !openAiReady || loadingHistory) {
      return;
    }

    const userMessage: AssistantChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? "local",
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    onMessagesChange?.(nextMessages);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const response = await onAsk(
        conversationId,
        nextMessages.slice(-24).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      );
      const responseMessages =
        response.messages.length > 0 ? response.messages : [...nextMessages, response.message];
      setMessages(responseMessages);
      onMessagesChange?.(responseMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function approveAction(action: AssistantProposedAction) {
    if (!onApproveProposedAction || actionStates[action.id]) {
      return;
    }
    setActionStates((current) => ({ ...current, [action.id]: "approving" }));
    try {
      await onApproveProposedAction(action);
      setActionStates((current) => ({ ...current, [action.id]: "approved" }));
      onResolveProposedAction?.(action.id);
    } catch (err) {
      setActionStates((current) => ({ ...current, [action.id]: "failed" }));
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function dismissAction(action: AssistantProposedAction) {
    if (actionStates[action.id]) {
      return;
    }
    setActionStates((current) => ({ ...current, [action.id]: "dismissed" }));
    onResolveProposedAction?.(action.id);
  }

  return (
    <section
      className={cn(
        "grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]",
        className,
      )}
      aria-label="Draftmora chat workspace"
    >
      <Card size="sm" className="h-full min-h-[38rem] min-w-0 xl:min-h-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText />
            Chat
          </CardTitle>
          <CardDescription className="truncate">
            {conversationTitle || "New conversation"}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {onNewConversation && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onNewConversation()}
                disabled={sending}
                aria-label="New conversation"
              >
                <Plus data-icon="inline-start" />
                <span className="hidden sm:inline">New chat</span>
              </Button>
            )}
            <Badge variant={openAiReady ? "secondary" : "outline"}>
              {openAiReady ? "Ready" : "Setup"}
            </Badge>
          </CardAction>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {!openAiReady && (
            <Alert>
              <AlertCircle />
              <AlertDescription className="flex flex-col gap-2">
                <span>Connect OpenAI before sending a message.</span>
                <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
                  <Settings2 data-icon="inline-start" />
                  Open Settings
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <ScrollArea className="min-h-0 flex-1 pr-3">
            {loadingHistory ? (
              <Empty className="min-h-full py-8 pb-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LoaderCircle className="animate-spin" />
                  </EmptyMedia>
                  <EmptyTitle>Loading chat</EmptyTitle>
                  <EmptyDescription>Restoring saved messages.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : messages.length === 0 ? (
              <Empty className="min-h-full py-8 pb-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Bot />
                  </EmptyMedia>
                  <EmptyTitle>Start a chat</EmptyTitle>
                  <EmptyDescription>
                    Ask about priorities, task wording, or the next useful step.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup aria-live="polite" className="gap-3">
                {messages.map((message) => (
                  <ChatMessageRow
                    actionStates={actionStates}
                    focusAreas={focusAreas}
                    message={message}
                    key={message.id}
                    onApproveAction={approveAction}
                    onDismissAction={dismissAction}
                  />
                ))}
                {sending && <PendingMessage />}
                <div ref={bottomRef} />
              </ItemGroup>
            )}
          </ScrollArea>
        </CardContent>

        <CardFooter>
          <form onSubmit={submit} className="w-full">
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="assistant-chat-input">Message</FieldLabel>
                <InputGroup className="min-h-28">
                  <InputGroupTextarea
                    id="assistant-chat-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Ask the agent..."
                    className="min-h-24"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <InputGroupAddon align="block-end" className="justify-between border-t">
                    <InputGroupText>
                      <Sparkles />
                      <span>⌘ Enter</span>
                    </InputGroupText>
                    <InputGroupButton type="submit" variant="default" disabled={!canSend}>
                      {sending ? (
                        <LoaderCircle className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <Send data-icon="inline-start" />
                      )}
                      {sending ? "Sending..." : "Send"}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </FieldGroup>
          </form>
        </CardFooter>
      </Card>

      <aside className="flex min-w-0 flex-col gap-3 xl:h-full">
        <ContextCard
          counts={boardCounts}
          loading={loadingHistory}
          memoryAvailable={memoryAvailable}
          openAiReady={openAiReady}
        />
        <PromptStarters
          disabled={!openAiReady || loadingHistory || sending}
          onPrompt={(prompt) => void sendContent(prompt)}
        />
      </aside>
    </section>
  );
}

function ContextCard(props: {
  counts: Record<TaskStatus, number>;
  loading: boolean;
  memoryAvailable: boolean;
  openAiReady: boolean;
}) {
  const activeCount = props.counts.ready + props.counts.in_progress;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Context</CardTitle>
        <CardDescription>Board snapshot</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          <Item variant="muted" size="sm">
            <ItemMedia variant="icon">
              <Bot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>OpenAI</ItemTitle>
              <ItemDescription>{props.openAiReady ? "Ready" : "Needs setup"}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={props.openAiReady ? "secondary" : "outline"}>
                {props.openAiReady ? "Ready" : "Setup"}
              </Badge>
            </ItemActions>
          </Item>
          <Item variant="muted" size="sm">
            <ItemMedia variant="icon">
              <ListChecks />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Board</ItemTitle>
              <ItemDescription>{activeCount} active tasks</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="outline">{props.counts.draft} draft</Badge>
            </ItemActions>
          </Item>
          <Item variant="muted" size="sm">
            <ItemMedia variant="icon">
              <MemoryStick />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Memory</ItemTitle>
              <ItemDescription>{props.memoryAvailable ? "Local" : "Unavailable"}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={props.memoryAvailable ? "secondary" : "outline"}>
                {props.memoryAvailable ? "On" : "Off"}
              </Badge>
            </ItemActions>
          </Item>
          {props.loading && (
            <Item variant="outline" size="sm">
              <ItemMedia variant="icon">
                <LoaderCircle className="animate-spin" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Restoring chat</ItemTitle>
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

function PromptStarters(props: {
  disabled: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Prompt Starters</CardTitle>
        <CardDescription>Proactive next steps</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {PROMPT_STARTERS.map((starter) => {
            const Icon = starter.icon;
            return (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={props.disabled}
                onClick={() => props.onPrompt(starter.prompt)}
                key={starter.label}
              >
                <Icon data-icon="inline-start" />
                <span className="truncate">{starter.label}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ChatMessageRow(props: {
  actionStates: Record<string, ActionState>;
  focusAreas: FocusArea[];
  message: AssistantChatMessage;
  onApproveAction: (action: AssistantProposedAction) => void;
  onDismissAction: (action: AssistantProposedAction) => void;
}) {
  const isUser = props.message.role === "user";
  const proposedActions = isUser ? [] : props.message.proposedActions ?? [];
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <Item
        variant={isUser ? "default" : "muted"}
        size="sm"
        className={cn(
          "max-w-[92%] items-start",
          isUser && "border-transparent bg-primary text-primary-foreground",
        )}
      >
        <ItemMedia variant="icon">
          {isUser ? <UserRound /> : <Bot />}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{isUser ? "You" : "Agent"}</ItemTitle>
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{props.message.content}</p>
          ) : (
            <MarkdownMessage>{props.message.content}</MarkdownMessage>
          )}
          {proposedActions.length > 0 && (
            <>
              <Separator />
              <ItemGroup className="gap-2">
                {proposedActions.map((action) => (
                  <ProposedActionRow
                    action={action}
                    focusAreas={props.focusAreas}
                    key={action.id}
                    state={props.actionStates[action.id]}
                    onApprove={() => props.onApproveAction(action)}
                    onDismiss={() => props.onDismissAction(action)}
                  />
                ))}
              </ItemGroup>
            </>
          )}
        </ItemContent>
      </Item>
    </div>
  );
}

function ProposedActionRow(props: {
  action: AssistantProposedAction;
  focusAreas: FocusArea[];
  state?: ActionState;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const approving = props.state === "approving";
  const completed = props.state === "approved" || props.state === "dismissed";
  return (
    <Item variant="outline" size="sm" className="items-start">
      <ItemMedia variant="icon">{actionIcon(props.action)}</ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="truncate">{props.action.title}</span>
          <Badge variant="outline">{actionLabel(props.action)}</Badge>
        </ItemTitle>
        {props.action.rationale && <ItemDescription>{props.action.rationale}</ItemDescription>}
        <ActionFieldList action={props.action} focusAreas={props.focusAreas} />
      </ItemContent>
      <ItemActions className="basis-full justify-end sm:basis-auto">
        {props.state === "approved" ? (
          <Badge variant="secondary">
            <CheckCircle2 data-icon="inline-start" />
            Approved
          </Badge>
        ) : props.state === "dismissed" ? (
          <Badge variant="outline">Dismissed</Badge>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" onClick={props.onDismiss} disabled={approving}>
              <X data-icon="inline-start" />
              Dismiss
            </Button>
            <Button type="button" size="sm" onClick={props.onApprove} disabled={completed || approving}>
              {approving ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <CheckCircle2 data-icon="inline-start" />
              )}
              {approving ? "Approving..." : "Approve"}
            </Button>
          </>
        )}
      </ItemActions>
    </Item>
  );
}

function ActionFieldList(props: {
  action: AssistantProposedAction;
  focusAreas: FocusArea[];
}) {
  const rows = actionRows(props.action, props.focusAreas);
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl className="grid gap-1 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <div className="min-w-0" key={`${row.label}-${row.value}`}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="truncate font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PendingMessage() {
  return (
    <div className="flex w-full justify-start">
      <Item variant="muted" size="sm" className="max-w-[92%] items-start">
        <ItemMedia variant="icon">
          <LoaderCircle className="animate-spin" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Agent</ItemTitle>
          <p className="text-sm text-muted-foreground">Thinking...</p>
        </ItemContent>
      </Item>
    </div>
  );
}

function actionIcon(action: AssistantProposedAction) {
  if (action.type === "create_task") {
    return <Plus />;
  }
  if (action.type === "move_task") {
    return <ClipboardCheck />;
  }
  return <WandSparkles />;
}

function actionLabel(action: AssistantProposedAction): string {
  if (action.type === "create_task") {
    return "Create";
  }
  if (action.type === "move_task") {
    return "Move";
  }
  return "Update";
}

function actionRows(action: AssistantProposedAction, focusAreas: FocusArea[]) {
  if (action.type === "create_task") {
    return [
      { label: "Title", value: action.task.title },
      { label: "Status", value: formatStatus(action.task.status ?? "draft") },
      { label: "Priority", value: action.task.priority ?? "medium" },
      { label: "Focus", value: formatFocusArea(action.task.focusAreaId, focusAreas) },
    ];
  }
  if (action.type === "move_task") {
    return [
      { label: "Task", value: action.taskId },
      { label: "New status", value: formatStatus(action.status) },
    ];
  }
  return [
    { label: "Task", value: action.taskId },
    ...Object.entries(action.patch).map(([key, value]) => ({
      label: formatPatchKey(key),
      value: formatPatchValue(key, value, focusAreas),
    })),
  ];
}

function formatStatus(status: TaskStatus): string {
  return COLUMN_LABELS[status];
}

function formatFocusArea(value: string | null | undefined, focusAreas: FocusArea[]): string {
  if (!value) {
    return "No focus area";
  }
  return focusAreas.find((area) => area.id === value)?.label ?? value;
}

function formatPatchKey(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatPatchValue(key: string, value: unknown, focusAreas: FocusArea[]): string {
  if (key === "status" && typeof value === "string" && value in COLUMN_LABELS) {
    return formatStatus(value as TaskStatus);
  }
  if (key === "focusAreaId") {
    return formatFocusArea(typeof value === "string" ? value : null, focusAreas);
  }
  if (Array.isArray(value)) {
    return value.join(", ") || "None";
  }
  if (value === null || value === undefined || value === "") {
    return "None";
  }
  return String(value);
}
