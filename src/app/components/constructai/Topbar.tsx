import { useState, useRef, useEffect } from "react";
import { Search, Bell, Menu, ChevronsUpDown, Check, FolderKanban } from "lucide-react";
import { useProjects } from "./useProjects";
import { useTeam } from "./useTeam";
import api from "../../services/api";
import { projectTone, TONE_DOT } from "./wsStatus";

// Search results and notifications are built from the workspace's real projects,
// change orders and teammates. No invented records.
type SearchHit = { type: string; label: string; target: string; coId?: string; projectId?: string };

const relativeTime = (iso?: string) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const CO_DOT: Record<string, string> = {
  approved: "#1E6B3A", rejected: "#B42318", owner_approval: "#FF6B1A",
  pm_review: "#1E4E8C", drafted: "#8A867D", void: "#8A867D",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

export function Topbar({
  title,
  onMenu,
  onNavigate,
  onOpenChangeOrder,
  projectId,
  onOpenProject,
}: {
  title: string;
  onMenu: () => void;
  onNavigate: (v: any) => void;
  onOpenChangeOrder: (id: string) => void;
  /** Set on a project page: the breadcrumb ends in a project switcher. */
  projectId?: string | null;
  onOpenProject?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<null | "results" | "notifs" | "project">(null);
  const barRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Close any open menu on an outside click or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (open && barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobileSearchOpen(true);
        setOpen("results");
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === "Escape" && open) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // The sidebar's search and "new" icons drive these.
  useEffect(() => {
    const focus = () => { setMobileSearchOpen(true); setOpen("results"); requestAnimationFrame(() => searchInputRef.current?.focus()); };
    // "New" now starts a fresh chat with Buildsasa AI (handled in App).
    window.addEventListener("buildsasa:focus-search", focus);
    return () => window.removeEventListener("buildsasa:focus-search", focus);
  }, []);

  const { projects } = useProjects();
  const team = useTeam();
  const [changeOrders, setChangeOrders] = useState<any[]>([]);
  const [coLoaded, setCoLoaded] = useState(false);
  useEffect(() => {
    if (coLoaded || (open !== "results" && open !== "notifs")) return;
    setCoLoaded(true);
    api.listChangeOrders()
      .then((rows) => setChangeOrders(Array.isArray(rows) ? rows : []))
      .catch(() => setChangeOrders([]));
  }, [open, coLoaded]);

  const searchIndex: SearchHit[] = [
    ...projects.map((p) => ({ type: "Project", label: p.code ? `${p.code} · ${p.name}` : p.name, target: "projects", projectId: p.id })),
    ...changeOrders.map((c) => ({ type: "Variation", label: `${c.number ?? "Variation"} · ${c.title ?? "Untitled"}`, target: "change-orders", coId: c.id })),
    ...team.map((m) => ({ type: "People", label: `${m.name} · ${m.role}`, target: "team" })),
  ];
  const results = q
    ? searchIndex.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()) || r.type.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : searchIndex.slice(0, 5);

  // Recent activity from the most recently updated change orders. There is no
  // notifications table yet, so this shows real activity or says there is none.
  const notifications = [...changeOrders]
    .sort((a, b) => +new Date(b.updatedAt ?? b.createdAt ?? 0) - +new Date(a.updatedAt ?? a.createdAt ?? 0))
    .slice(0, 6)
    .map((c) => ({
      t: `${c.number ?? "CO"} · ${c.title ?? "Untitled"}`,
      s: `${String(c.status ?? "").replace(/_/g, " ") || "updated"} · ${relativeTime(c.updatedAt ?? c.createdAt)}`,
      c: CO_DOT[c.status] ?? "#8A867D",
      coId: c.id as string | undefined,
    }));

  const current = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const pick = (hit: SearchHit) => {
    if (hit.coId) onOpenChangeOrder(hit.coId);
    else if (hit.projectId && onOpenProject) onOpenProject(hit.projectId);
    else onNavigate(hit.target);
    setQ(""); setOpen(null); setMobileSearchOpen(false);
  };
  const toggle = (m: NonNullable<typeof open>) => setOpen((o) => (o === m ? null : m));

  return (
    <header ref={barRef} className="ws-topbar">
      <button type="button" onClick={onMenu} className="ws-icon-btn lg:hidden" aria-label="Open menu"><Menu /></button>

      {/* Breadcrumb. On a project page the last crumb switches project. */}
      <nav aria-label="Breadcrumb" className="ws-crumbs" style={{ flexShrink: 1 }}>
        {projectId ? (
          <>
            <button type="button" className="ws-crumb hidden sm:inline" onClick={() => onNavigate("projects")}>Projects</button>
            <span className="hidden sm:inline" aria-hidden>/</span>
            <div className="relative min-w-0">
              <button type="button" className="ws-project-switch" onClick={() => toggle("project")} aria-haspopup="listbox" aria-expanded={open === "project"} aria-label={`Switch project. Current: ${current?.name ?? "project"}`}>
                <span className="ws-dot" style={{ color: TONE_DOT[projectTone(current?.status)] }} aria-hidden />
                <span className="truncate">{current?.name ?? "Project"}</span>
                <ChevronsUpDown aria-hidden />
              </button>
              {open === "project" && (
                <div className="ws-menu" role="listbox" aria-label="Projects" style={{ top: 38, left: 0, width: 280, maxHeight: 360, overflowY: "auto" }}>
                  <div className="ws-menu-label">Switch project</div>
                  {projects.map((p) => (
                    <button key={p.id} role="option" aria-selected={p.id === projectId} className="ws-menu-item" onClick={() => { setOpen(null); if (p.id !== projectId) onOpenProject?.(p.id); }}>
                      <span className="ws-dot" style={{ color: TONE_DOT[projectTone(p.status)] }} aria-hidden />
                      <span className="truncate flex-1">{p.name}</span>
                      {p.id === projectId && <Check aria-hidden />}
                    </button>
                  ))}
                  <div className="ws-divider" style={{ margin: "4px 0" }} />
                  <button className="ws-menu-item" onClick={() => { setOpen(null); onNavigate("projects"); }}><FolderKanban /> All projects</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <span className="ws-crumb-current" aria-current="page">{title}</span>
        )}
      </nav>

      {/* Search */}
      <div className={`ws-search ${mobileSearchOpen ? "block absolute left-3 right-3 top-[10px] z-30 max-w-none md:static md:max-w-[420px]" : "hidden"} md:block`}>
        <Search aria-hidden />
        <label htmlFor="ws-search-input" className="sr-only">Search projects, change orders and people</label>
        <input
          id="ws-search-input"
          ref={searchInputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen("results"); }}
          onFocus={() => setOpen("results")}
          onBlur={() => { if (!q) setMobileSearchOpen(false); }}
          placeholder="Search projects, orders, people…"
          autoComplete="off"
        />
        <span className="ws-kbd hidden xl:inline" aria-hidden>{isMac ? "⌘K" : "Ctrl K"}</span>
        {open === "results" && (
          <div className="ws-menu" style={{ top: 42, left: 0, right: 0 }}>
            <div className="ws-menu-label">{results.length} result{results.length === 1 ? "" : "s"}</div>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {results.map((r, ri) => (
                <button key={`${r.type}-${r.coId ?? r.label}-${ri}`} className="ws-menu-item" onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
                  <span className="ws-pill" style={{ height: 20, fontSize: 11 }}>{r.type}</span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
              {results.length === 0 && <div className="ws-sub" style={{ padding: "16px 9px", textAlign: "center" }}>{searchIndex.length === 0 ? "Nothing to search yet. Create a project first." : "No matches"}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button type="button" onClick={() => { setMobileSearchOpen(true); setOpen("results"); requestAnimationFrame(() => searchInputRef.current?.focus()); }} className="ws-icon-btn md:hidden" aria-label="Search"><Search /></button>

        {/* Notifications */}
        <div className="relative">
          <button type="button" className="ws-icon-btn relative" onClick={() => toggle("notifs")} aria-label={notifications.length ? `Notifications, ${notifications.length} recent` : "Notifications"} aria-expanded={open === "notifs"}>
            <Bell />
            {notifications.length > 0 && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full" style={{ background: "var(--ws-primary)" }} />}
          </button>
          {open === "notifs" && (
            <div className="ws-menu" style={{ right: 0, top: 42, width: 300 }}>
              <div className="ws-menu-label">Recent activity</div>
              {notifications.length === 0 && <div className="ws-sub" style={{ padding: "16px 9px", textAlign: "center" }}>Nothing recent yet</div>}
              {notifications.map((n, i) => (
                <button key={i} className="ws-menu-item" style={{ height: "auto", padding: "8px 9px", alignItems: "flex-start" }} onClick={() => { setOpen(null); if (n.coId) onOpenChangeOrder(n.coId); else onNavigate("change-orders"); }}>
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: n.c }} />
                  <span className="min-w-0">
                    <span className="block truncate">{n.t}</span>
                    <span className="block" style={{ fontSize: 12, color: "var(--ws-muted)" }}>{n.s}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
