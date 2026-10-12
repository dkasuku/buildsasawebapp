// ============================================================================
// PublicPortalView — the client's view of their project, reached through a
// private link (/?portal=TOKEN) with no account. They follow progress, see site
// photos, the timeline and their invoices, and approve or reject change orders
// waiting on them. Always light and plain: the reader is a homeowner on a phone.
// ============================================================================

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X, Camera, CalendarDays, Receipt, ClipboardCheck, Home } from "lucide-react";
import api, { absoluteFileUrl, type PortalDto } from "../../services/api";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const day = (d?: string | null) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(d); }
};
const C = { ink: "#1B1F24", soft: "#5B6675", faint: "#8A95A5", line: "#E6E9EE", brand: "#F45B1E", navy: "#0B2A4A", green: "#16A34A", red: "#DC2626" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };

type Tab = "overview" | "approvals" | "photos" | "timeline" | "invoices";

export function PublicPortalView({ token }: { token: string }) {
  const [data, setData] = useState<PortalDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = () => api.getPortal(token)
    .then((d) => { setData(d); setState("ready"); })
    .catch((e) => { setError(e?.message || "This project link is not available."); setState("error"); });
  useEffect(() => { load(); }, [token]);

  const Shell = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "#F4F6FA", color: C.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ background: C.navy }}>
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden"><img src="/Buildsasa.png" alt="" className="w-full h-full object-cover" /></div>
          <div className="text-[14px] text-white font-semibold truncate">{data?.companyName || "Project portal"}</div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-5">{children}</div>
      <div className="text-center text-[11px] pb-8" style={{ color: C.faint }}>
        Project portal by <a href="https://buildsasa.com" target="_blank" rel="noopener noreferrer" style={{ color: C.brand }}>Buildsasa</a>
      </div>
    </div>
  );

  if (state === "loading") return Shell(<div className="flex items-center justify-center gap-2 py-20 text-[13px]" style={{ color: C.soft }}><Loader2 className="w-4 h-4 animate-spin" /> Loading your project…</div>);
  if (state === "error" || !data) return Shell(
    <div className="text-center py-20">
      <AlertTriangle className="w-10 h-10 mx-auto" style={{ color: C.red }} />
      <div className="text-[16px] font-semibold mt-3">Link not available</div>
      <p className="text-[13px] mt-1.5" style={{ color: C.soft }}>{error}</p>
    </div>,
  );

  const { project, schedule, photos, changeOrders, invoices } = data;
  const pending = changeOrders.filter((c) => c.status === "owner_approval");
  const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const paid = invoices.reduce((s, i) => s + i.paidAmount, 0);
  const progress = Math.max(0, Math.min(100, project.progress || 0));
  const cover = project.images[0] ? absoluteFileUrl(project.images[0]) : photos[0]?.photos[0] ? absoluteFileUrl(photos[0].photos[0]) : null;

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: "overview", label: "Overview", icon: Home },
    { key: "approvals", label: "Approvals", icon: ClipboardCheck, badge: pending.length },
    { key: "photos", label: "Photos", icon: Camera },
    { key: "timeline", label: "Timeline", icon: CalendarDays },
    { key: "invoices", label: "Invoices", icon: Receipt },
  ];

  return Shell(
    <div className="space-y-4">
      {/* Hero */}
      <div style={card} className="overflow-hidden">
        {cover && <img src={cover} alt="" className="w-full object-cover" style={{ height: 180 }} />}
        <div className="p-5">
          <div className="text-[11px] uppercase tracking-wider" style={{ color: C.brand }}>Your project</div>
          <div className="text-[21px] font-semibold leading-tight mt-1">{project.name}</div>
          <div className="text-[13px] mt-1" style={{ color: C.soft }}>{[project.city !== "—" ? project.city : "", project.status].filter(Boolean).join(" · ")}</div>
          <div className="mt-4">
            <div className="flex justify-between text-[13px] mb-1.5"><span style={{ color: C.soft }}>Progress</span><strong>{progress}%</strong></div>
            <div style={{ height: 10, background: "#EEF0F3", borderRadius: 99 }}><div style={{ width: `${progress}%`, height: 10, background: C.brand, borderRadius: 99 }} /></div>
          </div>
          {(project.startDate || project.targetEndDate) && (
            <div className="flex gap-6 mt-4 text-[12.5px]">
              {project.startDate && <div><div style={{ color: C.faint }}>Started</div><div className="font-medium">{day(project.startDate)}</div></div>}
              {project.practicalCompletionAt
                ? <div><div style={{ color: C.faint }}>Handed over</div><div className="font-medium">{day(project.practicalCompletionAt)}</div></div>
                : project.targetEndDate && <div><div style={{ color: C.faint }}>Target finish</div><div className="font-medium">{day(project.targetEndDate)}</div></div>}
            </div>
          )}
        </div>
      </div>

      {pending.length > 0 && tab !== "approvals" && (
        <button onClick={() => setTab("approvals")} className="w-full text-left p-4 flex items-center gap-3" style={{ ...card, background: "#FFF7ED", borderColor: "#FED7AA" }}>
          <ClipboardCheck className="w-5 h-5 shrink-0" style={{ color: C.brand }} />
          <div className="text-[13.5px] flex-1"><strong>{pending.length} change {pending.length === 1 ? "order needs" : "orders need"} your approval.</strong> Tap to review.</div>
        </button>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto p-1" style={{ ...card, borderRadius: 12 }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5 px-3 rounded-lg text-[13px] whitespace-nowrap shrink-0" style={{ height: 38, background: tab === t.key ? C.navy : "transparent", color: tab === t.key ? "#fff" : C.soft }}>
            <t.icon className="w-4 h-4" />{t.label}
            {t.badge ? <span className="text-[10px] font-bold rounded-full px-1.5" style={{ background: C.brand, color: "#fff" }}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Waiting for you" value={String(pending.length)} tone={pending.length ? C.brand : undefined} onClick={() => setTab("approvals")} />
            <Stat label="Site photos" value={String(photos.reduce((s, l) => s + l.photos.length, 0))} onClick={() => setTab("photos")} />
            <Stat label="Invoiced" value={kes(invoiced)} onClick={() => setTab("invoices")} />
            <Stat label="Balance due" value={kes(invoiced - paid)} tone={invoiced - paid > 0 ? C.ink : C.green} onClick={() => setTab("invoices")} />
          </div>
          {project.description && <div className="p-5 text-[13.5px] whitespace-pre-wrap" style={{ ...card, color: "#374151" }}>{project.description}</div>}
          {photos[0] && (
            <div className="p-5" style={card}>
              <div className="flex justify-between items-baseline"><div className="font-semibold text-[14px]">Latest from site</div><div className="text-[12px]" style={{ color: C.faint }}>{day(photos[0].date)}</div></div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {photos[0].photos.slice(0, 6).map((u, i) => <button key={i} onClick={() => setLightbox(absoluteFileUrl(u))}><img src={absoluteFileUrl(u)} alt="" className="w-full object-cover rounded-lg" style={{ aspectRatio: "1" }} /></button>)}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "approvals" && (
        <div className="space-y-3">
          {changeOrders.length === 0 && <Empty text="Nothing needs your approval right now. When the team prices a change to the work, it will appear here for you to approve." />}
          {changeOrders.map((c) => <ChangeOrderCard key={c.id} co={c} token={token} onDone={load} />)}
        </div>
      )}

      {tab === "photos" && (
        <div className="space-y-3">
          {photos.length === 0 && <Empty text="No site photos yet. Photos the team takes on site will appear here." />}
          {photos.map((l, i) => (
            <div key={i} className="p-4" style={card}>
              <div className="flex justify-between items-baseline gap-2"><div className="font-semibold text-[13.5px]">{day(l.date)}</div><div className="text-[12px] truncate" style={{ color: C.faint }}>{l.location}</div></div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {l.photos.map((u, j) => <button key={j} onClick={() => setLightbox(absoluteFileUrl(u))}><img src={absoluteFileUrl(u)} alt="" loading="lazy" className="w-full object-cover rounded-lg" style={{ aspectRatio: "1" }} /></button>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "timeline" && (
        <div style={card} className="overflow-hidden">
          {schedule.length === 0 && <div className="p-5"><Empty text="The timeline hasn't been shared yet." bare /></div>}
          {schedule.map((s, i) => {
            const done = s.status === "done" || s.percent >= 100;
            const pct = done ? 100 : Math.max(0, Math.min(100, s.percent || 0));
            return (
              <div key={i} className="px-5 py-3.5 flex gap-3" style={{ borderTop: i ? `1px solid ${C.line}` : undefined }}>
                <div className="pt-0.5">{done ? <Check className="w-4 h-4" style={{ color: C.green }} /> : <div className="w-4 h-4 rounded-full" style={{ border: `2px solid ${s.status === "in_progress" ? C.brand : "#CBD2DB"}` }} />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2"><div className="text-[13.5px]" style={{ fontWeight: s.type === "milestone" || s.type === "phase" ? 600 : 400 }}>{s.name}</div><div className="text-[12px] shrink-0" style={{ color: C.faint }}>{pct}%</div></div>
                  <div className="text-[12px] mt-0.5" style={{ color: C.faint }}>{s.type === "milestone" ? day(s.endDate) : `${day(s.startDate)} – ${day(s.endDate)}`}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-3">
          {invoices.length === 0 && <Empty text="No invoices yet." />}
          {invoices.map((inv) => {
            const balance = inv.amount - inv.paidAmount;
            const isPaid = inv.status === "paid" || balance <= 0;
            return (
              <div key={inv.invoiceNumber} className="p-4" style={card}>
                <div className="flex justify-between items-start gap-2">
                  <div><div className="font-semibold text-[14px]">{inv.invoiceNumber}</div><div className="text-[12px] mt-0.5" style={{ color: C.faint }}>Issued {day(inv.issueDate)}{!isPaid && inv.dueDate ? ` · due ${day(inv.dueDate)}` : ""}</div></div>
                  <span className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={isPaid ? { background: "#ECFDF3", color: C.green } : inv.status === "overdue" ? { background: "#FEF2F2", color: C.red } : { background: "#EFF6FF", color: "#2563EB" }}>{isPaid ? "Paid" : inv.status === "overdue" ? "Overdue" : "Due"}</span>
                </div>
                {inv.items.length > 0 && <div className="mt-2 text-[12.5px]" style={{ color: C.soft }}>{inv.items.map((it) => it.description).filter(Boolean).join(" · ")}</div>}
                <div className="flex justify-between mt-3 text-[13px]"><span style={{ color: C.soft }}>Amount</span><span className="font-semibold">{kes(inv.amount)}</span></div>
                {inv.paidAmount > 0 && <div className="flex justify-between text-[13px]"><span style={{ color: C.soft }}>Paid</span><span>{kes(inv.paidAmount)}</span></div>}
                {!isPaid && <div className="flex justify-between text-[13px] font-semibold"><span>Balance</span><span>{kes(balance)}</span></div>}
              </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.88)", zIndex: 50 }} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg" />
          <button className="absolute top-4 right-4 text-white" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
      )}
    </div>,
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="p-4 text-left" style={card}>
      <div className="text-[11.5px]" style={{ color: C.faint }}>{label}</div>
      <div className="text-[17px] font-semibold mt-1" style={{ color: tone || C.ink }}>{value}</div>
    </button>
  );
}

function Empty({ text, bare }: { text: string; bare?: boolean }) {
  return <div className={bare ? "text-[13px]" : "p-6 text-center text-[13px]"} style={bare ? { color: C.soft } : { ...card, color: C.soft }}>{text}</div>;
}

function ChangeOrderCard({ co, token, onDone }: { co: PortalDto["changeOrders"][number]; token: string; onDone: () => void }) {
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const waiting = co.status === "owner_approval";
  const input: React.CSSProperties = { border: "1px solid #D0D5DD", color: C.ink, background: "#fff" };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api.decidePortalChangeOrder(token, co.id, { decision: mode === "approve" ? "approve" : "reject", name: name.trim(), comment: comment.trim() });
      onDone();
    } catch (e: any) { setErr(e?.message || "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4" style={{ ...card, borderColor: waiting ? "#FED7AA" : C.line }}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-mono" style={{ color: C.faint }}>{co.number}</div>
          <div className="font-semibold text-[14.5px] leading-snug">{co.title}</div>
          {co.area && <div className="text-[12px]" style={{ color: C.faint }}>{co.area}</div>}
        </div>
        <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 shrink-0" style={waiting ? { background: "#FFF7ED", color: C.brand } : co.status === "approved" ? { background: "#ECFDF3", color: C.green } : { background: "#FEF2F2", color: C.red }}>
          {waiting ? "Needs your approval" : co.status === "approved" ? "Approved" : "Rejected"}
        </span>
      </div>
      {co.description && <div className="text-[13px] mt-2 whitespace-pre-wrap" style={{ color: "#374151" }}>{co.description}</div>}
      <div className="flex gap-5 mt-3 text-[13px]">
        <div><div style={{ color: C.faint }} className="text-[11.5px]">{co.amountKES < 0 ? "Credit to you" : "Extra cost"}</div><div className="font-semibold">{kes(Math.abs(co.amountKES))}</div></div>
        <div><div style={{ color: C.faint }} className="text-[11.5px]">Time impact</div><div className="font-semibold">{co.scheduleImpactDays ? `${co.scheduleImpactDays > 0 ? "+" : ""}${co.scheduleImpactDays} days` : "None"}</div></div>
      </div>

      {waiting && mode === "idle" && (
        <div className="flex gap-2 mt-4">
          <button onClick={() => setMode("approve")} className="flex-1 rounded-lg text-white text-[14px] font-semibold" style={{ background: C.green, height: 44 }}>Approve</button>
          <button onClick={() => setMode("reject")} className="flex-1 rounded-lg text-[14px]" style={{ ...input, height: 44 }}>Reject</button>
        </div>
      )}
      {waiting && mode !== "idle" && (
        <div className="space-y-2 mt-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className="w-full rounded-lg px-3 text-[16px] outline-none" style={{ ...input, height: 44 }} />
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder={mode === "approve" ? "Comment (optional)" : "Why are you rejecting it? The team will revise it."} className="w-full rounded-lg px-3 py-2 text-[15px] outline-none" style={input} />
          {mode === "approve" && <p className="text-[12px]" style={{ color: C.soft }}>By approving, you agree to this change{co.amountKES > 0 ? ` and its extra cost of ${kes(co.amountKES)}` : ""}.</p>}
          {err && <div className="text-[12.5px]" style={{ color: C.red }}>{err}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setMode("idle"); setErr(""); }} className="px-4 rounded-lg text-[14px]" style={{ ...input, height: 44 }}>Back</button>
            <button onClick={submit} disabled={busy} className="flex-1 rounded-lg text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: mode === "approve" ? C.green : C.red, height: 44 }}>
              {busy ? "Sending…" : mode === "approve" ? "Confirm approval" : "Confirm rejection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
