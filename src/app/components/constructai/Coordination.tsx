import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Briefcase, MessageSquare, Send, AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import type { Role } from "./roles";
import api from "../../services/api";
import { EmptyState } from "./EmptyState";

type Comment = { author: string; text: string; date: string };
type Issue = {
  id: string;
  title: string;
  type: "RFI" | "Clash" | "Design Question";
  status: "open" | "answered" | "closed";
  priority: "low" | "medium" | "high";
  raisedBy: string;
  assignedTo: string;
  project: string;
  date: string;
  description: string;
  comments: Comment[];
};

const mapIssue = (r: any): Issue => ({
  id: r.id, title: r.title, type: r.type, status: r.status, priority: r.priority,
  raisedBy: r.raisedBy || "", assignedTo: r.assignedTo || "", project: r.project || "",
  date: r.date || "", description: r.description || "",
  comments: (() => { try { return JSON.parse(r.comments || "[]"); } catch { return []; } })(),
});

const STATUS_META: Record<Issue["status"], { label: string; cls: string; icon: any }> = {
  open: { label: "Open", cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30", icon: AlertCircle },
  answered: { label: "Answered", cls: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30", icon: Clock3 },
  closed: { label: "Closed", cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30", icon: CheckCircle2 },
};

const TYPE_CLS: Record<Issue["type"], string> = {
  RFI: "bg-[#3B82F6]/15 text-[#3B82F6]",
  Clash: "bg-[#EF4444]/15 text-[#EF4444]",
  "Design Question": "bg-[#A855F7]/15 text-[#A855F7]",
};

export default function Coordination({ role }: { role: Role }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [detail, setDetail] = useState<Issue | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newComment, setNewComment] = useState("");

  // Load persisted issues; the API response is authoritative (including empty)
  useEffect(() => {
    (async () => {
      try { setIssues(((await api.getCoordinationIssues()) ?? []).map(mapIssue)); }
      catch { /* offline — leave list empty */ }
    })();
  }, []);

  const filtered = useMemo(() => issues.filter((i) => {
    if (filter !== "all" && i.status !== filter) return false;
    if (q && !`${i.title} ${i.id} ${i.raisedBy} ${i.assignedTo} ${i.project}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [issues, q, filter]);

  const setStatus = (id: string, status: Issue["status"]) => {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    setDetail((d) => (d && d.id === id ? { ...d, status } : d));
    toast.success(`${id} marked ${STATUS_META[status].label}`);
    api.updateCoordinationIssue(id, { status }).catch(() => { /* offline */ });
  };

  const addComment = (id: string) => {
    if (!newComment.trim()) return;
    const c: Comment = { author: "You", text: newComment.trim(), date: new Date().toISOString().slice(0, 10) };
    const existing = issues.find((i) => i.id === id)?.comments ?? [];
    const nextComments = [...existing, c];
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, comments: nextComments } : i)));
    setDetail((d) => (d && d.id === id ? { ...d, comments: nextComments } : d));
    setNewComment("");
    toast.success("Comment added");
    api.updateCoordinationIssue(id, { comments: nextComments }).catch(() => { /* offline */ });
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RFIs & issues…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <div className="flex gap-1">
          {["all", "open", "answered", "closed"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`h-9 px-3 rounded-lg text-[12px] capitalize transition ${filter === f ? "bg-[#FF6B1A] text-black font-medium" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{f}</button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Issue</button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState
            icon={Briefcase}
            title="No issues yet"
            description="Raise your first RFI, clash or design question to start coordinating with the team."
            actionLabel="New Issue"
            onAction={() => setShowNew(true)}
          />
        )}
        {filtered.map((i) => {
          const M = STATUS_META[i.status];
          return (
            <button key={i.id} onClick={() => setDetail(i)} className="w-full text-left bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#2E3947] transition">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[#5B6675]">{i.id}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_CLS[i.type]}`}>{i.type}</span>
                <span className="text-[13px] text-white flex-1">{i.title}</span>
                <span className={`text-[10px] px-2 py-1 rounded-full border ${M.cls}`}>{M.label}</span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-[#8A95A5] flex-wrap">
                <span>Raised by {i.raisedBy}</span>
                <span>→ {i.assignedTo}</span>
                <span>{i.project}</span>
                <span>{i.date}</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {i.comments.length}</span>
              </div>
            </button>
          );
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#5B6675]">{detail.id}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_CLS[detail.type]}`}>{detail.type}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META[detail.status].cls}`}>{STATUS_META[detail.status].label}</span>
                </div>
                <h3 className="text-[15px] text-white mt-1.5">{detail.title}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px] text-[#B8C0CC]">{detail.description}</p>
            <div className="grid grid-cols-2 gap-3 mt-4 text-[12px]">
              <div><div className="text-[#5B6675] text-[10px] uppercase">Raised by</div><div className="text-white">{detail.raisedBy}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Assigned to</div><div className="text-white">{detail.assignedTo}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Project</div><div className="text-white">{detail.project}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Date raised</div><div className="text-white">{detail.date}</div></div>
            </div>

            <div className="mt-5">
              <div className="text-[11px] text-[#8A95A5] uppercase tracking-wider mb-2">Discussion ({detail.comments.length})</div>
              <div className="space-y-2">
                {detail.comments.map((c, idx) => (
                  <div key={idx} className="bg-[#0A0E14] border border-[#222A35] rounded-lg p-3">
                    <div className="flex items-center justify-between text-[11px]"><span className="text-[#FF6B1A]">{c.author}</span><span className="text-[#5B6675]">{c.date}</span></div>
                    <div className="text-[12px] text-[#B8C0CC] mt-1">{c.text}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment(detail.id)} placeholder="Add a comment…" className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                <button onClick={() => addComment(detail.id)} className="h-9 px-3 bg-[#FF6B1A] text-black rounded-lg"><Send className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-5">
              {detail.status === "open" && <button onClick={() => setStatus(detail.id, "answered")} className="h-8 px-3 bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/30 rounded-lg text-[11px]">Mark Answered</button>}
              {detail.status !== "closed" && <button onClick={() => setStatus(detail.id, "closed")} className="h-8 px-3 bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 rounded-lg text-[11px]">Close Issue</button>}
              {detail.status === "closed" && <button onClick={() => setStatus(detail.id, "open")} className="h-8 px-3 bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 rounded-lg text-[11px]">Reopen</button>}
            </div>
          </div>
        </div>
      )}

      {showNew && <NewIssueModal onClose={() => setShowNew(false)} onCreate={async (i) => {
        setIssues((prev) => [i, ...prev]);
        toast.success(`${i.id} created`);
        try {
          const saved = await api.createCoordinationIssue({ title: i.title, type: i.type, status: i.status, priority: i.priority, raisedBy: i.raisedBy, assignedTo: i.assignedTo, project: i.project, date: i.date, description: i.description, comments: i.comments });
          setIssues((prev) => prev.map((x) => x.id === i.id ? mapIssue(saved) : x));
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewIssueModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: Issue) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Issue["type"]>("RFI");
  const [priority, setPriority] = useState<Issue["priority"]>("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [project, setProject] = useState("Westside Tower");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    onCreate({
      id: `RFI-${String(Math.floor(Math.random() * 900) + 100).padStart(3, "0")}`,
      title: title.trim(), type, status: "open", priority,
      raisedBy: "You", assignedTo: assignedTo.trim() || "Unassigned", project,
      date: new Date().toISOString().slice(0, 10),
      description: description.trim(), comments: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><Briefcase className="w-4 h-4 text-[#FF6B1A]" /> New Coordination Issue</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Issue title" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <select value={type} onChange={(e) => setType(e.target.value as Issue["type"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option value="RFI">RFI</option><option value="Clash">Clash</option><option value="Design Question">Design Question</option>
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Issue["priority"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Assign to" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            <select value={project} onChange={(e) => setProject(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Westside Tower</option><option>Riverside Mall</option><option>Hilltop Residences</option>
            </select>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue, reference drawings…" rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Create Issue</button>
        </div>
      </div>
    </div>
  );
}
