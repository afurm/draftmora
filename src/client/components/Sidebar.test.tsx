/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AssistantChatConversation, FocusArea, TaskStatus } from "../../shared/types";
import { Sidebar } from "./Sidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Sidebar", () => {
  it("keeps the sidebar mode switch without a duplicate workspace board link", async () => {
    const onViewChange = vi.fn();
    const onWorkspaceModeChange = vi.fn();
    const onChatConversationSelect = vi.fn();

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SidebarProvider>
            <Sidebar
              activeView="board"
              workspaceMode="chat"
              counts={counts()}
              focusAreas={focusAreas()}
              chatConversations={chatConversations()}
              activeConversationId="conversation-1"
              chatHistoryLoading={false}
              onViewChange={onViewChange}
              onWorkspaceModeChange={onWorkspaceModeChange}
              onChatConversationSelect={onChatConversationSelect}
              onNewChatConversation={vi.fn()}
            />
          </SidebarProvider>
        </TooltipProvider>,
      );
    });

    expect(container.querySelector('button[aria-label="Show board"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Show chat"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Task mode"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Drafts");
    expect(container.textContent?.toLowerCase()).not.toContain("workspace");
    expect(container.textContent).toContain("Conversations");
    expect(container.textContent).toContain("New chat");
    expect(container.textContent).toContain("Plan my day");
    expect(container.textContent).toContain("Launch note");
    expect(container.textContent).toContain("This Mac");
    expect(container.textContent).not.toContain("Focus areas");
    expect(container.textContent).not.toContain("Client Ops");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-sidebar="menu-button"]'))
        .some((button) => button.textContent?.trim() === "Board"),
    ).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Show board"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onWorkspaceModeChange).toHaveBeenCalledWith("board");
    expect(onViewChange).toHaveBeenCalledWith("board");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-sidebar="menu-button"]'))
        .find((button) => button.textContent?.includes("Launch note"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChatConversationSelect).toHaveBeenCalledWith("conversation-2");
  });

  it("lets the Board toggle leave settings instead of staying selected there", async () => {
    const onViewChange = vi.fn();
    const onWorkspaceModeChange = vi.fn();

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SidebarProvider>
            <Sidebar
              activeView="settings"
              workspaceMode="board"
              counts={counts()}
              focusAreas={focusAreas()}
              chatConversations={chatConversations()}
              activeConversationId="conversation-1"
              chatHistoryLoading={false}
              onViewChange={onViewChange}
              onWorkspaceModeChange={onWorkspaceModeChange}
              onChatConversationSelect={vi.fn()}
              onNewChatConversation={vi.fn()}
            />
          </SidebarProvider>
        </TooltipProvider>,
      );
    });

    const boardToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show board"]',
    );

    expect(boardToggle?.getAttribute("data-state")).toBe("off");

    await act(async () => {
      boardToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onWorkspaceModeChange).toHaveBeenCalledWith("board");
    expect(onViewChange).toHaveBeenCalledWith("board");
  });
});

function counts(): Record<TaskStatus, number> {
  return {
    draft: 1,
    ready: 2,
    in_progress: 1,
    needs_attention: 0,
    done: 3,
  };
}

function focusAreas(): FocusArea[] {
  return [{ id: "client-ops", label: "Client Ops", color: "emerald" }];
}

function chatConversations(): AssistantChatConversation[] {
  return [
    {
      id: "conversation-1",
      title: "Plan my day",
      createdAt: "2026-05-03T09:00:00.000Z",
      updatedAt: "2026-05-03T09:01:00.000Z",
    },
    {
      id: "conversation-2",
      title: "Launch note",
      createdAt: "2026-05-03T09:02:00.000Z",
      updatedAt: "2026-05-03T09:03:00.000Z",
    },
  ];
}
