import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Paperclip, MessageSquare, CheckCircle2, FileCheck2, Clock, AlertTriangle, Mic, Download, MoreHorizontal, ChevronRight, Sparkles, ThumbsUp, ImageIcon } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { useCurrency } from "./CurrencyContext";
import { USD_TO_KES, formatCurrency } from "./currency";
import api from "../../services/api";
import { EmptyState } from "./EmptyState";

// The activity timeline and the change order itself are loaded from the backend
// (see the fetch in the component). Both used to be hardcoded: `timeline` listed
// five invented events by people who do not exist, and a CHANGE_ORDERS lookup
// table held three fake orders with a fallback of `?? CHANGE_ORDERS["CO-1258"]`
// — so opening ANY real change order displayed someone else's invented data for
// "Midtown Medical", and it looked entirely genuine.
// Shillings per dollar comes from currency.ts, so this screen and the Change
// Orders list cannot disagree about what a stored USD figure is worth.
const $toKES = (dollars: number) => Math.round(dollars * USD_TO_KES);


// Backend status codes -> display label + style. Keyed on the real values the
// API returns (drafted | pm_review | owner_approval | approved | rejected | void)
// as well as the human labels, so either shape renders correctly.
const STATUS_LABELS: Record<string, string> = {
  drafted: "Drafted", pm_review: "PM Review", owner_approval: "Owner Approval",
  approved: "Approved", rejected: "Rejected", void: "Void",
};
const STATUS_STYLES: Record<string, string> = {
  "Owner Approval": "bg-[#FF6B1A]/15 text-[#FF6B1A] border-[#FF6B1A]/30",
  "PM Review": "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30",
  Approved: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30",
  Rejected: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30",
  Drafted: "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]",
  Void: "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]",
};
const relTime = (iso?: string | null) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return String(iso);
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const AVATAR_COLORS = ["#FF6B1A", "#3B82F6", "#22C55E", "#8B5CF6", "#F5A623", "#06B6D4"];
const colorFor = (k: string) => AVATAR_COLORS[Array.from(k || "?").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

export function ChangeOrderDetail({
  setView,
  role = "Contractor",
  changeOrderId,
  onBack,
  backLabel,
  statusOverride,
}: {
  setView: (v: View) => void;
  role?: Role;
  changeOrderId: string;
  onBack?: () => void;
  backLabel?: string;
  statusOverride?: string;
}) {
  const perms = ROLES[role];
  const { currency } = useCurrency();
  // ---- Real change order, loaded from the backend -------------------------
  const [row, setRow] = useState<any | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const co = await api.getChangeOrder(changeOrderId);
      setRow(co);
      // Activity is supplementary — a failure here must not blank the page.
      try { setActivity((await api.getChangeOrderActivity(changeOrderId)) ?? []); }
      catch { setActivity([]); }
    } catch (e: any) {
      setLoadError(e?.message || "Could not load this change order");
    } finally {
      setLoading(false);
    }
  }, [changeOrderId]);
  useEffect(() => { load(); }, [load]);

  // Map the stored row onto the shape this screen renders. Every value is the
  // real one; nothing is invented when a field is empty — it shows "—".
  const changeOrder = {
    id: row?.number ?? changeOrderId,
    project: row?.project?.name ?? "",
    area: row?.area || "—",
    title: row?.title ?? "",
    status: STATUS_LABELS[row?.status] ?? row?.status ?? "Drafted",
    costKES: $toKES(Number(row?.costUSD) || 0),
    schedule: `${(Number(row?.scheduleImpactDays) || 0) >= 0 ? "+" : ""}${Number(row?.scheduleImpactDays) || 0} day${Math.abs(Number(row?.scheduleImpactDays) || 0) === 1 ? "" : "s"}`,
    trigger: row?.trigger || "—",
    rfi: row?.rfi || "—",
    submitted: row?.submittedDate || (row?.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"),
    pending: row?.status === "approved" ? "Approved" : row?.updatedAt ? `Updated ${relTime(row.updatedAt)}` : "—",
  };

  const displayStatus = statusOverride ?? changeOrder.status;
  // ROLES[].approveLimit is denominated in USD (see RoleManager, which labels it
  // "Max dollar value this role can approve"). This used to compare it against
  // changeOrder.costKES — a shilling figure against a dollar ceiling — so every
  // limit was effectively 130x too strict and a Project Manager with a $250k
  // ceiling was refused at roughly $1,900. Compare dollars with dollars.
  const CO_AMOUNT_USD = Number(row?.costUSD) || 0;
  const canApprove = perms.approveAny && CO_AMOUNT_USD <= perms.approveLimit;
  const approveLimitLabel = perms.approveLimit === Infinity
    ? "∞"
    : formatCurrency($toKES(perms.approveLimit), currency);

  // Persist a status change and refresh from the server, so what is shown is
  // what was actually stored.
  const [savingStatus, setSavingStatus] = useState(false);
  const setStatus = async (next: string) => {
    if (savingStatus) return;
    setSavingStatus(true);
    try {
      await api.updateChangeOrder(changeOrderId, { status: next });
      await load();
      toast.success(next === "approved" ? `${changeOrder.id} approved` : `${changeOrder.id} rejected`);
    } catch (e: any) {
      toast.error(`Could not update ${changeOrder.id} — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setSavingStatus(false);
    }
  };

  // Download a real summary of this change order.
  const exportCO = () => {
    const lines = [
      `CHANGE ORDER ${changeOrder.id}`,
      `Title:        ${changeOrder.title}`,
      `Project:      ${changeOrder.project}`,
      `Area:         ${changeOrder.area}`,
      `Status:       ${changeOrder.status}`,
      `Cost impact:  ${formatCurrency(changeOrder.costKES, currency)}`,
      `Schedule:     ${changeOrder.schedule}`,
      `Trigger:      ${changeOrder.trigger}`,
      `RFI:          ${changeOrder.rfi}`,
      `Submitted:    ${changeOrder.submitted}`,
      "",
      "SCOPE & JUSTIFICATION",
      row?.description || "(none recorded)",
      "",
      "ACTIVITY",
      ...(timeline.length ? timeline.map((t) => `- ${t.time} · ${t.who} (${t.role}): ${t.action}`) : ["(none recorded)"]),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${changeOrder.id || "change-order"}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${changeOrder.id} downloaded`);
  };

  // The real approval pipeline this product implements.
  const STAGES = [
    { key: "drafted", label: "Drafted" },
    { key: "pm_review", label: "PM Review" },
    { key: "owner_approval", label: "Owner Approval" },
    { key: "approved", label: "Approved" },
  ];
  const currentStageIndex = Math.max(0, STAGES.findIndex((x) => x.key === (row?.status === "rejected" ? "owner_approval" : row?.status)));

  // Real comments from the activity trail, plus a real timeline built from it.
  const comments = activity
    .filter((a) => a.type === "comment" && a.message)
    .map((a) => ({ n: a.userName || "Unknown", r: a.userRole || "", t: relTime(a.createdAt), c: colorFor(a.userId || a.userName || ""), m: a.message as string }));

  const timeline = activity.map((a) => ({
    who: a.userName || "Buildsasa",
    role: a.userRole || "System",
    action: a.type === "status"
      ? `Status ${a.fromStatus ? `${STATUS_LABELS[a.fromStatus] ?? a.fromStatus} → ` : ""}${STATUS_LABELS[a.toStatus] ?? a.toStatus ?? ""}`.trim()
      : a.type === "comment" ? "Commented"
      : a.type === "created" ? "Created this change order"
      : a.message || "Updated",
    time: relTime(a.createdAt),
    c: colorFor(a.userId || a.userName || ""),
    icon: a.type === "status" ? CheckCircle2 : a.type === "comment" ? MessageSquare : a.type === "created" ? FileCheck2 : AlertTriangle,
  }));

  // Post a real comment onto the change order's activity trail. This previously
  // only pushed into local state and said "Comment posted" — nothing was saved,
  // so the comment vanished on reload and no one else ever saw it.
  const submit = async () => {
    if (!comment.trim()) return toast.error("Comment is empty");
    if (posting) return;
    setPosting(true);
    try {
      await api.addChangeOrderComment(changeOrderId, comment.trim());
      setComment("");
      setActivity((await api.getChangeOrderActivity(changeOrderId)) ?? []);
      toast.success("Comment posted");
    } catch (e: any) {
      toast.error(`Comment not posted — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-7 py-6 space-y-4">
        <div className="h-6 w-40 rounded bg-[#11161D] animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 h-64 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
          <div className="h-64 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !row) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <button onClick={() => (onBack ? onBack() : setView("change-orders"))} className="flex items-center gap-1.5 text-[12px] text-[#8A95A5] hover:text-white mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to {backLabel ?? "Change Orders"}
        </button>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={AlertTriangle}
            title="This change order could not be loaded"
            description={loadError ?? undefined}
            actionLabel="Try again"
            onAction={load}
            secondaryLabel="Back to Change Orders"
            onSecondary={() => (onBack ? onBack() : setView("change-orders"))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6">
      <button
        onClick={() => (onBack ? onBack() : setView("projects"))}
        className="flex items-center gap-1.5 text-[12px] text-[#8A95A5] hover:text-white mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to {backLabel ?? changeOrder.project}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-[#8A95A5] flex-wrap">
                  <span className="font-mono">{changeOrder.id}</span>
                  <ChevronRight className="w-3 h-3" />
                  <span>{changeOrder.project}</span>
                  <ChevronRight className="w-3 h-3" />
                  <span>{changeOrder.area}</span>
                </div>
                <h1 className="text-[18px] sm:text-[22px] text-white mt-1.5 tracking-tight font-display">
                  {changeOrder.title}
                </h1>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider border ${STATUS_STYLES[displayStatus] ?? STATUS_STYLES["Owner Approval"]}`}>
                    {displayStatus}
                  </span>
                  {/* Only claim a schedule impact when this order actually has
                      one. This pill used to render unconditionally, next to a
                      hardcoded "Rev 3" badge shown on every change order — the
                      revision number was invented and there is no revision
                      model to read it from. */}
                  {(Number(row?.scheduleImpactDays) || 0) !== 0 && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 uppercase tracking-wider">Schedule Impact</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {/* Real text export of this change order. */}
                <button onClick={exportCO} title="Download a summary of this change order" className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-4 h-4" /></button>
                {row?.status !== "approved" && row?.status !== "rejected" && (
                  <button
                    onClick={() => setStatus("rejected")}
                    disabled={savingStatus}
                    className="h-9 px-3 rounded-md border border-[#EF4444]/40 text-[#EF4444] text-[12px] hover:bg-[#EF4444]/10 disabled:opacity-60"
                  >Reject</button>
                )}
                {/* Actually persists the approval. This used to only raise
                    "approved · owner notified" — nothing was saved, so the order
                    stayed pending and the approval was silently lost. */}
                <button
                  onClick={() => canApprove ? setStatus("approved") : toast.error(`${role} cannot approve this amount (limit ${approveLimitLabel})`)}
                  disabled={savingStatus || row?.status === "approved"}
                  className={`h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 disabled:opacity-60 ${canApprove ? "bg-[#FF6B1A] hover:bg-[#FF7E33] text-white" : "bg-[#222A35] text-[#5B6675] cursor-not-allowed"}`}
                ><CheckCircle2 className="w-4 h-4" /> {row?.status === "approved" ? "Approved" : savingStatus ? "Saving…" : "Approve"}</button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#222A35]">
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Cost Impact</div>
                {/* "2.1% of contract" and "Critical path" sat under these two
                    figures on every change order. Neither was computed: the
                    percentage needs a contract value this screen never loads,
                    and nothing here knows whether the delay touches the
                    critical path. Both were invented and are removed. */}
                <div className="text-[18px] sm:text-[20px] text-[#FF6B1A] mt-1 font-display">+{formatCurrency(changeOrder.costKES, currency)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Schedule Impact</div>
                <div className="text-[18px] sm:text-[20px] text-white mt-1 font-display">{changeOrder.schedule}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Trigger</div>
                <div className="text-[14px] text-white mt-1">{changeOrder.trigger}</div>
                <div className="text-[10px] text-[#8A95A5]">{changeOrder.rfi}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Submitted</div>
                <div className="text-[14px] text-white mt-1">{changeOrder.submitted}</div>
                <div className="text-[10px] text-[#8A95A5]">{changeOrder.pending}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#FF6B1A]/30 bg-gradient-to-br from-[#FF6B1A]/8 to-transparent p-5">
            {/* This order's own description. It used to be a fixed paragraph about
                "8 additional VAV boxes on Level 14", labelled "AI Summary · 3 voice
                notes & 12 photos" — invented detail shown for every change order,
                with Regenerate / View sources buttons that did nothing. */}
            <div className="flex items-center gap-2 text-[11px] text-[#FF6B1A] uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5" /> Scope &amp; justification
            </div>
            <p className="text-[13px] text-white leading-relaxed whitespace-pre-wrap">
              {row?.description || <span className="text-[#8A95A5]">No description recorded for this change order yet.</span>}
            </p>
          </div>

          {/* A "Budget Impact" table used to sit here: five hardcoded rows
              ("VAV Terminal Units (8 ea.) — $186,400", "Field labor (412 hrs)",
              "Accelerated freight") totalling a fixed "+$284,000". It was
              identical on every change order, priced in dollars inside a product
              that bills in shillings, and bore no relation to the record on
              screen. Change orders have no line-item cost breakdown model, so
              rather than show invented figures to a quantity surveyor the panel
              is removed until they do. The real cost impact is the "Cost Impact"
              figure above, which comes from the record. */}

          {/* The attachments panel here was entirely fabricated: a fixed count
              of "14", four Unsplash stock photos, and Add/open buttons that did
              nothing. Change orders have no attachment model yet, so rather than
              show invented evidence the panel is removed until they do. */}

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-4 font-display">Discussion · {comments.length}</div>
            <div className="space-y-4">
              {comments.length === 0 && (
                <div className="text-[11.5px] text-[#5B6675] py-2">No comments yet — be the first to add one.</div>
              )}
              {comments.map((c, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] shrink-0" style={{ background: c.c }}>{c.n.split(" ").map((x: string) => x[0]).join("")}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[13px] text-white">{c.n}</span>
                      <span className="text-[10px] text-[#5B6675]">{c.r} · {c.t}</span>
                    </div>
                    <div className="text-[12px] text-[#8A95A5] mt-1 leading-relaxed">{c.m}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-[#222A35] flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Reply, @mention, or paste a link..."
                className="flex-1 h-10 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
              />
              <button onClick={submit} className="h-10 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px]">Send</button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-4 font-display">Approval Progress</div>
            {/* The real approval pipeline, positioned by this order's actual
                status, with who moved it there taken from the activity trail.
                This used to be five hardcoded people ("Sarah Patel",
                "K. Ahmadi (Owner)"…) with invented states — presented as if it
                were this change order's genuine approval history. */}
            <div className="space-y-3">
              {STAGES.map((stage) => {
                const idx = STAGES.findIndex((x) => x.key === stage.key);
                const done = idx < currentStageIndex || row?.status === "approved";
                const active = idx === currentStageIndex;
                const colour = row?.status === "rejected" && active ? "#EF4444" : done ? "#22C55E" : active ? "#FF6B1A" : "#5B6675";
                // Who last moved it into this stage, if anyone did.
                const by = activity.find((a) => a.type === "status" && a.toStatus === stage.key);
                return (
                  <div key={stage.key} className="w-full text-left flex items-center gap-3 -mx-2 px-2 py-1 rounded">
                    <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: colour }}>
                      {done ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: colour }} /> : <Clock className="w-3.5 h-3.5" style={{ color: colour }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-white truncate">{stage.label}</div>
                      <div className="text-[10px] text-[#5B6675] truncate">
                        {by ? `${by.userName || "Someone"} · ${relTime(by.createdAt)}` : done ? "Completed" : active ? "In progress" : "Not started"}
                      </div>
                    </div>
                    <span className="text-[10px]" style={{ color: colour }}>
                      {done ? "Done" : active ? (row?.status === "rejected" ? "Rejected" : "Current") : "Waiting"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-4 font-display">Audit Trail</div>
            <div className="relative">
              <div className="absolute left-3 top-1 bottom-1 w-px bg-[#222A35]" />
              <div className="space-y-4">
                {timeline.length === 0 && (
                  <div className="text-[11.5px] text-[#5B6675]">No activity recorded yet.</div>
                )}
                {timeline.map((t, i) => (
                  <div key={i} className="relative pl-9">
                    <div className="absolute left-0 top-0 w-6 h-6 rounded-full border-2 border-[#11161D] flex items-center justify-center" style={{ background: `${t.c}25` }}>
                      <t.icon className="w-3 h-3" style={{ color: t.c }} />
                    </div>
                    <div className="text-[12px] text-white">{t.who} <span className="text-[#5B6675]">· {t.role}</span></div>
                    <div className="text-[11px] text-[#8A95A5] mt-0.5">{t.action}</div>
                    <div className="text-[10px] text-[#5B6675] mt-0.5">{t.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Only the references this change order actually records. The four
              entries here (RFI-284, Drawing M-401, Submittal 15-700, PCO-58) were
              hardcoded and identical on every change order. */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-3 font-display">Linked Items</div>
            <div className="space-y-2 text-[12px]">
              {row?.rfi ? (
                <div className="w-full text-left flex items-center gap-2 p-2 rounded">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] uppercase tracking-wider shrink-0">RFI</span>
                  <span className="text-white truncate">{row.rfi}</span>
                </div>
              ) : (
                <div className="text-[11.5px] text-[#5B6675]">Nothing linked to this change order yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
