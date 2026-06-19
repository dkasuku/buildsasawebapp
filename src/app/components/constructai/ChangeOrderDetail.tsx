import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Paperclip, MessageSquare, CheckCircle2, FileCheck2, Clock, AlertTriangle, Mic, Download, MoreHorizontal, ChevronRight, Sparkles, ThumbsUp, ImageIcon } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";

const timeline = [
  { who: "Sarah Patel", role: "Field Supervisor", action: "Created from voice memo", time: "2d ago", c: "#FF6B1A", icon: Mic },
  { who: "Tomás Nguyen", role: "Project Manager", action: "Updated scope and cost", time: "1d ago", c: "#3B82F6", icon: FileCheck2 },
  { who: "Jane Cho", role: "Project Executive", action: "Approved internally", time: "16h ago", c: "#22C55E", icon: CheckCircle2 },
  { who: "ConstructAI", role: "System", action: "Detected schedule impact", time: "12h ago", c: "#F5A623", icon: AlertTriangle },
  { who: "Marcus Rivera", role: "VP Operations", action: "Commented on variance", time: "2h ago", c: "#8B5CF6", icon: MessageSquare },
];

const $toKES = (dollars: number) => Math.round(dollars * 130);

const CHANGE_ORDERS: Record<string, {
  id: string;
  project: string;
  area: string;
  title: string;
  status: "Owner Approval" | "PM Review" | "Approved" | "Drafted";
  costKES: number;
  schedule: string;
  trigger: string;
  rfi: string;
  submitted: string;
  pending: string;
}> = {
  "CO-1258": {
    id: "CO-1258",
    project: "Midtown Medical",
    area: "Level 14 — Mechanical",
    title: "Additional VAV boxes — east wing reconfiguration",
    status: "Owner Approval",
    costKES: $toKES(284000),
    schedule: "+4 days",
    trigger: "Design clarification",
    rfi: "RFI #284",
    submitted: "May 16, 2026",
    pending: "Pending 6 days",
  },
  "CO-1284": {
    id: "CO-1284",
    project: "Harborfront Tower",
    area: "Curtain Wall — East",
    title: "Curtain wall reinforcement",
    status: "PM Review",
    costKES: $toKES(24500),
    schedule: "+1 day",
    trigger: "Structural review",
    rfi: "RFI #301",
    submitted: "May 20, 2026",
    pending: "Pending 2 days",
  },
  "CO-1252": {
    id: "CO-1252",
    project: "Harborfront Tower",
    area: "Level 12 — Electrical",
    title: "Owner-approved electrical reroute",
    status: "Approved",
    costKES: $toKES(86500),
    schedule: "+0 days",
    trigger: "Owner request",
    rfi: "RFI #277",
    submitted: "May 12, 2026",
    pending: "Approved",
  },
};

const STATUS_STYLES: Record<string, string> = {
  "Owner Approval": "bg-[#FF6B1A]/15 text-[#FF6B1A] border-[#FF6B1A]/30",
  "PM Review": "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30",
  Approved: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30",
  Drafted: "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]",
};

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
  const changeOrder = CHANGE_ORDERS[changeOrderId] ?? CHANGE_ORDERS["CO-1258"];
  const displayStatus = statusOverride ?? changeOrder.status;
  const CO_AMOUNT = changeOrder.costKES;
  const canApprove = perms.approveAny && CO_AMOUNT <= perms.approveLimit;
  const approveLimitLabel = perms.approveLimit === Infinity
    ? "∞"
    : formatCurrency($toKES(perms.approveLimit), currency);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState([
    { n: "Marcus Rivera", r: "VP Operations", t: "2h ago", c: "#8B5CF6", m: "I'm OK with the cost but we need to push back on the 4-day schedule slip. Can we expedite freight further?" },
    { n: "Tomás Nguyen", r: "Project Manager", t: "1h ago", c: "#3B82F6", m: "Already in motion — air freight option lands tomorrow morning." },
  ]);

  const submit = () => {
    if (!comment.trim()) return toast.error("Comment is empty");
    setComments([...comments, { n: "You", r: "VP Operations", t: "now", c: "#FF6B1A", m: comment }]);
    setComment("");
    toast.success("Comment posted");
  };

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
                  <span className="px-2.5 py-1 rounded-full text-[10px] bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 uppercase tracking-wider">Schedule Impact</span>
                  <span className="px-2.5 py-1 rounded-full text-[10px] bg-[#222A35] text-[#8A95A5] uppercase tracking-wider">Rev 3</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toast.success("PDF download started")} className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-4 h-4" /></button>
                <button onClick={() => toast("More options")} className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><MoreHorizontal className="w-4 h-4" /></button>
                <button
                  onClick={() => canApprove ? toast.success(`${changeOrder.id} approved · owner notified`) : toast.error(`${role} cannot approve this amount (limit ${approveLimitLabel})`)}
                  className={`h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 ${canApprove ? "bg-[#FF6B1A] hover:bg-[#FF7E33] text-white" : "bg-[#222A35] text-[#5B6675] cursor-not-allowed"}`}
                ><CheckCircle2 className="w-4 h-4" /> Approve</button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#222A35]">
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Cost Impact</div>
                <div className="text-[18px] sm:text-[20px] text-[#FF6B1A] mt-1 font-display">+{formatCurrency(changeOrder.costKES, currency)}</div>
                <div className="text-[10px] text-[#8A95A5]">2.1% of contract</div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Schedule Impact</div>
                <div className="text-[18px] sm:text-[20px] text-white mt-1 font-display">{changeOrder.schedule}</div>
                <div className="text-[10px] text-[#8A95A5]">Critical path</div>
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
            <div className="flex items-center gap-2 text-[11px] text-[#FF6B1A] uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5" /> AI Summary · 3 voice notes & 12 photos
            </div>
            <p className="text-[13px] text-white leading-relaxed">
              Owner-requested HVAC capacity increase on Level 14 east wing drove the need for <span className="text-[#FF6B1A]">8 additional VAV boxes</span>, supplementary ductwork, and rerouting. 18-day material lead time impacts critical path by 4 days. Cost includes equipment ($186k), labor (412 hrs), and accelerated freight ($14k).
            </p>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#FF6B1A]/20">
              <button onClick={() => toast.success("Feedback recorded")} className="text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> Looks right</button>
              <button onClick={() => toast("Regenerating draft...")} className="text-[11px] text-[#8A95A5] hover:text-white">Regenerate</button>
              <button onClick={() => toast("Sources opened")} className="text-[11px] text-[#8A95A5] hover:text-white">View sources</button>
            </div>
          </div>

          {perms.financials && (
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] text-white font-display">Budget Impact</div>
              <button onClick={() => toast("Spreadsheet export started")} className="text-[11px] text-[#FF6B1A] hover:underline">Open in sheet</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                    <th className="text-left py-2">Code</th>
                    <th className="text-left py-2">Item</th>
                    <th className="text-right py-2">Original</th>
                    <th className="text-right py-2">Revised</th>
                    <th className="text-right py-2">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { c: "15-700", i: "VAV Terminal Units (8 ea.)", o: "$0", r: "$186,400", d: "+$186,400" },
                    { c: "15-820", i: "Branch ductwork & insulation", o: "$42,000", r: "$58,200", d: "+$16,200" },
                    { c: "01-720", i: "Field labor (412 hrs)", o: "$0", r: "$67,400", d: "+$67,400" },
                    { c: "01-450", i: "Accelerated freight", o: "$0", r: "$14,000", d: "+$14,000" },
                  ].map((r) => (
                    <tr key={r.c} className="border-b border-[#222A35]/60">
                      <td className="py-2.5 font-mono text-[#8A95A5] text-[11px]">{r.c}</td>
                      <td className="py-2.5 text-white">{r.i}</td>
                      <td className="py-2.5 text-right text-[#8A95A5]">{r.o}</td>
                      <td className="py-2.5 text-right text-white">{r.r}</td>
                      <td className="py-2.5 text-right text-[#FF6B1A]">{r.d}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="py-3 text-right text-[#8A95A5]">Net Impact</td>
                    <td className="py-3 text-right text-[#FF6B1A] text-[15px] font-display">+$284,000</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] text-white flex items-center gap-2 font-display"><Paperclip className="w-4 h-4 text-[#8A95A5]" /> Attachments · 14</div>
              <button onClick={() => toast("Upload attachment")} className="text-[11px] text-[#FF6B1A] hover:underline">Add</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&q=80",
                "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=400&q=80",
                "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&q=80",
                "https://images.unsplash.com/photo-1531834685032-c34bf0d84c77?w=400&q=80",
              ].map((src, i) => (
                <button key={i} onClick={() => toast(`Attachment ${i + 1} opened`)} className="relative aspect-square rounded-lg overflow-hidden border border-[#222A35] group">
                  <ImageWithFallback src={src} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition" />
                  <div className="absolute top-2 right-2 w-6 h-6 rounded bg-black/40 backdrop-blur flex items-center justify-center"><ImageIcon className="w-3 h-3 text-white" /></div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-4 font-display">Discussion · {comments.length}</div>
            <div className="space-y-4">
              {comments.map((c, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] shrink-0" style={{ background: c.c }}>{c.n.split(" ").map(x => x[0]).join("")}</div>
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
            <div className="text-[13px] text-white mb-4 font-display">Approval Chain</div>
            <div className="space-y-3">
              {[
                { n: "Sarah Patel", r: "Field Supervisor", s: "Submitted", c: "#22C55E" },
                { n: "Tomás Nguyen", r: "Project Manager", s: "Approved", c: "#22C55E" },
                { n: "Jane Cho", r: "Project Executive", s: "Approved", c: "#22C55E" },
                { n: "K. Ahmadi (Owner)", r: "Owner Rep", s: "Pending · 6d", c: "#FF6B1A" },
                { n: "Architect of Record", r: "Required if design change", s: "Waiting", c: "#5B6675" },
              ].map((p, i) => (
                <button key={i} onClick={() => toast(p.n + " · " + p.s)} className="w-full text-left flex items-center gap-3 hover:bg-[#161C24] -mx-2 px-2 py-1 rounded">
                  <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: p.c }}>
                    {p.s.startsWith("Approved") || p.s === "Submitted" ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: p.c }} /> : <Clock className="w-3.5 h-3.5" style={{ color: p.c }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-white truncate">{p.n}</div>
                    <div className="text-[10px] text-[#5B6675] truncate">{p.r}</div>
                  </div>
                  <span className="text-[10px]" style={{ color: p.c }}>{p.s}</span>
                </button>
              ))}
            </div>
            {role !== "Owner" && (
              <button onClick={() => toast.success("Owner nudged via email + SMS")} className="mt-4 w-full h-9 rounded-md bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF6B1A] text-[12px] hover:bg-[#FF6B1A]/25">Nudge owner</button>
            )}
          </div>

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-4 font-display">Audit Trail</div>
            <div className="relative">
              <div className="absolute left-3 top-1 bottom-1 w-px bg-[#222A35]" />
              <div className="space-y-4">
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

          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[13px] text-white mb-3 font-display">Linked Items</div>
            <div className="space-y-2 text-[12px]">
              {[
                { l: "RFI-284 — HVAC zoning", c: "RFI" },
                { l: "Drawing M-401 Rev 4", c: "DWG" },
                { l: "Submittal 15-700 VAV", c: "SUB" },
                { l: "PCO-58 — cost estimate", c: "PCO" },
              ].map((l) => (
                <button key={l.l} onClick={() => toast(`Opening ${l.l}`)} className="w-full text-left flex items-center gap-2 p-2 rounded hover:bg-[#161C24]">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] uppercase tracking-wider shrink-0">{l.c}</span>
                  <span className="text-white truncate">{l.l}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
