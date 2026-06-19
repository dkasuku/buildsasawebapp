import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, UploadCloud, FileSpreadsheet, Check, Clock, Users, ChevronDown, AlertCircle, Loader2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { ROLE_COLORS } from "./roles";
import { TEAM_MEMBERS, getMember, getMemberColor, getMemberInitials } from "./team-data";
import { useTeam, resolveName } from "./useTeam";

export type ChecklistItemStatus = "open" | "in-progress" | "done" | "blocked";
export type AnswerType = "text" | "number" | "percentage" | "photo" | "yes_no" | "checkbox";

export type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  assignedTo: string[];
  interval: "once" | "daily" | "weekly" | "monthly";
  dueTime: string;
  status: ChecklistItemStatus;
  completedBy?: string;
  completedAt?: string;
  answer?: string;
  answerType?: AnswerType;
  options?: string[];
  required?: boolean;
  unit?: string;
  images?: string[];
  subItems?: ChecklistItem[];
};

export type Checklist = {
  items: ChecklistItem[];
};

const INTERVAL_LABELS: Record<string, string> = {
  once: "One-time",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const STATUS_STYLES: Record<ChecklistItemStatus, { bg: string; text: string; border: string; label: string }> = {
  open: { bg: "bg-[#222A35]", text: "text-[#8A95A5]", border: "border-[#222A35]", label: "Open" },
  "in-progress": { bg: "bg-[#3B82F6]/15", text: "text-[#3B82F6]", border: "border-[#3B82F6]/30", label: "In Progress" },
  done: { bg: "bg-[#22C55E]/15", text: "text-[#22C55E]", border: "border-[#22C55E]/30", label: "Done" },
  blocked: { bg: "bg-[#EF4444]/15", text: "text-[#EF4444]", border: "border-[#EF4444]/30", label: "Blocked" },
};

function parseCSV(text: string): ChecklistItem[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const titleIdx = headers.findIndex((h) => h.includes("title") || h.includes("task") || h.includes("item"));
  const descIdx = headers.findIndex((h) => h.includes("desc") || h.includes("detail") || h.includes("note"));
  const assignIdx = headers.findIndex((h) => h.includes("assign") || h.includes("staff") || h.includes("person") || h.includes("member"));
  const intervalIdx = headers.findIndex((h) => h.includes("interval") || h.includes("frequency") || h.includes("repeat"));
  const timeIdx = headers.findIndex((h) => h.includes("time") || h.includes("due") || h.includes("hour"));
  const statusIdx = headers.findIndex((h) => h.includes("status") || h.includes("state"));
  const answerIdx = headers.findIndex((h) => h.includes("answer") || h.includes("response") || h.includes("result") || h.includes("note"));

  const items: ChecklistItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const title = cols[Math.max(titleIdx, 0)] || `Task ${i}`;
    const description = descIdx >= 0 ? cols[descIdx] || "" : "";
    const assignStr = assignIdx >= 0 ? cols[assignIdx] || "" : "";
    const intervalRaw = intervalIdx >= 0 ? (cols[intervalIdx] || "once").toLowerCase() : "once";
    const dueTime = timeIdx >= 0 ? cols[timeIdx] || "" : "";
    const statusRaw = statusIdx >= 0 ? (cols[statusIdx] || "open").toLowerCase() : "open";
    const answer = answerIdx >= 0 ? cols[answerIdx] || "" : "";

    const interval: ChecklistItem["interval"] =
      intervalRaw.includes("day") ? "daily"
      : intervalRaw.includes("week") ? "weekly"
      : intervalRaw.includes("month") ? "monthly"
      : "once";

    const status: ChecklistItem["status"] =
      statusRaw.includes("progress") ? "in-progress"
      : statusRaw.includes("done") || statusRaw.includes("complete") ? "done"
      : statusRaw.includes("block") ? "blocked"
      : "open";

    const assignedTo: string[] = [];
    if (assignStr) {
      const names = assignStr.split(/[;|]/).map((n) => n.trim().toLowerCase());
      for (const name of names) {
        const member = TEAM_MEMBERS.find(
          (m) => m.name.toLowerCase().includes(name) || m.id.toLowerCase() === name
        );
        if (member) assignedTo.push(member.id);
      }
    }

    items.push({
      id: `chk-${Date.now()}-${i}`,
      title,
      description,
      assignedTo,
      interval,
      dueTime,
      status,
      answer,
    });
  }
  return items;
}

export function ChecklistBuilder({
  checklist,
  onChange,
  title = "Checklist",
  allowUpload = true,
}: {
  checklist: Checklist;
  onChange: (c: Checklist) => void;
  title?: string;
  allowUpload?: boolean;
}) {
  const [showAssignPicker, setShowAssignPicker] = useState<string | null>(null);
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS;
  const fileRef = useRef<HTMLInputElement>(null);
  const assignRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (assignRef.current && !assignRef.current.contains(target)) {
        setShowAssignPicker(null);
      }
    };
    if (showAssignPicker) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [showAssignPicker]);

  const addItem = () => {
    onChange({
      items: [
        ...checklist.items,
        { id: `chk-${Date.now()}`, title: "", description: "", assignedTo: [], interval: "once", dueTime: "", status: "open" },
      ],
    });
  };

  const removeItem = (id: string) => {
    onChange({ items: checklist.items.filter((i) => i.id !== id) });
  };

  const updateItem = (id: string, patch: Partial<ChecklistItem>) => {
    onChange({ items: checklist.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        toast.error("Could not parse checklist from CSV. Expected columns: title, description, assignedTo, interval, dueTime, status, answer");
        return;
      }
      onChange({ items: [...checklist.items, ...parsed] });
      toast.success(`${parsed.length} checklist items imported from CSV`);
    } catch {
      toast.error("Failed to read CSV file");
    }
    e.currentTarget.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-[#8A95A5]">{title} ({checklist.items.length})</div>
        <div className="flex items-center gap-2">
          {allowUpload && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="h-7 px-2 rounded-md border border-dashed border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40 flex items-center gap-1.5"
              >
                <UploadCloud className="w-3 h-3" /> Upload CSV
              </button>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </>
          )}
          <button
            onClick={addItem}
            className="h-7 px-2 rounded-md bg-[#FF6B1A]/10 text-[#FF6B1A] text-[11px] flex items-center gap-1.5 hover:bg-[#FF6B1A]/20"
          >
            <Plus className="w-3 h-3" /> Add Item
          </button>
        </div>
      </div>

      {checklist.items.length === 0 && (
        <div className="text-center py-6 rounded-lg border border-dashed border-[#222A35] bg-[#0A0E14]">
          <FileSpreadsheet className="w-6 h-6 text-[#5B6675] mx-auto mb-1" />
          <div className="text-[11px] text-[#5B6675]">No checklist items yet.</div>
          <div className="text-[10px] text-[#5B6675]">Add manually or upload a CSV file.</div>
        </div>
      )}

      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {checklist.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2 min-w-0">
                <input
                  value={item.title}
                  onChange={(e) => updateItem(item.id, { title: e.target.value })}
                  placeholder="Task title..."
                  className="w-full h-8 px-2 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                />
                <input
                  value={item.description}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                  placeholder="Description / notes..."
                  className="w-full h-8 px-2 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                />
                <div className="flex flex-wrap gap-2">
                  {/* Interval */}
                  <div className="relative">
                    <select
                      value={item.interval}
                      onChange={(e) => updateItem(item.id, { interval: e.target.value as ChecklistItem["interval"] })}
                      className="h-7 pl-6 pr-6 rounded-md bg-[#11161D] border border-[#222A35] text-[11px] text-white focus:outline-none focus:border-[#FF6B1A] appearance-none"
                    >
                      {Object.entries(INTERVAL_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <Clock className="w-3 h-3 text-[#5B6675] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <ChevronDown className="w-3 h-3 text-[#5B6675] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {/* Due time */}
                  <input
                    type="time"
                    value={item.dueTime}
                    onChange={(e) => updateItem(item.id, { dueTime: e.target.value })}
                    className="h-7 px-2 rounded-md bg-[#11161D] border border-[#222A35] text-[11px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />

                  {/* Assignees */}
                  <div className="relative" ref={assignRef}>
                    <button
                      onClick={() => setShowAssignPicker(showAssignPicker === item.id ? null : item.id)}
                      className={`h-7 px-2 rounded-md border text-[11px] flex items-center gap-1.5 ${
                        item.assignedTo.length
                          ? "bg-[#3B82F6]/10 border-[#3B82F6]/30 text-[#3B82F6]"
                          : "bg-[#11161D] border-[#222A35] text-[#8A95A5] hover:text-white"
                      }`}
                    >
                      <Users className="w-3 h-3" />
                      {item.assignedTo.length === 0
                        ? "Assign"
                        : item.assignedTo.length === 1
                          ? resolveName(item.assignedTo[0]) || "1 member"
                          : `${item.assignedTo.length} members`}
                    </button>
                    {showAssignPicker === item.id && (
                      <div className="absolute left-0 top-8 z-30 w-52 rounded-md border border-[#222A35] bg-[#0F141B] shadow-2xl overflow-hidden">
                        <div className="px-3 py-2 text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">Assign to</div>
                        <div className="max-h-[200px] overflow-y-auto">
                          {people.length === 0 && <div className="px-3 py-2 text-[11px] text-[#5B6675]">No teammates yet — invite people on the Team page.</div>}
                          {people.map((m) => {
                            const selected = item.assignedTo.includes(m.id);
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  const newAssigned = selected
                                    ? item.assignedTo.filter((id) => id !== m.id)
                                    : [...item.assignedTo, m.id];
                                  updateItem(item.id, { assignedTo: newAssigned });
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-[#161C24] flex items-center gap-2 border-b border-[#222A35]/40 last:border-0"
                              >
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-medium shrink-0" style={{ background: ROLE_COLORS[m.role] }}>
                                  {m.initials}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] text-white truncate">{m.name}</div>
                                  <div className="text-[9px] text-[#5B6675]">{m.role}</div>
                                </div>
                                {selected && <Check className="w-3.5 h-3.5 text-[#FF6B1A]" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => removeItem(item.id)}
                className="shrink-0 w-6 h-6 rounded-md text-[#8A95A5] hover:text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center justify-center"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Assigned avatars */}
            {item.assignedTo.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {item.assignedTo.map((id) => (
                  <div key={id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#161C24] border border-[#222A35]">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-medium" style={{ background: getMemberColor(id) }}>
                      {getMemberInitials(id)}
                    </div>
                    <span className="text-[10px] text-[#8A95A5]">{resolveName(id)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Status + answer row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLES[item.status].bg} ${STATUS_STYLES[item.status].text} ${STATUS_STYLES[item.status].border}`}>
                {STATUS_STYLES[item.status].label}
              </span>
              {item.completedBy && (
                <span className="text-[10px] text-[#5B6675]">
                  by {resolveName(item.completedBy)}
                  {item.completedAt ? ` · ${item.completedAt}` : ""}
                </span>
              )}
              {item.answer && (
                <div className="w-full text-[11px] text-[#8A95A5] bg-[#0F141B] border border-[#222A35] rounded px-2 py-1 mt-1">
                  <span className="text-[10px] text-[#5B6675] uppercase">Answer:</span> {item.answer}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChecklistPreview({ checklist }: { checklist: Checklist }) {
  if (checklist.items.length === 0) return null;
  return (
    <div className="space-y-2">
      {checklist.items.map((item) => (
        <div key={item.id} className="flex items-start gap-2 p-2 rounded-md bg-[#0A0E14] border border-[#222A35]">
          <div className="shrink-0 mt-0.5">
            {item.status === "done" && <Check className="w-4 h-4 text-[#22C55E]" />}
            {item.status === "in-progress" && <Loader2 className="w-4 h-4 text-[#3B82F6]" />}
            {item.status === "blocked" && <AlertCircle className="w-4 h-4 text-[#EF4444]" />}
            {item.status === "open" && <div className="w-4 h-4 rounded-full border border-[#5B6675]" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-[12px] text-white">{item.title}</div>
              <span className={`text-[9px] px-1 py-0.5 rounded border ${STATUS_STYLES[item.status].bg} ${STATUS_STYLES[item.status].text} ${STATUS_STYLES[item.status].border}`}>
                {STATUS_STYLES[item.status].label}
              </span>
            </div>
            {item.description && <div className="text-[11px] text-[#8A95A5]">{item.description}</div>}
            {item.answer && (
              <div className="text-[11px] text-[#8A95A5] mt-1">
                <span className="text-[10px] text-[#5B6675] uppercase">Answer:</span> {item.answer}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5]">{INTERVAL_LABELS[item.interval]}</span>
              {item.dueTime && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {item.dueTime}</span>}
              {item.assignedTo.length > 0 && (
                <div className="flex items-center gap-1">
                  {item.assignedTo.map((id) => (
                    <div key={id} className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-medium" style={{ background: getMemberColor(id) }} title={getMember(id)?.name}>
                      {getMemberInitials(id)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────── Staff Checklist View (fill-in mode) ────────── */
export function StaffChecklistView({
  checklist,
  currentUserId,
  onChange,
}: {
  checklist: Checklist;
  currentUserId: string;
  onChange: (c: Checklist) => void;
}) {
  const myItems = checklist.items.filter((i) => i.assignedTo.includes(currentUserId));

  const updateItem = (id: string, patch: Partial<ChecklistItem>) => {
    onChange({
      items: checklist.items.map((i) => {
        if (i.id !== id) return i;
        const updates: Partial<ChecklistItem> = { ...patch };
        if (patch.status === "done" && i.status !== "done") {
          updates.completedBy = currentUserId;
          updates.completedAt = new Date().toLocaleString();
        }
        return { ...i, ...updates };
      }),
    });
  };

  if (myItems.length === 0) {
    return (
      <div className="text-center py-6 rounded-lg border border-dashed border-[#222A35] bg-[#0A0E14]">
        <ClipboardList className="w-6 h-6 text-[#5B6675] mx-auto mb-1" />
        <div className="text-[11px] text-[#5B6675]">No checklist items assigned to you.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {myItems.map((item) => {
        const style = STATUS_STYLES[item.status];
        return (
          <div key={item.id} className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="shrink-0 mt-0.5">
                {item.status === "done" && <Check className="w-4 h-4 text-[#22C55E]" />}
                {item.status === "in-progress" && <Loader2 className="w-4 h-4 text-[#3B82F6]" />}
                {item.status === "blocked" && <AlertCircle className="w-4 h-4 text-[#EF4444]" />}
                {item.status === "open" && <div className="w-4 h-4 rounded-full border border-[#5B6675]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-white">{item.title}</div>
                {item.description && <div className="text-[11px] text-[#8A95A5]">{item.description}</div>}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5]">{INTERVAL_LABELS[item.interval]}</span>
                  {item.dueTime && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {item.dueTime}</span>}
                  <span className={`text-[9px] px-1 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}>{style.label}</span>
                </div>
              </div>
            </div>

            {/* Status picker */}
            <div className="flex flex-wrap gap-2">
              {(["open", "in-progress", "done", "blocked"] as ChecklistItemStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => updateItem(item.id, { status: s })}
                  className={`text-[11px] px-2.5 h-7 rounded-md border transition-colors ${
                    item.status === s
                      ? `${STATUS_STYLES[s].bg} ${STATUS_STYLES[s].text} ${STATUS_STYLES[s].border}`
                      : "bg-[#11161D] border-[#222A35] text-[#8A95A5] hover:text-white"
                  }`}
                >
                  {STATUS_STYLES[s].label}
                </button>
              ))}
            </div>

            {/* Answer input */}
            <div>
              <label className="text-[10px] text-[#5B6675] uppercase tracking-wider block mb-1">Your response / notes</label>
              <textarea
                value={item.answer ?? ""}
                onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                placeholder="Describe what was done, attach reference numbers, issues found..."
                rows={2}
                className="w-full px-2.5 py-2 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-y"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
