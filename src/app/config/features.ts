// ============================================================================
// Feature visibility / Simple mode
// ----------------------------------------------------------------------------
// ALL modules ship and are visible by default — nothing is hidden in
// production. On top of that, every role already sees only the views relevant
// to it (see ROLES[role].views), so a field supervisor naturally sees far
// fewer items than the workspace owner.
//
// "Simple mode" is an OPTIONAL extra: when a user turns it on, the sidebar
// collapses to a focused core set (Dashboard, Projects, Checklists/Forms,
// BuildflexAI, Team, Billing). It is OFF by default and never removes any
// feature — flip it off and everything returns.
//
// Enable Simple mode via:
//   localStorage.setItem("constructai-simple-mode", "1")   (then reload)
// or the toggle in the sidebar footer, or VITE_SIMPLE_MODE=1 at build time.
// ============================================================================

import type { View } from "../components/constructai/Sidebar";

// The focused set shown when Simple mode is ON.
export const CORE_VIEWS: View[] = [
  "dashboard",
  "projects",
  "checklists",
  "forms",
  "buildflex-ai",
  "team",
  "billing",
];

// Simple mode has been retired: all modules are always visible (each role still
// only sees its own relevant views). Kept as a no-op so existing imports/refs
// keep working, and we clear any stale stored flag so no one is stranded.
export function simpleModeEnabled(): boolean {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem("constructai-simple-mode"); } catch { /* noop */ }
  return false;
}

export function setSimpleMode(on: boolean): void {
  try {
    if (on) localStorage.setItem("constructai-simple-mode", "1");
    else localStorage.removeItem("constructai-simple-mode");
  } catch {
    /* noop */
  }
}

// Is a given view allowed to appear right now?
// Default: everything visible. Simple mode: only the core set.
export function isViewVisible(v: View): boolean {
  if (v === "login") return true;
  if (!simpleModeEnabled()) return true; // all features visible by default
  if (v === "change-order") return CORE_VIEWS.includes("change-orders");
  return CORE_VIEWS.includes(v);
}

// Intersect a role's permitted views with what's visible right now.
export function visibleViewsFor(roleViews: View[]): View[] {
  return roleViews.filter(isViewVisible);
}
