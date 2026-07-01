// ============================================================================
// AiAssistantPanel — global Buildflex AI chat that slides in from the right,
// opened from the top-bar icon. Uses the /api/ai/assistant endpoint (OpenAI),
// which is enriched server-side with the user's project & financial context.
//
// Session persistence: the `messages` state lives in App (lifted), so the
// conversation survives the panel being closed/reopened and navigating between
// modules. It is only reset when the user clicks "New chat" or reloads the page
// (which remounts App). Stop cancels an in-flight request; the pencil on a sent
// prompt lets you edit & re-ask from that point.
// ============================================================================

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Sparkles, X, Send, Square, Loader2, Maximize2, SquarePen, Pencil, ClipboardList } from "lucide-react";
import api from "../../services/api";

// A checklist/form the AI drafted from a chat prompt. Attached to the AI message
// so the chat can offer to open it in the full Form Builder.
export type AiFormDraft = { title: string; trade: string; category: string; items: any[] };
export type Msg = { role: "user" | "ai"; text: string; form?: AiFormDraft };

// Heuristic: does this prompt ask the AI to BUILD a checklist/form (vs. ask a
// general question about one)? We avoid firing on "how do I…/what is…" queries.
export const looksLikeFormRequest = (t: string) => {
  const s = t.trim();
  if (/^\s*(how|what|why|when|where|explain|tell me|can you explain|is |are |should )/i.test(s)) return false;
  return /\b(checklist|inspection|form|questionnaire|audit|punch ?list|qa|qc)\b/i.test(s)
    && /\b(create|build|generate|make|draft|prepare|new|set ?up|design|put together|give me|write|produce)\b/i.test(s);
};

// Trade keyword map (canonical trade name → regex of names/synonyms). First match wins.
const TRADE_HINTS: { trade: string; re: RegExp }[] = [
  { trade: "Electrical", re: /\b(electric\w*|wiring|megger|circuit|conduit|breaker|switchgear)\b/i },
  { trade: "Plumbing", re: /\b(plumb\w*|pipe\w*|sanitary|drain(?!age)|water ?supply|fixture)\b/i },
  { trade: "HVAC", re: /\b(hvac|ventilation|duct\w*|air ?condition\w*|mechanical|chiller|ahu)\b/i },
  { trade: "Concrete", re: /\b(concrete|rebar|pour|slab|formwork|curing|screed)\b/i },
  { trade: "Masonry", re: /\b(masonry|brick\w*|block ?work|mortar|stonework)\b/i },
  { trade: "Roofing", re: /\b(roof\w*|membrane|waterproof\w*|flashing)\b/i },
  { trade: "Drywall", re: /\b(drywall|gypsum|plasterboard|partition|ceiling board)\b/i },
  { trade: "Carpentry", re: /\b(carpentr\w*|joinery|timber|woodwork|millwork|cabinetry)\b/i },
  { trade: "Painting", re: /\b(paint\w*|coating|primer|decorat\w*)\b/i },
  { trade: "Landscaping", re: /\b(landscap\w*|planting|irrigation|softscape|turf)\b/i },
  { trade: "Earthwork", re: /\b(earthwork|excavat\w*|backfill|compaction|trench\w*)\b/i },
  { trade: "Asphalt & Paving", re: /\b(asphalt|paving|tarmac|bitumen|pavement)\b/i },
  { trade: "Drainage", re: /\b(drainage|culvert|storm ?water|catch ?basin|manhole)\b/i },
  { trade: "Grading", re: /\b(grading|subgrade|levelling|leveling)\b/i },
  { trade: "Bridge", re: /\b(bridge|girder|abutment|deck slab|pier)\b/i },
  { trade: "Traffic Control", re: /\b(traffic|road ?marking\w*|signage|cones|barricade)\b/i },
];
const CATEGORY_HINTS: { category: string; re: RegExp }[] = [
  { category: "pre-handover", re: /\b(handover|hand-?over|snag\w*|punch ?list|commission\w*|close ?out|completion|occupancy|defect liability)\b/i },
  { category: "quality", re: /\b(quality|qa|qc|defect|tolerance|test\w*|compliance|workmanship|finish\w*)\b/i },
  { category: "safety", re: /\b(safety|ppe|hazard|toolbox|fall protection|fire|osha|incident|risk|hse|lockout)\b/i },
];

// Infer a builder trade + category from the free-text prompt. Falls back to the
// builder's own defaults (General / safety) when nothing matches.
export const inferTradeCategory = (prompt: string): { trade: string; category: string } => {
  const trade = TRADE_HINTS.find((h) => h.re.test(prompt))?.trade || "General";
  const category = CATEGORY_HINTS.find((h) => h.re.test(prompt))?.category || "safety";
  return { trade, category };
};

// Pull a human-readable reason out of a thrown API error. The http() helper
// throws Error(responseBody); the backend body is usually JSON {error|message},
// so we unwrap it (and trim) to show the real cause instead of a generic note.
export const aiErrorText = (err: any): string => {
  if (err?.name === "AbortError") return "stopped";
  let raw = (err && (err.message || String(err))) || "unknown error";
  try { const j = JSON.parse(raw); raw = j.error || j.message || raw; } catch { /* not JSON */ }
  return String(raw).replace(/\s+/g, " ").trim().slice(0, 240) || "unknown error";
};

export const AI_GREETING: Msg = { role: "ai", text: "Hi — I'm Buildsasa AI. Ask me about your projects, finances, change orders, or how to do something. e.g. \"What's my biggest cost exposure right now?\"" };

export function AiAssistantPanel({
  open,
  onClose,
  onExpand,
  messages,
  setMessages,
  onOpenForm,
}: {
  open: boolean;
  onClose: () => void;
  onExpand?: () => void;
  messages: Msg[];
  setMessages: Dispatch<SetStateAction<Msg[]>>;
  onOpenForm?: (form: AiFormDraft) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const send = async () => {
    const text = q.trim();
    if (!text || busy) return;
    // Conversation so far (before this turn) gives the assistant memory.
    const history = messages.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (looksLikeFormRequest(text)) {
        // Build a checklist draft the user can open in the full Form Builder.
        const res = await api.buildChecklistAI({ prompt: text }, controller.signal);
        const items = Array.isArray(res.items) ? res.items : [];
        const guess = inferTradeCategory(text);
        const trade = res.trade || guess.trade;
        const category = res.category || guess.category;
        const reply = (res.reply || "").trim() || (items.length
          ? `I drafted "${res.title || "a checklist"}" (${trade} · ${category}) with ${items.length} item${items.length > 1 ? "s" : ""}. Open it in the Form Builder to review, edit, and save.`
          : "I couldn't turn that into checklist items — try naming the trade and what to inspect.");
        setMessages((m) => [...m, items.length
          ? { role: "ai", text: reply, form: { title: res.title || "Untitled checklist", trade, category, items } }
          : { role: "ai", text: reply }]);
      } else {
        const res = await api.aiAssistant(text, history, controller.signal);
        setMessages((m) => [...m, { role: "ai", text: res.answer || "No answer." }]);
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        setMessages((m) => [...m, { role: "ai", text: "⏹ Stopped." }]);
      } else {
        setMessages((m) => [...m, { role: "ai", text: `I couldn't reach the AI: ${aiErrorText(err)}. Check that an AI key (OpenAI or DeepSeek) is set and funded on the backend, then try again.` }]);
      }
    }
    abortRef.current = null;
    setBusy(false);
  };

  // Stop the in-flight generation. The fetch rejects with an AbortError, which
  // `send` turns into a "Stopped" note.
  const stop = () => { abortRef.current?.abort(); };

  // Edit a previously sent prompt: pull its text back into the input and drop it
  // (and everything after it) so re-sending continues the thread from that point.
  const editPrompt = (index: number) => {
    if (busy) return;
    const msg = messages[index];
    if (!msg || msg.role !== "user") return;
    setQ(msg.text);
    setMessages((m) => m.slice(0, index));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const newChat = () => { abortRef.current?.abort(); setMessages([AI_GREETING]); setQ(""); };

  const quick = ["Summarize my projects", "Biggest cost exposure?", "Draft a change order summary"];

  return (
    <>
      {/* backdrop (mobile) */}
      <div onClick={onClose} className={`fixed inset-0 z-[65] bg-black/40 sm:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />

      <aside className={`fixed inset-y-0 right-0 z-[70] w-full sm:w-[400px] bg-[#0A0E14] border-l border-[#222A35] flex flex-col shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="shrink-0 px-4 py-3.5 border-b border-[#222A35] bg-[#11161D] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#FF6B1A]/15 flex items-center justify-center"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-white font-display leading-tight">Buildsasa AI</div>
            <div className="text-[10px] text-[#5B6675]">Project & financial assistant</div>
          </div>
          <button onClick={newChat} title="New chat" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><SquarePen className="w-4 h-4" /></button>
          {onExpand && <button onClick={onExpand} title="Open full view" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><Maximize2 className="w-4 h-4" /></button>}
          <button onClick={onClose} title="Close" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`group flex items-end gap-1.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user" && (
                <button
                  onClick={() => editPrompt(i)}
                  disabled={busy}
                  title="Edit & re-ask"
                  className="mb-0.5 h-6 w-6 shrink-0 rounded-md text-[#5B6675] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[#161C24] flex items-center justify-center transition-opacity disabled:opacity-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="flex flex-col items-start gap-1.5 max-w-[88%]">
                <div className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-[#FF6B1A] text-white" : "bg-[#11161D] border border-[#222A35] text-[#C2CAD6]"}`}>{m.text}</div>
                {m.role === "ai" && m.form && onOpenForm && (
                  <button onClick={() => onOpenForm(m.form!)} className="inline-flex items-center gap-1.5 rounded-md bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A45] hover:bg-[#FF6B1A]/25 px-2.5 py-1.5 text-[11.5px] font-medium transition-colors">
                    <ClipboardList className="w-3.5 h-3.5" /> Open in Form Builder
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="rounded-lg px-3 py-2 text-[12px] bg-[#11161D] border border-[#222A35] text-[#8A95A5] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…</div></div>}
        </div>

        <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
          {quick.map((p) => <button key={p} onClick={() => setQ(p)} className="text-[10.5px] px-2 py-1 rounded-full border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#2C3744] transition-colors">{p}</button>)}
        </div>

        <div className="p-3 border-t border-[#222A35] shrink-0">
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="Ask Buildsasa AI…" className="flex-1 resize-none max-h-28 bg-[#11161D] border border-[#222A35] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
            {busy ? (
              <button onClick={stop} title="Stop generating" className="h-9 w-9 shrink-0 rounded-lg bg-[#222A35] hover:bg-[#2C3744] text-white flex items-center justify-center"><Square className="w-3.5 h-3.5 fill-current" /></button>
            ) : (
              <button onClick={send} disabled={!q.trim()} title="Send" className="h-9 w-9 shrink-0 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-40"><Send className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default AiAssistantPanel;
