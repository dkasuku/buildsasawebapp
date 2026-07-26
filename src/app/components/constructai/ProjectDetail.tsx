// ============================================================================
// ProjectDetail — the per-project dashboard.
//
// Everything about one project in one place: photo gallery, progress tracking
// (reported vs. schedule-derived), financial position, and every related record
// with a link straight into the module that owns it. Data comes from a single
// /api/projects/:id/overview call so the page is one round trip, and every
// number is computed from real rows rather than being guessed in the UI.
// ============================================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle, AlertTriangle, ArrowLeft, Boxes, Calendar, CalendarDays, CheckCircle2,
  ClipboardCheck, ClipboardList, Clock, FileStack, FileText, HardHat,
  Image as ImageIcon, MapPin, Pencil, Receipt, RefreshCw, ShieldAlert, TrendingUp,
  UserCircle, Users, Wrench,
} from "lucide-react";
import api, { absoluteFileUrl, type ProjectOverviewDto } from "../../services/api";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { ImageLightbox } from "./ImageLightbox";
import { EmptyState } from "./EmptyState";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency } from "./currency";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";

const $toKES = (usd: number) => Math.round((Number(usd) || 0) * 130);

const statusColor = (s: string) =>
  s === "On Track" ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30"
  : s === "At Risk" ? "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30"
  : s === "Planning" ? "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30"
  : s === "Archived" ? "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]"
  : "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30";

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export function ProjectDetail({
  projectId,
  role = "Contractor",
  onBack,
  setView,
  onEdit,
}: {
  projectId: string;
  role?: Role;
  onBack: () => void;
  setView: (v: View) => void;
  onEdit?: () => void;
}) {
  const { currency } = useCurrency();
  const showFin = ROLES[role].financials;
  const [data, setData] = useState<ProjectOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [tab, setTab] = useState<"overview" | "progress" | "records" | "financials">("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getProjectOverview(projectId));
    } catch (e: any) {
      // Show the real reason. A silent failure here would leave an empty page
      // that reads as "this project has nothing in it".
      setError(e?.message || "Could not load this project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="px-4 sm:px-7 py-6 space-y-4">
        <div className="h-8 w-40 rounded bg-[#11161D] animate-pulse" />
        <div className="h-48 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <button onClick={onBack} className="mb-4 h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to projects
        </button>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={AlertCircle}
            title="This project could not be loaded"
            description={error ?? undefined}
            actionLabel="Try again"
            onAction={load}
            secondaryLabel="Back to projects"
            onSecondary={onBack}
          />
        </div>
      </div>
    );
  }

  const { project, progress, counts, financials, schedule, recent, team } = data;
  const images = (project.images ?? []).map((u) => absoluteFileUrl(u)).filter(Boolean);
  const cover = images[0];
  // Prefer the schedule-derived figure when a schedule exists — it is computed
  // from actual task completion rather than typed in by hand.
  const effectiveProgress = progress.schedule ?? progress.reported;
  const budgetKES = $toKES(financials.budget);
  const actualKES = $toKES(financials.actual);
  const budgetUsedPct = budgetKES > 0 ? Math.round((actualKES / budgetKES) * 100) : null;

  const goto = (v: View, label: string) => { setView(v); toast(`Opening ${label}`); };

  const TABS = [
    { key: "overview" as const, label: "Overview" },
    { key: "progress" as const, label: "Progress" },
    { key: "records" as const, label: "Related records" },
    ...(showFin ? [{ key: "financials" as const, label: "Financials" }] : []),
  ];

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button onClick={onBack} title="Back to projects" className="h-9 w-9 shrink-0 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-[#5B6675]">{project.code}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] border ${statusColor(project.status)}`}>{project.status}</span>
            </div>
            <h1 className="text-[20px] sm:text-[24px] text-white font-display leading-tight truncate">{project.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-[#8A95A5] flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{project.city || "—"}</span>
              {project.startDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Started {fmtDate(project.startDate)}</span>}
              {project.targetEndDate && <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />Target {fmtDate(project.targetEndDate)}</span>}
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Created {fmtDate(project.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} title="Refresh" className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {onEdit && (
            <button onClick={onEdit} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Edit project
            </button>
          )}
        </div>
      </div>

      {/* Cover + gallery */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          {cover ? (
            <button onClick={() => setLightbox({ images, index: 0 })} className="relative block w-full h-[200px] sm:h-[260px] overflow-hidden text-left">
              <ImageWithFallback src={cover} alt={project.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-3 left-4 text-[11px] text-white/90">{images.length} photo{images.length === 1 ? "" : "s"} · click to view</div>
            </button>
          ) : (
            <div className="h-[200px] sm:h-[260px] flex flex-col items-center justify-center gap-2 text-center px-6">
              <ImageIcon className="w-7 h-7 text-[#5B6675]" />
              <div className="text-[12.5px] text-[#8A95A5]">No project photos yet</div>
              {onEdit && <button onClick={onEdit} className="text-[11px] text-[#FF6B1A] hover:underline">Add photos in Edit project</button>}
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto border-t border-[#222A35]">
              {images.map((src, i) => (
                <button key={`${src}-${i}`} onClick={() => setLightbox({ images, index: i })} className="shrink-0">
                  <ImageWithFallback src={src} alt="" className="h-14 w-20 rounded-md object-cover border border-[#222A35] hover:border-[#FF6B1A]" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Brief + team */}
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-4">
          <div>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1.5">Project brief</div>
            <p className="text-[12.5px] text-[#C2CAD6] leading-relaxed whitespace-pre-wrap">
              {project.description || <span className="text-[#5B6675]">No description added yet.</span>}
            </p>
          </div>
          <div className="pt-3 border-t border-[#222A35]">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Team</div>
            {team.length === 0 ? (
              <div className="text-[11.5px] text-[#5B6675]">No one assigned yet.</div>
            ) : (
              <div className="space-y-1.5">
                {team.map((t, i) => (
                  <div key={t.id ?? `${t.role}-${i}`} className="flex items-center gap-2 text-[11.5px]">
                    <UserCircle className="w-3.5 h-3.5 text-[#8A95A5] shrink-0" />
                    <span className="text-[#8A95A5]">{t.role}</span>
                    <span className="text-white truncate">{t.userId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Progress"
          value={`${effectiveProgress}%`}
          sub={progress.schedule != null ? `from ${progress.scheduleItems} schedule items` : "manually reported"}
          accent="text-white"
        />
        <KpiCard
          label="Open punch items"
          value={String(counts.punchOpen)}
          sub={`${counts.punchTotal} logged in total`}
          accent={counts.punchOpen > 0 ? "text-[#F5A623]" : "text-[#22C55E]"}
        />
        <KpiCard
          label="Change orders"
          value={String(counts.changeOrders)}
          sub={showFin ? `exposure ${project.exposure || "—"}` : "on this project"}
          accent="text-[#FF6B1A]"
        />
        <KpiCard
          label={showFin ? "Contract value" : "Drawings"}
          value={showFin ? (project.value || "—") : String(counts.drawings)}
          sub={showFin ? "as contracted" : "sheets uploaded"}
          accent="text-white"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#222A35]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 h-9 text-[12px] whitespace-nowrap border-b-2 -mb-px transition ${tab === t.key ? "border-[#FF6B1A] text-white" : "border-transparent text-[#8A95A5] hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Health signals" subtitle="Things worth looking at today">
            <div className="divide-y divide-[#222A35]">
              <Signal ok={progress.overdueItems === 0} label="Overdue schedule items" value={String(progress.overdueItems)} />
              <Signal ok={progress.blockedItems === 0} label="Blocked schedule items" value={String(progress.blockedItems)} />
              <Signal ok={counts.punchOpen === 0} label="Open punch items" value={String(counts.punchOpen)} />
              <Signal ok={counts.safetyIncidents === 0} label="Safety incidents" value={String(counts.safetyIncidents)} />
              {showFin && <Signal ok={budgetUsedPct == null || budgetUsedPct <= 100} label="Budget used" value={budgetUsedPct == null ? "—" : `${budgetUsedPct}%`} />}
            </div>
          </Panel>
          <Panel title="What's on this project" subtitle="Jump straight to the module">
            <div className="grid grid-cols-2 gap-2 p-4">
              <LinkTile icon={FileStack} label="Drawings" count={counts.drawings} onClick={() => goto("plans", "Plans & Drawings")} />
              <LinkTile icon={ClipboardList} label="Daily logs" count={counts.dailyLogs} onClick={() => goto("daily-log", "Daily Log")} />
              <LinkTile icon={CheckCircle2} label="Punch list" count={counts.punchTotal} onClick={() => goto("punch-list", "Punch List")} />
              <LinkTile icon={ClipboardCheck} label="Checklists" count={counts.checklists} onClick={() => goto("checklists", "Checklists")} />
              <LinkTile icon={HardHat} label="Inspections" count={counts.inspections} onClick={() => goto("inspections", "Inspections")} />
              <LinkTile icon={ShieldAlert} label="Safety" count={counts.safetyIncidents} onClick={() => goto("safety-incidents", "Safety Incidents")} />
              <LinkTile icon={FileText} label="Documents" count={counts.documents} onClick={() => goto("documents", "Documents")} />
              <LinkTile icon={Users} label="Crews" count={counts.crews} onClick={() => goto("crews", "Crews")} />
              <LinkTile icon={Wrench} label="Change orders" count={counts.changeOrders} onClick={() => goto("change-orders", "Change Orders")} />
              <LinkTile icon={Boxes} label="Equipment" count={counts.equipment} onClick={() => goto("equipment", "Inventory")} />
              {showFin && <LinkTile icon={Receipt} label="Invoices" count={counts.invoices} onClick={() => goto("invoicing", "Invoicing")} />}
              {showFin && <LinkTile icon={TrendingUp} label="Commitments" count={counts.commitments} onClick={() => goto("commitments", "Commitments")} />}
            </div>
          </Panel>
        </div>
      )}

      {tab === "progress" && (
        <div className="space-y-4">
          <Panel title="Progress tracking" subtitle="Reported vs. schedule-derived completion">
            <div className="p-4 space-y-5">
              <ProgressBar label="Schedule-derived" hint={progress.schedule == null ? "No schedule items yet" : `Average across ${progress.scheduleItems} items`} pct={progress.schedule} />
              <ProgressBar label="Reported by the team" hint="Entered manually on the project" pct={progress.reported} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-[#222A35]">
                <Stat label="Milestones" value={`${progress.milestonesDone}/${progress.milestonesTotal}`} />
                <Stat label="Schedule items" value={String(progress.scheduleItems)} />
                <Stat label="Overdue" value={String(progress.overdueItems)} tone={progress.overdueItems ? "bad" : "good"} />
                <Stat label="Blocked" value={String(progress.blockedItems)} tone={progress.blockedItems ? "bad" : "good"} />
              </div>
            </div>
          </Panel>

          <Panel
            title="Schedule"
            subtitle={schedule.length ? `${schedule.length} item${schedule.length === 1 ? "" : "s"}` : undefined}
            action={{ label: "Open Schedule", onClick: () => goto("schedule", "Schedule") }}
          >
            {schedule.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No schedule yet" description="Add tasks and milestones in the Schedule module to track progress automatically." actionLabel="Open Schedule" onAction={() => goto("schedule", "Schedule")} />
            ) : (
              <div className="divide-y divide-[#222A35]">
                {schedule.map((s) => {
                  const overdue = s.endDate && new Date(s.endDate) < new Date() && (s.percent ?? 0) < 100;
                  return (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] text-white truncate">{s.name}</span>
                          {s.type === "milestone" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/15 text-[#3B82F6] shrink-0">Milestone</span>}
                          {overdue && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#EF4444]/15 text-[#EF4444] shrink-0 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Overdue</span>}
                        </div>
                        <div className="text-[10.5px] text-[#5B6675] mt-0.5">{fmtDate(s.startDate)} → {fmtDate(s.endDate)}{s.trade ? ` · ${s.trade}` : ""}</div>
                      </div>
                      <div className="w-24 shrink-0">
                        <div className="h-1.5 rounded-full bg-[#222A35] overflow-hidden">
                          <div className="h-full rounded-full bg-[#FF6B1A]" style={{ width: `${Math.min(100, Math.max(0, s.percent ?? 0))}%` }} />
                        </div>
                      </div>
                      <span className="text-[11px] text-[#8A95A5] w-9 text-right shrink-0">{s.percent ?? 0}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "records" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RecordList
            title="Drawings" icon={FileStack} rows={recent.drawings}
            empty="No drawings uploaded for this project yet."
            onOpen={() => goto("plans", "Plans & Drawings")}
            render={(d: any) => ({ primary: `${d.number} · ${d.title}`, secondary: `${d.discipline} · Rev ${d.rev} · ${fmtDate(d.createdAt)}` })}
          />
          <RecordList
            title="Daily logs" icon={ClipboardList} rows={recent.dailyLogs}
            empty="No daily logs recorded yet."
            onOpen={() => goto("daily-log", "Daily Log")}
            render={(l: any) => ({ primary: `${l.crew} · ${l.headcount} people`, secondary: `${fmtDate(l.date)}${l.location ? ` · ${l.location}` : ""}` })}
          />
          <RecordList
            title="Change orders" icon={Wrench} rows={recent.changeOrders}
            empty="No change orders raised yet."
            onOpen={() => goto("change-orders", "Change Orders")}
            render={(c: any) => ({ primary: `${c.number ?? "CO"} · ${c.title ?? "Untitled"}`, secondary: `${c.status ?? "—"} · ${fmtDate(c.createdAt)}` })}
          />
          <RecordList
            title="Inspections" icon={HardHat} rows={recent.inspections}
            empty="No inspections logged yet."
            onOpen={() => goto("inspections", "Inspections")}
            render={(i: any) => ({ primary: `${i.type} · ${i.inspector}`, secondary: `${i.status} · ${fmtDate(i.date)}` })}
          />
          <RecordList
            title="Safety incidents" icon={ShieldAlert} rows={recent.safetyIncidents}
            empty="No safety incidents — good."
            onOpen={() => goto("safety-incidents", "Safety Incidents")}
            render={(s: any) => ({ primary: `${s.incidentType} · ${s.severity}`, secondary: `${s.status} · ${fmtDate(s.date)}` })}
          />
          <RecordList
            title="Checklists" icon={ClipboardCheck} rows={recent.checklists}
            empty="No checklists assigned to this project yet."
            onOpen={() => goto("checklists", "Checklists")}
            render={(c: any) => ({ primary: c.title, secondary: `${c.status}${c.dueDate ? ` · due ${fmtDate(c.dueDate)}` : ""}` })}
          />
          <RecordList
            title="Documents" icon={FileText} rows={recent.documents}
            empty="No documents filed against this project yet."
            onOpen={() => goto("documents", "Documents")}
            render={(d: any) => ({ primary: d.name, secondary: `${d.size ?? "—"} · ${d.updated ?? fmtDate(d.createdAt)}` })}
          />
          {showFin && (
            <RecordList
              title="Invoices" icon={Receipt} rows={recent.invoices}
              empty="No invoices raised for this project yet."
              onOpen={() => goto("invoicing", "Invoicing")}
              render={(i: any) => ({ primary: `${i.invoiceNumber} · ${i.clientName}`, secondary: `${i.status} · ${formatCompactCurrency(Number(i.amount) || 0, currency)}` })}
            />
          )}
        </div>
      )}

      {tab === "financials" && showFin && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KpiCard label="Budget" value={budgetKES > 0 ? formatCompactCurrency(budgetKES, currency) : "—"} sub="across cost categories" accent="text-white" />
            <KpiCard label="Actual spend" value={actualKES > 0 ? formatCompactCurrency(actualKES, currency) : "—"} sub={budgetUsedPct == null ? "no budget set" : `${budgetUsedPct}% of budget`} accent={budgetUsedPct != null && budgetUsedPct > 100 ? "text-[#EF4444]" : "text-white"} />
            <KpiCard label="Cash in / out" value={formatCompactCurrency($toKES(financials.net), currency)} sub={`in ${formatCompactCurrency($toKES(financials.cashIn), currency)} · out ${formatCompactCurrency($toKES(financials.cashOut), currency)}`} accent={financials.net >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"} />
            <KpiCard label="Unpaid invoices" value={financials.invoicedUnpaid > 0 ? formatCompactCurrency(Number(financials.invoicedUnpaid) || 0, currency) : "—"} sub={`of ${formatCompactCurrency(Number(financials.invoicedTotal) || 0, currency)} invoiced`} accent="text-[#F5A623]" />
          </div>
          <Panel title="Cost categories" subtitle="Budget vs. actual per category" action={{ label: "Open Financials", onClick: () => goto("financials", "Financials") }}>
            {financials.expenses.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No cost categories yet" description="Add budget categories in Financials to track spend against budget here." actionLabel="Open Financials" onAction={() => goto("financials", "Financials")} />
            ) : (
              <div className="divide-y divide-[#222A35]">
                {financials.expenses.map((e) => {
                  const b = $toKES(e.budgetUSD);
                  const a = $toKES(e.actualUSD);
                  const pct = b > 0 ? Math.round((a / b) * 100) : 0;
                  const over = pct > 100;
                  return (
                    <div key={e.id} className="px-4 py-3">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-white">{e.name}</span>
                        <span className={over ? "text-[#EF4444]" : "text-[#8A95A5]"}>
                          {formatCompactCurrency(a, currency)} / {formatCompactCurrency(b, currency)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-[#222A35] overflow-hidden">
                        <div className={`h-full rounded-full ${over ? "bg-[#EF4444]" : "bg-[#22C55E]"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- presentation

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
      <div className="text-[11px] text-[#8A95A5]">{label}</div>
      <div className={`text-[20px] sm:text-[22px] mt-1 font-display ${accent ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#5B6675] mt-0.5 line-clamp-1">{sub}</div>}
    </div>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#222A35] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-white font-display">{title}</div>
          {subtitle && <div className="text-[11px] text-[#8A95A5] truncate">{subtitle}</div>}
        </div>
        {action && <button onClick={action.onClick} className="text-[11px] text-[#FF6B1A] hover:underline shrink-0">{action.label}</button>}
      </div>
      {children}
    </div>
  );
}

function Signal({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-2.5">
      {ok ? <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" /> : <AlertTriangle className="w-4 h-4 text-[#F5A623] shrink-0" />}
      <span className="text-[12px] text-[#C2CAD6] flex-1">{label}</span>
      <span className={`text-[13px] font-display ${ok ? "text-[#22C55E]" : "text-[#F5A623]"}`}>{value}</span>
    </div>
  );
}

function LinkTile({ icon: Icon, label, count, onClick }: { icon: any; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 p-3 rounded-lg border border-[#222A35] bg-[#0A0E14] hover:border-[#FF6B1A]/40 text-left transition">
      <div className="w-8 h-8 rounded-md bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
      <div className="min-w-0">
        <div className="text-[15px] text-white font-display leading-none">{count}</div>
        <div className="text-[10.5px] text-[#8A95A5] truncate mt-0.5">{label}</div>
      </div>
    </button>
  );
}

function ProgressBar({ label, hint, pct }: { label: string; hint?: string; pct: number | null }) {
  const value = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1.5">
        <span className="text-[#C2CAD6]">{label}</span>
        <span className="text-white font-display">{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-[#222A35] overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-[#FF6B1A] to-[#FF8A4A] transition-all" style={{ width: `${value}%` }} />
      </div>
      {hint && <div className="text-[10px] text-[#5B6675] mt-1">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "text-[#EF4444]" : tone === "good" ? "text-[#22C55E]" : "text-white";
  return (
    <div>
      <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{label}</div>
      <div className={`text-[15px] font-display mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function RecordList({
  title, icon: Icon, rows, empty, onOpen, render,
}: {
  title: string;
  icon: any;
  rows: any[];
  empty: string;
  onOpen: () => void;
  render: (row: any) => { primary: string; secondary?: string };
}) {
  return (
    <Panel title={title} subtitle={rows.length ? `${rows.length} most recent` : undefined} action={{ label: "Open", onClick: onOpen }}>
      {rows.length === 0 ? (
        <div className="px-4 py-8 flex flex-col items-center text-center gap-2">
          <Icon className="w-5 h-5 text-[#5B6675]" />
          <div className="text-[11.5px] text-[#5B6675]">{empty}</div>
        </div>
      ) : (
        <div className="divide-y divide-[#222A35]">
          {rows.map((row, i) => {
            const { primary, secondary } = render(row);
            return (
              <button key={row.id ?? i} onClick={onOpen} className="w-full px-4 py-2.5 text-left hover:bg-[#161C24] transition">
                <div className="text-[12.5px] text-white truncate">{primary}</div>
                {secondary && <div className="text-[10.5px] text-[#5B6675] truncate mt-0.5">{secondary}</div>}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export default ProjectDetail;
