// ============================================================================
// ProjectDetail — the project hub.
//
// Click a project and everything about it is here, one click deep at most:
// the contract value, timeline and time elapsed across the top; then folders
// down the side — Contract Documents, Drawings & Designs (with versions), Bills
// of Quantities (import, revisions, rate library), Variations (running total
// against the contract sum), Payment Certificates (cumulative valuation), Site
// Execution (diary, progress, defects, H&S) and Cost Control (budget vs actual,
// cost to complete, cash flow) — plus Closeout.
//
// It reads and writes the SAME rows as the standalone modules (Plans, Change
// Orders, Financials…); this is a different door into them, not a copy. Data
// comes from one /api/projects/:id/hub call and is refetched after every write.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle, ArrowLeft, BarChart3, Calculator, Calendar, CalendarDays, CheckCircle2, ClipboardList, Clock, FileStack,
  FileText, Flag, HardHat, Image as ImageIcon, LayoutDashboard, Loader2, MapPin, Pencil, Receipt, RefreshCw, ShieldAlert,
  UserCircle, Wallet, Wrench, Check, AlertTriangle, ArrowUpRight, ChevronRight,
} from "lucide-react";
import api, { absoluteFileUrl, type ProjectHubDto } from "../../services/api";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { ImageLightbox } from "./ImageLightbox";
import { EmptyState } from "./EmptyState";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES, canManageBids } from "./roles";
import { ProjectCloseout } from "./ProjectCloseout";
import { DocumentFolder } from "./project-hub/DocumentFolder";
import { DrawingsFolder } from "./project-hub/DrawingsFolder";
import { BoqFolder } from "./project-hub/BoqFolder";
import { VariationsFolder } from "./project-hub/VariationsFolder";
import { CertificatesFolder } from "./project-hub/CertificatesFolder";
import { SiteFolder } from "./project-hub/SiteFolder";
import { CostControlFolder } from "./project-hub/CostControlFolder";
import { Bar, Field, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, statusTone, useMoney } from "./project-hub/shared";

type Folder = "overview" | "contract" | "drawings" | "boq" | "variations" | "certificates" | "site" | "costs" | "closeout";

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
  const { fmt, compact } = useMoney();
  const perms = ROLES[role];
  const showFin = perms.financials;
  const canEditDocs = canManageBids(role) || perms.manageTeam;
  const canLogVariations = perms.createCO;
  const canApproveVariations = perms.approveAny;
  const canCertify = perms.financials && canManageBids(role);

  const [data, setData] = useState<ProjectHubDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("overview");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [contractModal, setContractModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    setError(null);
    try { setData(await api.getProjectHub(projectId)); }
    catch (e: any) { setError(e?.message || "Could not load this project"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  // Every folder calls this after a write; quiet so the page does not flash.
  const refresh = useCallback(() => load(true), [load]);

  const folders = useMemo<{ key: Folder; label: string; icon: any; count?: number; hint?: string }[]>(() => {
    if (!data) return [];
    const c = data.counts;
    const docsIn = (cat: string) => data.documents.filter((d) => (d.category || "general") === cat).length;
    return [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "contract", label: "Contract Documents", icon: FileText, count: docsIn("contract") },
      { key: "drawings", label: "Drawings & Designs", icon: FileStack, count: c.sheets, hint: c.drawings !== c.sheets ? `${c.drawings} versions` : undefined },
      { key: "boq", label: "Bills of Quantities", icon: Calculator, count: data.boq.itemCount, hint: data.boq.revisions.length ? `V${data.boq.revisions[0].version} saved` : undefined },
      { key: "variations", label: "Variations", icon: Wrench, count: c.variations },
      ...(showFin ? [{ key: "certificates" as Folder, label: "Payment Certificates", icon: Receipt, count: c.certificates }] : []),
      { key: "site", label: "Site Execution", icon: HardHat, count: c.punchOpen, hint: c.punchOpen ? "open defects" : undefined },
      ...(showFin ? [{ key: "costs" as Folder, label: "Cost Control", icon: BarChart3 }] : []),
      { key: "closeout", label: "Closeout", icon: Flag },
    ];
  }, [data, showFin]);

  if (loading) {
    return (
      <div className="px-4 sm:px-7 py-6 space-y-4">
        <div className="h-8 w-40 rounded bg-[#11161D] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
          <div className="h-80 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
          <div className="h-80 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <button onClick={onBack} className="mb-4 h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> Back to projects</button>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState icon={AlertCircle} title="This project could not be loaded" description={error ?? undefined} actionLabel="Try again" onAction={() => load()} secondaryLabel="Back to projects" onSecondary={onBack} />
        </div>
      </div>
    );
  }

  const { project, timeline, progress, costs, counts } = data;
  const images = (project.images ?? []).map((u) => absoluteFileUrl(u)).filter(Boolean);
  const effectiveProgress = progress.schedule ?? progress.reported;
  const contractSum = project.contractSumKES ?? null;
  const behind = timeline.elapsedPct != null && effectiveProgress < timeline.elapsedPct - 10;

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button onClick={onBack} title="Back to projects" className="h-9 w-9 shrink-0 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><ArrowLeft className="w-4 h-4" /></button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-[#5B6675]">{project.code}</span>
              <Pill tone={statusTone(project.status)}>{project.status}</Pill>
            </div>
            <h1 className="text-[20px] sm:text-[24px] text-white font-display leading-tight truncate">{project.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-[#8A95A5] flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{project.city || "—"}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Created {fmtDate(project.createdAt)}</span>
              {data.team.length > 0 && <span className="flex items-center gap-1"><UserCircle className="w-3 h-3" />{data.team.length} on the team</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} title="Refresh" className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center">{refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}</button>
          {onEdit && <button onClick={onEdit} className={btnPrimary}><Pencil className="w-3.5 h-3.5" /> Edit project</button>}
        </div>
      </div>

      {/* ── Contract value · Timeline · Time elapsed ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HeaderTile
          icon={Wallet} label="Contract value" onClick={canEditDocs ? () => setContractModal(true) : undefined}
          value={contractSum != null ? fmt(contractSum) : (project.value || "Not set")}
          sub={contractSum != null
            ? (costs.approvedVariations ? <>Revised <span className="text-white">{fmt(costs.revisedContractSum)}</span> after variations</> : "no approved variations yet")
            : (canEditDocs ? "Click to set the agreed sum" : "not set")}
          tone={showFin ? undefined : "muted"}
          hidden={!showFin && contractSum != null}
        />
        <HeaderTile
          icon={CalendarDays} label="Timeline" onClick={canEditDocs ? () => setContractModal(true) : undefined}
          value={timeline.startDate && timeline.targetEndDate ? `${fmtDate(timeline.startDate, { month: "short", day: "numeric" })} → ${fmtDate(timeline.targetEndDate)}` : timeline.startDate ? `Started ${fmtDate(timeline.startDate)}` : "Not set"}
          sub={timeline.durationDays != null ? `${timeline.durationDays} days · ${Math.round(timeline.durationDays / 7)} weeks` : canEditDocs ? "Click to set start and completion dates" : "dates not set"}
        />
        <div className={`rounded-xl border p-4 ${behind ? "border-[#F5A623]/40 bg-[#F5A623]/5" : "border-[#222A35] bg-[#11161D]"}`}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-[#8A95A5] flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Time elapsed</div>
            {behind && <Pill tone="warn"><AlertTriangle className="w-2.5 h-2.5 inline -mt-px mr-0.5" /> behind</Pill>}
          </div>
          <div className="flex items-end justify-between mt-1 gap-2">
            <div className="text-[20px] text-white font-display leading-tight">{timeline.elapsedPct != null ? `${timeline.elapsedPct}%` : timeline.elapsedDays != null ? `${timeline.elapsedDays} days` : "—"}</div>
            <div className="text-[11px] text-[#8A95A5] text-right">
              {timeline.remainingDays != null ? (timeline.remainingDays >= 0 ? `${timeline.remainingDays} days left` : `${-timeline.remainingDays} days over`) : "no end date"}
            </div>
          </div>
          <div className="mt-2 relative">
            <Bar pct={timeline.elapsedPct} tone={timeline.remainingDays != null && timeline.remainingDays < 0 ? "bad" : "info"} className="h-2" />
            {/* progress marker: where the work is, against where the calendar is */}
            <div className="absolute -top-0.5 h-3 w-0.5 bg-[#FF6B1A]" style={{ left: `calc(${Math.min(100, effectiveProgress)}% - 1px)` }} title={`Work ${effectiveProgress}% complete`} />
          </div>
          <div className="text-[10.5px] text-[#5B6675] mt-1">calendar {timeline.elapsedPct ?? "—"}% · <span className="text-[#FF6B1A]">work {effectiveProgress}%</span>{progress.schedule != null ? " (from schedule)" : " (reported)"}</div>
        </div>
      </div>

      {/* ── Folder rail + content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)] gap-4 items-start">
        <nav className="lg:sticky lg:top-2">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible rounded-xl border border-[#222A35] bg-[#11161D] p-1.5">
            {folders.map((f) => {
              const active = folder === f.key;
              return (
                <button key={f.key} onClick={() => setFolder(f.key)} className={`min-w-max lg:min-w-0 lg:w-full h-10 px-3 rounded-lg text-[12px] flex items-center gap-2.5 transition text-left ${active ? "bg-[#FF6B1A] text-white" : "text-[#C2CAD6] hover:bg-[#161C24] hover:text-white"}`}>
                  <f.icon className={`w-4 h-4 shrink-0 ${active ? "text-white" : "text-[#FF6B1A]"}`} />
                  <span className="flex-1 truncate">{f.label}</span>
                  {f.count != null && f.count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${active ? "bg-white/20" : "bg-[#222A35] text-[#8A95A5]"}`}>{f.count}</span>}
                </button>
              );
            })}
          </div>
          <div className="hidden lg:block mt-3 rounded-xl border border-[#222A35] bg-[#0A0E14] p-3 text-[10.5px] text-[#5B6675] leading-relaxed">
            Everything here is also in the modules (Plans, Change Orders, Financials…). This page just puts one project's records in one place.
          </div>
        </nav>

        <div className="min-w-0">
          {folder === "overview" && (
            <Overview data={data} images={images} onEdit={onEdit} onLightbox={(i) => setLightbox({ images, index: i })} go={setFolder} showFin={showFin} fmt={fmt} compact={compact} />
          )}
          {folder === "contract" && (
            <div className="space-y-4">
              <DocumentFolder projectId={projectId} category="contract" docs={data.documents} onChanged={refresh} canEdit={canEditDocs} />
              <DocumentFolder projectId={projectId} category="general" docs={data.documents} onChanged={refresh} canEdit={canEditDocs} />
            </div>
          )}
          {folder === "drawings" && <DrawingsFolder projectId={projectId} sheets={data.drawings} docs={data.documents} canEdit={canEditDocs} onChanged={refresh} />}
          {folder === "boq" && <BoqFolder projectId={projectId} summary={data.boq} docs={data.documents} canEdit={canManageBids(role)} onChanged={refresh} />}
          {folder === "variations" && (
            <VariationsFolder projectId={projectId} variations={data.variations} contractSum={contractSum} canEdit={canLogVariations} canApprove={canApproveVariations} onChanged={refresh} onSetContractSum={() => setContractModal(true)} />
          )}
          {folder === "certificates" && showFin && (
            <CertificatesFolder projectId={projectId} certificates={data.certificates} contractSum={contractSum} revisedContractSum={costs.revisedContractSum} canEdit={canCertify} onChanged={refresh} onSetContractSum={() => setContractModal(true)} />
          )}
          {folder === "site" && <SiteFolder projectId={projectId} site={data.site} progress={progress} schedule={data.schedule} docs={data.documents} canEdit={perms.completeTasks || canEditDocs} onChanged={refresh} />}
          {folder === "costs" && showFin && <CostControlFolder costs={costs} setView={setView} onSetContractSum={() => setContractModal(true)} />}
          {folder === "closeout" && <ProjectCloseout projectId={projectId} canEdit={canManageBids(role)} />}
        </div>
      </div>

      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
      {contractModal && (
        <ContractModal
          project={project}
          onClose={() => setContractModal(false)}
          onSaved={async () => { setContractModal(false); await refresh(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeaderTile({ icon: Icon, label, value, sub, onClick, hidden }: { icon: any; label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; tone?: string; hidden?: boolean }) {
  const inner = (
    <>
      <div className="text-[11px] text-[#8A95A5] flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}{onClick && <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[#5B6675]"><Pencil className="w-2.5 h-2.5" /> edit</span>}</div>
      <div className="text-[18px] sm:text-[20px] text-white font-display mt-1 leading-tight break-words">{hidden ? "••••" : value}</div>
      {sub && <div className="text-[10.5px] text-[#5B6675] mt-1 leading-snug">{hidden ? "hidden for your role" : sub}</div>}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 text-left hover:border-[#FF6B1A]/50 transition w-full">{inner}</button>
  ) : (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">{inner}</div>
  );
}

function Overview({ data, images, onEdit, onLightbox, go, showFin, fmt, compact }: {
  data: ProjectHubDto; images: string[]; onEdit?: () => void; onLightbox: (i: number) => void; go: (f: Folder) => void; showFin: boolean;
  fmt: (n: number | null | undefined) => string; compact: (n: number | null | undefined) => string;
}) {
  const { project, progress, counts, costs, site, variations, certificates, boq, drawings, documents } = data;
  const cover = images[0];
  const latestDiary = site.dailyLogs[0];
  const pendingVars = variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status)).length;
  const lastCert = certificates[certificates.length - 1];
  const budgetPct = costs.revisedBudget > 0 ? Math.round((costs.actual / costs.revisedBudget) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          {cover ? (
            <button onClick={() => onLightbox(0)} className="relative block w-full h-[180px] sm:h-[220px] overflow-hidden text-left">
              <ImageWithFallback src={cover} alt={project.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-3 left-4 text-[11px] text-white/90">{images.length} photo{images.length === 1 ? "" : "s"} · click to view</div>
            </button>
          ) : (
            <div className="h-[180px] sm:h-[220px] flex flex-col items-center justify-center gap-2 text-center px-6">
              <ImageIcon className="w-7 h-7 text-[#5B6675]" />
              <div className="text-[12.5px] text-[#8A95A5]">No project photos yet</div>
              {onEdit && <button onClick={onEdit} className="text-[11px] text-[#FF6B1A] hover:underline">Add photos in Edit project</button>}
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto border-t border-[#222A35]">
              {images.map((src, i) => (
                <button key={`${src}-${i}`} onClick={() => onLightbox(i)} className="shrink-0"><ImageWithFallback src={src} alt="" className="h-14 w-20 rounded-md object-cover border border-[#222A35] hover:border-[#FF6B1A]" /></button>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-4">
          <div>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1.5">Project brief</div>
            <p className="text-[12.5px] text-[#C2CAD6] leading-relaxed whitespace-pre-wrap line-clamp-6">{project.description || <span className="text-[#5B6675]">No description added yet.</span>}</p>
          </div>
          <div className="pt-3 border-t border-[#222A35]">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Team</div>
            {data.team.length === 0 ? <div className="text-[11.5px] text-[#5B6675]">No one assigned yet.</div> : (
              <div className="space-y-1.5">
                {data.team.map((t, i) => (
                  <div key={t.id ?? `${t.role}-${i}`} className="flex items-center gap-2 text-[11.5px]">
                    <UserCircle className="w-3.5 h-3.5 text-[#8A95A5] shrink-0" /><span className="text-[#8A95A5]">{t.role}</span><span className="text-white truncate">{t.userId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Every folder at a glance — each tile opens it */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlanceTile icon={FileText} label="Contract documents" value={String(documents.filter((d) => (d.category || "general") === "contract").length)} sub="files on record" onClick={() => go("contract")} />
        <GlanceTile icon={FileStack} label="Drawings" value={String(drawings.length)} sub={`${counts.drawings} version${counts.drawings === 1 ? "" : "s"} · ${drawings.filter((s) => s.latest.status === "For Construction" || s.latest.status === "Approved").length} approved`} onClick={() => go("drawings")} />
        <GlanceTile icon={Calculator} label="Bill of quantities" value={boq.itemCount ? compact(boq.total) : "—"} sub={boq.itemCount ? `${boq.itemCount} items · ${boq.revisions.length} revision${boq.revisions.length === 1 ? "" : "s"}` : "not priced yet"} onClick={() => go("boq")} />
        <GlanceTile icon={Wrench} label="Variations" value={costs.approvedVariations ? `${costs.approvedVariations > 0 ? "+" : "−"}${compact(Math.abs(costs.approvedVariations))}` : String(counts.variations)} sub={pendingVars ? `${pendingVars} awaiting decision` : `${counts.variations} logged`} onClick={() => go("variations")} tone={pendingVars ? "warn" : undefined} />
        {showFin && <GlanceTile icon={Receipt} label="Certified to date" value={certificates.length ? compact(costs.certifiedToDate) : "—"} sub={lastCert ? `last: ${lastCert.number}${lastCert.pctOfContract != null ? ` · ${lastCert.pctOfContract}% of contract` : ""}` : "no certificates yet"} onClick={() => go("certificates")} />}
        <GlanceTile icon={ClipboardList} label="Site diary" value={String(counts.dailyLogs)} sub={latestDiary ? `last entry ${fmtDate(latestDiary.date)}` : "no entries yet"} onClick={() => go("site")} />
        <GlanceTile icon={CheckCircle2} label="Open defects" value={String(counts.punchOpen)} sub={`${counts.punchTotal} logged · ${counts.safetyIncidents} H&S incident${counts.safetyIncidents === 1 ? "" : "s"}`} onClick={() => go("site")} tone={counts.punchOpen ? "warn" : "good"} />
        {showFin && <GlanceTile icon={BarChart3} label="Budget used" value={budgetPct == null ? "—" : `${budgetPct}%`} sub={costs.originalBudget ? `${compact(costs.actual)} of ${compact(costs.revisedBudget)}` : "no budget yet"} onClick={() => go("costs")} tone={budgetPct != null && budgetPct > 100 ? "bad" : undefined} />}
      </div>

      <Panel title="Health signals" subtitle="Things worth looking at today">
        <div className="divide-y divide-[#222A35]">
          <Signal ok={progress.overdueItems === 0} label="Overdue programme items" value={String(progress.overdueItems)} onClick={() => go("site")} />
          <Signal ok={progress.blockedItems === 0} label="Blocked programme items" value={String(progress.blockedItems)} onClick={() => go("site")} />
          <Signal ok={counts.punchOpen === 0} label="Open defects" value={String(counts.punchOpen)} onClick={() => go("site")} />
          <Signal ok={site.safetyIncidents.filter((s) => s.status !== "closed").length === 0} label="Open H&S incidents" value={String(site.safetyIncidents.filter((s) => s.status !== "closed").length)} onClick={() => go("site")} />
          <Signal ok={pendingVars === 0} label="Variations awaiting a decision" value={String(pendingVars)} onClick={() => go("variations")} />
          {showFin && <Signal ok={budgetPct == null || budgetPct <= 100} label="Budget used" value={budgetPct == null ? "—" : `${budgetPct}%`} onClick={() => go("costs")} />}
          {showFin && <Signal ok={costs.variance >= 0} label="Forecast against budget" value={costs.originalBudget ? `${costs.variance >= 0 ? "under by" : "over by"} ${fmt(Math.abs(costs.variance))}` : "—"} onClick={() => go("costs")} />}
        </div>
      </Panel>
    </div>
  );
}

function GlanceTile({ icon: Icon, label, value, sub, onClick, tone }: { icon: any; label: string; value: string; sub?: string; onClick: () => void; tone?: "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-[#EF4444]" : tone === "warn" ? "text-[#F5A623]" : tone === "good" ? "text-[#22C55E]" : "text-white";
  return (
    <button onClick={onClick} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3.5 text-left hover:border-[#FF6B1A]/50 transition min-w-0 group">
      <div className="flex items-center gap-2 text-[11px] text-[#8A95A5]"><Icon className="w-3.5 h-3.5 text-[#FF6B1A]" /> <span className="truncate flex-1">{label}</span><ArrowUpRight className="w-3.5 h-3.5 text-[#5B6675] group-hover:text-[#FF6B1A] shrink-0" /></div>
      <div className={`text-[19px] font-display mt-1 leading-tight truncate ${color}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-[#5B6675] mt-0.5 truncate">{sub}</div>}
    </button>
  );
}

function Signal({ ok, label, value, onClick }: { ok: boolean; label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-4 py-2.5 flex items-center gap-2.5 hover:bg-[#161C24]/60 text-left">
      {ok ? <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" /> : <AlertTriangle className="w-4 h-4 text-[#F5A623] shrink-0" />}
      <span className="text-[12px] text-[#C2CAD6] flex-1">{label}</span>
      <span className={`text-[12.5px] font-display ${ok ? "text-[#22C55E]" : "text-[#F5A623]"}`}>{value}</span>
      <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />
    </button>
  );
}

function ContractModal({ project, onClose, onSaved }: { project: ProjectHubDto["project"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const money = useMoney();
  const toInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [f, setF] = useState({ contractSum: money.fromBase(project.contractSumKES), startDate: toInput(project.startDate), targetEndDate: toInput(project.targetEndDate) });
  const [busy, setBusy] = useState(false);
  const days = f.startDate && f.targetEndDate ? Math.round((new Date(f.targetEndDate).getTime() - new Date(f.startDate).getTime()) / 86400000) : null;
  const save = async () => {
    if (days != null && days < 0) return toast.error("The completion date is before the start date");
    setBusy(true);
    try {
      await api.updateProjectContract(project.id, { contractSumKES: f.contractSum === "" ? null : money.toBase(f.contractSum), startDate: f.startDate || null, targetEndDate: f.targetEndDate || null });
      toast.success("Contract details saved");
      await onSaved();
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Contract value & timeline" subtitle="The agreed sum is the base every variation and certificate is measured against." onClose={onClose}>
      <div className="space-y-3">
        <Field label={money.unit("Contract sum")} hint={`Entered in ${money.code} — switch the currency in the top bar to enter it in ${money.code === "KES" ? "USD" : "KES"}.${project.value ? ` Shown on the project card as “${project.value}”.` : ""}`}>
          <input autoFocus type="number" min={0} value={f.contractSum} onChange={(e) => setF((x) => ({ ...x, contractSum: e.target.value }))} placeholder={money.code === "KES" ? "e.g. 45000000" : "e.g. 350000"} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (possession of site)"><input type="date" value={f.startDate} onChange={(e) => setF((x) => ({ ...x, startDate: e.target.value }))} className={input} /></Field>
          <Field label="Contract completion"><input type="date" value={f.targetEndDate} onChange={(e) => setF((x) => ({ ...x, targetEndDate: e.target.value }))} className={input} /></Field>
        </div>
        {days != null && days >= 0 && <div className="text-[11.5px] text-[#8A95A5] flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Contract period: {days} days ({Math.round(days / 7)} weeks)</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save</button>
        </div>
      </div>
    </Modal>
  );
}

export default ProjectDetail;
