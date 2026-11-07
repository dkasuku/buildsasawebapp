// The Buildsasa AI page: a full-screen chat in the style of ChatGPT or Claude.
// History on the left, the conversation in the middle, and a preview pane on
// the right only when there is something to look at (a table, a checklist
// draft, a financial report). Categories focus the assistant on one kind of
// work: interior design, quotes, site, money, checklists, planning.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUp, ArrowUpRight, Calculator, CalendarRange, ClipboardCheck, ClipboardList, Download, HardHat, History,
  Loader2, MessageSquare, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Search, Sparkles, Square, SquarePen,
  Trash2, Wallet, X, ImagePlus,
} from "lucide-react";
import api from "../../services/api";
import { AiRichText, exportCsv, type AiAction, type AiDesignResult, type AiFormDraft, type Msg } from "./AiAssistantPanel";
import { DesignCard, DesignPreview } from "./Visualizer";
import { askAi, type AiSession } from "./aiSession";
import { FinancialReports } from "./BuildflexAI";
import { DesignStudio } from "./DesignStudio";

type Tool = { label: string; view?: string; kind?: "design" | "financial" };
type Category = { id: string; label: string; icon: any; blurb: string; prompts: string[]; tool?: Tool; money?: boolean };

// Kept in step with AI_CATEGORY_GUIDE in backend/src/server.js.
export const AI_CATEGORIES: Category[] = [
  { id: "design", label: "Interior design", icon: Palette, blurb: "Attach a photo of a raw space to see it finished, with a costed materials list. Or ask for layouts and finishes.",
    prompts: ["Design a modern living room for a 4 m × 5 m space, with a materials list", "Suggest a colour palette and finishes for a 3-bedroom bungalow"],
    tool: { label: "Generate images in Design studio", kind: "design" } },
  { id: "quotes", label: "Quotes & estimates", icon: Calculator, blurb: "Material estimates and bills of quantities priced in KES.",
    prompts: ["Estimate materials for a 3-bedroom bungalow, about 120 m²", "Price a 50 m perimeter wall in machine-cut stone"],
    tool: { label: "Open Quotes", view: "quotes" } },
  { id: "site", label: "Site & daily logs", icon: HardHat, blurb: "What happened on site, write-ups of the day, delays and safety.",
    prompts: ["What happened on my sites this week?", "Write today's daily log: 12 workers, first-floor slab formwork, cement delivered"],
    tool: { label: "Open Daily log", view: "daily-log" } },
  { id: "money", label: "Money & reports", icon: Wallet, money: true, blurb: "Budgets, spend, cash flow, invoices and change orders.",
    prompts: ["Which projects are over budget?", "Which invoices are overdue and by how much?"],
    tool: { label: "Build a financial report", kind: "financial" } },
  { id: "checklists", label: "Checklists & quality", icon: ClipboardCheck, blurb: "Inspection checklists by trade and quality standards.",
    prompts: ["Create a pre-pour concrete inspection checklist", "Build an electrical first-fix checklist"],
    tool: { label: "Open Checklists", view: "checklists" } },
  { id: "planning", label: "Planning & schedule", icon: CalendarRange, blurb: "Programmes, durations, sequencing and lead times.",
    prompts: ["Draft a programme for a 4-bedroom maisonette", "What are typical lead times for steel windows and doors?"],
    tool: { label: "Open Schedule", view: "schedule" } },
];
const catOf = (id?: string) => AI_CATEGORIES.find((c) => c.id === id);

type Preview = { kind: "table"; title: string; head: string[]; rows: string[][] } | { kind: "form"; form: AiFormDraft } | { kind: "financial" } | { kind: "design"; d: AiDesignResult };

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; };
const dayGroup = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "Previous 7 days" : days < 30 ? "Previous 30 days" : "Older";
};

export function AiWorkspace({ session, canSeeMoney, onNavigate, onOpenProject, onOpenForm, start, onStarted }: {
  session: AiSession; canSeeMoney: boolean;
  /** A question typed in a module page's ask bar: start a new chat with it. */
  start?: { text: string; images: string[]; key: number; page?: string } | null; onStarted?: () => void;
  onNavigate: (view: string) => void; onOpenProject: (id: string) => void; onOpenForm?: (form: AiFormDraft) => void;
}) {
  const { messages, setMessages, category, setCategory, history, convId, reset, open, remove } = session;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  // Photos attached to the next message (the Visualizer redesigns them).
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = async (list: FileList | null) => {
    const picked = Array.from(list || []).filter((f) => f.type.startsWith("image/")).slice(0, 1);
    if (!picked.length) return;
    setUploading(true);
    try {
      const { urls, failed } = await api.uploadFiles(picked);
      failed.forEach((f) => toast.error(`${f.name}: ${f.error}`));
      if (urls[0]) { setFiles([urls[0]]); setCategory("design"); requestAnimationFrame(() => inputRef.current?.focus()); }
    } catch (e: any) { toast.error(e?.message || "Upload failed. Try again."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const [showHistory, setShowHistory] = useState(() => { try { return localStorage.getItem("buildsasa-ai-history") !== "0" && window.innerWidth >= 1024; } catch { return true; } });
  const [find, setFind] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cats = AI_CATEGORIES.filter((c) => canSeeMoney || !c.money);
  const cat = catOf(category);
  const started = messages.some((m) => m.role === "user");

  useEffect(() => { api.me().then((u) => setName((u?.name || "").trim().split(/\s+/)[0] || "")).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  useEffect(() => { try { localStorage.setItem("buildsasa-ai-history", showHistory ? "1" : "0"); } catch { /* noop */ } }, [showHistory]);
  // Grow the composer with its text, up to a limit.
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(220, el.scrollHeight) + "px"; } }, [q]);

  const run = (a: AiAction) => (a.kind === "open" ? onNavigate(a.view) : onOpenProject(a.id));
  const send = async (raw?: string, imgs?: string[], fresh = false) => {
    const images = raw === undefined ? files : (imgs || []);
    const text = (raw ?? q).trim() || (images.length ? "Turn this into a modern, finished interior" : "");
    if (!text || busy || uploading) return;
    const before = fresh ? [] : messages;
    setMessages((m) => [...m, { role: "user", text, ...(images.length ? { images } : {}) }]);
    setQ(""); setFiles([]); setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await askAi(text, before, { signal: controller.signal, category: images.length ? "design" : fresh ? "general" : category, page: (fresh && pageRef.current) || "Buildsasa AI", images });
      setMessages((m) => [...m, reply]);
      if (reply.form) setPreview({ kind: "form", form: reply.form });
      if (reply.design && window.innerWidth >= 1280) setPreview({ kind: "design", d: reply.design });
      // "Open the punch list": go there. The chat carries on in the docked panel.
      if (reply.actions?.[0]) run(reply.actions[0]);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Stopped." }]);
    }
    abortRef.current = null; setBusy(false);
  };
  const stop = () => abortRef.current?.abort();
  const edit = (i: number) => {
    if (busy || messages[i]?.role !== "user") return;
    setQ(messages[i].text); setMessages((m) => m.slice(0, i));
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  // Arriving from an ask bar: a fresh chat with that question already asked.
  const startedKey = useRef(0);
  // The page an ask-bar question came from, so "this" and "here" mean that page.
  const pageRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!start || startedKey.current === start.key) return;
    startedKey.current = start.key;
    pageRef.current = start.page;
    abortRef.current?.abort(); reset(start.images.length ? "design" : "general"); setPreview(null); setQ(""); setFiles([]);
    send(start.text, start.images, true);
    onStarted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start?.key]);
  const newChat = (c = "general") => { abortRef.current?.abort(); reset(c); setPreview(null); setQ(""); requestAnimationFrame(() => inputRef.current?.focus()); };
  const pick = (c: Category) => { if (started) newChat(c.id); else setCategory(category === c.id ? "general" : c.id); };
  const useTool = (t: Tool) => { if (t.kind === "design") setDesignOpen(true); else if (t.kind === "financial") setPreview({ kind: "financial" }); else if (t.view) onNavigate(t.view); };
  const openChat = async (id: string) => {
    try { await open(id); setPreview(null); if (window.innerWidth < 1024) setShowHistory(false); }
    catch (e: any) { toast.error(e?.message || "Couldn't open that chat."); }
  };

  const groups = useMemo(() => {
    const rows = (history || []).filter((h) => !find.trim() || h.title.toLowerCase().includes(find.trim().toLowerCase()));
    const out: { label: string; rows: typeof rows }[] = [];
    for (const r of rows) { const g = dayGroup(r.updatedAt); const last = out[out.length - 1]; if (last && last.label === g) last.rows.push(r); else out.push({ label: g, rows: [r] }); }
    return out;
  }, [history, find]);

  const composer = (big: boolean) => (
    <div className={`rounded-2xl border border-[#2C3744] bg-[#11161D] shadow-[0_8px_30px_rgba(0,0,0,0.18)] focus-within:border-[#FF6B1A]/60 transition-colors ${big ? "p-3" : "p-2.5"}`}>
      {files.length > 0 && (
        <div className="flex gap-2 px-1 pb-2">
          {files.map((u) => (
            <div key={u} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#222A35]">
              <img src={u} alt="Attached" className="w-full h-full object-cover" />
              <button onClick={() => setFiles((f) => f.filter((x) => x !== u))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-[#ffffff] flex items-center justify-center" aria-label="Remove photo"><X className="w-3 h-3" /></button>
            </div>
          ))}
          <div className="text-[11.5px] text-[#8A95A5] self-center">Describe the finish you want, e.g. "luxury modern office with glass partitions and polished concrete".</div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => attach(e.target.files)} />
      <textarea ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} rows={big ? 2 : 1}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder={cat ? `Ask about ${cat.label.toLowerCase()}…` : "How can I help with your projects today?"}
        className="w-full resize-none bg-transparent px-2 py-1 text-[14px] text-white placeholder:text-[#5B6675] focus:outline-none" />
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <button onClick={() => fileRef.current?.click()} disabled={uploading || busy} title="Attach a photo of a raw space to redesign it" className="h-8 w-8 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] flex items-center justify-center disabled:opacity-50">{uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}</button>
        {cat ? (
          <button onClick={() => setCategory("general")} className="h-8 pl-2.5 pr-2 rounded-full bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 text-[#FF8A47] text-[12px] inline-flex items-center gap-1.5" title="Remove the focus">
            <cat.icon className="w-3.5 h-3.5" /> {cat.label} <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[11.5px] text-[#5B6675] pl-2">Pick a category to focus the answers, or just ask.</span>
        )}
        {cat?.tool && (!cat.money || canSeeMoney) && (
          <button onClick={() => useTool(cat.tool!)} className="h-8 px-2.5 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white text-[12px] inline-flex items-center gap-1.5"><ArrowUpRight className="w-3.5 h-3.5" /> {cat.tool.label}</button>
        )}
        <div className="ml-auto">
          {busy
            ? <button onClick={stop} title="Stop" className="h-9 w-9 rounded-xl bg-[#222A35] text-white flex items-center justify-center"><Square className="w-3.5 h-3.5 fill-current" /></button>
            : <button onClick={() => send()} disabled={(!q.trim() && !files.length) || uploading} title="Send" className="h-9 w-9 rounded-xl bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-35"><ArrowUp className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex min-h-0 bg-[#0A0E14]">
      {/* History */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setShowHistory(false)} />
          <aside className="fixed lg:static inset-y-0 left-0 z-40 w-72 lg:w-64 shrink-0 border-r border-[#222A35] bg-[#0F141B] flex flex-col min-h-0">
            <div className="p-3 flex items-center gap-2">
              <button onClick={() => newChat()} className="flex-1 h-9 rounded-lg bg-[#161C24] hover:bg-[#161C24] border border-[#222A35] text-white text-[13px] inline-flex items-center gap-2 px-3"><SquarePen className="w-4 h-4 text-[#FF6B1A]" /> New chat</button>
              <button onClick={() => setShowHistory(false)} title="Hide history" className="h-9 w-9 rounded-lg text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><PanelLeftClose className="w-4 h-4" /></button>
            </div>
            <div className="px-3 pb-2">
              <div className="relative"><Search className="w-3.5 h-3.5 text-[#5B6675] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search chats" className="w-full h-8 rounded-md bg-[#0A0E14] border border-[#222A35] pl-8 pr-2 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/50" />
              </div>
            </div>
            <div className="px-2 pb-1 text-[10.5px] uppercase tracking-wider text-[#5B6675] px-4 pt-1">Categories</div>
            <div className="px-2 pb-2 space-y-0.5">
              {cats.map((c) => (
                <button key={c.id} onClick={() => newChat(c.id)} className="w-full h-8 px-2.5 rounded-md text-[12.5px] text-[#C2CAD6] hover:bg-[#161C24] hover:text-white inline-flex items-center gap-2"><c.icon className="w-4 h-4 text-[#8A95A5]" /> {c.label}</button>
              ))}
            </div>
            <div className="border-t border-[#222A35] mx-3" />
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {history === null ? <div className="px-3 py-2 text-[12px] text-[#5B6675]"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />Loading chats…</div>
                : groups.length === 0 ? <div className="px-3 py-6 text-center text-[12px] text-[#5B6675]"><History className="w-5 h-5 mx-auto mb-2" />{find ? "No chats match." : "Your chats will appear here."}</div>
                : groups.map((g) => (
                  <div key={g.label} className="mb-2">
                    <div className="px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-[#5B6675]">{g.label}</div>
                    {g.rows.map((r) => { const C = catOf(r.category)?.icon || MessageSquare; return (
                      <div key={r.id} className={`group flex items-center rounded-md ${r.id === convId ? "bg-[#161C24]" : "hover:bg-[#161C24]"}`}>
                        <button onClick={() => openChat(r.id)} className="flex-1 min-w-0 h-8 px-2.5 text-left text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-2" title={r.title}>
                          <C className="w-3.5 h-3.5 shrink-0 text-[#5B6675]" /><span className="truncate">{r.title}</span>
                        </button>
                        <button onClick={() => { if (window.confirm(`Delete "${r.title}"?`)) remove(r.id).catch(() => toast.error("Couldn't delete.")); }} className="opacity-0 group-hover:opacity-100 h-7 w-7 mr-1 rounded text-[#5B6675] hover:text-[#EF4444] flex items-center justify-center" aria-label="Delete chat"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ); })}
                  </div>
                ))}
            </div>
          </aside>
        </>
      )}

      {/* Conversation */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-[#222A35]">
          {!showHistory && <button onClick={() => setShowHistory(true)} title="Show chat history" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><PanelLeftOpen className="w-4 h-4" /></button>}
          {!showHistory && <button onClick={() => newChat()} title="New chat" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><SquarePen className="w-4 h-4" /></button>}
          <div className="text-[13px] text-[#C2CAD6] truncate">{started ? (history?.find((h) => h.id === convId)?.title || messages.find((m) => m.role === "user")?.text.slice(0, 80)) : "Buildsasa AI"}</div>
          {cat && started && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FF6B1A]/10 text-[#FF8A47] inline-flex items-center gap-1"><cat.icon className="w-3 h-3" />{cat.label}</span>}
        </div>

        {!started ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 pt-[12vh] pb-10">
              <h1 className="text-center text-[32px] sm:text-[38px] text-white font-display tracking-tight flex items-center justify-center gap-3">
                <Sparkles className="w-8 h-8 text-[#FF6B1A]" /> {greeting()}{name ? `, ${name}` : ""}
              </h1>
              <p className="text-center text-[13.5px] text-[#8A95A5] mt-2">Ask about your projects, price a job, design a room or plan the work. I can open any page for you.</p>
              <div className="mt-7">{composer(true)}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-6">
                {cats.map((c) => (
                  <div key={c.id} className={`rounded-xl border p-3.5 transition-colors ${category === c.id ? "border-[#FF6B1A]/50 bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#11161D] hover:border-[#2C3744]"}`}>
                    <button onClick={() => pick(c)} className="w-full text-left">
                      <div className="flex items-center gap-2 text-[13.5px] text-white"><span className="w-7 h-7 rounded-lg bg-[#FF6B1A]/10 flex items-center justify-center"><c.icon className="w-4 h-4 text-[#FF6B1A]" /></span>{c.label}</div>
                      <div className="text-[11.5px] text-[#8A95A5] mt-1.5 leading-snug">{c.blurb}</div>
                    </button>
                    <div className="mt-2.5 space-y-1">
                      {c.prompts.map((p) => <button key={p} onClick={() => { setCategory(c.id); send(p); }} className="w-full text-left text-[11.5px] text-[#C2CAD6] hover:text-white rounded-md px-2 py-1.5 bg-[#0A0E14] border border-[#222A35] hover:border-[#2C3744] line-clamp-2">{p}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {messages.map((m, i) => m.role === "user" ? (
                  <div key={i} className="group flex justify-end items-end gap-1.5">
                    <button onClick={() => edit(i)} disabled={busy} title="Edit and ask again" className="h-7 w-7 rounded-md text-[#5B6675] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[#161C24] flex items-center justify-center disabled:opacity-0"><Pencil className="w-3.5 h-3.5" /></button>
                    <div className="max-w-[80%] flex flex-col items-end gap-1.5">
                      {m.images?.map((u) => <img key={u} src={u} alt="Attached" className="max-w-[240px] max-h-44 rounded-xl border border-[#222A35] object-cover" />)}
                      <div className="rounded-2xl rounded-br-md bg-[#161C24] text-white text-[14px] leading-relaxed px-4 py-2.5 whitespace-pre-wrap">{m.text}</div>
                    </div>
                  </div>
                ) : m.text === messages[0]?.text && i === 0 ? null : (
                  <div key={i} className="flex gap-3">
                    <span className="w-8 h-8 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /></span>
                    <div className="min-w-0 flex-1 pt-1 text-[14px] leading-relaxed text-[#D5DBE3]">
                      <AiRichText text={m.text} onPreview={(head, rows) => setPreview({ kind: "table", title: messages[i - 1]?.text.slice(0, 80) || "Table", head, rows })} />
                      {m.design && <div className="mt-3"><DesignCard d={m.design} onPreview={() => setPreview({ kind: "design", d: m.design! })} /></div>}
                      {(!!m.form || !!m.actions?.length) && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {m.form && <button onClick={() => setPreview({ kind: "form", form: m.form! })} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-3 py-1.5 text-[12px] font-medium"><ClipboardList className="w-3.5 h-3.5" /> Preview checklist</button>}
                          {m.actions?.map((a, k) => <button key={k} onClick={() => run(a)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-3 py-1.5 text-[12px] font-medium"><ArrowUpRight className="w-3.5 h-3.5" /> Open {a.label}</button>)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <div className="flex gap-3"><span className="w-8 h-8 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-[#FF6B1A] animate-pulse" /></span><div className="pt-1.5 text-[13px] text-[#8A95A5] inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {messages[messages.length - 1]?.images?.length ? "Designing your space and pricing the materials… this takes up to a minute." : "Thinking…"}</div></div>}
                <div ref={endRef} />
              </div>
            </div>
            <div className="shrink-0 px-4 pb-4 pt-2">
              <div className="max-w-3xl mx-auto">{composer(false)}<p className="text-center text-[10.5px] text-[#5B6675] mt-1.5">Buildsasa AI can make mistakes. Check prices and quantities before you order.</p></div>
            </div>
          </>
        )}
      </section>

      {/* Preview */}
      {preview && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 xl:hidden" onClick={() => setPreview(null)} />
          <aside className="fixed xl:static inset-y-0 right-0 z-40 w-full sm:w-[520px] xl:w-[44%] xl:max-w-[720px] shrink-0 border-l border-[#222A35] bg-[#0F141B] flex flex-col min-h-0">
            <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-[#222A35]">
              <div className="text-[13px] text-white truncate flex-1">{preview.kind === "table" ? preview.title : preview.kind === "form" ? preview.form.title : preview.kind === "design" ? "Visualizer" : "Financial report"}</div>
              {preview.kind === "table" && <button onClick={() => exportCsv(preview.head, preview.rows)} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#FF8A47] hover:bg-[#161C24] inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export to CSV</button>}
              {preview.kind === "form" && onOpenForm && <button onClick={() => onOpenForm(preview.form)} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] inline-flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> Open in Form Builder</button>}
              <button onClick={() => setPreview(null)} title="Close preview" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {preview.kind === "table" && (
                <div className="rounded-lg border border-[#222A35] overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-[#161C24] text-[#8A95A5]"><tr>{preview.head.map((h, k) => <th key={k} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h.replace(/\*\*/g, "")}</th>)}</tr></thead>
                    <tbody>{preview.rows.map((r, k) => <tr key={k} className="border-t border-[#222A35]">{r.map((c, n) => <td key={n} className={`px-3 py-2 align-top ${/\*\*/.test(c) ? "text-white font-semibold" : "text-[#C2CAD6]"}`}>{c.replace(/\*\*/g, "")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
              {preview.kind === "form" && (
                <div>
                  <div className="text-[12px] text-[#8A95A5] mb-3">{preview.form.trade} · {preview.form.category} · {preview.form.items.length} items</div>
                  <ol className="space-y-1.5">
                    {preview.form.items.map((it: any, k: number) => (
                      <li key={k} className="rounded-lg border border-[#222A35] bg-[#11161D] px-3 py-2 text-[13px] text-[#D5DBE3] flex gap-2.5">
                        <span className="text-[#5B6675] w-5 shrink-0 text-right">{k + 1}.</span>
                        <span>{it.question || it.label || it.text || it.title || String(it)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {preview.kind === "financial" && canSeeMoney && <FinancialReports />}
              {preview.kind === "design" && <DesignPreview d={preview.d} />}
            </div>
          </aside>
        </>
      )}
      {designOpen && <DesignStudio onClose={() => setDesignOpen(false)} />}
    </div>
  );
}
