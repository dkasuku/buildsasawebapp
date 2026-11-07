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
import { Sparkles, X, Send, Square, Loader2, Maximize2, SquarePen, Pencil, ClipboardList, ArrowUpRight, Download } from "lucide-react";
import { AI_VIEWS } from "./modules";
import api from "../../services/api";
import { SaveCard } from "./AiTools";

// A checklist/form the AI drafted from a chat prompt. Attached to the AI message
// so the chat can offer to open it in the full Form Builder.
export type AiFormDraft = { title: string; trade: string; category: string; items: any[] };
// A step the AI asked the app to take: open a page or a project.
export type SaveKind = "daily-log" | "punch" | "observation" | "quote";
export type AiAction = { kind: "open"; view: string; label: string } | { kind: "project"; id: string; label: string }
  // A record the AI drafted; the user confirms it before it is saved.
  | { kind: "save"; type: SaveKind; data: Record<string, any>; label: string; savedId?: string };
// An interior design the Visualizer generated from the user's photo.
export type AiDesignResult = { id: string; before?: string; after: string; prompt: string; estimate?: import("../../services/api").DesignEstimate | null };
export type Msg = { role: "user" | "ai"; text: string; form?: AiFormDraft; actions?: AiAction[]; design?: AiDesignResult; images?: string[] };

// The assistant ends a reply with [[open:daily-log]] or [[project:<id>|Name]]
// when the user asked to go somewhere or do something there. Pull those out of
// the text and turn them into buttons (the first one also runs straight away).
const SAVE_LABEL: Record<SaveKind, string> = { "daily-log": "daily log", punch: "punch item", observation: "observation", quote: "quote" };
export const parseActions = (raw: string): { text: string; actions: AiAction[] } => {
  const actions: AiAction[] = [];
  // [[save:daily-log|{...json...}]]: a draft record to confirm.
  raw = raw.replace(/\[\[save:(daily-log|punch|observation|quote)\|(\{[\s\S]*?\})\]\]/g, (_m, type: SaveKind, json: string) => {
    try { const data = JSON.parse(json); if (data && typeof data === "object") actions.push({ kind: "save", type, data, label: SAVE_LABEL[type] }); } catch { /* malformed: drop it */ }
    return "";
  });
  const text = raw.replace(/\[\[(open|project):([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, kind: string, arg: string, label?: string) => {
    const key = String(arg).trim();
    if (kind === "open") { const v = AI_VIEWS.find((x) => x.key === key); if (v) actions.push({ kind: "open", view: v.key, label: v.label }); }
    else actions.push({ kind: "project", id: key, label: (label || "project").trim() });
    return "";
  }).trim();
  return { text, actions };
};

// Markdown tables in a reply become real tables with an Export to CSV button,
// so an estimate or a report can go straight into Excel.
type Block = { kind: "text"; text: string } | { kind: "table"; head: string[]; rows: string[][] };
const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (ROW.test(lines[i]) && SEP.test(lines[i + 1] || "")) {
      const head = cells(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push({ kind: "table", head, rows });
    } else {
      const last = out[out.length - 1];
      if (last && last.kind === "text") last.text += "\n" + lines[i]; else out.push({ kind: "text", text: lines[i] });
    }
  }
  return out.map((b) => (b.kind === "text" ? { ...b, text: b.text.trim() } : b)).filter((b) => b.kind === "table" || b.text);
}
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");
export function exportCsv(head: string[], rows: string[][]) {
  const esc = (v: string) => `"${plain(v).replace(/"/g, '""')}"`;
  const csv = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `buildsasa-ai-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const Bold = ({ text }: { text: string }) => <>{text.split(/(\*\*.+?\*\*)/g).map((p, i) => (/^\*\*.+\*\*$/.test(p) ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong> : p))}</>;
export function AiRichText({ text, onPreview }: { text: string; /** Show a table large in a side pane. */ onPreview?: (head: string[], rows: string[][]) => void }) {
  return (
    <div className="space-y-2">
      {blocks(text).map((b, i) => b.kind === "text" ? <div key={i} className="whitespace-pre-wrap"><Bold text={b.text} /></div> : (
        <div key={i} className="rounded-md border border-[#222A35] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="bg-[#161C24] text-[#8A95A5]"><tr>{b.head.map((h, k) => <th key={k} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{plain(h)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, k) => <tr key={k} className="border-t border-[#222A35]">{r.map((c, n) => <td key={n} className="px-2 py-1.5 text-[#C2CAD6] align-top"><Bold text={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="flex border-t border-[#222A35] bg-[#0A0E14]">
            {onPreview && <button onClick={() => onPreview(b.head, b.rows)} className="flex-1 h-8 text-[11.5px] text-[#C2CAD6] hover:bg-[#161C24] inline-flex items-center justify-center gap-1.5 border-r border-[#222A35]"><Maximize2 className="w-3.5 h-3.5" /> Open in preview</button>}
            <button onClick={() => exportCsv(b.head, b.rows)} className="flex-1 h-8 text-[11.5px] text-[#FF8A47] hover:bg-[#161C24] inline-flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export to CSV</button>
          </div>
        </div>
      ))}
    </div>
  );
}

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

export const AI_GREETING: Msg = { role: "ai", text: "Hi, I'm Buildsasa AI. Tell me what you need and I'll find it, open it or work it out for you: \"How is Kitengela House doing?\", \"Open today's daily log\", \"Estimate materials for a 3-bedroom bungalow\", or \"Which invoices are overdue?\"" };

export function AiAssistantPanel({
  open,
  onClose,
  onExpand,
  messages,
  setMessages,
  onOpenForm,
  docked,
  prefill,
  onConsumePrefill,
  pageTitle,
  onNavigate,
  onOpenProject,
}: {
  /** Desktop: sits as a column beside the page instead of covering it. */
  docked?: boolean;
  prefill?: string | null;
  onConsumePrefill?: () => void;
  /** The page the user is on, so "this" in a question means something. */
  pageTitle?: string;
  onNavigate?: (view: string) => void;
  onOpenProject?: (id: string) => void;
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
    if (!prefill) return;
    setQ(prefill); onConsumePrefill?.();
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [prefill, onConsumePrefill]);
  const run = (a: AiAction) => { if (a.kind === "open") onNavigate?.(a.view); else if (a.kind === "project") onOpenProject?.(a.id); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open && !(docked && window.innerWidth >= 1280)) onClose(); };
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
        const res = await api.aiAssistant(text, history, controller.signal, pageTitle);
        const { text: answer, actions } = parseActions(res.answer || "No answer.");
        setMessages((m) => [...m, { role: "ai", text: answer || "Done.", actions }]);
        if (actions[0] && actions[0].kind !== "save") run(actions[0]);
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

  const quick = ["How are my projects doing?", "What needs my attention today?", "Estimate materials for a 3-bedroom house", "Which invoices are overdue?", "Open the daily log"];

  return (
    <>
      {/* backdrop (mobile) */}
      <div onClick={onClose} className={`fixed inset-0 z-[65] bg-black/40 sm:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />

      <aside className={`fixed inset-y-0 right-0 z-[70] w-full sm:w-[400px] bg-[#0A0E14] border-l border-[#222A35] flex flex-col transition-[transform,visibility] duration-200 ${open ? `translate-x-0 visible shadow-2xl ${docked ? "xl:static xl:z-auto xl:shadow-none xl:h-screen xl:shrink-0" : ""}` : "translate-x-full invisible"}`}>
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
                <div className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${m.role === "user" ? "bg-[#FF6B1A] text-white whitespace-pre-wrap" : "bg-[#11161D] border border-[#222A35] text-[#C2CAD6] w-full"}`}>{m.role === "ai" ? <AiRichText text={m.text} /> : m.text}
                  {m.design && <img src={m.design.after} alt="AI design" className="mt-2 w-full rounded-md border border-[#222A35]" />}
                  {m.role === "ai" && m.design && onExpand && <button onClick={onExpand} className="mt-2 text-[11.5px] text-[#FF8A47] hover:underline">Compare before and after, and see the estimate →</button>}</div>
                {m.role === "ai" && m.actions?.map((a, k) => a.kind === "save" && (
                  <div key={`s${k}`} className="w-full"><SaveCard action={a} text={m.text} onOpen={(v) => onNavigate?.(v)}
                    onSaved={(id) => setMessages((ms) => ms.map((x, n) => (n === i ? { ...x, actions: (x.actions || []).map((y, j) => (j === k && y.kind === "save" ? { ...y, savedId: id } : y)) } : x)))} /></div>
                ))}
                {m.role === "ai" && m.actions?.filter((a) => a.kind !== "save").map((a, k) => (
                  <button key={k} onClick={() => run(a)} className="inline-flex items-center gap-1.5 rounded-md bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-2.5 py-1.5 text-[11.5px] font-medium">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Open {a.label}
                  </button>
                ))}
                {m.role === "ai" && m.form && onOpenForm && (
                  <button onClick={() => onOpenForm(m.form!)} className="inline-flex items-center gap-1.5 rounded-md bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-2.5 py-1.5 text-[11.5px] font-medium transition-colors">
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
