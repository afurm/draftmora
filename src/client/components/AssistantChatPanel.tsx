import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Layers3,
  ListChecks,
  LoaderCircle,
  MemoryStick,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { COLUMN_LABELS, type FocusArea, type TaskStatus } from "../../shared/types";
import type {
  AssistantChatHistoryResponse,
  AssistantChatMessage,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantProposedAction,
} from "../../shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  EmptyContent,
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
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [historyRetryKey, setHistoryRetryKey] = useState(0);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerDisabled = !openAiReady || loadingHistory || sending;
  const canSend = draft.trim().length > 0 && !composerDisabled;
  const chatTitle = conversationTitle || "New conversation";
  const chatStateDescription = formatConversationState({
    loading: loadingHistory,
    messageCount: messages.length,
    conversationId,
  });

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setHistoryError(null);
    setChatError(null);
    setActionStates({});
  }, [conversationId]);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages, sending, historyError, chatError]);

  useEffect(() => {
    if (!loadingHistory) {
      focusComposer(textareaRef);
    }
  }, [conversationId, loadingHistory]);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    setHistoryError(null);
    onLoadHistory(conversationId)
      .then((history) => {
        if (!cancelled) {
          setMessages(history.messages);
          onMessagesChange?.(history.messages);
          setHistoryError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setMessages([]);
          onMessagesChange?.([]);
          setHistoryError(message);
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
  }, [conversationId, historyRetryKey, onLoadHistory, onMessagesChange]);

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
    setChatError(null);

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
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      focusComposer(textareaRef);
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
      setChatError(err instanceof Error ? err.message : String(err));
    }
  }

  function dismissAction(action: AssistantProposedAction) {
    if (actionStates[action.id]) {
      return;
    }
    setActionStates((current) => ({ ...current, [action.id]: "dismissed" }));
    onResolveProposedAction?.(action.id);
  }

  async function handleNewConversation() {
    await onNewConversation?.();
    focusComposer(textareaRef);
  }

  function retryHistory() {
    setHistoryRetryKey((current) => current + 1);
    focusComposer(textareaRef);
  }

  return (
    <section
      className={cn(
        "grid h-full min-h-0 min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]",
        className,
      )}
      aria-label="Draftmora chat workspace"
    >
      <Card size="sm" className="h-full min-h-0 min-w-0">
        <CardHeader className="border-b">
          <CardTitle className="truncate">{chatTitle}</CardTitle>
          <CardDescription className="truncate">{chatStateDescription}</CardDescription>
          <CardAction className="flex items-center gap-2">
            <ContextSheet
              counts={boardCounts}
              loading={loadingHistory}
              memoryAvailable={memoryAvailable}
            />
            {onNewConversation && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleNewConversation()}
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
              <AlertTitle>OpenAI setup required</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>Connect OpenAI before sending a message.</span>
                <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
                  <Settings2 data-icon="inline-start" />
                  Open Settings
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {historyError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Could not load this conversation</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{historyError}</span>
                <Button type="button" size="sm" variant="outline" onClick={retryHistory}>
                  <RotateCcw data-icon="inline-start" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {chatError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Chat request failed</AlertTitle>
              <AlertDescription>{chatError}</AlertDescription>
            </Alert>
          )}

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-1 pb-4">
              {loadingHistory ? (
                <ChatLoadingSkeleton />
              ) : messages.length === 0 ? (
                <ChatEmptyState
                  disabled={!openAiReady || loadingHistory || sending}
                  onPrompt={(prompt) => void sendContent(prompt)}
                />
              ) : (
                <ItemGroup aria-live="polite" className="gap-3 py-3">
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
            </div>
          </ScrollArea>
        </CardContent>

        <CardFooter className="shrink-0">
          <form onSubmit={submit} className="w-full">
            <FieldGroup className="gap-3">
              <Field data-disabled={composerDisabled ? true : undefined}>
                <FieldLabel htmlFor="assistant-chat-input" className="sr-only">
                  Message
                </FieldLabel>
                <InputGroup className="min-h-20">
                  <InputGroupTextarea
                    id="assistant-chat-input"
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      openAiReady ? "Ask the agent..." : "Connect OpenAI to start chatting"
                    }
                    className="min-h-16"
                    disabled={composerDisabled}
                    aria-label="Message"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <InputGroupAddon align="block-end" className="justify-between border-t">
                    <InputGroupText className="min-w-0">
                      <Sparkles />
                      <span className="hidden sm:inline">Send with</span>
                      <span className="inline-flex items-center gap-1">
                        <Kbd>⌘</Kbd>
                        <Kbd>Enter</Kbd>
                      </span>
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

      <aside className="hidden min-w-0 flex-col gap-3 xl:flex xl:h-full">
        <ContextCard
          counts={boardCounts}
          loading={loadingHistory}
          memoryAvailable={memoryAvailable}
        />
      </aside>
    </section>
  );
}

function ContextSheet(props: {
  counts: Record<TaskStatus, number>;
  loading: boolean;
  memoryAvailable: boolean;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="xl:hidden"
          aria-label="Open context"
        >
          <PanelRightOpen data-icon="inline-start" />
          <span className="hidden sm:inline">Context</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Current context</SheetTitle>
          <SheetDescription>Board counts available to the chat agent.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ContextSnapshot {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ContextCard(props: {
  counts: Record<TaskStatus, number>;
  loading: boolean;
  memoryAvailable: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Current context</CardTitle>
        <CardDescription>Board snapshot for this conversation.</CardDescription>
      </CardHeader>
      <CardContent>
        <ContextSnapshot {...props} />
      </CardContent>
    </Card>
  );
}

function ContextSnapshot(props: {
  counts: Record<TaskStatus, number>;
  loading: boolean;
  memoryAvailable: boolean;
}) {
  const activeCount = props.counts.ready + props.counts.in_progress;
  return (
    <ItemGroup>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <ListChecks />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Ready now</ItemTitle>
          <ItemDescription>
            {props.counts.ready} ready · {props.counts.in_progress} in progress
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">{activeCount}</Badge>
        </ItemActions>
      </Item>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <Layers3 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Drafts</ItemTitle>
          <ItemDescription>Work that still needs shaping.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline">{props.counts.draft}</Badge>
        </ItemActions>
      </Item>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <ClipboardCheck />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Needs attention</ItemTitle>
          <ItemDescription>Tasks that may need review.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant={props.counts.needs_attention > 0 ? "secondary" : "outline"}>
            {props.counts.needs_attention}
          </Badge>
        </ItemActions>
      </Item>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <CheckCircle2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Done</ItemTitle>
          <ItemDescription>Completed local work.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline">{props.counts.done}</Badge>
        </ItemActions>
      </Item>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <MemoryStick />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Memory</ItemTitle>
          <ItemDescription>
            {props.memoryAvailable ? "Local recall available." : "Not available."}
          </ItemDescription>
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
            <ItemDescription>Loading saved messages.</ItemDescription>
          </ItemContent>
        </Item>
      )}
    </ItemGroup>
  );
}

function ChatEmptyState(props: {
  disabled: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
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
      <EmptyContent className="max-w-2xl">
        <PromptStarterActions disabled={props.disabled} onPrompt={props.onPrompt} />
      </EmptyContent>
    </Empty>
  );
}

function PromptStarterActions(props: {
  disabled: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      {PROMPT_STARTERS.map((starter) => {
        const Icon = starter.icon;
        return (
          <Button
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start"
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
  );
}

function ChatLoadingSkeleton() {
  return (
    <ItemGroup aria-label="Loading chat history" className="gap-3 py-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          className={cn("flex w-full", index === 1 ? "justify-end" : "justify-start")}
          key={index}
        >
          <Item
            variant={index === 1 ? "default" : "muted"}
            size="sm"
            className={cn(
              "w-fit max-w-[min(42rem,100%)] items-start",
              index === 1 && "max-w-[min(34rem,100%)]",
            )}
          >
            <ItemMedia variant="icon">
              <Skeleton className="size-4 rounded-full" />
            </ItemMedia>
            <ItemContent>
              <Skeleton className="h-4 w-20" />
              <Skeleton className={index === 1 ? "h-4 w-48" : "h-4 w-full"} />
              {index !== 1 && <Skeleton className="h-4 w-4/5" />}
            </ItemContent>
          </Item>
        </div>
      ))}
    </ItemGroup>
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
          "w-fit max-w-[min(42rem,100%)] items-start",
          isUser && "border-transparent bg-primary text-primary-foreground",
          isUser && "max-w-[min(34rem,100%)]",
        )}
      >
        <ItemMedia variant="icon">
          {isUser ? <UserRound /> : <Bot />}
        </ItemMedia>
        <ItemContent className="min-w-0 gap-2">
          <ItemHeader className="basis-auto justify-start">
            <ItemTitle>{isUser ? "You" : "Agent"}</ItemTitle>
            <span
              className={cn(
                "text-xs text-muted-foreground",
                isUser && "text-primary-foreground/70",
              )}
            >
              {formatMessageTime(props.message.createdAt)}
            </span>
          </ItemHeader>
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
        <ItemHeader className="basis-auto items-start">
          <ItemTitle className="line-clamp-none max-w-full flex-1 flex-wrap">
            <span className="truncate">{props.action.title}</span>
            <Badge variant="outline">{actionLabel(props.action)}</Badge>
          </ItemTitle>
        </ItemHeader>
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
    <ItemGroup className="gap-1 pt-1">
      {rows.map((row) => (
        <Item
          variant="muted"
          size="xs"
          className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)]"
          key={`${row.label}-${row.value}`}
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span className="truncate font-medium">{row.value}</span>
        </Item>
      ))}
    </ItemGroup>
  );
}

function PendingMessage() {
  return (
    <div className="flex w-full justify-start">
      <Item variant="muted" size="sm" className="w-fit max-w-[min(42rem,100%)] items-start">
        <ItemMedia variant="icon">
          <LoaderCircle className="animate-spin" />
        </ItemMedia>
        <ItemContent>
          <ItemHeader className="basis-auto justify-start">
            <ItemTitle>Agent</ItemTitle>
            <span className="text-xs text-muted-foreground">Now</span>
          </ItemHeader>
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

function formatConversationState(props: {
  loading: boolean;
  messageCount: number;
  conversationId: string | null;
}): string {
  if (props.loading) {
    return "Restoring saved history";
  }
  if (props.messageCount === 0) {
    return props.conversationId ? "No messages yet" : "Unsaved local conversation";
  }
  return `${props.messageCount} ${props.messageCount === 1 ? "message" : "messages"} · Saved local history`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function focusComposer(ref: RefObject<HTMLTextAreaElement | null>) {
  window.setTimeout(() => ref.current?.focus(), 0);
}
