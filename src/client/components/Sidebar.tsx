import {
  Circle,
  LayoutGrid,
  MessageSquareText,
  Monitor,
  Plus,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AssistantChatConversation,
  FocusArea,
  TaskStatus,
} from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { getFocusAreaStyle } from "../focus-areas";

type View = "board" | "settings";
type WorkspaceMode = "board" | "chat";
const BRAND_ICON_SRC = "/draftmora-logo.png";

export function Sidebar(props: {
  activeView: View;
  workspaceMode: WorkspaceMode;
  counts: Record<TaskStatus, number>;
  focusAreas: FocusArea[];
  focusAreaCounts: Record<string, number>;
  activeFocusAreaId: string | null;
  chatConversations: AssistantChatConversation[];
  activeConversationId: string | null;
  chatHistoryLoading: boolean;
  onViewChange: (view: View) => void;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  onFocusAreaChange: (focusAreaId: string | null) => void;
  onChatConversationSelect: (conversationId: string) => void;
  onNewChatConversation: () => void;
}) {
  const readyNowCount = props.counts.ready + props.counts.in_progress;
  const attentionCount = props.counts.needs_attention;
  const { isMobile, setOpenMobile, state } = useSidebar();

  function selectView(view: View) {
    props.onViewChange(view);
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function selectWorkspaceMode(mode: WorkspaceMode) {
    props.onWorkspaceModeChange(mode);
    if (mode === "board") {
      props.onViewChange("board");
    }
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function selectChatConversation(conversationId: string) {
    props.onChatConversationSelect(conversationId);
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function createChatConversation() {
    props.onNewChatConversation();
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function selectFocusArea(focusAreaId: string | null) {
    props.onFocusAreaChange(focusAreaId);
    props.onWorkspaceModeChange("board");
    props.onViewChange("board");
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  const activeWorkspaceMode =
    props.activeView === "settings" ? "" : props.workspaceMode === "chat" ? "chat" : "board";
  const settingsIsActive = props.activeView === "settings";
  const collapsedIconMode = !isMobile && state === "collapsed";
  const collapsedToggleItemStyle = collapsedIconMode
    ? {
        width: "32px",
        height: "32px",
        minWidth: "32px",
        padding: 0,
        borderRadius: "var(--radius-md)",
      }
    : undefined;
  const totalTaskCount = Object.values(props.counts).reduce((total, count) => total + count, 0);

  return (
    <ShadcnSidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              size="lg"
              tooltip="Draftmora"
              onClick={() => selectView("board")}
            >
              <img
                src={BRAND_ICON_SRC}
                alt=""
                aria-hidden="true"
                className="size-8 shrink-0 rounded-[0.6rem] object-cover ring-1 ring-border/70"
              />
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">Draftmora</span>
                <span className="truncate text-xs text-muted-foreground">
                  Local task board
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ToggleGroup
          type="single"
          value={activeWorkspaceMode}
          onValueChange={(value) => {
            if (value) {
              selectWorkspaceMode(value as WorkspaceMode);
            }
          }}
          variant="outline"
          size="sm"
          spacing={collapsedIconMode ? 1 : 0}
          orientation={collapsedIconMode ? "vertical" : "horizontal"}
          className={cn("w-full", collapsedIconMode && "w-8 rounded-none")}
          aria-label="Task mode"
        >
          <ToggleGroupItem
            value="board"
            aria-label="Show board"
            title="Board"
            style={collapsedToggleItemStyle}
            className={cn(collapsedIconMode ? "flex-none" : "flex-1")}
          >
            <LayoutGrid data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">Board</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="chat"
            aria-label="Show chat"
            title="Chat"
            style={collapsedToggleItemStyle}
            className={cn(collapsedIconMode ? "flex-none" : "flex-1")}
          >
            <MessageSquareText data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">Chat</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </SidebarHeader>

      <SidebarContent>
        {props.workspaceMode === "chat" ? (
          <ChatHistoryGroup
            loading={props.chatHistoryLoading}
            conversations={props.chatConversations}
            activeConversationId={props.activeConversationId}
            onConversationSelect={selectChatConversation}
            onNewConversation={createChatConversation}
          />
        ) : (
          <FocusAreasGroup
            focusAreas={props.focusAreas}
            focusAreaCounts={props.focusAreaCounts}
            totalTaskCount={totalTaskCount}
            activeFocusAreaId={props.activeFocusAreaId}
            onFocusAreaChange={selectFocusArea}
            onManageFocusAreas={() => selectView("settings")}
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={settingsIsActive}
              tooltip="Settings"
              aria-current={settingsIsActive ? "page" : undefined}
              onClick={() => selectView("settings")}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div
              data-sidebar="local-status"
              className="flex h-auto min-h-12 w-full items-start gap-2 rounded-md p-2 text-sm text-sidebar-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2 [&_svg]:size-4 [&_svg]:shrink-0"
              aria-label={`This Mac: ${readyNowCount} ready now, ${attentionCount} need attention`}
              title={`This Mac: ${readyNowCount} ready now, ${attentionCount} need attention`}
            >
              <Monitor />
              <span className="grid gap-0.5 group-data-[collapsible=icon]:hidden">
                <span>This Mac</span>
                <span className="text-xs font-normal text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {readyNowCount} ready now · {attentionCount} need attention
                  </span>
                </span>
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </ShadcnSidebar>
  );
}

function FocusAreasGroup(props: {
  focusAreas: FocusArea[];
  focusAreaCounts: Record<string, number>;
  totalTaskCount: number;
  activeFocusAreaId: string | null;
  onFocusAreaChange: (focusAreaId: string | null) => void;
  onManageFocusAreas: () => void;
}) {
  const allWorkIsActive = props.activeFocusAreaId === null;

  return (
    <SidebarGroup className="min-h-0 flex-1">
      <SidebarGroupLabel>Focus areas</SidebarGroupLabel>
      <SidebarGroupAction
        type="button"
        aria-label="Edit focus areas"
        title="Edit focus areas"
        onClick={props.onManageFocusAreas}
      >
        <Settings />
        <span className="sr-only">Edit focus areas</span>
      </SidebarGroupAction>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 pr-1 group-data-[collapsible=icon]:pr-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                isActive={allWorkIsActive}
                tooltip="All work"
                aria-pressed={allWorkIsActive}
                aria-label={formatFocusAreaAriaLabel("All work", props.totalTaskCount)}
                onClick={() => props.onFocusAreaChange(null)}
              >
                <LayoutGrid />
                <span>All work</span>
                <FocusAreaCountBadge count={props.totalTaskCount} />
              </SidebarMenuButton>
            </SidebarMenuItem>
            {props.focusAreas.map((area) => {
              const style = getFocusAreaStyle(area.color);
              const count = props.focusAreaCounts[area.id] ?? 0;
              const isActive = props.activeFocusAreaId === area.id;
              return (
                <SidebarMenuItem key={area.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={isActive}
                    tooltip={area.label}
                    aria-pressed={isActive}
                    aria-label={formatFocusAreaAriaLabel(area.label, count)}
                    onClick={() => props.onFocusAreaChange(area.id)}
                  >
                    <Circle style={{ color: style.accent, fill: style.background }} />
                    <span>{area.label}</span>
                    <FocusAreaCountBadge count={count} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ChatHistoryGroup(props: {
  loading: boolean;
  conversations: AssistantChatConversation[];
  activeConversationId: string | null;
  onConversationSelect: (conversationId: string) => void;
  onNewConversation: () => void;
}) {
  const [query, setQuery] = useState("");
  const showSearch = props.conversations.length >= 5;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleConversations = useMemo(() => {
    if (!showSearch || normalizedQuery.length === 0) {
      return props.conversations;
    }
    return props.conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, props.conversations, showSearch]);

  return (
    <SidebarGroup className="min-h-0 flex-1">
      <SidebarGroupLabel>Conversations</SidebarGroupLabel>
      <SidebarGroupAction
        type="button"
        aria-label="New chat"
        title="New chat"
        onClick={props.onNewConversation}
      >
        <Plus />
        <span className="sr-only">New chat</span>
      </SidebarGroupAction>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col gap-2">
        {showSearch && (
          <>
            <SidebarInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="group-data-[collapsible=icon]:hidden"
            />
            <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />
          </>
        )}
        <ScrollArea className="min-h-0 flex-1 pr-1 group-data-[collapsible=icon]:pr-0">
          <SidebarMenu>
            {props.loading ? (
              Array.from({ length: 4 }, (_, index) => (
                <SidebarMenuItem key={index}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))
            ) : props.conversations.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  disabled
                  className="h-auto items-start disabled:opacity-100"
                  tooltip="No conversations yet"
                >
                  <MessageSquareText />
                  <span className="grid gap-0.5">
                    <span>No conversations</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Start a new chat.
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : visibleConversations.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  disabled
                  className="h-auto items-start disabled:opacity-100"
                  tooltip="No matching conversations"
                >
                  <MessageSquareText />
                  <span className="grid gap-0.5">
                    <span>No matches</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Try another search.
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              visibleConversations.map((conversation) => {
                const isActive = conversation.id === props.activeConversationId;
                return (
                  <SidebarMenuItem key={conversation.id}>
                    <SidebarMenuButton
                      type="button"
                      isActive={isActive}
                      className={cn("h-auto min-h-11 items-start", isActive && "pr-14")}
                      tooltip={conversation.title}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => props.onConversationSelect(conversation.id)}
                    >
                      <MessageSquareText />
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate">{conversation.title}</span>
                        <span className="truncate text-xs font-normal text-muted-foreground">
                          {formatConversationTime(conversation.updatedAt)}
                        </span>
                      </span>
                    </SidebarMenuButton>
                    {isActive && <SidebarMenuBadge>Open</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })
            )}
          </SidebarMenu>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function FocusAreaCountBadge(props: { count: number }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "ml-auto group-data-[collapsible=icon]:hidden",
        props.count === 0 && "font-normal text-muted-foreground",
      )}
    >
      {props.count}
    </Badge>
  );
}

function formatFocusAreaAriaLabel(label: string, count: number): string {
  return `${label}, ${count} ${count === 1 ? "task" : "tasks"}`;
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved chat";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
