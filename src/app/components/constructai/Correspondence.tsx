import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, MessageSquare, FileText, Send, Download, ArrowUpRight, ArrowDownLeft, Paperclip } from "lucide-react";
import type { Role } from "./roles";
import api from "../../services/api";

const mapCorr = (r: any): Correspondence => ({
  id: r.id, subject: r.subject, type: r.type, direction: r.direction, status: r.status,
  from: r.fromParty || "", to: r.toParty || "", project: r.project || "", date: r.date || "", body: r.body || "",
  attachments: (() => { try { return JSON.parse(r.attachments || "[]"); } catch { return []; } })(),
});

type Correspondence = {
  id: string;
  subject: string;
  type: "Letter" | "Submittal" | "Transmittal" | "Notice";
  direction: "outgoing" | "incoming";
  status: "draft" | "sent" | "received" | "responded";
  from: string;
  to: string;
  project: string;
  date: string;
  body: string;
  attachments: string[];
};

const SEED: Correspondence[] = [
  {
    id: "LTR-0089", subject: "Notice of delay — inclement weather W23", type: "Letter", direction: "outgoing", status: "sent",
    from: "Buildflex Construction Ltd", to: "Westside Developments (Client)", project: "Westside Tower", date: "2026-06-10",
    body: "We hereby notify you of a 3-day delay to the programme arising from heavy rainfall recorded between 5–7 June 2026, in accordance with clause 24.1 of the contract. Updated programme attached.",
    attachments: ["Updated_Programme_RevF.pdf", "Rainfall_Records_W23.pdf"],
  },
  {
    id: "SUB-0142", subject: "Submittal — curtain wall shop drawings package 2", type: "Submittal", direction: "outgoing", status: "responded",
    from: "Buildflex Construction Ltd", to: "Lena Hassan (Architect)", project: "Westside Tower", date: "2026-06-06",
    body: "Please find attached curtain wall shop drawings package 2 covering elevations N2–N5 for review and approval. Response requested within 10 working days.",
    attachments: ["CW_ShopDwgs_Pkg2.pdf"],
  },
  {
    id: "TRN-0231", subject: "Transmittal — revised structural drawings S-201 Rev D", type: "Transmittal", direction: "incoming", status: "received",
    from: "David Kim (Engineer)", to: "Buildflex Construction Ltd", project: "Riverside Mall", date: "2026-06-04",
    body: "Transmitting revised drawing S-201 Rev D incorporating concrete grade clarification per RFI-044. Superseded copies should be marked accordingly.",
    attachments: ["S-201_RevD.pdf"],
  },
  {
    id: "NTC-0017", subject: "Notice to proceed — Phase 2 fit-out", type: "Notice", direction: "incoming", status: "received",
    from: "Westside Developments (Client)", to: "Buildflex Construction Ltd", project: "Westside Tower", date: "2026-06-01",
    body: "You are hereby instructed to proceed with Phase 2 interior fit-out works per the agreed scope and pricing schedule dated 28 May 2026.",
    attachments: [],
  },
];

const TYPE_CLS: Record<Correspondence["type"], string> = {
  Letter: "bg-[#3B82F6]/15 text-[#3B82F6]",
  Submittal: "bg-[#A855F7]/15 text-[#A855F7]",
  Transmittal: "bg-[#F5A623]/15 text-[#F5A623]",
  Notice: "bg-[#EF4444]/15 text-[#EF4444]",
};

const STATUS_CLS: Record<Correspondence["status"], string> = {
  draft: "bg-[#5B6675]/15 text-[#8A95A5] border-[#5B6675]/30",
  sent: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30",
  received: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30",
  responded: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30",
};

export default function CorrespondenceModule({ role }: { role: Role }) {
  const [items, setItems] = useState<Correspondence[]>(SEED);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [detail, setDetail] = useState<Correspondence | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Load persisted correspondence; keep SEED only if the backend is unreachable
  useEffect(() => {
    (async () => {
      try { setItems((await api.getCorrespondence()).map(mapCorr)); }
      catch { /* offline — keep SEED */ }
    })();
  }, []);

  const filtered = useMemo(() => items.filter((c) => {
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (q && !`${c.subject} ${c.id} ${c.from} ${c.to} ${c.project}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [items, q, typeFilter]);

  const markResponded = (id: string) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status: "responded" } : c)));
    setDetail((d) => (d && d.id === id ? { ...d, status: "responded" } : d));
    toast.success(`${id} marked as responded`);
    api.updateCorrespondence(id, { status: "responded" }).catch(() => { /* offline */ });
  };

  const sendDraft = (id: string) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status: "sent" } : c)));
    setDetail((d) => (d && d.id === id ? { ...d, status: "sent" } : d));
    toast.success(`${id} sent`);
    api.updateCorrespondence(id, { status: "sent" }).catch(() => { /* offline */ });
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search correspondence…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white">
          <option value="all">All Types</option>
          <option>Letter</option><option>Submittal</option><option>Transmittal</option><option>Notice</option>
        </select>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Correspondence</button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <div className="text-center text-[13px] text-[#5B6675] py-10">No correspondence matches your filters.</div>}
        {filtered.map((c) => (
          <button key={c.id} onClick={() => setDetail(c)} className="w-full text-left bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#2E3947] transition">
            <div className="flex items-center gap-2 flex-wrap">
              {c.direction === "outgoing" ? <ArrowUpRight className="w-3.5 h-3.5 text-[#3B82F6]" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-[#22C55E]" />}
              <span className="text-[11px] text-[#5B6675]">{c.id}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_CLS[c.type]}`}>{c.type}</span>
              <span className="text-[13px] text-white flex-1">{c.subject}</span>
              <span className={`text-[10px] px-2 py-1 rounded-full border capitalize ${STATUS_CLS[c.status]}`}>{c.status}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-[#8A95A5] flex-wrap">
              <span>{c.from}</span><span>→</span><span>{c.to}</span>
              <span>{c.project}</span><span>{c.date}</span>
              {c.attachments.length > 0 && <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" /> {c.attachments.length}</span>}
            </div>
          </button>
        ))}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#5B6675]">{detail.id}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_CLS[detail.type]}`}>{detail.type}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${STATUS_CLS[detail.status]}`}>{detail.status}</span>
                </div>
                <h3 className="text-[15px] text-white mt-1.5">{detail.subject}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px] mb-4">
              <div><div className="text-[#5B6675] text-[10px] uppercase">From</div><div className="text-white">{detail.from}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">To</div><div className="text-white">{detail.to}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Project</div><div className="text-white">{detail.project}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Date</div><div className="text-white">{detail.date}</div></div>
            </div>
            <div className="bg-[#0A0E14] border border-[#222A35] rounded-lg p-4 text-[13px] text-[#B8C0CC] leading-relaxed">{detail.body}</div>
            {detail.attachments.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] text-[#8A95A5] uppercase tracking-wider mb-2">Attachments</div>
                <div className="space-y-1.5">
                  {detail.attachments.map((a) => (
                    <button key={a} onClick={() => toast.info(`Downloading ${a}…`)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#0A0E14] border border-[#222A35] rounded-lg hover:border-[#FF6B1A] transition text-left">
                      <FileText className="w-3.5 h-3.5 text-[#FF6B1A]" />
                      <span className="text-[12px] text-white flex-1">{a}</span>
                      <Download className="w-3.5 h-3.5 text-[#8A95A5]" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-5">
              {detail.status === "draft" && <button onClick={() => sendDraft(detail.id)} className="h-8 px-3 bg-[#FF6B1A] text-black rounded-lg text-[11px] font-medium flex items-center gap-1"><Send className="w-3 h-3" /> Send</button>}
              {(detail.status === "sent" || detail.status === "received") && <button onClick={() => markResponded(detail.id)} className="h-8 px-3 bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 rounded-lg text-[11px]">Mark Responded</button>}
            </div>
          </div>
        </div>
      )}

      {showNew && <NewCorrespondenceModal onClose={() => setShowNew(false)} onCreate={async (c) => {
        setItems((prev) => [c, ...prev]);
        toast.success(`${c.id} created as draft`);
        try {
          const saved = await api.createCorrespondence({ subject: c.subject, type: c.type, direction: c.direction, status: c.status, fromParty: c.from, toParty: c.to, project: c.project, date: c.date, body: c.body, attachments: c.attachments });
          setItems((prev) => prev.map((x) => x.id === c.id ? mapCorr(saved) : x));
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewCorrespondenceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Correspondence) => void }) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState<Correspondence["type"]>("Letter");
  const [to, setTo] = useState("");
  const [project, setProject] = useState("Westside Tower");
  const [body, setBody] = useState("");

  const PREFIX: Record<Correspondence["type"], string> = { Letter: "LTR", Submittal: "SUB", Transmittal: "TRN", Notice: "NTC" };

  const submit = () => {
    if (!subject.trim()) { toast.error("Subject is required"); return; }
    onCreate({
      id: `${PREFIX[type]}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`,
      subject: subject.trim(), type, direction: "outgoing", status: "draft",
      from: "Buildflex Construction Ltd", to: to.trim() || "Unspecified recipient", project,
      date: new Date().toISOString().slice(0, 10),
      body: body.trim(), attachments: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><MessageSquare className="w-4 h-4 text-[#FF6B1A]" /> New Correspondence</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <select value={type} onChange={(e) => setType(e.target.value as Correspondence["type"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Letter</option><option>Submittal</option><option>Transmittal</option><option>Notice</option>
            </select>
            <select value={project} onChange={(e) => setProject(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Westside Tower</option><option>Riverside Mall</option><option>Hilltop Residences</option>
            </select>
          </div>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient (e.g. Client, Architect)" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Letter body…" rows={4} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Save Draft</button>
        </div>
      </div>
    </div>
  );
}
