// ============================================================================
// Checklist Form Builder — full-page, split editor/preview workspace built on
// the new checklist item model (question_group, caption, question_type,
// default_answer, photo_available, answer_options, corrective_option,
// corrective_actions, policy). Saves as a template via the same path the
// strict importer uses.
// ============================================================================

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, ChevronUp, ChevronDown, GripVertical, AlertTriangle, Loader2, Send, Square, Pencil, Sparkles, Check, Hash, Layers, SquarePen } from "lucide-react";
import { TRADES } from "./roles";
import { aiErrorText } from "./AiAssistantPanel";
import api, { type ChecklistTemplateDto } from "../../services/api";

const QTYPES = [
  { v: "text", label: "Text" },
  { v: "number", label: "Number" },
  { v: "percentage", label: "Percentage" },
  { v: "yes_no", label: "Yes / No" },
  { v: "checkbox", label: "Checkbox" },
  { v: "photo", label: "Photo" },
];
const CATEGORIES = ["safety", "quality", "pre-handover", "custom"];
const NEEDS_OPTIONS = ["yes_no", "checkbox"];

type Item = {
  id: string;
  group: string;
  caption: string;
  type: string;
  required: boolean;
  defaultAnswer: string;
  photo: "Yes" | "No";
  options: string;
  corrOption: string;
  corrActions: string;
  policy: string;
};

const newItem = (): Item => ({
  id: `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  group: "", caption: "", type: "yes_no", required: false, defaultAnswer: "",
  photo: "No", options: "Yes|No", corrOption: "", corrActions: "", policy: "",
});

const VALID_TYPES = QTYPES.map((q) => q.v);
const optionsToStr = (v: any): string => {
  if (Array.isArray(v)) return v.join("|");
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p.join("|") : v; } catch { return v; } }
  return "";
};
// Map a stored/AI item (new or legacy shape) into an editable builder row.
const toItem = (a: any): Item => ({
  ...newItem(),
  group: a.questionGroup || a.group || "",
  caption: a.caption || a.question || a.title || "",
  type: VALID_TYPES.includes(a.questionType) ? a.questionType : "yes_no",
  required: !!a.required,
  defaultAnswer: a.defaultAnswer || "",
  photo: a.photoAvailable === "Yes" ? "Yes" : "No",
  options: a.answerOptions !== undefined ? optionsToStr(a.answerOptions) : optionsToStr(a.options),
  corrOption: a.correctiveOption || "",
  corrActions: Array.isArray(a.correctiveActions) ? a.correctiveActions.join("|") : (a.correctiveActions || ""),
  policy: a.policy || "",
});
const parseTemplateItems = (json?: string): Item[] => {
  try { const arr = JSON.parse(json || "[]"); return Array.isArray(arr) ? arr.map(toItem) : []; } catch { return []; }
};

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] transition-colors";
const lbl = "text-[10px] uppercase tracking-[0.08em] text-[#5B6675] mb-1 block";

export default function ChecklistFormBuilder({ onClose, onSaved, initial }: { onClose: () => void; onSaved: () => void; initial?: ChecklistTemplateDto }) {
  const editing = !!initial?.id;
  const [title, setTitle] = useState(initial?.title || "");
  const [trade, setTrade] = useState(initial?.trade || "General");
  const [category, setCategory] = useState(initial?.category || "safety");
  const [items, setItems] = useState<Item[]>(() => {
    const parsed = initial ? parseTemplateItems(initial.items) : [];
    return parsed.length ? parsed : [newItem()];
  });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"build" | "ai">("build");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Describe a checklist and I'll build it — then ask me to edit it too (e.g. \"translate captions to Swahili\", \"add corrective actions to every Yes/No item\"). Try: \"Concrete pour pre-inspection for a high-rise\"." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const patch = (id: string, p: Partial<Item>) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const remove = (id: string) => setItems((arr) => (arr.length > 1 ? arr.filter((it) => it.id !== id) : arr));
  const move = (idx: number, dir: -1 | 1) => setItems((arr) => {
    const next = [...arr]; const j = idx + dir;
    if (j < 0 || j >= next.length) return arr;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const add = () => setItems((arr) => [...arr, newItem()]);

  // Current rows -> builder-model JSON, so the AI can edit them in place.
  const toModel = (it: Item) => ({
    questionGroup: it.group.trim(),
    caption: it.caption.trim(),
    questionType: it.type,
    answerOptions: it.options.split("|").map((s) => s.trim()).filter(Boolean),
    defaultAnswer: it.defaultAnswer.trim(),
    photoAvailable: it.photo,
    correctiveOption: it.corrOption.trim(),
    correctiveActions: it.corrActions.split("|").map((s) => s.trim()).filter(Boolean),
    policy: it.policy.trim(),
    required: it.required,
  });

  // The AI returns the COMPLETE updated checklist — map it back to rows and replace.
  const applyGenerated = (aiItems: any[]) => {
    const mapped: Item[] = (aiItems || []).filter((a) => a && (a.caption || a.question || a.title)).map(toItem);
    if (!mapped.length) return 0;
    setItems(mapped); // replace — keeps unaffected items because the AI was given the current set
    return mapped.length;
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || generating) return;
    // Conversation so far (before this turn) gives the AI memory of the dialogue.
    const history = messages.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setChatInput("");
    setGenerating(true);
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const res = await api.buildChecklistAI({ prompt: text, trade, category, current: filled.map(toModel), history }, controller.signal);
      const n = applyGenerated(res.items);
      if (res.title && !title.trim()) setTitle(res.title);
      const reply = (res.reply || "").trim() || (n > 0
        ? `Done — the form now has ${n} item${n > 1 ? "s" : ""}${res.title ? ` ("${res.title}")` : ""}. Want any edits — translate, add corrective actions, or tighten checks?`
        : "I couldn't turn that into checklist items. Try naming the trade and what to inspect.");
      setMessages((m) => [...m, { role: "ai", text: reply }]);
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        setMessages((m) => [...m, { role: "ai", text: "⏹ Stopped." }]);
      } else {
        setMessages((m) => [...m, { role: "ai", text: `Generation failed: ${aiErrorText(err)}. Check that an AI key (OpenAI or DeepSeek) is set and funded on the backend, then try again.` }]);
      }
    }
    chatAbortRef.current = null;
    setGenerating(false);
  };

  // Stop the in-flight generation (aborts the fetch; shown as "Stopped").
  const stopChat = () => { chatAbortRef.current?.abort(); };

  // Edit a sent prompt: load it back into the input and drop it (and everything
  // after) so re-sending continues from that point.
  const editChatPrompt = (index: number) => {
    if (generating) return;
    const msg = messages[index];
    if (!msg || msg.role !== "user") return;
    setChatInput(msg.text);
    setMessages((m) => m.slice(0, index));
    requestAnimationFrame(() => chatInputRef.current?.focus());
  };

  const filled = items.filter((it) => it.caption.trim());
  const stats = {
    items: filled.length,
    groups: new Set(filled.map((i) => i.group.trim() || "Ungrouped")).size,
    corrective: filled.filter((i) => i.corrOption.trim() && i.corrActions.trim()).length,
  };

  const save = async (status: "active" | "draft") => {
    if (!title.trim()) return toast.error("Give the checklist a title");
    if (!filled.length) return toast.error("Add at least one item with a question");
    if (filled.find((it) => !it.group.trim())) return toast.error("Every item needs a question group");

    const payloadItems = filled.map((it, i) => ({
      question: it.caption.trim(),
      questionType: it.type,
      required: it.required,
      position: i + 1,
      options: it.options.split("|").map((s) => s.trim()).filter(Boolean),
      questionGroup: it.group.trim(),
      defaultAnswer: it.defaultAnswer.trim(),
      photoAvailable: it.photo,
      correctiveOption: it.corrOption.trim(),
      correctiveActions: it.corrActions.split("|").map((s) => s.trim()).filter(Boolean),
      policy: it.policy.trim(),
    }));

    setBusy(true);
    try {
      if (editing && initial?.id) {
        await api.updateChecklistTemplate(initial.id, { title: title.trim(), trade, category, items: JSON.stringify(payloadItems), status } as any);
        toast.success(`Template "${title.trim()}" updated`);
      } else {
        await api.createChecklistTemplate({ title: title.trim(), trade, category, items: JSON.stringify(payloadItems), isGlobal: false, status } as any);
        toast.success(status === "draft" ? `Draft "${title.trim()}" saved` : `Template "${title.trim()}" created with ${payloadItems.length} items`);
      }
      onSaved();
    } catch (e: any) { toast.error(e?.message || "Could not save the template"); }
    setBusy(false);
  };

  const typeLabel = (v: string) => QTYPES.find((q) => q.v === v)?.label || v;

  return (
    <div className="flex flex-col h-full bg-[#0A0E14] text-[#E6EAF0]">
      {/* ===== command bar ===== */}
      <header className="shrink-0 border-b border-[#222A35] bg-[#11161D]">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} title="Back to checklists" className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#2C3744] flex items-center justify-center shrink-0 transition-colors"><ArrowLeft className="w-4 h-4" /></button>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[#5B6675] leading-none">Checklists · Templates</div>
              <div className="text-[14px] text-white font-display leading-tight flex items-center gap-2 mt-0.5">{editing ? "Edit form" : "Form Builder"} <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] tracking-wider">{editing ? "EDITING" : "NEW"}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-3 mr-1.5 text-[11px] text-[#8A95A5] tabular-nums">
              <span className="flex items-center gap-1" title="Items"><Hash className="w-3 h-3 text-[#5B6675]" /> {stats.items}</span>
              <span className="flex items-center gap-1" title="Groups"><Layers className="w-3 h-3 text-[#5B6675]" /> {stats.groups}</span>
              <span className="flex items-center gap-1" title="Corrective rules"><AlertTriangle className="w-3 h-3 text-[#F5A623]" /> {stats.corrective}</span>
            </div>
            <button onClick={() => save("draft")} disabled={busy} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] disabled:opacity-50 transition-colors">Save draft</button>
            <button onClick={() => save("active")} disabled={busy} className="h-8 px-3.5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-50 shadow-[0_2px_10px_rgba(255,107,26,0.25)]">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {editing ? "Save changes" : "Create"}</button>
          </div>
        </div>
      </header>

      {/* ===== mobile editor/preview switch ===== */}
      <div className="lg:hidden shrink-0 border-b border-[#222A35] bg-[#11161D] px-4 py-2 flex gap-1">
        <button onClick={() => setView("build")} className={`flex-1 h-8 rounded-md text-[12px] font-medium ${view === "build" ? "bg-[#222A35] text-white" : "text-[#8A95A5]"}`}>Build</button>
        <button onClick={() => setView("ai")} className={`flex-1 h-8 rounded-md text-[12px] font-medium flex items-center justify-center gap-1.5 ${view === "ai" ? "bg-[#222A35] text-white" : "text-[#8A95A5]"}`}><Sparkles className="w-3.5 h-3.5" /> AI</button>
      </div>

      {/* ===== split body ===== */}
      <div className="flex-1 min-h-0 flex">
        {/* editor */}
        <div className={`flex-1 min-w-0 overflow-y-auto ${view === "ai" ? "hidden lg:block" : "block"}`}>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
            {/* details */}
            <section className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
              <div className={lbl}>Checklist details</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled checklist" className="w-full h-11 bg-transparent border-0 border-b border-[#222A35] px-0 text-[18px] text-white font-display placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] transition-colors" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3.5">
                <div><span className={lbl}>Trade</span><select value={trade} onChange={(e) => setTrade(e.target.value)} className={input}>{TRADES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></div>
                <div><span className={lbl}>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                <div>
                  <span className={lbl}>Visibility</span>
                  <div className="flex h-9 rounded-md border border-[#222A35] overflow-hidden">
                    <button type="button" className="flex-1 text-[11.5px] bg-[#FF6B1A]/15 text-[#FF6B1A]">Private</button>
                    <button type="button" onClick={() => toast("Public templates are curated for the marketplace. Contact support to publish yours.", { description: "support@buildsasa.com" })} className="flex-1 text-[11.5px] bg-[#0A0E14] text-[#8A95A5] hover:text-white">Public</button>
                  </div>
                  <div className="text-[10px] text-[#5B6675] mt-1">Private = your workspace only. Public = marketplace (contact support).</div>
                </div>
              </div>
            </section>

            {/* items */}
            <div className="flex items-center justify-between">
              <div className={`${lbl} !mb-0`}>Items · {stats.items}</div>
            </div>

            <div className="space-y-3">
              {items.map((it, idx) => {
                const opts = it.options.split("|").map((s) => s.trim()).filter(Boolean);
                return (
                  <div key={it.id} className="group rounded-lg border border-[#222A35] bg-[#11161D] hover:border-[#2C3744] transition-colors">
                    {/* row header */}
                    <div className="flex items-center gap-2.5 px-3 h-10 border-b border-[#222A35]">
                      <GripVertical className="w-3.5 h-3.5 text-[#3A4350] shrink-0" />
                      <span className="font-mono text-[11px] text-[#5B6675] tabular-nums shrink-0">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5] shrink-0">{typeLabel(it.type)}</span>
                      {it.group.trim() && <span className="text-[10px] text-[#8A95A5] truncate">· {it.group.trim()}</span>}
                      <div className="ml-auto flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => move(idx, -1)} disabled={idx === 0} className="h-7 w-7 flex items-center justify-center rounded text-[#8A95A5] hover:text-white hover:bg-[#161C24] disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="h-7 w-7 flex items-center justify-center rounded text-[#8A95A5] hover:text-white hover:bg-[#161C24] disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(it.id)} className="h-7 w-7 flex items-center justify-center rounded text-[#EF4444] hover:bg-[#EF4444]/10"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>

                    {/* body */}
                    <div className="p-3 space-y-3">
                      <div><span className={lbl}>Question *</span><input value={it.caption} onChange={(e) => patch(it.id, { caption: e.target.value })} placeholder="e.g. Formwork aligned, clean and braced" className={input} /></div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div><span className={lbl}>Group *</span><input value={it.group} onChange={(e) => patch(it.id, { group: e.target.value })} placeholder="Formwork" className={input} /></div>
                        <div><span className={lbl}>Answer type</span><select value={it.type} onChange={(e) => patch(it.id, { type: e.target.value })} className={input}>{QTYPES.map((q) => <option key={q.v} value={q.v}>{q.label}</option>)}</select></div>
                        <div><span className={lbl}>Default</span><input value={it.defaultAnswer} onChange={(e) => patch(it.id, { defaultAnswer: e.target.value })} placeholder="optional" className={input} /></div>
                        <div>
                          <span className={lbl}>Photo</span>
                          <div className="flex h-9 rounded-md border border-[#222A35] overflow-hidden">
                            {(["No", "Yes"] as const).map((p) => <button key={p} onClick={() => patch(it.id, { photo: p })} className={`flex-1 text-[11.5px] ${it.photo === p ? "bg-[#FF6B1A]/15 text-[#FF6B1A]" : "bg-[#0A0E14] text-[#8A95A5] hover:text-white"}`}>{p}</button>)}
                          </div>
                        </div>
                      </div>

                      {NEEDS_OPTIONS.includes(it.type) && (
                        <div><span className={lbl}>Answer options <span className="text-[#3A4350] normal-case">(separate with | )</span></span><input value={it.options} onChange={(e) => patch(it.id, { options: e.target.value })} placeholder="Yes|No" className={input} /></div>
                      )}

                      {/* corrective inset */}
                      <div className="rounded-md border border-[#222A35] bg-[#161C24] p-2.5">
                        <div className="text-[10px] uppercase tracking-[0.08em] text-[#5B6675] mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-[#F5A623]" /> Corrective action <span className="text-[#3A4350] normal-case tracking-normal">— optional</span></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <span className={lbl}>Trigger answer</span>
                            {opts.length ? (
                              <select value={it.corrOption} onChange={(e) => patch(it.id, { corrOption: e.target.value })} className={input}><option value="">— none —</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                            ) : (
                              <input value={it.corrOption} onChange={(e) => patch(it.id, { corrOption: e.target.value })} placeholder="e.g. No / Fail" className={input} />
                            )}
                          </div>
                          <div><span className={lbl}>Corrective actions <span className="text-[#3A4350] normal-case">( | )</span></span><input value={it.corrActions} onChange={(e) => patch(it.id, { corrActions: e.target.value })} placeholder="Re-inspect|Notify engineer" className={input} /></div>
                        </div>
                        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-end">
                          <div><span className={lbl}>Policy / reference</span><input value={it.policy} onChange={(e) => patch(it.id, { policy: e.target.value })} placeholder="e.g. ACI 318 / Drawing S-201" className={input} /></div>
                          <label className="flex items-center gap-2 text-[11.5px] text-[#8A95A5] h-9 px-2.5 rounded-md border border-[#222A35] bg-[#0A0E14] cursor-pointer"><input type="checkbox" checked={it.required} onChange={(e) => patch(it.id, { required: e.target.checked })} className="accent-[#FF6B1A]" /> Required</label>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={add} className="w-full h-11 rounded-lg border border-dashed border-[#2C3744] text-[12.5px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/60 hover:bg-[#FF6B1A]/[0.03] flex items-center justify-center gap-1.5 transition-colors"><Plus className="w-4 h-4" /> Add item</button>
          </div>
        </div>

        {/* AI form generator */}
        <aside className={`flex flex-col bg-[#11161D] border-l border-[#222A35] shrink-0 ${view === "build" ? "hidden lg:flex" : "flex w-full"} lg:w-[400px] xl:w-[440px]`}>
          <div className="px-5 py-4 border-b border-[#222A35] flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#FF6B1A]/15 flex items-center justify-center"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-white font-display leading-tight">AI form generator</div>
              <div className="text-[10px] text-[#5B6675]">Describe it — I'll build the items</div>
            </div>
            <button onClick={() => { setMessages([{ role: "ai", text: "New chat. Describe a checklist and I'll build it — or ask me to edit the current form." }]); setChatInput(""); }} title="New chat" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><SquarePen className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`group flex items-end gap-1.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "user" && (
                  <button onClick={() => editChatPrompt(i)} disabled={generating} title="Edit & re-ask" className="mb-0.5 h-6 w-6 shrink-0 rounded-md text-[#5B6675] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[#161C24] flex items-center justify-center transition-opacity disabled:opacity-0"><Pencil className="w-3.5 h-3.5" /></button>
                )}
                <div className={`max-w-[88%] rounded-lg px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-[#FF6B1A] text-white" : "bg-[#0A0E14] border border-[#222A35] text-[#C2CAD6]"}`}>{m.text}</div>
              </div>
            ))}
            {generating && (
              <div className="flex justify-start"><div className="rounded-lg px-3 py-2 text-[12px] bg-[#0A0E14] border border-[#222A35] text-[#8A95A5] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Building checklist…</div></div>
            )}
          </div>

          <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
            {["Concrete pour pre-inspection", "Electrical rough-in safety", "Roofing membrane QA"].map((p) => (
              <button key={p} onClick={() => setChatInput(p)} className="text-[10.5px] px-2 py-1 rounded-full border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#2C3744] transition-colors">{p}</button>
            ))}
          </div>

          <div className="p-3 border-t border-[#222A35] shrink-0">
            <div className="flex items-end gap-2">
              <textarea ref={chatInputRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} rows={1} placeholder="Describe the checklist…" className="flex-1 resize-none max-h-28 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
              {generating ? (
                <button onClick={stopChat} title="Stop generating" className="h-9 w-9 shrink-0 rounded-lg bg-[#222A35] hover:bg-[#2C3744] text-white flex items-center justify-center"><Square className="w-3.5 h-3.5 fill-current" /></button>
              ) : (
                <button onClick={sendChat} disabled={!chatInput.trim()} title="Send" className="h-9 w-9 shrink-0 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-40"><Send className="w-4 h-4" /></button>
              )}
            </div>
            <div className="text-[10px] text-[#3A4350] mt-1.5">Generated items are added to the form on the left — edit anything after.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
