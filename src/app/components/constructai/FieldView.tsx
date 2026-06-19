import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ClipboardList, ChevronLeft, Camera, CheckCircle2, AlertCircle,
  Hash, Text, ToggleLeft, ImageIcon, ListChecks, Loader2, Send
} from "lucide-react";
import type { Role } from "./roles";
import api, { type ChecklistDto, type ChecklistQuestionDto } from "../../services/api";

type AnswerMap = Record<string, string>;

const TYPE_ICONS: Record<string, typeof Text> = {
  text: Text, number: Hash, yes_no: ToggleLeft, photo: ImageIcon,
  checkbox: ListChecks, date: Text, dropdown: Text,
};

function QuestionCard({
  q, subQs, value, onChange, disabled, correction
}: {
  q: ChecklistQuestionDto;
  subQs: ChecklistQuestionDto[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  correction?: { status?: string; reviewNote?: string | null };
}) {
  const Icon = TYPE_ICONS[q.questionType] || Text;
  const isYesNo = q.questionType === "yes_no";
  const isPhoto = q.questionType === "photo";
  const isCheckbox = q.questionType === "checkbox";
  const parsedOpts = (() => {
    try {
      const o = q.options ? JSON.parse(q.options) : [];
      if (Array.isArray(o)) return { choices: o, images: [] };
      return { choices: o.choices || [], images: o.images || [] };
    } catch { return { choices: [], images: [] }; }
  })();
  const opts = parsedOpts.choices;
  const attachedImages = parsedOpts.images;

  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-lg bg-[#0A0E14] border border-[#222A35] flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-[#FF6B1A]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-white leading-snug"><span className="text-[10px] text-[#FF6B1A] font-mono mr-1">{String(q.position + 1)}.</span>{q.question}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {q.required && <span className="text-[9px] px-1 py-0.5 rounded bg-[#EF4444]/15 text-[#EF4444]">Required</span>}
            {correction?.status === "needs_correction" && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30 flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" /> Needs correction
              </span>
            )}
          </div>
          {correction?.reviewNote && (
            <div className="text-[10px] text-[#FF6B1A] mt-1">Note: {correction.reviewNote}</div>
          )}
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {attachedImages.map((url: string, idx: number) => (
                <a key={idx} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" className="w-10 h-10 object-cover rounded border border-[#222A35] hover:border-[#FF6B1A]/40" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {isYesNo ? (
        <div className="grid grid-cols-2 gap-2">
          {["Yes", "No"].map((opt) => (
            <button
              key={opt}
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={`h-10 rounded-lg text-[12px] font-medium border ${
                value === opt
                  ? opt === "Yes" ? "bg-[#22C55E]/20 border-[#22C55E] text-[#22C55E]" : "bg-[#EF4444]/20 border-[#EF4444] text-[#EF4444]"
                  : "bg-[#0A0E14] border-[#222A35] text-[#8A95A5]"
              } disabled:opacity-60`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : isPhoto ? (
        <div className="space-y-2">
          {value ? (
            <div className="relative">
              <img src={value} alt="capture" className="w-full h-32 object-cover rounded-lg border border-[#222A35]" />
              <button disabled={disabled} onClick={() => onChange("")} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px]">×</button>
            </div>
          ) : (
            <label className="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-[#222A35] bg-[#0A0E14] text-[#8A95A5] cursor-pointer hover:border-[#FF6B1A]/50">
              <Camera className="w-5 h-5 mr-1.5" /> Tap to take photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={disabled}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;
                  try { onChange(await api.uploadFile(file)); }
                  catch { onChange(URL.createObjectURL(file)); }
                }}
              />
            </label>
          )}
        </div>
      ) : isCheckbox && opts.length ? (
        <div className="space-y-1.5">
          {opts.map((opt: string) => {
            const checked = (value || "").split(",").includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 p-2 rounded bg-[#0A0E14] border border-[#222A35] cursor-pointer">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={checked}
                  onChange={() => {
                    const curr = (value || "").split(",").filter(Boolean);
                    const next = checked ? curr.filter((c) => c !== opt) : [...curr, opt];
                    onChange(next.join(","));
                  }}
                  className="w-4 h-4 accent-[#FF6B1A]"
                />
                <span className="text-[12px] text-white">{opt}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <input
          type={q.questionType === "number" ? "number" : q.questionType === "date" ? "date" : "text"}
          disabled={disabled}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.questionType === "number" ? "Enter number..." : "Type your answer..."}
          className="w-full h-10 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] disabled:opacity-60"
        />
      )}

      {subQs.length > 0 && (
        <div className="pl-4 border-l-2 border-[#FF6B1A]/30 space-y-3 mt-2">
          {subQs.map((sq) => (
            <QuestionCard key={sq.id} q={sq} subQs={[]} value={value} onChange={onChange} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FieldView({ role = "Worker" }: { role?: Role }) {
  const [checklists, setChecklists] = useState<ChecklistDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChecklist, setActiveChecklist] = useState<ChecklistDto | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [existingResponses, setExistingResponses] = useState<Record<string, string>>({});
  const [responseStatus, setResponseStatus] = useState<Record<string, { status?: string; reviewNote?: string | null }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadChecklists();
  }, []);

  const loadChecklists = async () => {
    try {
      const rows = await api.getChecklists();
      const assigned = rows.filter((r) => r.assigned);
      setChecklists(assigned);
    } catch { /* offline */ }
    setLoading(false);
  };

  const openChecklist = async (cl: ChecklistDto) => {
    setActiveChecklist(cl);
    setAnswers({});
    setExistingResponses({});
    setResponseStatus({});
    try {
      const responses = await api.getChecklistResponses(cl.id);
      const ans: AnswerMap = {};
      const ex: Record<string, string> = {};
      const st: Record<string, { status?: string; reviewNote?: string | null }> = {};
      for (const r of responses) {
        ans[r.questionId] = r.value;
        ex[r.questionId] = r.id;
        st[r.questionId] = { status: r.status, reviewNote: r.reviewNote };
      }
      setAnswers(ans);
      setExistingResponses(ex);
      setResponseStatus(st);
    } catch { /* offline */ }
  };

  const setAnswer = (qId: string, val: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: val }));
  };

  const submit = async () => {
    if (!activeChecklist) return;
    const required = activeChecklist.questions.filter((q) => q.required && !q.parentId);
    const missing = required.filter((q) => !answers[q.id]?.trim());
    if (missing.length) {
      return toast.error(`${missing.length} required question(s) unanswered`);
    }

    setSubmitting(true);
    try {
      for (const [qId, val] of Object.entries(answers)) {
        if (!val.trim()) continue;
        const existingId = existingResponses[qId];
        if (existingId) {
          await api.updateChecklistResponse(activeChecklist.id, existingId, { value: val, status: 'corrected' });
        } else {
          await api.createChecklistResponse(activeChecklist.id, { questionId: qId, value: val });
        }
      }
      setSubmitted((prev) => new Set([...prev, activeChecklist.id]));
      toast.success("Checklist submitted successfully");
      setActiveChecklist(null);
      loadChecklists();
    } catch {
      toast.error("Submit failed — saved locally, retry when online");
    }
    setSubmitting(false);
  };

  if (activeChecklist) {
    const rootQs = activeChecklist.questions.filter((q) => !q.parentId);
    const subMap = new Map<string, ChecklistQuestionDto[]>();
    for (const q of activeChecklist.questions) {
      if (q.parentId) {
        const arr = subMap.get(q.parentId) || [];
        arr.push(q);
        subMap.set(q.parentId, arr);
      }
    }

    return (
      <div className="px-4 sm:px-7 py-5 sm:py-6 max-w-lg mx-auto">
        <button onClick={() => setActiveChecklist(null)} className="text-[12px] text-[#8A95A5] flex items-center gap-1 mb-4 hover:text-white">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to checklists
        </button>
        <div className="mb-4">
          <div className="text-[16px] text-white font-display">{activeChecklist.title}</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">{rootQs.length} items · Fill all required fields</div>
        </div>

        <div className="space-y-3 pb-24">
          {rootQs.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              subQs={subMap.get(q.id) || []}
              value={answers[q.id] || ""}
              onChange={(v) => setAnswer(q.id, v)}
              disabled={submitting}
              correction={responseStatus[q.id]}
            />
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#0A0E14]/90 backdrop-blur border-t border-[#222A35] z-20 sm:max-w-lg sm:mx-auto sm:left-auto sm:right-auto">
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-[#FF6B1A] text-white text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-[#FF7E33] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? "Submitting..." : "Submit Checklist"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[16px] text-white font-display flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[#FF6B1A]" /> My Assigned Checklists
          </div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">
            Complete your assigned QA checklists and safety inspections
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 text-[#FF6B1A] animate-spin" />
        </div>
      ) : checklists.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-8 text-center">
          <ClipboardList className="w-8 h-8 text-[#5B6675] mx-auto mb-2" />
          <div className="text-[13px] text-white">No assigned checklists</div>
          <div className="text-[11px] text-[#5B6675] mt-1">
            Ask your supervisor to assign you a checklist from Tasks & Trades
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {checklists.map((cl) => {
            const total = cl.questions?.filter((q) => !q.parentId).length ?? 0;
            const isDone = submitted.has(cl.id);
            return (
              <button
                key={cl.id}
                onClick={() => openChecklist(cl)}
                className="text-left rounded-xl border border-[#222A35] bg-[#11161D] p-4 hover:border-[#FF6B1A]/40 transition space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#5B6675] font-mono">{cl.id.slice(0, 8)}</span>
                  {isDone ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Done
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30">Pending</span>
                  )}
                </div>
                <div className="text-[13px] text-white font-display">{cl.title}</div>
                <div className="text-[10px] text-[#8A95A5]">{cl.category || "General"} · {total} items</div>
                <div className="text-[10px] text-[#5B6675]">
                  {cl.questions?.filter((q) => !q.parentId).map((q) => q.question).slice(0, 2).join(" · ")}
                  {(cl.questions?.filter((q) => !q.parentId).length ?? 0) > 2 ? " ..." : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
