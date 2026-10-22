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
  AlertCircle, ArrowLeft, Calendar, CalendarDays, CheckCircle2, Clock, Image as ImageIcon, Loader2, MapPin, MoreHorizontal,
  Pencil, RefreshCw, UserCircle, Check, AlertTriangle, ChevronRight, Share2, UserCheck,
} from "lucide-react";
import { ClientPortalDialog } from "./ClientPortalDialog";
import { SiteWeather } from "./SiteWeather";
import { SelectionsFolder } from "./project-hub/SelectionsFolder";
import api, { absoluteFileUrl, type ProjectHubDto } from "../../services/api";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { ImageLightbox } from "./ImageLightbox";
import { EmptyState } from "./EmptyState";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES, canManageBids } from "./roles";
import { ProjectCloseout } from "./ProjectCloseout";
import { clientApi } from "./client/clientData";
import { projectTone, statusText } from "./wsStatus";
import { ProjectAnalytics } from "./project-hub/ProjectAnalytics";
import { ActivityCard, AttentionCard, ReadinessCard } from "./project-hub/ProjectAside";
import { DocumentFolder } from "./project-hub/DocumentFolder";
import { DrawingsFolder } from "./project-hub/DrawingsFolder";
import { BoqFolder } from "./project-hub/BoqFolder";
import { VariationsFolder } from "./project-hub/VariationsFolder";
import { CertificatesFolder } from "./project-hub/CertificatesFolder";
import { SiteFolder } from "./project-hub/SiteFolder";
import { ClientFolder } from "./project-hub/ClientFolder";
import { CostControlFolder } from "./project-hub/CostControlFolder";
import { ReportFolder } from "./project-hub/ReportFolder";
import { Field, Modal, Panel, btnGhost, btnPrimary, fmtDate, input, useMoney } from "./project-hub/shared";
import { isStarter } from "./planTier";

type Folder = "overview" | "analytics" | "contract" | "drawings" | "boq" | "variations" | "selections" | "certificates" | "site" | "costs" | "report" | "closeout" | "client";

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
  // Payment certificates, cost control and the BOQ are Business plan features.
  const starterPlan = isStarter();
  const showFin = perms.financials && !starterPlan;
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
  const [portalOpen, setPortalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // The project's client, for the header meta line and the setup checklist.
  const [clients, setClients] = useState<{ id: string; email: string; name?: string | null }[] | null>(null);
  useEffect(() => { clientApi.projectClients(projectId).then(setClients).catch(() => setClients([])); }, [projectId]);
  // Same roles the server lets share the portal (those that handle money).
  const canSharePortal = perms.financials;

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

  const folders = useMemo<{ key: Folder; label: string; count?: number }[]>(() => {
    if (!data) return [];
    const c = data.counts;
    const docsIn = (cat: string) => data.documents.filter((d) => (d.category || "general") === cat).length;
    return [
      { key: "overview", label: "Overview" },
      { key: "analytics", label: "Analytics" },
      { key: "contract", label: "Contract", count: docsIn("contract") },
      { key: "drawings", label: "Drawings", count: c.sheets },
      ...(starterPlan ? [] : [{ key: "boq" as Folder, label: "BOQ", count: data.boq.itemCount }]),
      { key: "variations", label: "Variations", count: c.variations },
      ...(showFin ? [{ key: "certificates" as Folder, label: "Certificates", count: c.certificates }] : []),
      { key: "selections", label: "Finishes" },
      { key: "site", label: "Site", count: c.punchOpen },
      ...(showFin ? [{ key: "costs" as Folder, label: "Cost control" }] : []),
      { key: "client", label: "Client" },
      ...(perms.viewReports ? [{ key: "report" as Folder, label: "Reports" }] : []),
      { key: "closeout", label: "Closeout" },
    ];
  }, [data, showFin, perms.viewReports, starterPlan]);

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

  const { project, costs } = data;
  const images = (project.images ?? []).map((u) => absoluteFileUrl(u)).filter(Boolean);
  const contractSum = project.contractSumKES ?? null;
  const tone = projectTone(project.status);
  const planning = tone === "blue";
  const client = clients?.[0];
  const withAside = ["overview", "contract", "drawings", "variations", "site", "closeout"].includes(folder);

  return (
    <div>
      {/* ── Header band ── */}
      <div className="ws-project-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="ws-h1 truncate">{project.name}</h1>
              {project.code && <span className="ws-mono" style={{ fontSize: 12, color: "var(--ws-muted)" }}>{project.code}</span>}
              <span className={`ws-pill ws-pill-${tone}`}>{statusText(project.status)}</span>
            </div>
            <div className="ws-meta">
              <span><MapPin aria-hidden />{project.city || "No location"}</span>
              <span><Clock aria-hidden />Created {fmtDate(project.createdAt)}</span>
              <span>
                <UserCircle aria-hidden />Client:{" "}
                {client ? <span style={{ color: "var(--ws-text)" }}>{client.name || client.email}</span>
                  : <button type="button" className="ws-link" onClick={() => setFolder("client")}>not assigned yet</button>}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canSharePortal && (client
              ? <button type="button" onClick={() => setPortalOpen(true)} className="ws-btn ws-btn-lg"><Share2 aria-hidden /> Share</button>
              : <button type="button" onClick={() => setFolder("client")} className="ws-btn ws-btn-lg"><UserCheck aria-hidden /> Invite client</button>)}
            {onEdit && <button type="button" onClick={onEdit} className="ws-btn ws-btn-lg"><Pencil aria-hidden /> Edit project</button>}
            <div className="relative">
              <button type="button" className="ws-icon-btn" style={{ height: 38, width: 38 }} aria-label="More project actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                {refreshing ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />
                  <div className="ws-menu" role="menu" style={{ right: 0, top: 44, width: 230 }}>
                    <button role="menuitem" className="ws-menu-item" onClick={() => { setMoreOpen(false); refresh(); }}><RefreshCw /> Refresh</button>
                    {canEditDocs && <button role="menuitem" className="ws-menu-item" onClick={() => { setMoreOpen(false); setContractModal(true); }}><CalendarDays /> Contract value &amp; dates</button>}
                    {canSharePortal && <button role="menuitem" className="ws-menu-item" onClick={() => { setMoreOpen(false); setPortalOpen(true); }}><Share2 /> View-only portal link</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <nav className="ws-tabs" aria-label="Project sections">
          {folders.map((f) => (
            <button key={f.key} type="button" className="ws-tab" aria-current={folder === f.key ? "page" : undefined} onClick={() => setFolder(f.key)}>
              {f.label}
              {f.count != null && f.count > 0 && <span className="ws-count">{f.count}</span>}
            </button>
          ))}
        </nav>
      </div>
      {portalOpen && (
        <ClientPortalDialog
          projectId={projectId}
          projectName={project.name}
          token={project.portalToken}
          onChange={(t) => setData((d) => (d ? { ...d, project: { ...d.project, portalToken: t } } : d))}
          onClose={() => setPortalOpen(false)}
        />
      )}

      <div className="ws-content">
        <div className="ws-main" style={withAside ? undefined : { flexBasis: "100%" }}>
          {folder === "overview" && (
            <>
              <SiteWeather projectId={projectId} compact site={{ name: data.project.name, lat: data.project.lat, lng: data.project.lng }} onPinLocation={onEdit || (() => toast.info("Ask a project manager to set this project's location"))} />
              <Overview data={data} images={images} onEdit={onEdit} onLightbox={(i) => setLightbox({ images, index: i })} go={setFolder} showFin={showFin} fmt={fmt} />
            </>
          )}
          {folder === "analytics" && <ProjectAnalytics data={data} fmt={fmt} showFin={showFin} go={setFolder} onExport={perms.viewReports ? () => setFolder("report") : undefined} />}
          {folder === "contract" && (
            <>
              <DocumentFolder projectId={projectId} category="contract" docs={data.documents} onChanged={refresh} canEdit={canEditDocs} />
              <DocumentFolder projectId={projectId} category="general" docs={data.documents} onChanged={refresh} canEdit={canEditDocs} />
            </>
          )}
          {folder === "drawings" && <DrawingsFolder projectId={projectId} role={role} projectName={data.project.name} sheets={data.drawings} docs={data.documents} canEdit={canEditDocs} onChanged={refresh} />}
          {folder === "boq" && <BoqFolder projectId={projectId} summary={data.boq} docs={data.documents} canEdit={canManageBids(role)} onChanged={refresh} />}
          {folder === "selections" && <SelectionsFolder projectId={projectId} canEdit={canSharePortal} portalOn={!!data.project.portalToken} onOpenPortal={canSharePortal ? () => setPortalOpen(true) : undefined} />}
          {folder === "variations" && (
            <VariationsFolder projectId={projectId} variations={data.variations} contractSum={contractSum} canEdit={canLogVariations} canApprove={canApproveVariations} onChanged={refresh} onSetContractSum={() => setContractModal(true)} />
          )}
          {folder === "certificates" && showFin && (
            <CertificatesFolder projectId={projectId} certificates={data.certificates} contractSum={contractSum} revisedContractSum={costs.revisedContractSum} canEdit={canCertify} onChanged={refresh} onSetContractSum={() => setContractModal(true)} />
          )}
          {folder === "site" && <SiteFolder projectId={projectId} site={data.site} progress={data.progress} schedule={data.schedule} docs={data.documents} canEdit={perms.completeTasks || canEditDocs} onChanged={refresh} />}
          {folder === "costs" && showFin && <CostControlFolder costs={costs} setView={setView} onSetContractSum={() => setContractModal(true)} />}
          {folder === "report" && perms.viewReports && <ReportFolder data={data} setView={setView} />}
          {folder === "client" && <ClientFolder projectId={projectId} canInvite={canSharePortal} onOpenPortal={canSharePortal ? () => setPortalOpen(true) : undefined} />}
          {folder === "closeout" && <ProjectCloseout projectId={projectId} canEdit={canManageBids(role)} />}
        </div>

        {withAside && (
          <aside className="ws-aside" aria-label="Project status">
            {planning
              ? <ReadinessCard data={data} hasClient={!!client} onContract={canEditDocs ? () => setContractModal(true) : undefined} go={setFolder} />
              : <AttentionCard data={data} showFin={showFin} go={setFolder} />}
            <ActivityCard data={data} />
          </aside>
        )}
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

function Overview({ data, images, onEdit, onLightbox, go, showFin, fmt }: {
  data: ProjectHubDto; images: string[]; onEdit?: () => void; onLightbox: (i: number) => void; go: (f: Folder) => void; showFin: boolean;
  fmt: (n: number | null | undefined) => string;
}) {
  const { project, progress, counts, costs, site, variations } = data;
  const cover = images[0];
  const pendingVars = variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status)).length;
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
