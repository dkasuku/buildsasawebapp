import { useState, useEffect, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { Toaster, toast } from "sonner";
import { Sidebar, type View } from "./components/constructai/Sidebar";
import { Topbar } from "./components/constructai/Topbar";
import { Login } from "./components/constructai/Login";
import { ResetPassword } from "./components/constructai/ResetPassword";
import { PublicFormFill } from "./components/constructai/PublicFormFill";
import { ErrorBoundary } from "./components/constructai/ErrorBoundary";
import { Dashboard } from "./components/constructai/Dashboard";
import { Projects } from "./components/constructai/Projects";
import { ChangeOrderDetail } from "./components/constructai/ChangeOrderDetail";
import { MobileCreate } from "./components/constructai/MobileCreate";
import { FieldView } from "./components/constructai/FieldView";
import { Reports } from "./components/constructai/Reports";
import { Team } from "./components/constructai/Team.tsx";
import { Plans } from "./components/constructai/Plans";
import { Tasks } from "./components/constructai/Tasks";
import { Schedule } from "./components/constructai/Schedule";
import Financials from "./components/constructai/Financials";
import { Documents } from "./components/constructai/Documents";
import { DailyLog } from "./components/constructai/DailyLog";
import { PunchList } from "./components/constructai/PunchList";
import PunchListPro from "./components/constructai/PunchListPro";
import ChangeOrders from "./components/constructai/ChangeOrders";
import Billing from "./components/constructai/Billing";
import TeamMembers from "./components/constructai/TeamMembers";
import api from "./services/api";
import { Commitments } from "./components/constructai/Commitments";
import { Inbox } from "./components/constructai/Inbox";
import { Announcements } from "./components/constructai/Announcements";
import { RoleManager } from "./components/constructai/RoleManager";
import Bidding from "./components/constructai/Bidding";
import Invoicing from "./components/constructai/Invoicing";
import Inspections from "./components/constructai/Inspections";
import SafetyIncidents from "./components/constructai/SafetyIncidents";
import Equipment from "./components/constructai/Equipment";
import Attendance from "./components/constructai/Attendance";
import BuildflexAI from "./components/constructai/BuildflexAI";
import Checklists from "./components/constructai/Checklists";
import { DigitizedForms } from "./components/constructai/DigitizedForms";
import Observations from "./components/constructai/Observations";
import ActionPlans from "./components/constructai/ActionPlans";
import Coordination from "./components/constructai/Coordination";
import CorrespondenceModule from "./components/constructai/Correspondence";
import Crews from "./components/constructai/Crews";
import Directory from "./components/constructai/Directory";
import CompanyDocs from "./components/constructai/CompanyDocs";
import type { Role } from "./components/constructai/roles";
import { ROLES } from "./components/constructai/roles";
import { CurrencyProvider } from "./components/constructai/CurrencyContext";
import { visibleViewsFor } from "./config/features";
import { Onboarding } from "./components/constructai/Onboarding";
import { FeatureTour } from "./components/constructai/FeatureTour";
import { ProfileSettings } from "./components/constructai/ProfileSettings";
import { CreditCard } from "lucide-react";
import { AiAssistantPanel, AI_GREETING, type Msg as AiMsg, type AiFormDraft } from "./components/constructai/AiAssistantPanel";

const TITLES: Record<Exclude<View, "login">, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Executive overview" },
  projects: { title: "Projects", subtitle: "Portfolio · 12 active sites" },
  "change-order": { title: "Change Order", subtitle: "Detailed review & approvals" },
  "change-orders": { title: "Change Orders", subtitle: "Cost & schedule impact · approvals" },
  billing: { title: "Billing & Plan", subtitle: "Subscription & payments" },
  plans: { title: "Plans & Drawings", subtitle: "Architectural sheets & sharing" },
  tasks: { title: "Tasks & Trades", subtitle: "Assign forms & checklists to trades and track their progress" },
  schedule: { title: "Schedule", subtitle: "Project timeline — Gantt, dates & milestones" },
  documents: { title: "Project Documents", subtitle: "Per-project docs and shared files" },
  "daily-log": { title: "Daily Log", subtitle: "Crew headcount, locations, notes" },
  "punch-list": { title: "Punch List", subtitle: "Deficiencies and closeouts" },
  commitments: { title: "Commitments", subtitle: "Subcontracts, POs, obligations" },
  reports: { title: "Reports", subtitle: "Financial & operational analytics" },
  financials: { title: "Financials", subtitle: "Cash flow, budgets, and exports" },
  team: { title: "Team", subtitle: "Members, roles & workflows" },
  "mobile-create": { title: "AI Creation Flow", subtitle: "Mobile — field capture" },
  "field-view": { title: "Field Supervisor", subtitle: "Mobile — jobsite operations" },
  inbox: { title: "Inbox", subtitle: "Internal messages & project conversations" },
  announcements: { title: "Announcements", subtitle: "Company-wide broadcasts & notices" },
  observations: { title: "Observations", subtitle: "Quality & safety site observations" },
  "action-plans": { title: "Action Plans", subtitle: "Corrective actions & follow-ups" },
  coordination: { title: "Coordination Issues", subtitle: "RFIs, clashes, design questions" },
  correspondence: { title: "Correspondence", subtitle: "Letters, submittals & transmittals" },
  crews: { title: "Crews", subtitle: "Crew rosters & schedules" },
  directory: { title: "Directory", subtitle: "Global contacts & companies" },
  "company-docs": { title: "Company Documents", subtitle: "Organization-wide vault" },
  "role-manager": { title: "Role Manager", subtitle: "Configure team roles and permissions" },
  bidding: { title: "Bidding", subtitle: "Subcontractor bids and tendering" },
  invoicing: { title: "Invoicing", subtitle: "Accounts receivable and invoice management" },
  inspections: { title: "Inspections", subtitle: "Quality, safety, and compliance inspections" },
  checklists: { title: "Checklists", subtitle: "Templates, assignments, and digital submissions" },
  "safety-incidents": { title: "Safety Incidents", subtitle: "OSHA-style incident reporting and tracking" },
  equipment: { title: "Equipment Inventory", subtitle: "Machinery, tools, and maintenance schedules" },
  attendance: { title: "Attendance", subtitle: "Check in/out, breaks, leaves & time tracking" },
  "buildflex-ai": { title: "Buildflex AI", subtitle: "AI assistant for reports & building expertise" },
  forms: { title: "Digitized Forms", subtitle: "Uploaded forms, daily reports, timesheets, and RFIs" },
};

export default function App() {
  const [view, setView] = useState<View>(() => {
    try {
      // Google OAuth redirect: /?token=…&user=… — persist the session, clean the
      // URL, and land on the dashboard (role is read from the stored user below).
      const params = new URLSearchParams(window.location.search);
      const gToken = params.get("token");
      if (gToken) {
        localStorage.setItem("constructai-token", gToken);
        const gUser = params.get("user");
        if (gUser) localStorage.setItem("constructai-user", gUser);
        window.history.replaceState({}, "", window.location.pathname);
        return "dashboard";
      }
      // Login is required: start on the login screen unless a session token exists.
      return localStorage.getItem("constructai-token") ? "dashboard" : "login";
    } catch { return "login"; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [role, setRole] = useState<Role>(() => {
    // Role is determined by the logged-in account (persisted at login/signup).
    try {
      const u = JSON.parse(localStorage.getItem("constructai-user") || "null");
      if (u && u.role && ROLES[u.role as Role]) return u.role as Role;
    } catch { /* noop */ }
    return "Contractor";
  });
  const [theme, setThemeState] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("constructai-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* noop */ }
    return "dark";
  });
  // First-run guided setup — shown once to workspace owners / managers.
  const [onboarded, setOnboarded] = useState<boolean>(() => {
    try { return localStorage.getItem("constructai-onboarded") === "1"; } catch { return true; }
  });
  const dismissOnboarding = () => {
    try { localStorage.setItem("constructai-onboarded", "1"); } catch { /* noop */ }
    setOnboarded(true);
  };
  // Global Buildflex AI side panel (opened from the top-bar icon).
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  // Chat session lifted here so it persists across panel open/close and module
  // navigation; only "New chat" or a page reload (which remounts App) resets it.
  const [aiMessages, setAiMessages] = useState<AiMsg[]>([AI_GREETING]);
  // A checklist the AI drafted in chat, queued to open in the Form Builder
  // (inside the Checklists view) as a new, unsaved form.
  const [aiFormDraft, setAiFormDraft] = useState<any | null>(null);
  const openAiForm = (form: AiFormDraft) => {
    setAiFormDraft({ title: form.title, trade: form.trade, category: form.category, items: JSON.stringify(form.items || []), status: "draft" });
    setAiPanelOpen(false);
    setView("checklists");
  };
  // Feature tour — shown once after first-run setup; re-launchable from the sidebar.
  const [tourOpen, setTourOpen] = useState(false);
  const closeTour = () => {
    try { localStorage.setItem("constructai-tour-done", "1"); } catch { /* noop */ }
    setTourOpen(false);
  };
  useEffect(() => {
    const start = () => setTourOpen(true);
    window.addEventListener("buildflex:start-tour", start);
    return () => window.removeEventListener("buildflex:start-tour", start);
  }, []);
  // Profile settings modal (opened from the sidebar profile menu).
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("buildflex:open-settings", open);
    return () => window.removeEventListener("buildflex:open-settings", open);
  }, []);
  useEffect(() => {
    // The tour only auto-launches when it was just queued by a signup/sign-in
    // (see Login). Plain reloads or returning sessions never trigger it.
    let queued = false;
    try { queued = localStorage.getItem("constructai-show-tour") === "1"; } catch { /* noop */ }
    if (!queued) return;
    // Owners/managers see the setup wizard first; defer until it's done (this
    // effect re-runs when `onboarded` flips, then the tour opens).
    const setupWizardUp = !onboarded && (ROLES[role].isWorkspaceOwner || ROLES[role].manageTeam);
    if (setupWizardUp) return;
    try { localStorage.removeItem("constructai-show-tour"); } catch { /* noop */ }
    setTourOpen(true);
  }, [onboarded, role]);
  const [activeChangeOrderId, setActiveChangeOrderId] = useState("CO-1258");
  const [activeChangeOrderStatus, setActiveChangeOrderStatus] = useState<string | null>(null);
  const [returnView, setReturnView] = useState<View>("dashboard");

  // Theme switch. Uses the View Transitions API to crossfade the whole page as a
  // single composited snapshot (smooth, no per-element repaint flicker). Falls
  // back to an instant switch where the API isn't available.
  const setTheme = (t: "dark" | "light") => {
    const apply = () => {
      flushSync(() => {
        setThemeState(t);
        try { localStorage.setItem("constructai-theme", t); } catch { /* noop */ }
      });
      // Keep <html> in sync within the same synchronous step so the snapshot is correct.
      document.documentElement.classList.toggle("theme-light", t === "light");
    };
    const doc = document as any;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof doc.startViewTransition === "function" && !reduce) {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  };

  // Sync <html> class in the SAME paint frame as the React re-render.
  // Doing this in useLayoutEffect (before paint) eliminates the one-frame
  // mismatch that caused a white/dark flicker when toggling themes.
  useLayoutEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  }, [theme]);

  // Reset to first allowed+visible view when role changes
  useEffect(() => {
    const allowed = visibleViewsFor(ROLES[role].views);
    if (!allowed.includes(view)) {
      setView((allowed[0] ?? "dashboard") as View);
    }
  }, [role]);

  // Subscription gate — stays dormant until Paystack is configured, so local
  // testing is never blocked. Once a key is set, non-subscribers see a paywall.
  const [gate, setGate] = useState<{ configured: boolean; active: boolean; overdue: boolean; unpaidDue: string | null }>({ configured: false, active: true, overdue: false, unpaidDue: null });
  useEffect(() => {
    if (view === "login") return;
    let alive = true;
    (async () => {
      try {
        const [plans, sub, invoices] = await Promise.all([
          api.getBillingPlans(),
          api.getSubscription().catch(() => ({ status: "inactive" })),
          api.getBillingInvoices().catch(() => []),
        ]);
        const open = (Array.isArray(invoices) ? invoices : []).filter((i: any) => i.status !== "paid" && i.status !== "void");
        const now = Date.now();
        const overdue = open.some((i: any) => new Date(i.dueDate).getTime() < now);
        const soonest = open.map((i: any) => i.dueDate).sort()[0] || null;
        if (alive) setGate({ configured: !!(plans as any).configured, active: (sub as any)?.status === "active", overdue, unpaidDue: soonest });
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [view]);

  const openChangeOrder = (id: string, status?: string) => {
    setActiveChangeOrderId(id);
    setActiveChangeOrderStatus(status ?? null);
    setReturnView((prev) => (view === "change-order" ? prev : view));
    setView("change-order");
    setDrawerOpen(false);
    toast.success(`Opening ${id}`);
  };

  // Password-reset deep link: /?reset=TOKEN (works whether or not signed in)
  const resetToken = (() => { try { return new URLSearchParams(window.location.search).get("reset"); } catch { return null; } })();
  if (resetToken) {
    return (
      <div className={`h-screen w-full ${theme === "light" ? "theme-light" : ""}`}>
        <ResetPassword token={resetToken} theme={theme} setTheme={setTheme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Public shared form deep link: /?form=TOKEN (no auth required)
  const formToken = (() => { try { return new URLSearchParams(window.location.search).get("form"); } catch { return null; } })();
  if (formToken) {
    return (
      <div className={theme === "light" ? "theme-light" : ""}>
        <PublicFormFill token={formToken} theme={theme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  if (view === "login") {
    return (
      <div className={`h-screen w-full ${theme === "light" ? "theme-light" : ""}`}>
        <Login onContinue={(user) => { if (user && user.role && ROLES[user.role as Role]) setRole(user.role as Role); setView("dashboard"); }} theme={theme} setTheme={setTheme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // If current view isn't allowed for the role / hidden in this build, bounce
  // to the first allowed + visible view.
  const allowed = visibleViewsFor(ROLES[role].views);
  const effectiveView: View = allowed.includes(view) ? view : ((allowed[0] ?? "dashboard") as View);
  const meta = TITLES[effectiveView as Exclude<View, "login">];
  const backTarget: View = returnView === "change-order" ? "dashboard" : returnView;
  const backMeta = TITLES[backTarget as Exclude<View, "login">];
  // Block (after due date) on an overdue invoice, or when a configured workspace
  // has no active plan. Stays dormant until Paystack is configured so local
  // testing is never blocked. A not-yet-due unpaid invoice shows a soft banner.
  const paywalled = gate.configured && (gate.overdue || !gate.active);
  const invoiceBanner = gate.configured && !paywalled && !!gate.unpaidDue;
  // The first-run setup wizard only applies to workspace owners/managers.
  const onboardingShowing = !onboarded && (ROLES[role].isWorkspaceOwner || ROLES[role].manageTeam);

  return (
    <CurrencyProvider>
      <div
        className={`size-full min-h-screen flex text-[#E6EAF0] ${theme === "light" ? "theme-light bg-[#F4F6FA]" : "bg-[#0A0E14]"}`}
        style={theme === "light" ? { backgroundColor: "#F4F6FA" } : undefined}
      >
        <Sidebar
          view={effectiveView}
          setView={setView}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          role={role}
        />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <Topbar
            title={meta.title}
            subtitle={meta.subtitle}
            onMenu={() => setDrawerOpen(true)}
            onNewOrder={() => setView("change-orders")}
            role={role}
            setRole={setRole}
            onNavigate={(v: View) => setView(v)}
            onOpenChangeOrder={openChangeOrder}
            onOpenAi={() => setAiPanelOpen(true)}
            theme={theme}
            setTheme={setTheme}
          />
          {role !== "Contractor" && (
            <div className="shrink-0 bg-[#11161D] border-b border-[#222A35] px-4 sm:px-7 py-2 text-[11px] text-[#8A95A5] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B1A]" />
              Viewing as <span className="text-white">{role}</span> — some panels & actions are hidden per permissions.
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
            {paywalled && effectiveView !== "billing" && (
              <div className="absolute inset-0 z-50 bg-[#0A0E14]/96 flex items-center justify-center p-6 text-center">
                <div className="max-w-sm">
                  <div className="text-[18px] text-white font-display">{gate.overdue ? "Payment required" : "Subscription required"}</div>
                  <p className="text-[12px] text-[#8A95A5] mt-2">{gate.overdue ? "You have an overdue invoice. Pay it to continue using your workspace." : "Your workspace needs an active plan to continue. Choose a plan to unlock everything."}</p>
                  <div className="flex gap-2 justify-center mt-4">
                    <button onClick={() => setView("billing")} className="h-10 px-5 rounded-md bg-[#FF6B1A] text-white text-[12px]">{gate.overdue ? "Pay invoice" : "View plans"}</button>
                    <button onClick={() => { try { localStorage.removeItem("constructai-token"); localStorage.removeItem("constructai-user"); } catch { /* noop */ } setView("login"); }} className="h-10 px-4 rounded-md border border-[#222A35] text-[#8A95A5] text-[12px]">Sign out</button>
                  </div>
                </div>
              </div>
            )}
            {invoiceBanner && effectiveView !== "billing" && (
              <div className="flex items-center gap-3 px-4 sm:px-7 py-2.5 bg-[#F59E0B]/10 border-b border-[#F59E0B]/30">
                <CreditCard className="w-4 h-4 text-[#F59E0B] shrink-0" />
                <div className="text-[12px] text-[#E6EAF0] flex-1">You have an invoice due {gate.unpaidDue ? new Date(gate.unpaidDue).toLocaleDateString() : "soon"}. Pay it to avoid any interruption to your services.</div>
                <button onClick={() => setView("billing")} className="h-8 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[11.5px] shrink-0">Pay invoice</button>
              </div>
            )}
            <ErrorBoundary resetKey={effectiveView} onReset={() => setView("dashboard")}>
            {effectiveView === "dashboard" && (
              <Dashboard
                role={role}
                onOpenChangeOrder={openChangeOrder}
                onNavigate={setView}
              />
            )}
            {effectiveView === "projects" && <Projects setView={setView} role={role} />}
            {effectiveView === "change-order" && (
              <ChangeOrderDetail
                key={activeChangeOrderId}
                setView={setView}
                role={role}
                changeOrderId={activeChangeOrderId}
                statusOverride={activeChangeOrderStatus ?? undefined}
                onBack={() => setView(backTarget)}
                backLabel={backMeta?.title ?? "Dashboard"}
              />
            )}
            {effectiveView === "change-orders" && <ChangeOrders role={role} />}
            {effectiveView === "billing" && <Billing role={role} />}
            {effectiveView === "plans" && <Plans role={role} />}
            {effectiveView === "tasks" && <Tasks role={role} />}
            {effectiveView === "schedule" && <Schedule role={role} />}
            {effectiveView === "documents" && <Documents />}
            {effectiveView === "daily-log" && <DailyLog />}
            {effectiveView === "punch-list" && <PunchListPro role={role} />}
            {effectiveView === "commitments" && <Commitments />}
            {effectiveView === "mobile-create" && <MobileCreate />}
            {effectiveView === "field-view" && <FieldView role={role} />}
            {effectiveView === "reports" && <Reports />}
            {effectiveView === "financials" && <Financials role={role} />}
            {effectiveView === "team" && <TeamMembers role={role} />}
            {effectiveView === "inbox" && <Inbox role={role} />}
            {effectiveView === "announcements" && <Announcements />}
            {effectiveView === "observations" && <Observations role={role} />}
            {effectiveView === "action-plans" && <ActionPlans role={role} />}
            {effectiveView === "coordination" && <Coordination role={role} />}
            {effectiveView === "correspondence" && <CorrespondenceModule role={role} />}
            {effectiveView === "crews" && <Crews role={role} />}
            {effectiveView === "directory" && <Directory role={role} />}
            {effectiveView === "company-docs" && <CompanyDocs role={role} />}
            {effectiveView === "role-manager" && <RoleManager role={role} />}
            {effectiveView === "bidding" && <Bidding role={role} />}
            {effectiveView === "invoicing" && <Invoicing role={role} />}
            {effectiveView === "inspections" && <Inspections role={role} />}
            {effectiveView === "checklists" && <Checklists role={role} aiDraft={aiFormDraft} onConsumeAiDraft={() => setAiFormDraft(null)} />}
            {effectiveView === "safety-incidents" && <SafetyIncidents role={role} />}
            {effectiveView === "equipment" && <Equipment role={role} />}
            {effectiveView === "attendance" && <Attendance role={role} />}
            {effectiveView === "buildflex-ai" && <BuildflexAI role={role} messages={aiMessages} setMessages={setAiMessages} onOpenForm={openAiForm} />}
            {effectiveView === "forms" && <DigitizedForms role={role} />}
            </ErrorBoundary>
          </div>
        </div>
        <Toaster theme={theme} position="top-right" />
        {onboardingShowing && !paywalled && (
          <Onboarding
            role={role}
            onNavigate={(v: View) => setView(v)}
            onClose={dismissOnboarding}
          />
        )}
        {tourOpen && !paywalled && !onboardingShowing && (
          <FeatureTour onClose={closeTour} onNavigate={(v: View) => setView(v)} role={role} />
        )}
        {settingsOpen && <ProfileSettings onClose={() => setSettingsOpen(false)} />}
        <AiAssistantPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} onExpand={() => { setAiPanelOpen(false); setView("buildflex-ai"); }} messages={aiMessages} setMessages={setAiMessages} onOpenForm={openAiForm} />
      </div>
    </CurrencyProvider>
  );
}
