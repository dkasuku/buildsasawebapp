import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, FileText, X, Trash2, Hammer, Share2, Award, Loader2, Link as LinkIcon, Calendar, Wallet, Mail, Phone, ThumbsUp, ThumbsDown, RotateCcw, Sparkles } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, TRADES } from "./roles";
import api, { type BidPackageDto, type BidDto } from "../../services/api";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";
import { EmptyState } from "./EmptyState";

const PKG_STATUS_COLOR: Record<string, string> = {
  draft: "#5B6675",
  open: "#3B82F6",
  closed: "#F5A623",
  awarded: "#22C55E",
};

const BID_STATUS_COLOR: Record<string, string> = {
  submitted: "#3B82F6",
  shortlisted: "#F5A623",
  "under-review": "#F5A623",
  awarded: "#22C55E",
  declined: "#EF4444",
  rejected: "#EF4444",
};

// Friendly label per bid status (e.g. submitted -> "New")
const BID_STATUS_LABEL: Record<string, string> = {
  submitted: "New",
  shortlisted: "Shortlisted",
  "under-review": "Under review",
  awarded: "Awarded",
  declined: "Declined",
  rejected: "Rejected",
};

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
};

export default function Bidding({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const canManage = perms.manageTeam || perms.financials; // gate manage actions
  const { currency } = useCurrency();

  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>("All");
  const [packages, setPackages] = useState<BidPackageDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", trade: "General", description: "", budgetKES: "", dueDate: "", projectId: "", status: "draft" as "draft" | "open" });

  // Detail drawer
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<BidPackageDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string>("");
  const [sharing, setSharing] = useState(false);
  const [bidForm, setBidForm] = useState({ subcontractor: "", amount: "", notes: "" });
  const [addingBid, setAddingBid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bidBusyId, setBidBusyId] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  // Count of brand-new (submitted) bids across all packages
  const totalNew = packages.reduce(
    (sum, p) => sum + (p.bids || []).filter((b) => b.status === "submitted").length,
    0,
  );

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const params = projectFilter !== "All" ? { projectId: projectFilter } : undefined;
      const rows = await api.getBidPackages(params);
      setPackages(Array.isArray(rows) ? rows : []);
    } catch {
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    api.getProjects()
      .then((ps) => setProjects(ps.map((p) => ({ id: p.id || p.code, name: p.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name || "—";

  const openDetail = async (id: string) => {
    setActiveId(id);
    setShareUrl("");
    setBidForm({ subcontractor: "", amount: "", notes: "" });
    setDeclineFor(null);
    setDeclineReason("");
    setDetailLoading(true);
    setActive(packages.find((p) => p.id === id) || null);
    try {
      const pkg = await api.getBidPackage(id);
      setActive(pkg);
      if (pkg.publicToken) {
        setShareUrl(`${window.location.origin}/?bid=${pkg.publicToken}`);
      }
    } catch {
      // fall back to the list copy already set
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setActiveId(null);
    setActive(null);
  };

  const refreshActive = async (id: string) => {
    try {
      const pkg = await api.getBidPackage(id);
      setActive(pkg);
    } catch { /* ignore */ }
    loadPackages();
  };

  const createPackage = async () => {
    if (!canManage) return toast.error(`${role} cannot create tenders`);
    if (!form.title.trim()) return toast.error("Title is required");
    setCreating(true);
    try {
      const payload: Partial<BidPackageDto> = {
        title: form.title.trim(),
        trade: form.trade || undefined,
        description: form.description.trim() || undefined,
        budgetKES: form.budgetKES ? Number(form.budgetKES) : undefined,
        dueDate: form.dueDate || undefined,
        projectId: form.projectId || (projectFilter !== "All" ? projectFilter : projects[0]?.id) || "",
        status: form.status,
      };
      if (!payload.projectId) { setCreating(false); return toast.error("Select a project"); }
      await api.createBidPackage(payload);
      toast.success("Tender created");
      setShowNew(false);
      setForm({ title: "", trade: "General", description: "", budgetKES: "", dueDate: "", projectId: "", status: "draft" });
      loadPackages();
    } catch (e: any) {
      toast.error(e?.message || "Could not create tender");
    } finally {
      setCreating(false);
    }
  };

  const shareLink = async (id: string) => {
    if (!canManage) return toast.error("Not allowed");
    setSharing(true);
    try {
      const { url, token } = await api.shareBidPackage(id);
      const link = url || `${window.location.origin}/?bid=${token}`;
      setShareUrl(link);
      try { await navigator.clipboard.writeText(link); toast.success("Link copied"); }
      catch { toast.success("Share link ready"); }
      refreshActive(id);
    } catch (e: any) {
      toast.error(e?.message || "Could not create share link");
    } finally {
      setSharing(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }
    catch { toast.error("Could not copy"); }
  };

  const setStatus = async (id: string, status: string) => {
    if (!canManage) return toast.error("Not allowed");
    setBusy(true);
    try {
      await api.updateBidPackage(id, { status });
      toast.success(`Tender ${status}`);
      refreshActive(id);
    } catch (e: any) {
      toast.error(e?.message || "Could not update status");
    } finally {
      setBusy(false);
    }
  };

  const award = async (id: string, bidId: string) => {
    if (!canManage) return toast.error("Not allowed");
    setBusy(true);
    try {
      const pkg = await api.awardBid(id, bidId);
      setActive(pkg);
      toast.success("Bid awarded");
      loadPackages();
    } catch (e: any) {
      toast.error(e?.message || "Could not award bid");
    } finally {
      setBusy(false);
    }
  };

  const respondBid = async (pkgId: string, bidId: string, status: string, reason?: string) => {
    if (!canManage) return toast.error("Not allowed");
    setBidBusyId(bidId);
    try {
      await api.respondToBid(pkgId, bidId, { status, reason });
      const msg = status === "shortlisted" ? "Bid shortlisted" : status === "declined" ? "Bid declined" : status === "submitted" ? "Bid re-opened" : "Bid updated";
      toast.success(msg);
      setDeclineFor(null);
      setDeclineReason("");
      await refreshActive(pkgId);
    } catch (e: any) {
      toast.error(e?.message || "Could not update bid");
    } finally {
      setBidBusyId(null);
    }
  };

  const addBid = async (id: string) => {
    if (!canManage) return toast.error("Not allowed");
    if (!bidForm.subcontractor.trim() || !bidForm.amount) return toast.error("Subcontractor and amount required");
    setAddingBid(true);
    try {
      await api.addPackageBid(id, {
        subcontractor: bidForm.subcontractor.trim(),
        amount: Number(bidForm.amount),
        trade: active?.trade || "General",
        notes: bidForm.notes.trim() || undefined,
      });
      toast.success("Bid logged");
      setBidForm({ subcontractor: "", amount: "", notes: "" });
      refreshActive(id);
    } catch (e: any) {
      toast.error(e?.message || "Could not add bid");
    } finally {
      setAddingBid(false);
    }
  };

  const deletePackage = async (id: string) => {
    if (!canManage) return toast.error("Not allowed");
    setBusy(true);
    try {
      await api.deleteBidPackage(id);
      toast.success("Tender deleted");
      closeDetail();
      loadPackages();
    } catch (e: any) {
      toast.error(e?.message || "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  const labelCls = "text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1";
  const inputCls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]";

  const StatusBadge = ({ status, map, label }: { status: string; map: Record<string, string>; label?: string }) => (
    <span className="px-2 py-0.5 rounded-full text-[10px] capitalize" style={{ background: `${map[status] || "#5B6675"}20`, color: map[status] || "#5B6675" }}>{label || status}</span>
  );

  // Per-bid status badge using the friendly label map
  const BidStatusBadge = ({ status }: { status: string }) => (
    <StatusBadge status={status} map={BID_STATUS_COLOR} label={BID_STATUS_LABEL[status] || status} />
  );

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display">
            <FileText className="w-4 h-4 text-[#FF6B1A]" /> Tenders & Bidding
            {totalNew > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 bg-[#FF6B1A]/15 text-[#FF6B1A]"><Sparkles className="w-3 h-3" /> {totalNew} new submission{totalNew === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Publish tender packages and collect subcontractor bids</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {canManage && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> New tender
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-[12px] text-[#8A95A5] flex items-center gap-2 py-16 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading tenders…</div>
      ) : packages.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={Hammer}
            title="No tenders yet"
            description="Create a tender package to define the scope, budget and deadline, then share a public link so subcontractors can bid."
            actionLabel={canManage ? "New tender" : undefined}
            onAction={canManage ? () => setShowNew(true) : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {packages.map((p) => {
            const bidCount = p.bids?.length ?? 0;
            const newCount = (p.bids || []).filter((b) => b.status === "submitted").length;
            return (
            <button
              key={p.id}
              onClick={() => openDetail(p.id)}
              className="text-left rounded-xl border border-[#222A35] bg-[#11161D] p-4 hover:border-[#FF6B1A]/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-[13px] text-white font-display leading-snug">{p.title}</div>
                <StatusBadge status={p.status} map={PKG_STATUS_COLOR} />
              </div>
              <div className="mt-1 text-[11px] text-[#8A95A5]">{p.trade || "General"} · {projectName(p.projectId)}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-[#E6EAF0]"><Wallet className="w-3.5 h-3.5 text-[#5B6675]" />{p.budgetKES != null ? formatCurrency(Math.round(p.budgetKES), currency) : "—"}</div>
                <div className="flex items-center gap-1.5 text-[#8A95A5]"><Calendar className="w-3.5 h-3.5 text-[#5B6675]" />{fmtDate(p.dueDate)}</div>
              </div>
              <div className="mt-3 pt-3 border-t border-[#222A35] flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#222A35] text-[#8A95A5]">{bidCount} bid{bidCount === 1 ? "" : "s"}</span>
                {newCount > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#FF6B1A]/15 text-[#FF6B1A]">{newCount} new</span>}
              </div>
            </button>
            );
          })}
        </div>
      )}

      {/* New tender modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">New tender</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div><div className={labelCls}>Title</div><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="e.g. Block A — Electrical fit-out" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className={labelCls}>Trade</div>
                  <select value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} className={inputCls}>
                    {TRADES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Project</div>
                  <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={inputCls}>
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><div className={labelCls}>Budget (KES)</div><input type="number" value={form.budgetKES} onChange={(e) => setForm({ ...form, budgetKES: e.target.value })} className={inputCls} /></div>
                <div><div className={labelCls}>Due date</div><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} /></div>
              </div>
              <div>
                <div className={labelCls}>Status</div>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "draft" | "open" })} className={inputCls}>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                </select>
              </div>
              <div><div className={labelCls}>Description</div><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" /></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createPackage} disabled={creating} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60">{creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {activeId && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeDetail}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative h-full w-full max-w-lg bg-[#0A0E14] border-l border-[#222A35] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Drawer header */}
            <div className="sticky top-0 z-10 bg-[#11161D] border-b border-[#222A35] px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-[14px] text-white font-display truncate">{active?.title || "Tender"}</div>
                  {active && <StatusBadge status={active.status} map={PKG_STATUS_COLOR} />}
                </div>
                <div className="text-[11px] text-[#8A95A5] mt-0.5 truncate">{active?.trade || "General"} · {active ? projectName(active.projectId) : ""}</div>
              </div>
              <button onClick={closeDetail} className="text-[#8A95A5] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              {detailLoading && !active ? (
                <div className="text-[12px] text-[#8A95A5] flex items-center gap-2 py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : active ? (
                <>
                  {/* Info */}
                  <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 grid grid-cols-2 gap-3 text-[12px]">
                    <div><div className={labelCls}>Budget</div><div className="text-white">{active.budgetKES != null ? formatCurrency(Math.round(active.budgetKES), currency) : "—"}</div></div>
                    <div><div className={labelCls}>Due date</div><div className="text-white">{fmtDate(active.dueDate)}</div></div>
                    {active.description && <div className="col-span-2"><div className={labelCls}>Scope</div><div className="text-[#E6EAF0] leading-relaxed whitespace-pre-wrap">{active.description}</div></div>}
                  </div>

                  {/* Share */}
                  {canManage && (
                    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
                      <div className={labelCls}>Public bid link</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => shareLink(active.id)} disabled={sharing} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60">{sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />} {shareUrl ? "Regenerate link" : "Share bid link"}</button>
                        {shareUrl && <button onClick={copyLink} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><LinkIcon className="w-3.5 h-3.5" /> Copy</button>}
                      </div>
                      {shareUrl && <div className="mt-2 text-[11px] text-[#3B82F6] break-all bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2">{shareUrl}</div>}
                    </div>
                  )}

                  {/* Status / delete actions */}
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      {active.status !== "open" && active.status !== "awarded" && <button onClick={() => setStatus(active.id, "open")} disabled={busy} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#E6EAF0] hover:border-[#3B82F6] disabled:opacity-60">Set open</button>}
                      {active.status !== "closed" && active.status !== "awarded" && <button onClick={() => setStatus(active.id, "closed")} disabled={busy} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#E6EAF0] hover:border-[#F5A623] disabled:opacity-60">Close</button>}
                      <button onClick={() => deletePackage(active.id)} disabled={busy} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center gap-1.5 ml-auto disabled:opacity-60"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                    </div>
                  )}

                  {/* Bids list */}
                  <div>
                    <div className="text-[12px] text-white font-display mb-2">Bids ({active.bids?.length ?? 0})</div>
                    <div className="space-y-2">
                      {(active.bids || []).length === 0 && <div className="text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D] py-6 text-center">No bids yet</div>}
                      {(active.bids || []).map((b: BidDto) => {
                        const isAwarded = active.awardedBidId === b.id || b.status === "awarded";
                        const isDeclined = b.status === "declined" || b.status === "rejected";
                        const isNew = b.status === "submitted";
                        const canAward = canManage && !isAwarded && !isDeclined && (active.status === "open" || active.status === "closed");
                        const rowBusy = bidBusyId === b.id;
                        const showDecline = declineFor === b.id;
                        const ghostBtn = "h-8 px-2.5 rounded-md border border-[#222A35] text-[11px] flex items-center gap-1.5 hover:border-[#FF6B1A]/60 disabled:opacity-60";
                        return (
                          <div key={b.id} className={`rounded-xl border p-3 ${isAwarded ? "border-[#22C55E]/50 bg-[#22C55E]/5" : isNew ? "border-[#FF6B1A]/40 bg-[#FF6B1A]/[0.04]" : "border-[#222A35] bg-[#11161D]"}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[13px] text-white truncate">{b.subcontractor || b.contactName || "Unknown"}</div>
                                {b.contactName && b.contactName !== b.subcontractor && <div className="text-[11px] text-[#8A95A5] truncate">{b.contactName}</div>}
                                <div className="text-[11px] text-[#5B6675] truncate">{b.trade} · {fmtDate(b.submittedAt)}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[13px] text-white font-display">{formatCurrency(Math.round(b.amount || 0), currency)}</div>
                                <div className="mt-0.5"><BidStatusBadge status={b.status} /></div>
                              </div>
                            </div>

                            {/* Contact details + quick contact links */}
                            {(b.contactEmail || b.contactPhone) && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {b.contactEmail && <a href={`mailto:${b.contactEmail}`} className="h-7 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#E6EAF0] flex items-center gap-1.5 hover:border-[#3B82F6]/60"><Mail className="w-3 h-3 text-[#3B82F6]" /> {b.contactEmail}</a>}
                                {b.contactPhone && <a href={`tel:${b.contactPhone}`} className="h-7 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#E6EAF0] flex items-center gap-1.5 hover:border-[#22C55E]/60"><Phone className="w-3 h-3 text-[#22C55E]" /> {b.contactPhone}</a>}
                              </div>
                            )}

                            {b.notes && <div className="mt-2 text-[11px] text-[#8A95A5] leading-relaxed whitespace-pre-wrap">{b.notes}</div>}
                            {b.fileUrl && <a href={b.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-[#3B82F6] hover:underline">Attachment</a>}

                            {/* Decline reason inline input */}
                            {canManage && showDecline && (
                              <div className="mt-2 pt-2 border-t border-[#222A35]">
                                <div className={labelCls}>Reason (optional)</div>
                                <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={2} placeholder="e.g. Over budget" className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" />
                                <div className="mt-2 flex justify-end gap-2">
                                  <button onClick={() => { setDeclineFor(null); setDeclineReason(""); }} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white">Cancel</button>
                                  <button onClick={() => respondBid(active.id, b.id, "declined", declineReason.trim() || undefined)} disabled={rowBusy} className="h-8 px-2.5 rounded-md bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] text-[11px] flex items-center gap-1.5 hover:bg-[#EF4444]/25 disabled:opacity-60">{rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5" />} Confirm decline</button>
                                </div>
                              </div>
                            )}

                            {/* Per-bid actions */}
                            {canManage && !showDecline && (
                              <div className="mt-2 pt-2 border-t border-[#222A35] flex flex-wrap items-center justify-end gap-2">
                                {isAwarded ? (
                                  <span className="text-[11px] text-[#22C55E] flex items-center gap-1.5 mr-auto"><Award className="w-3.5 h-3.5" /> Awarded</span>
                                ) : isDeclined ? (
                                  <>
                                    <span className="text-[11px] text-[#EF4444] flex items-center gap-1.5 mr-auto"><ThumbsDown className="w-3.5 h-3.5" /> Declined</span>
                                    <button onClick={() => respondBid(active.id, b.id, "submitted")} disabled={rowBusy} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] flex items-center gap-1.5 hover:text-white disabled:opacity-60">{rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Re-open</button>
                                  </>
                                ) : (
                                  <>
                                    {b.status !== "shortlisted" && <button onClick={() => respondBid(active.id, b.id, "shortlisted")} disabled={rowBusy} className={`${ghostBtn} text-[#F5A623] hover:border-[#F5A623]/60`}>{rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />} Shortlist</button>}
                                    <button onClick={() => { setDeclineFor(b.id); setDeclineReason(""); }} disabled={rowBusy} className={`${ghostBtn} text-[#EF4444] hover:border-[#EF4444]/60`}><ThumbsDown className="w-3.5 h-3.5" /> Decline</button>
                                    {canAward && <button onClick={() => award(active.id, b.id)} disabled={busy || rowBusy} className="h-8 px-3 rounded-md bg-[#22C55E]/15 border border-[#22C55E]/40 text-[#22C55E] text-[11px] flex items-center gap-1.5 hover:bg-[#22C55E]/25 disabled:opacity-60"><Award className="w-3.5 h-3.5" /> Award</button>}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add offline bid */}
                  {canManage && (
                    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
                      <div className="text-[12px] text-white font-display mb-3">Add bid (offline)</div>
                      <div className="space-y-3">
                        <div><div className={labelCls}>Subcontractor</div><input value={bidForm.subcontractor} onChange={(e) => setBidForm({ ...bidForm, subcontractor: e.target.value })} className={inputCls} /></div>
                        <div><div className={labelCls}>Amount (KES)</div><input type="number" value={bidForm.amount} onChange={(e) => setBidForm({ ...bidForm, amount: e.target.value })} className={inputCls} /></div>
                        <div><div className={labelCls}>Notes</div><textarea value={bidForm.notes} onChange={(e) => setBidForm({ ...bidForm, notes: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" /></div>
                        <button onClick={() => addBid(active.id)} disabled={addingBid} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60">{addingBid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add bid</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[12px] text-[#8A95A5] py-10 text-center">Tender not found.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
