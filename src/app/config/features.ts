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

// Screens that are not finished and must not be reachable by customers.
// Empty right now: "mobile-create" (a static mockup showing another company's
// invented data) was deleted rather than left hidden.
const UNFINISHED_VIEWS: View[] = [];

// Pages switched off for the Kenyan market (Nov 2026 simplification). They are
// enterprise US-style workflows small and mid-size Kenyan contractors don't
// run, or jobs Buildsasa AI now does from chat. Their data and APIs are kept:
// delete a line here to bring a page back.
export const HIDDEN_VIEWS: View[] = [
  "dashboard",       // the AI home's "needs attention" brief does this job
  "coordination",    // BIM clash coordination
  "commitments",     // subcontract / PO ledgers
  "observations",    // folded into snags, inspections and safety
  "action-plans",    // enterprise QA corrective-action plans
  "correspondence",  // the AI writes letters
  "reports",         // the AI writes reports and client updates
  "announcements",   // teams talk on WhatsApp; the AI drafts messages
  "subcontractors",  // Contacts holds subcontractors and suppliers
  "crews",           // Team covers it
  "role-manager",    // roles are set when inviting, or by asking the AI
  "tasks",           // "Assignments" is already a tab inside Checklists
];

// Is a given view allowed to appear right now?
// Default: everything visible. Simple mode: only the core set.
export function isViewVisible(v: View): boolean {
  if (v === "login") return true;
  if (UNFINISHED_VIEWS.includes(v)) return false; // never ship an unfinished screen
  if (HIDDEN_VIEWS.includes(v)) return false;
  if (!simpleModeEnabled()) return true; // all features visible by default
  if (v === "project-detail") return CORE_VIEWS.includes("projects");
  return CORE_VIEWS.includes(v);
}

// Detail screens that aren't in the nav and aren't listed per-role: each one is
// reached by drilling into a record, so it inherits access from the list view
// that owns it. Without this, navigating to a detail screen bounced straight
// back because it appeared in no role's `views` array.
const IMPLIED_VIEWS: Partial<Record<View, View>> = {
  "project-detail": "projects",
};

// Intersect a role's permitted views with what's visible right now.
export function visibleViewsFor(roleViews: View[]): View[] {
  const implied = (Object.entries(IMPLIED_VIEWS) as [View, View][])
    .filter(([detail, parent]) => roleViews.includes(parent) && !roleViews.includes(detail))
    .map(([detail]) => detail);
  return [...roleViews, ...implied].filter(isViewVisible);
}
