import {
  Circle,
  LayoutGrid,
  MessageSquareText,
  Monitor,
  Plus,
  Settings,
} from "lucide-react";
import type {
  AssistantChatConversation,
  FocusArea,
  TaskStatus,
} from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  const { isMobile, setOpenMobile } = useSidebar();

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
    props.workspaceMode === "chat" ? "chat" : props.activeView === "board" ? "board" : "";
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
          spacing={0}
          className="w-full group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:flex-col"
          aria-label="Task mode"
        >
          <ToggleGroupItem
            value="board"
            aria-label="Show board"
            className="flex-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-w-8 group-data-[collapsible=icon]:px-0"
          >
            <LayoutGrid data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">Board</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="chat"
            aria-label="Show chat"
            className="flex-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-w-8 group-data-[collapsible=icon]:px-0"
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
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={props.workspaceMode === "board" && props.activeView === "settings"}
              tooltip="Settings"
              onClick={() => selectView("settings")}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" disabled className="h-auto items-start disabled:opacity-100">
              <Monitor />
              <span className="grid gap-0.5">
                <span>This Mac</span>
                <span className="text-xs font-normal text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {readyNowCount} ready now · {attentionCount} need attention
                  </span>
                </span>
              </span>
            </SidebarMenuButton>
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
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Focus areas</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={props.activeFocusAreaId === null}
              tooltip="All work"
              onClick={() => props.onFocusAreaChange(null)}
            >
              <LayoutGrid />
              <span>All work</span>
              <Badge variant="secondary" className="ml-auto group-data-[collapsible=icon]:hidden">
                {props.totalTaskCount}
              </Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {props.focusAreas.map((area) => {
            const style = getFocusAreaStyle(area.color);
            return (
              <SidebarMenuItem key={area.id}>
                <SidebarMenuButton
                  type="button"
                  isActive={props.activeFocusAreaId === area.id}
                  tooltip={area.label}
                  onClick={() => props.onFocusAreaChange(area.id)}
                >
                  <Circle style={{ color: style.accent, fill: style.background }} />
                  <span>{area.label}</span>
                  <Badge variant="secondary" className="ml-auto group-data-[collapsible=icon]:hidden">
                    {props.focusAreaCounts[area.id] ?? 0}
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
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
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Conversations</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={props.onNewConversation}
              tooltip="New conversation"
            >
              <Plus />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
          ) : (
            props.conversations.map((conversation) => {
              return (
                <SidebarMenuItem key={conversation.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={conversation.id === props.activeConversationId}
                    className="h-auto min-h-11 items-start"
                    tooltip={conversation.title}
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
                </SidebarMenuItem>
              );
            })
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
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
