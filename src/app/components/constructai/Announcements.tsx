import { useState, useEffect } from "react";
import { Megaphone, Pin, Calendar, Eye, X, Send, Plus, Bell, AlertTriangle, Info, CheckCircle2, Users, Building2, UserCheck, Globe, Search, Paperclip, Download, Trash2, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { TEAM_MEMBERS, getMemberColor } from "./team-data";
import { ROLES, ROLE_COLORS } from "./roles";
import type { Role } from "./roles";
import api from "../../services/api";
import { ExpandableText } from "./ExpandableText";
import { EmptyState } from "./EmptyState";

const parseJSON = (s: any) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const mapAnn = (r: any): Announcement => ({
  id: r.id, title: r.title, body: r.body || "", author: r.author || "", authorRole: r.authorRole || "",
  date: r.date || "", pinned: !!r.pinned, priority: r.priority, audience: r.audience,
  project: r.project || undefined, roles: parseJSON(r.roles), recipients: parseJSON(r.recipients),
  attachments: parseJSON(r.attachments), requireAck: !!r.requireAck,
  ackCount: r.ackCount || 0, readBy: r.readBy || 0, totalRecipients: r.totalRecipients || 0,
});

type Audience = "company" | "project" | "role" | "people";

type Announcement = {
  id: string;
  title: string;
  body: string;
  author: string;
  authorRole: string;
  date: string;
  pinned: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  audience: Audience;
  project?: string;
  roles?: Role[];
  recipients?: string[];
  attachments?: { name: string; size: string }[];
  requireAck?: boolean;
  ackCount: number;
  acked?: boolean;
  readBy: number;
  totalRecipients: number;
};

const PROJECTS = [
  "HFT-21 · Harborfront Tower",
  "MMC-14 · Midtown Medical",
  "RSP-08 · Riverside Plaza",
  "CHR-32 · Cedar Heights Residences",
  "SLH-19 · Sunset Logistics Hub",
];

const ALL_ROLES = Object.keys(ROLES) as Role[];

const PRIORITY_ICON: Record<string, any> = {
  urgent: AlertTriangle,
  high: Bell,
  normal: Info,
  low: CheckCircle2,
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/30",
  high: "text-[#FF6B1A] bg-[#FF6B1A]/10 border-[#FF6B1A]/30",
  normal: "text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/30",
  low: "text-[#22C55E] bg-[#22C55E]/10 border-[#22C55E]/30",
};

export function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filter, setFilter] = useState<"all" | "pinned" | "urgent">("all");
  const [search, setSearch] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<"all" | Audience>("all");
  const [showNew, setShowNew] = useState(false);
  const emptyDraft = {
    title: "",
    body: "",
    priority: "normal" as Announcement["priority"],
    audience: "company" as Audience,
    project: PROJECTS[0],
    roles: [] as Role[],
    recipients: [] as string[],
    attachments: [] as { name: string; size: string }[],
    requireAck: false,
  };
  const [draft, setDraft] = useState(emptyDraft);

  // Load persisted announcements; the API response is authoritative (including empty)
  useEffect(() => {
    (async () => {
      try { setAnnouncements(((await api.getAnnouncements()) ?? []).map(mapAnn)); }
      catch { /* offline — leave list empty */ }
    })();
  }, []);

  const filtered = announcements.filter((a) => {
    if (filter === "pinned" && !a.pinned) return false;
    if (filter === "urgent" && a.priority !== "urgent") return false;
    if (audienceFilter !== "all" && a.audience !== audienceFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q) && !(a.project ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const pinned = filtered.filter((a) => a.pinned);
  const others = filtered.filter((a) => !a.pinned);

  const togglePin = (id: string) => {
    const next = !announcements.find((a) => a.id === id)?.pinned;
    setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, pinned: next } : a)));
    api.updateAnnouncement(id, { pinned: next }).catch(() => { /* offline */ });
  };

  const acknowledge = (id: string) => {
    const cur = announcements.find((a) => a.id === id);
    if (!cur || cur.acked) return;
    const nextCount = cur.ackCount + 1;
    setAnnouncements((prev) => prev.map((a) => (a.id === id && !a.acked ? { ...a, acked: true, ackCount: nextCount } : a)));
    toast.success("Acknowledged");
    api.updateAnnouncement(id, { ackCount: nextCount }).catch(() => { /* offline */ });
  };

  const removeAnnouncement = (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    toast.success("Announcement deleted");
    api.deleteAnnouncement(id).catch(() => { /* offline */ });
  };

  const addDraftAttachment = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files).map((f) => ({ name: f.name, size: `${(f.size / 1024).toFixed(0)} KB` }));
    setDraft((d) => ({ ...d, attachments: [...d.attachments, ...added] }));
  };
  const removeDraftAttachment = (name: string) => {
    setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.name !== name) }));
  };

  const toggleDraftRole = (r: Role) => {
    setDraft((d) => ({ ...d, roles: d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r] }));
  };
  const toggleDraftPerson = (id: string) => {
    setDraft((d) => ({ ...d, recipients: d.recipients.includes(id) ? d.recipients.filter((x) => x !== id) : [...d.recipients, id] }));
  };

  // Estimate how many people will receive the announcement based on targeting
  const estimateRecipients = (d: typeof draft): number => {
    if (d.audience === "company") return TEAM_MEMBERS.length;
    if (d.audience === "people") return d.recipients.length;
    if (d.audience === "role") return TEAM_MEMBERS.filter((m) => d.roles.includes(m.role)).length;
    if (d.audience === "project") return Math.max(1, Math.round(TEAM_MEMBERS.length * 0.4));
    return 0;
  };

  const publish = () => {
    if (!draft.title.trim() || !draft.body.trim()) return toast.error("Title and body are required");
    if (draft.audience === "role" && draft.roles.length === 0) return toast.error("Select at least one role");
    if (draft.audience === "people" && draft.recipients.length === 0) return toast.error("Select at least one person");
    const newAnn: Announcement = {
      id: `ann-${Date.now()}`,
      title: draft.title.trim(),
      body: draft.body.trim(),
      author: "Marcus Rivera",
      authorRole: "Contractor",
      date: new Date().toISOString().split("T")[0],
      pinned: false,
      priority: draft.priority,
      audience: draft.audience,
      project: draft.audience === "project" ? draft.project : undefined,
      roles: draft.audience === "role" ? draft.roles : undefined,
      recipients: draft.audience === "people" ? draft.recipients : undefined,
      attachments: draft.attachments.length ? draft.attachments : undefined,
      requireAck: draft.requireAck,
      ackCount: 0,
      readBy: 0,
      totalRecipients: estimateRecipients(draft),
    };
    setAnnouncements((prev) => [newAnn, ...prev]);
    setDraft(emptyDraft);
    setShowNew(false);
    toast.success(`Announcement sent to ${newAnn.totalRecipients} ${newAnn.totalRecipients === 1 ? "person" : "people"}`);
    (async () => {
      try {
        const saved = await api.createAnnouncement({
          title: newAnn.title, body: newAnn.body, author: newAnn.author, authorRole: newAnn.authorRole,
          date: newAnn.date, pinned: newAnn.pinned, priority: newAnn.priority, audience: newAnn.audience,
          project: newAnn.project, roles: newAnn.roles, recipients: newAnn.recipients, attachments: newAnn.attachments,
          requireAck: newAnn.requireAck, ackCount: newAnn.ackCount, readBy: newAnn.readBy, totalRecipients: newAnn.totalRecipients,
        });
        setAnnouncements((prev) => prev.map((a) => a.id === newAnn.id ? mapAnn(saved) : a));
      } catch { /* offline — keep local */ }
    })();
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5 max-w-[900px]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[15px] text-white font-display">Announcements</div>
          <div className="text-[11px] text-[#8A95A5]">{announcements.length} total · {announcements.filter((a) => a.pinned).length} pinned · {announcements.filter((a) => a.priority === "urgent").length} urgent</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-[#222A35] rounded-md overflow-hidden">
            {(["all", "pinned", "urgent"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`h-8 px-3 text-[11px] capitalize ${filter === f ? "bg-[#161C24] text-white" : "text-[#8A95A5] hover:text-white"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <button onClick={() => setShowNew(true)} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      </div>

      {/* Search + audience filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements..."
            className="w-full h-9 pl-8 pr-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
          />
        </div>
        <div className="flex border border-[#222A35] rounded-md overflow-hidden">
          {([
            { key: "all", label: "All" },
            { key: "company", label: "Everyone" },
            { key: "project", label: "Project" },
            { key: "role", label: "Role" },
            { key: "people", label: "People" },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setAudienceFilter(f.key)}
              className={`h-9 px-3 text-[11px] ${audienceFilter === f.key ? "bg-[#161C24] text-white" : "text-[#8A95A5] hover:text-white"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider flex items-center gap-1.5">
            <Pin className="w-3 h-3" /> Pinned
          </div>
          {pinned.map((a) => (
            <AnnouncementCard key={a.id} ann={a} onTogglePin={() => togglePin(a.id)} onAcknowledge={() => acknowledge(a.id)} onDelete={() => removeAnnouncement(a.id)} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-3">
          {pinned.length > 0 && <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Recent</div>}
          {others.map((a) => (
            <AnnouncementCard key={a.id} ann={a} onTogglePin={() => togglePin(a.id)} onAcknowledge={() => acknowledge(a.id)} onDelete={() => removeAnnouncement(a.id)} />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="Post your first announcement to keep the team in the loop."
          actionLabel="New Announcement"
          onAction={() => setShowNew(true)}
        />
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-[520px] rounded-xl border border-[#222A35] bg-[#11161D] p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] text-white font-display">New Announcement</div>
              <button onClick={() => setShowNew(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Title</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Site safety stand-down" className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Body</label>
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={5} placeholder="Write your announcement..." className="w-full px-3 py-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-none" />
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Priority</label>
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Announcement["priority"] })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Audience targeting */}
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1.5">Who is this for?</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "company", label: "Everyone", desc: "All members", icon: Globe },
                    { key: "project", label: "By Project", desc: "Project team", icon: Building2 },
                    { key: "role", label: "By Role", desc: "Specific roles", icon: UserCheck },
                    { key: "people", label: "Specific People", desc: "Hand-pick", icon: Users },
                  ] as const).map((opt) => {
                    const active = draft.audience === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setDraft({ ...draft, audience: opt.key })}
                        className={`flex items-center gap-2.5 p-2.5 rounded-md border text-left transition ${active ? "border-[#FF6B1A] bg-[#FF6B1A]/10" : "border-[#222A35] bg-[#0A0E14] hover:border-[#2C3744]"}`}
                      >
                        <opt.icon className={`w-4 h-4 shrink-0 ${active ? "text-[#FF6B1A]" : "text-[#5B6675]"}`} />
                        <div className="min-w-0">
                          <div className={`text-[12px] ${active ? "text-white" : "text-[#C2CAD6]"}`}>{opt.label}</div>
                          <div className="text-[10px] text-[#5B6675]">{opt.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Project picker */}
              {draft.audience === "project" && (
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Project</label>
                  <select value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                    {PROJECTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}

              {/* Role chips */}
              {draft.audience === "role" && (
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1.5">Target roles</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_ROLES.map((r) => {
                      const on = draft.roles.includes(r);
                      return (
                        <button
                          key={r}
                          onClick={() => toggleDraftRole(r)}
                          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-[11px] transition ${on ? "border-[#FF6B1A]/50 bg-[#FF6B1A]/10 text-white" : "border-[#222A35] bg-[#0A0E14] text-[#8A95A5] hover:text-white"}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[r] }} />
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* People picker */}
              {draft.audience === "people" && (
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1.5">Select people</label>
                  <div className="max-h-[180px] overflow-y-auto rounded-md border border-[#222A35] bg-[#0A0E14] divide-y divide-[#222A35]/60">
                    {TEAM_MEMBERS.map((m) => {
                      const on = draft.recipients.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleDraftPerson(m.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition ${on ? "bg-[#FF6B1A]/10" : "hover:bg-[#161C24]"}`}
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] shrink-0" style={{ background: getMemberColor(m.id) }}>{m.initials}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] text-white truncate">{m.name}</div>
                            <div className="text-[10px] text-[#5B6675]">{m.role}</div>
                          </div>
                          {on && <CheckCircle2 className="w-4 h-4 text-[#FF6B1A] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Attachments */}
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1.5">Attachments</label>
                <label className="flex items-center justify-center gap-2 h-9 rounded-md border border-dashed border-[#2C3744] bg-[#0A0E14] text-[12px] text-[#8A95A5] cursor-pointer hover:border-[#FF6B1A] hover:text-white transition">
                  <Paperclip className="w-3.5 h-3.5" /> Attach files
                  <input type="file" multiple className="hidden" onChange={(e) => addDraftAttachment(e.target.files)} />
                </label>
                {draft.attachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {draft.attachments.map((f) => (
                      <div key={f.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0A0E14] border border-[#222A35] text-[11px]">
                        <Paperclip className="w-3 h-3 text-[#5B6675] shrink-0" />
                        <span className="text-white truncate flex-1">{f.name}</span>
                        <span className="text-[#5B6675]">{f.size}</span>
                        <button onClick={() => removeDraftAttachment(f.name)} className="text-[#5B6675] hover:text-[#EF4444]"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Require acknowledgement */}
              <button
                onClick={() => setDraft({ ...draft, requireAck: !draft.requireAck })}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left transition ${draft.requireAck ? "border-[#FF6B1A] bg-[#FF6B1A]/10" : "border-[#222A35] bg-[#0A0E14] hover:border-[#2C3744]"}`}
              >
                <ShieldCheck className={`w-4 h-4 shrink-0 ${draft.requireAck ? "text-[#FF6B1A]" : "text-[#5B6675]"}`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-[12px] ${draft.requireAck ? "text-white" : "text-[#C2CAD6]"}`}>Require acknowledgement</div>
                  <div className="text-[10px] text-[#5B6675]">Recipients must confirm they've read it</div>
                </div>
                <div className={`w-4 h-4 rounded flex items-center justify-center border ${draft.requireAck ? "bg-[#FF6B1A] border-[#FF6B1A]" : "border-[#2C3744]"}`}>
                  {draft.requireAck && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>

              {/* Recipient summary */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[11px] text-[#8A95A5]">
                <Users className="w-3.5 h-3.5 text-[#FF6B1A]" />
                <span>Reaches <span className="text-white">{estimateRecipients(draft)}</span> {estimateRecipients(draft) === 1 ? "person" : "people"}</span>
              </div>

              <button onClick={publish} className="w-full h-10 rounded-md bg-[#FF6B1A] text-white text-[13px] flex items-center justify-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> Publish Announcement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({ ann, onTogglePin, onAcknowledge, onDelete }: { ann: Announcement; onTogglePin: () => void; onAcknowledge: () => void; onDelete: () => void }) {
  const PriorityIcon = PRIORITY_ICON[ann.priority];

  return (
    <div className={`rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5 transition ${ann.pinned ? "border-l-2 border-l-[#FF6B1A]" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] ${PRIORITY_COLOR[ann.priority]}`}>
            <PriorityIcon className="w-3 h-3" /> {ann.priority}
          </span>
          {ann.audience === "company" ? (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#222A35] text-[#8A95A5]"><Globe className="w-3 h-3" /> Everyone</span>
          ) : ann.audience === "project" ? (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#222A35] text-[#8A95A5]"><Building2 className="w-3 h-3" /> {ann.project}</span>
          ) : ann.audience === "role" ? (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#222A35] text-[#8A95A5]"><UserCheck className="w-3 h-3" /> {ann.roles?.join(", ")}</span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#222A35] text-[#8A95A5]"><Users className="w-3 h-3" /> {ann.recipients?.length ?? 0} {ann.recipients?.length === 1 ? "person" : "people"}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {ann.requireAck && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] ${ann.acked ? "text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/10" : "text-[#F5A623] border-[#F5A623]/30 bg-[#F5A623]/10"}`}>
              <ShieldCheck className="w-3 h-3" /> {ann.acked ? "Acknowledged" : "Ack required"}
            </span>
          )}
          <button onClick={onTogglePin} className={`w-7 h-7 rounded-md flex items-center justify-center ${ann.pinned ? "text-[#F5A623]" : "text-[#5B6675]"} hover:bg-[#161C24]`}>
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="w-7 h-7 rounded-md flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#161C24]">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2.5">
        <div className="text-[14px] text-white font-display">{ann.title}</div>
        <ExpandableText text={ann.body} className="text-[12px] text-[#C2CAD6] mt-1.5 leading-relaxed" clampClass="line-clamp-2" />
      </div>

      {/* Attachments */}
      {ann.attachments && ann.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ann.attachments.map((f) => (
            <button
              key={f.name}
              onClick={() => toast.success(`Downloading ${f.name}`)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0A0E14] border border-[#222A35] text-[11px] hover:border-[#FF6B1A] transition"
            >
              <Paperclip className="w-3 h-3 text-[#5B6675]" />
              <span className="text-white">{f.name}</span>
              <span className="text-[#5B6675]">{f.size}</span>
              <Download className="w-3 h-3 text-[#FF6B1A]" />
            </button>
          ))}
        </div>
      )}

      {/* Acknowledgement action */}
      {ann.requireAck && (
        <div className="mt-3 flex items-center justify-between gap-3 p-2.5 rounded-md bg-[#0A0E14] border border-[#222A35]">
          <div className="text-[11px] text-[#8A95A5] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#FF6B1A]" />
            <span><span className="text-white">{ann.ackCount}</span>/{ann.totalRecipients} acknowledged</span>
          </div>
          <button
            onClick={onAcknowledge}
            disabled={ann.acked}
            className={`h-7 px-3 rounded-md text-[11px] flex items-center gap-1.5 ${ann.acked ? "bg-[#22C55E]/15 text-[#22C55E] cursor-default" : "bg-[#FF6B1A] text-white hover:bg-[#FF7E33]"}`}
          >
            {ann.acked ? <><Check className="w-3.5 h-3.5" /> Acknowledged</> : <><ShieldCheck className="w-3.5 h-3.5" /> Acknowledge</>}
          </button>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-[#5B6675]">
        <div className="flex items-center gap-2">
          <span className="text-white">{ann.author}</span>
          <span>· {ann.authorRole}</span>
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {ann.date}</span>
        </div>
        <div className="flex items-center gap-1">
          <Eye className="w-3 h-3" />
          <span>{ann.readBy}/{ann.totalRecipients}</span>
        </div>
      </div>
    </div>
  );
}
