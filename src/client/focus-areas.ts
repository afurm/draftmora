import { FOCUS_AREA_COLORS, type FocusArea, type FocusAreaColor } from "../shared/types";

export const FOCUS_AREA_COLOR_OPTIONS: Array<{
  value: FocusAreaColor;
  label: string;
  accent: string;
  background: string;
  border: string;
  foreground: string;
}> = [
  {
    value: "blue",
    label: "Blue",
    accent: "#2563eb",
    background: "#eff6ff",
    border: "#bfdbfe",
    foreground: "#1d4ed8",
  },
  {
    value: "emerald",
    label: "Emerald",
    accent: "#059669",
    background: "#ecfdf5",
    border: "#a7f3d0",
    foreground: "#047857",
  },
  {
    value: "amber",
    label: "Amber",
    accent: "#d97706",
    background: "#fffbeb",
    border: "#fde68a",
    foreground: "#b45309",
  },
  {
    value: "rose",
    label: "Rose",
    accent: "#e11d48",
    background: "#fff1f2",
    border: "#fecdd3",
    foreground: "#be123c",
  },
  {
    value: "violet",
    label: "Violet",
    accent: "#7c3aed",
    background: "#f5f3ff",
    border: "#ddd6fe",
    foreground: "#6d28d9",
  },
  {
    value: "cyan",
    label: "Cyan",
    accent: "#0891b2",
    background: "#ecfeff",
    border: "#a5f3fc",
    foreground: "#0e7490",
  },
  {
    value: "lime",
    label: "Lime",
    accent: "#65a30d",
    background: "#f7fee7",
    border: "#d9f99d",
    foreground: "#4d7c0f",
  },
  {
    value: "orange",
    label: "Orange",
    accent: "#ea580c",
    background: "#fff7ed",
    border: "#fed7aa",
    foreground: "#c2410c",
  },
  {
    value: "slate",
    label: "Slate",
    accent: "#475569",
    background: "#f8fafc",
    border: "#cbd5e1",
    foreground: "#334155",
  },
];

const COLOR_STYLE_BY_VALUE = new Map(
  FOCUS_AREA_COLOR_OPTIONS.map((option) => [option.value, option]),
);

export function getFocusAreaStyle(color: FocusAreaColor | undefined) {
  return COLOR_STYLE_BY_VALUE.get(color ?? "blue") ?? FOCUS_AREA_COLOR_OPTIONS[0];
}

export function getFocusAreaLabel(color: FocusAreaColor): string {
  return getFocusAreaStyle(color).label;
}

export function createFocusArea(label = "New area", existing: FocusArea[] = []): FocusArea {
  const color = FOCUS_AREA_COLORS[existing.length % FOCUS_AREA_COLORS.length];
  return {
    id: createFocusAreaId(label, existing),
    label,
    color,
  };
}

export function createFocusAreaId(label: string, existing: FocusArea[]): string {
  const base = slugifyFocusAreaId(label) || "area";
  const used = new Set(existing.map((area) => area.id));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyFocusAreaId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
