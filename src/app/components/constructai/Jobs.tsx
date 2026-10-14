// ============================================================================
// Jobs board — work opportunities posted by Buildsasa, open to every company on
// the platform. A company reads the job, places one bid (amount, timeline, a
// note and supporting files) and can edit or withdraw it until it is reviewed.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Briefcase, MapPin, CalendarClock, Wallet, Paperclip, Search, X, Loader2, Send, CheckCircle2, Clock, Trophy, XCircle, FileText, Trash2 , ExternalLink } from "lucide-react";
import api, { absoluteFileUrl, type JobDto, type FileRef } from "../../services/api";
import { useFileUpload, pickFiles } from "./useFileUpload";
import { UploadTray } from "./UploadTray";
import { formatCurrency } from "./currency";

const kes = (n?: number | null) => (n == null ? "—" : formatCurrency(Math.round(n), "KES"));
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const daysLeft = (d?: string | null) => {
  if (!d) return null;
  const ms = new Date(d + "T23:59:59").getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};
const BID_META = {
  submitted: { label: "Bid submitted", color: "#3B82F6", icon: Clock },
  shortlisted: { label: "Shortlisted", color: "#A855F7", icon: CheckCircle2 },
  awarded: { label: "You won this job", color: "#22C55E", icon: Trophy },
  rejected: { label: "Not selected", color: "#8A95A5", icon: XCircle },
} as const;

export function Jobs() {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [tab, setTab] = useState<"open" | "mine">("open");
  const [open, setOpen] = useState<JobDto | null>(null);

  const load = () => api.getJobs().then(setJobs).catch((e) => toast.error(e.message || "Could not load jobs")).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => ["All", ...new Set(jobs.map((j) => j.category))], [jobs]);
  const list = jobs.filter((j) => {
    if (tab === "mine" ? !j.myBid : !j.acceptingBids) return false;
    if (category !== "All" && j.category !== category) return false;
    if (q && !`${j.title} ${j.description} ${j.location || ""} ${j.category}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const mineCount = jobs.filter((j) => j.myBid).length;

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><Briefcase className="w-4 h-4 text-[#FF6B1A]" /> Jobs board</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Work opportunities shared by Buildsasa. Bid on the ones that fit your company.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs…" className="w-[180px] sm:w-[240px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="inline-flex gap-1 p-1 rounded-lg border border-[#222A35] bg-[#11161D]">
        {([["open", "Open jobs"], ["mine", `My bids${mineCount ? ` (${mineCount})` : ""}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`h-8 px-3.5 rounded-md text-[12px] ${tab === k ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5] hover:text-white"}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#222A35] bg-[#11161D] p-8 text-center">
          <Briefcase className="w-8 h-8 text-[#FF6B1A] mx-auto" />
          <div className="text-[14px] text-white font-display mt-3">{tab === "mine" ? "You haven't bid on any jobs yet" : "No open jobs right now"}</div>
          <p className="text-[12px] text-[#8A95A5] mt-1.5 max-w-md mx-auto">{tab === "mine" ? "Open a job and place a bid. You'll follow its progress here." : "New opportunities are posted regularly. Check back soon."}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((j) => {
            const left = daysLeft(j.deadline);
            const meta = j.myBid ? BID_META[j.myBid.status] : null;
            return (
              <button key={j.id} onClick={() => setOpen(j)} className="text-left rounded-xl border border-[#222A35] bg-[#11161D] p-4 hover:border-[#FF6B1A]/50 transition flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex flex-wrap gap-1"><span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FF6B1A]/10 text-[#FF6B1A]">{j.category}</span>{j.forYou && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#22C55E]/10 text-[#22C55E]" title="The client chose your company for this job">Sent to you</span>}{j.externalUrl && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] inline-flex items-center gap-1" title={`Apply on ${j.externalSource || "the original site"}`}><ExternalLink className="w-2.5 h-2.5" />External</span>}</span>
                  {meta ? <span className="text-[10.5px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: meta.color + "20", color: meta.color }}><meta.icon className="w-3 h-3" />{meta.label}</span>
                    : !j.acceptingBids ? <span className="text-[10.5px] text-[#8A95A5]">Closed</span> : null}
                </div>
                <div className="text-[14px] text-white font-display leading-snug">{j.title}</div>
                <div className="text-[12px] text-[#8A95A5] line-clamp-2">{j.description}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#C2CAD6] mt-auto pt-1">
                  {j.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#5B6675]" />{j.location}</span>}
                  {j.budgetKES != null && <span className="flex items-center gap-1"><Wallet className="w-3 h-3 text-[#5B6675]" />Budget {kes(j.budgetKES)}</span>}
                  {j.deadline && <span className={`flex items-center gap-1 ${left != null && left <= 3 && j.acceptingBids ? "text-[#F59E0B]" : ""}`}><CalendarClock className="w-3 h-3 text-[#5B6675]" />{j.acceptingBids && left != null ? (left <= 0 ? "Closes today" : `${left} day${left === 1 ? "" : "s"} left`) : `Closed ${day(j.deadline)}`}</span>}
                  {j.attachments.length > 0 && <span className="flex items-center gap-1"><Paperclip className="w-3 h-3 text-[#5B6675]" />{j.attachments.length}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && <JobDetail job={open} onClose={() => setOpen(null)} onChanged={() => { load(); setOpen(null); }} />}
    </div>
  );
}

function JobDetail({ job, onClose, onChanged }: { job: JobDto; onClose: () => void; onChanged: () => void }) {
  const me = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null"); } catch { return null; } })();
  const bid = job.myBid;
  const editable = job.acceptingBids && (!bid || bid.status === "submitted");
  const [bidding, setBidding] = useState(false);
  const [f, setF] = useState({
    amount: bid ? String(bid.amountKES) : "", timeline: bid?.timelineDays ? String(bid.timelineDays) : "",
    contactName: bid?.contactName || me?.name || "", phone: bid?.phone || "", email: bid?.email || me?.email || "", message: bid?.message || "",
  });
  const [files, setFiles] = useState<FileRef[]>(bid?.attachments || []);
  const [busy, setBusy] = useState(false);
  const uploader = useFileUpload();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";

  const addFiles = async () => {
    const picked = await pickFiles({ multiple: true, accept: ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" });
    if (!picked.length) return;
    const urls = await uploader.upload(picked);
    setFiles((x) => [...x, ...urls.map((url, i) => ({ url, name: picked[i]?.name || "File" }))]);
  };

  const submit = async () => {
    if (!Number(f.amount)) return toast.error("Enter your bid amount in KES");
    if (uploader.busy) return toast.error("Wait for the files to finish uploading");
    setBusy(true);
    try {
      await api.bidOnJob(job.id, { amountKES: Number(f.amount), timelineDays: f.timeline ? Number(f.timeline) : null, contactName: f.contactName, phone: f.phone, email: f.email, message: f.message, attachments: files });
      toast.success(bid ? "Bid updated" : "Bid submitted. You'll be contacted if you're shortlisted.");
      onChanged();
    } catch (e: any) { toast.error(e.message || "Could not submit your bid"); }
    finally { setBusy(false); }
  };
  const withdraw = async () => {
    if (!window.confirm("Withdraw your bid on this job?")) return;
    try { await api.withdrawJobBid(job.id); toast.success("Bid withdrawn"); onChanged(); }
    catch (e: any) { toast.error(e.message || "Could not withdraw"); }
  };

  const meta = bid ? BID_META[bid.status] : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-2xl max-h-[94vh] flex flex-col rounded-t-2xl sm:rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#FF6B1A]">{job.category}</div>
            <div className="text-[16px] text-white font-display leading-snug mt-0.5">{job.title}</div>
          </div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Info label="Location" value={job.location || "—"} />
            <Info label="Budget" value={job.budgetKES != null ? kes(job.budgetKES) : "Open"} />
            <Info label="Bids close" value={job.deadline ? day(job.deadline) : "Open"} />
            <Info label="For" value={job.clientName || "Buildsasa client"} />
          </div>
          <div className="text-[12.5px] text-[#D5DBE3] whitespace-pre-wrap leading-relaxed">{job.description}</div>
          {job.attachments.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-[#8A95A5]">Documents</div>
              {job.attachments.map((a) => <a key={a.url} href={absoluteFileUrl(a.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[12px] text-white hover:underline"><FileText className="w-3.5 h-3.5 text-[#FF6B1A]" />{a.name}</a>)}
            </div>
          )}

          {job.externalUrl && (
            <div className="rounded-lg border border-[#3B82F6]/40 bg-[#3B82F6]/10 p-4 space-y-2">
              <div className="text-[12.5px] text-white">Apply on the original site</div>
              <p className="text-[12px] text-[#C2CAD6]">Buildsasa shared this job from {job.externalSource || "another site"}. Applications go there, not through Buildsasa. Read the requirements and deadline on that page.</p>
              <a href={job.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px]">Open {job.externalSource || "the job post"} <ExternalLink className="w-3.5 h-3.5" /></a>
              <div className="text-[10.5px] text-[#5B6675] break-all">{job.externalUrl}</div>
            </div>
          )}

          {meta && !bidding && (
            <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: meta.color + "55", background: meta.color + "12" }}>
              <div className="text-[12.5px] flex items-center gap-1.5" style={{ color: meta.color }}><meta.icon className="w-4 h-4" />{meta.label}</div>
              <div className="text-[12px] text-[#C2CAD6]">Your bid: <b className="text-white">{kes(bid!.amountKES)}</b>{bid!.timelineDays ? ` · ${bid!.timelineDays} days` : ""} · sent {day(bid!.updatedAt)}</div>
            </div>
          )}

          {!job.externalUrl && editable && (bidding || !bid) && (
            <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-4 space-y-3">
              <div className="text-[12.5px] text-white">{bid ? "Edit your bid" : "Place your bid"}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[11px] text-[#8A95A5] mb-1">Your price (KES) *</div><input type="number" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="e.g. 2500000" className={input} /></div>
                <div><div className="text-[11px] text-[#8A95A5] mb-1">Time to complete (days)</div><input type="number" value={f.timeline} onChange={set("timeline")} placeholder="e.g. 60" className={input} /></div>
                <div><div className="text-[11px] text-[#8A95A5] mb-1">Contact person</div><input placeholder="e.g. John Kamau" value={f.contactName} onChange={set("contactName")} className={input} /></div>
                <div><div className="text-[11px] text-[#8A95A5] mb-1">Phone</div><input type="tel" value={f.phone} onChange={set("phone")} placeholder="e.g. 0712 345 678" className={input} /></div>
              </div>
              <div><div className="text-[11px] text-[#8A95A5] mb-1">Why your company? (experience, similar jobs, team)</div><textarea placeholder="e.g. We have done 8 similar builds in Kajiado and can start next month." value={f.message} onChange={set("message")} rows={4} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div>
                <div className="text-[11px] text-[#8A95A5] mb-1">Supporting documents (quote, company profile, certificates)</div>
                <div className="space-y-1">
                  {files.map((x) => (
                    <div key={x.url} className="flex items-center gap-2 text-[12px] text-white"><FileText className="w-3.5 h-3.5 text-[#FF6B1A]" /><span className="truncate flex-1">{x.name}</span><button onClick={() => setFiles((l) => l.filter((y) => y.url !== x.url))} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></div>
                  ))}
                </div>
                <button onClick={addFiles} className="mt-1.5 h-8 px-3 rounded-md border border-dashed border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" /> Add files (you can select several)</button>
                {uploader.pending.length > 0 && <div className="mt-2"><UploadTray state={uploader} /></div>}
              </div>
              <div className="flex justify-end gap-2">
                {bid && <button onClick={() => setBidding(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6]">Cancel</button>}
                <button onClick={submit} disabled={busy || uploader.busy} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[12px] flex items-center gap-1.5">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{bid ? "Update bid" : "Submit bid"}</button>
              </div>
            </div>
          )}

          {bid && editable && !bidding && (
            <div className="flex gap-2">
              <button onClick={() => setBidding(true)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-white">Edit bid</button>
              <button onClick={withdraw} className="h-9 px-3 rounded-md border border-[#EF4444]/40 text-[12px] text-[#EF4444]">Withdraw</button>
            </div>
          )}
          {!job.externalUrl && !job.acceptingBids && !bid && <div className="text-[12px] text-[#8A95A5]">Bids for this job have closed.</div>}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-2.5 py-2"><div className="text-[10px] uppercase tracking-wider text-[#5B6675]">{label}</div><div className="text-[12px] text-white truncate mt-0.5">{value}</div></div>;
}
