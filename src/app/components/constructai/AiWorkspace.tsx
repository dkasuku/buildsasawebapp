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
  Trash2, Wallet, X, ChevronDown, ImagePlus, Paperclip, Mic, AudioLines, Zap, Receipt, PiggyBank, Package, Users, Truck, DraftingCompass, AlertTriangle, Building2, CheckCircle2, FileText, ListChecks, ShieldAlert, Camera, FileSpreadsheet,
} from "lucide-react";
import api, { type AiBriefItem } from "../../services/api";
import { AnswerTools, SaveCard } from "./AiTools";
import { askedFormat, docTitle, exportAnswer, tableMarkdown } from "./aiDocs";
import { AI_GREETING, AiRichText, exportCsv, type AiAction, type AiDesignResult, type AiFormDraft, type Msg, type QuoteDraft } from "./AiAssistantPanel";
import { DesignCard, DesignPreview } from "./Visualizer";
import { askAi, imageModeFor, type AiSession, type ImageMode } from "./aiSession";
import { QuoteCard, QuoteEditor } from "./QuoteEditor";
import { ActionCard, runAction } from "./aiAgent";
import { CameraModal, isTouch, useVoice } from "./MediaInputs";
import { VoiceChat, speakable } from "./VoiceChat";
import { isViewVisible } from "../../config/features";
import { draftFromAnswer, exportQuote } from "./aiQuote";
import { FinancialReports } from "./BuildflexAI";
import { GettingStarted } from "./GettingStarted";
import { DesignStudio } from "./DesignStudio";

type Tool = { label: string; view?: string; kind?: "design" | "financial" | "photo" };
type Category = { id: string; label: string; icon: any; blurb: string; prompts: string[]; tool?: Tool; money?: boolean };

// Kept in step with AI_CATEGORY_GUIDE in backend/src/server.js.
export const AI_CATEGORIES: Category[] = [
  { id: "site", label: "Today on site", icon: HardHat, blurb: "Tell it the day in one message: workers, work done, deliveries, snags. It fills the daily log, stock and snag list.",
    prompts: ["12 workers today, slab formwork done, 40 bags of cement delivered, crack on the east wall", "What happened on my sites this week?"],
    tool: { label: "Open Daily log", view: "daily-log" } },
  { id: "quotes", label: "Quotes & BOQs", icon: Calculator, blurb: "A priced quote or BOQ in KES from a description, sketch or plan photo, using your own rates. Send it as PDF or on WhatsApp.",
    prompts: ["Quote a 3-bedroom bungalow in Kitengela, about 120 m²", "Price a 50 m perimeter wall in machine-cut stone with a gate"],
    tool: { label: "Open Quotes", view: "quotes" } },
  { id: "invoices", label: "Getting paid", icon: Receipt, money: true, blurb: "Payment requests for finished stages, record M-Pesa payments, and chase clients who are late.",
    prompts: ["Make a payment request for the roofing stage on Kitengela House: KES 850,000", "Mr Kamau paid 200,000 by M-Pesa, reference QWE12AB"],
    tool: { label: "Open Payment requests", view: "invoicing" } },
  { id: "labour", label: "Workers & wages", icon: Users, blurb: "Add your fundis and helpers, mark who came, and get Friday's wage bill ready for M-Pesa.",
    prompts: ["Add Juma, mason, 1,200 a day, 0722 000000", "What is this week's wage bill on Ruiru Maisonette?"],
    tool: { label: "Open Attendance", view: "attendance" } },
  { id: "receipts", label: "Receipts & spending", icon: Wallet, money: true, blurb: "Snap a receipt or supplier invoice and it's filed as spending on the right site.",
    prompts: ["Hardware receipt: 20 bags of cement, KES 15,600, Mwangi Hardware, for Kitengela House", "How much have I spent on Ruiru Maisonette this month?"],
    tool: { label: "Snap a receipt", kind: "photo" } },
  { id: "projects", label: "Clients & updates", icon: Building2, blurb: "Set up a site from a sentence or contract, and send the client a weekly update on WhatsApp.",
    prompts: ["New project: 4-bedroom maisonette in Ruiru for Mr Otieno, KES 9.5M, starting next month", "Write this week's update for my clients"],
    tool: { label: "Open Projects", view: "projects" } },
  { id: "budget", label: "Budgets", icon: PiggyBank, money: true, blurb: "A budget by stage, then budget against what you've really spent.",
    prompts: ["Make a substructure budget for my latest project", "Which of my projects are over budget?"],
    tool: { label: "Open Budget & spending", view: "financials" } },
  { id: "materials", label: "Materials", icon: Package, blurb: "How much cement, ballast, sand, blocks and steel you need, and what's in stock.",
    prompts: ["How many bags of cement, ballast and sand for a 150 m² slab, 150 mm thick?", "How many blocks for a 3-bedroom bungalow?"],
    tool: { label: "Open Materials", view: "equipment" } },
  { id: "planning", label: "Programme", icon: CalendarRange, blurb: "A programme with stages and dates, and what's running late.",
    prompts: ["Draft a programme for a 4-bedroom maisonette, starting 1 December", "What is behind schedule?"],
    tool: { label: "Open Schedule", view: "schedule" } },
  { id: "checklists", label: "Snags & checklists", icon: ClipboardCheck, blurb: "Checklists for each stage and a snag list you can share with the client.",
    prompts: ["Make a checklist before pouring the slab", "List the open snags on Kitengela House"],
    tool: { label: "Open Checklists", view: "checklists" } },
  { id: "design", label: "Designs & renders", icon: Palette, blurb: "Floor plans, 3D renders and interiors to show the client before you build. Uses design credits.",
    prompts: ["Design a modern kitchen for a 3 m × 4 m room with an island", "Render a 3-bedroom bungalow with a hipped roof and stone cladding"],
    tool: { label: "Open AI Design", kind: "design" } },
  { id: "documents", label: "Letters & contracts", icon: FileText, blurb: "Delay notices, client letters and simple contracts, ready as Word or PDF.",
    prompts: ["Write a delay notice to the client: 2 weeks for heavy rain", "Draft a simple labour contract for a masonry crew"] },
];
const catOf = (id?: string) => AI_CATEGORIES.find((c) => c.id === id);

// Shortcuts under the composer. `fill` puts a starter in the box for the user to
// finish; `ask` sends straight away; `photo` opens the photo picker.
const QUICK: { label: string; icon: any; ask?: string; fill?: string; photo?: boolean; money?: boolean }[] = [
  { label: "Write a quote", icon: Calculator, fill: "Write a quote for " },
  { label: "Log today's site work", icon: HardHat, fill: "Log today's site work: " },
  { label: "Snap a receipt or site photo", icon: Camera, photo: true },
  { label: "Weekly client update", icon: FileText, ask: "Write this week's progress update for each of my active projects, ready to send to the clients." },
  { label: "This week's wages", icon: Users, ask: "What is this week's wage bill for each site, worker by worker?" },
  { label: "Chase late payments", icon: Wallet, money: true, ask: "Which payment requests are overdue? Draft a polite but firm WhatsApp reminder for each client." },
];
// What the AI does, shown on the home screen so people know it makes real records, not just chat.
// Each one starts a message with an example the user can finish.
const CAN: { title: string; text: string; icon: any; fill: string; money?: boolean }[] = [
  { title: "Quotes and BOQs", text: "Priced from your own past rates. Send a sketch or plan photo too.", icon: Calculator, fill: "Write a quote for a 3-bedroom bungalow in Kitengela: " },
  { title: "Payment requests", text: "Bill a stage that's done and send it to the client.", icon: Receipt, money: true, fill: "Make a payment request for " },
  { title: "Record payments", text: "\"Kamau paid 200k by M-Pesa\" is filed against the right request.", icon: Wallet, money: true, fill: "Record a payment: " },
  { title: "The site day", text: "Workers, work done, deliveries and snags, in one message.", icon: HardHat, fill: "Today on site: " },
  { title: "Muster and wages", text: "Who came, half days, and this week's wage bill.", icon: Users, fill: "Mark the muster: " },
  { title: "Receipts and spending", text: "Snap a receipt and it's filed as spending on the right site.", icon: Camera, money: true, fill: "File this spending: " },
  { title: "Client updates", text: "A weekly progress update ready for WhatsApp.", icon: FileText, fill: "Write this week's update for " },
  { title: "Projects and programme", text: "Start a project with its stages and dates.", icon: CalendarRange, fill: "Start a new project: " },
  { title: "Budgets", text: "A project budget by section, then budget against what you've spent.", icon: PiggyBank, money: true, fill: "Make a budget for " },
  { title: "Checklists and inspections", text: "A checklist for any stage: slab, roofing, wiring, handover.", icon: ListChecks, fill: "Make a checklist for " },
];
// A design's costed materials as a quote table, so it can be downloaded or saved as a quote.
const estimateText = (m: Msg) => {
  const e = m.design?.estimate;
  if (!e?.items?.length) return m.text;
  const n = (v: number) => Math.round(v).toLocaleString("en-KE");
  return [`Design brief: ${m.design!.prompt}`, "", "| Item | Description | Quantity | Unit | Rate (KES) | Amount (KES) |", "|---|---|---|---|---|---|",
    ...e.items.map((it) => `| ${it.item} | ${it.description} | ${it.quantity} | ${it.unit} | ${n(it.rate)} | ${n(it.amount)} |`),
    `| **Total** | | | | | **${n(e.total)}** |`, "", e.assumptions ? `Assumptions: ${e.assumptions}` : "", e.notes || ""].join("\n").trim();
};
// The project a create-project card in this reply made, for later cards that say "projectId":"new".
const createdProjectId = (m: Msg) => { for (const a of m.actions || []) if (a.kind === "do" && a.action === "create-project" && a.done?.id) return a.done.id; return undefined; };
const BRIEF_ICON: Record<string, any> = { wallet: Wallet, calculator: Calculator, hardhat: HardHat, file: FileText, list: ListChecks, shield: ShieldAlert, check: CheckCircle2, building: Building2 };

type Preview = { kind: "table"; title: string; head: string[]; rows: string[][] } | { kind: "form"; form: AiFormDraft } | { kind: "financial" } | { kind: "design"; d: AiDesignResult } | { kind: "quote"; i: number };
const DOC_EXT = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; };
const dayGroup = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "Previous 7 days" : days < 30 ? "Previous 30 days" : "Older";
};

// A new owner's first visit: the AI does the onboarding by asking about their
// first site, then sets it up (and invites the client and team) with action
// cards. Shown in the chat so the AI's later turns see what it asked.
const onboardingGreeting = (name: string): Msg => ({
  role: "ai",
  text: `Karibu${name ? `, ${name}` : ""}! I'm Buildsasa AI, your site secretary. Let's set up your first site: what are you building, where, and for whom?`,
});

export function AiWorkspace({ session, canSeeMoney, onNavigate, onOpenProject, onOpenForm, start, onStarted, firstRun, onFirstRunDone }: {
  session: AiSession; canSeeMoney: boolean;
  /** First sign-in of the person setting up the workspace. */
  firstRun?: boolean; onFirstRunDone?: () => void;
  /** A question typed in a module page's ask bar: start a new chat with it. */
  start?: { text: string; images: string[]; key: number; page?: string } | null; onStarted?: () => void;
  onNavigate: (view: string) => void; onOpenProject: (id: string) => void; onOpenForm?: (form: AiFormDraft) => void;
}) {
  const { messages, setMessages, category, setCategory, history, convId, reset, open, remove } = session;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<false | "think" | "read" | "design">(false);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  // Files attached to the next message, as in ChatGPT: photos (a room to
  // redesign, a logo for the quote, a site photo to assess) and documents
  // (PDF, Word, Excel, CSV) the AI reads.
  const [att, setAtt] = useState<{ url: string; name: string; image: boolean }[]>([]);
  const [imgMode, setImgMode] = useState<ImageMode>("auto");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [camOpen, setCamOpen] = useState(false);
  // Phones get their own camera app; laptops get the webcam in a dialog.
  const openCamera = () => (isTouch() ? camRef.current?.click() : setCamOpen(true));
  const attach = async (list: FileList | null) => {
    const picked = Array.from(list || []).filter((f) => f.type.startsWith("image/") || DOC_EXT.test(f.name)).slice(0, 4 - att.length);
    if (!picked.length) { if (list?.length) toast.error("Attach photos, or PDF, Word, Excel or CSV files."); return; }
    setUploading(true);
    try {
      const { urls, failed } = await api.uploadFiles(picked);
      failed.forEach((f) => toast.error(`${f.name}: ${f.error}`));
      const ok = picked.filter((f) => !failed.some((x) => x.name === f.name));
      setAtt((a) => [...a, ...urls.map((url, k) => ({ url, name: ok[k]?.name || "file", image: !!ok[k]?.type.startsWith("image/") }))].slice(0, 4));
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e: any) { toast.error(e?.message || "Upload failed. Try again."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const [showHistory, setShowHistory] = useState(() => { try { return localStorage.getItem("buildsasa-ai-history") !== "0" && window.innerWidth >= 1024; } catch { return true; } });
  const [find, setFind] = useState("");
  const [catMenu, setCatMenu] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cats = AI_CATEGORIES.filter((c) => canSeeMoney || !c.money);
  const cat = catOf(category);
  const started = messages.some((m) => m.role === "user");

  useEffect(() => { api.me().then((u) => setName((u?.name || "").trim().split(/\s+/)[0] || "")).catch(() => {}); }, []);
  // Today's brief: what needs attention, from the workspace data.
  const [brief, setBrief] = useState<AiBriefItem[] | null>(null);
  // No company name yet (e.g. Google sign-in): ask for it, since it heads every quote.
  const [coName, setCoName] = useState<{ ask: boolean; value: string; busy?: boolean }>({ ask: false, value: "" });
  useEffect(() => {
    const load = () => api.getCompany().then((c) => setCoName({ ask: !!(c.nameIsDefault && c.canEdit), value: "" })).catch(() => {});
    load();
    window.addEventListener("buildsasa:company-updated", load);
    return () => window.removeEventListener("buildsasa:company-updated", load);
  }, []);
  const saveCoName = async () => {
    const n = coName.value.trim();
    if (!n) return;
    setCoName((x) => ({ ...x, busy: true }));
    try { const c = await api.updateCompany({ name: n }); toast.success(`Your quotes and invoices now show ${c.name}.`); setCoName({ ask: false, value: "" }); }
    catch (e: any) { toast.error(e?.message || "Couldn't save the name."); setCoName((x) => ({ ...x, busy: false })); }
  };
  useEffect(() => { if (!started) api.aiBrief().then((r) => setBrief(r.items)).catch(() => setBrief([])); }, [started]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  useEffect(() => { try { localStorage.setItem("buildsasa-ai-history", showHistory ? "1" : "0"); } catch { /* noop */ } }, [showHistory]);
  // Grow the composer with its text, up to a limit.
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(220, el.scrollHeight) + "px"; } }, [q]);

  const run = (a: AiAction) => { if (a.kind === "open") onNavigate(a.view); else if (a.kind === "project") onOpenProject(a.id); };
  // Update one action on one message (a draft saved, a quote card added).
  const patchActions = (i: number, f: (a: AiAction[]) => AiAction[]) => setMessages((m) => m.map((x, k) => (k === i ? { ...x, actions: f(x.actions || []) } : x)));
  // "Do all": run the reply's pending actions in order; a project created first
  // is used by the later steps that say "projectId":"new".
  const [doingAll, setDoingAll] = useState(false);
  const doAll = async (i: number, list: Msg[] = messages) => {
    setDoingAll(true);
    let created = createdProjectId(list[i]);
    const acts = list[i]?.actions || [];
    const did: string[] = [], failed: string[] = [];
    for (let k = 0; k < acts.length; k++) {
      const a = acts[k];
      if (a.kind !== "do" || a.done) continue;
      try {
        const done = await runAction(a, created);
        if (a.action === "create-project" && done.id) created = done.id;
        patchActions(i, (as) => as.map((x, n) => (n === k && x.kind === "do" ? { ...x, done: { ...done, at: Date.now() } } : x)));
        did.push(a.label || a.action);
      } catch (e: any) {
        failed.push(`${a.label || a.action}: ${e?.message || "didn't work"}`);
        // One step failing (say, an invite to someone already on the team)
        // doesn't stop the rest; it stays on its card to fix and retry.
        toast.error(e?.message || "That step didn't work.");
        if (a.action === "create-project") break;
      }
    }
    setDoingAll(false);
    return { did, failed };
  };
  const patchQuote = (i: number, quote: QuoteDraft) => setMessages((m) => m.map((x, k) => (k === i ? { ...x, quote } : x)));
  const send = async (raw?: string, imgs?: string[], fresh = false, spoken = false) => {
    // Attachments go with typed, spoken or one-tap questions; an ask-bar start brings its own.
    const images = imgs === undefined ? att.filter((a) => a.image).map((a) => a.url) : imgs;
    const files = imgs === undefined ? att.filter((a) => !a.image).map(({ url, name }) => ({ url, name })) : [];
    const mode: ImageMode = imgs === undefined ? imgMode : "auto";
    const text = (raw ?? q).trim() || (images.length ? (mode === "logo" ? "Use this as my logo on quotes" : "What is this photo? File it where it belongs.") : files.length ? "What is this document? Do what it needs: file it, price it or record it." : "");
    if (!text || busy || uploading) return null;
    // The first message of a new owner opens the setup conversation.
    const onboarding = !!firstRun && !fresh && !started;
    if (onboarding) { setCategory("onboarding"); onFirstRunDone?.(); }
    const before = onboarding ? [onboardingGreeting(name)] : fresh ? [] : messages;
    const designing = images.length > 0 && imageModeFor(text, mode) === "design";
    const asked: Msg = { role: "user", text, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) };
    setMessages((m) => onboarding ? [...before, asked] : [...m, asked]);
    setQ(""); setAtt([]); setImgMode("auto"); setBusy(designing ? "design" : files.length || images.length ? "read" : "think");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await askAi(text, before, { signal: controller.signal, category: designing ? "design" : fresh ? "general" : onboarding ? "onboarding" : category, page: (fresh && pageRef.current) || "Buildsasa AI", images, files, imageMode: mode, voice: spoken });
      // The reply lands after the question: its index is the old length + 1.
      const idx = (fresh ? 1 : before.length) + 1;
      setMessages((m) => [...m, reply]);
      if (reply.form) setPreview({ kind: "form", form: reply.form });
      if (reply.design && window.innerWidth >= 1280) setPreview({ kind: "design", d: reply.design });
      if (reply.quote && window.innerWidth >= 1280) setPreview({ kind: "quote", i: idx });
      // "…as a PDF / in Excel": hand over the file straight away.
      const fmt = askedFormat(text);
      if (fmt && reply.quote) exportQuote(reply.quote, fmt).catch(() => {});
      else if (fmt && !reply.design && !reply.form && reply.text.length > 40) exportAnswer(reply.text, fmt, docTitle(text)).catch(() => {});
      // "Open the punch list": go there. The chat carries on in the docked panel.
      if (reply.actions?.[0] && (reply.actions[0].kind === "open" || reply.actions[0].kind === "project")) run(reply.actions[0]);
      abortRef.current = null; setBusy(false);
      const list: Msg[] = []; list[idx] = reply;  // doAll reads only the reply, at its index in the chat
      return { reply, list, idx };
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Stopped." }]);
    }
    abortRef.current = null; setBusy(false);
    return null;
  };
  // ── Voice chat: talk, hear the answer, say "yes" to confirm its action cards ──
  // One line per action with the details that matter, so a misheard name or
  // amount is caught before anything is created.
  const actionSummary = (a: AiAction) => {
    if (a.kind !== "do") return "";
    const d = a.data || {};
    const lines = Array.isArray(d.items) ? d.items : [];
    const total = lines.reduce((s: number, l: any) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
    const bits = [d.name, d.title, d.unit && `unit ${d.unit}`, d.clientName && `for ${d.clientName}`, d.city && `in ${d.city}`, d.email && `email ${d.email}`, d.role, d.amountKES && `${Number(d.amountKES).toLocaleString("en-KE")} shillings`, total && `${Math.round(total).toLocaleString("en-KE")} shillings`, d.date || d.dueDate].filter(Boolean);
    return `${(a.label || a.action).replace(/-/g, " ")}${bits.length ? `: ${bits.join(", ")}` : ""}`;
  };
  const [voiceChat, setVoiceChat] = useState(false);
  const lastTurn = useRef<{ list: Msg[]; idx: number } | null>(null);
  const voiceTurn = async (said: string): Promise<string> => {
    const t = lastTurn.current;
    const pending = t ? (t.list[t.idx]?.actions || []).filter((a) => a.kind === "do" && !a.done) : [];
    if (t && pending.length && /^(yes|yeah|yep|ok(ay)?|sure|go ahead|do it|do all|confirm|proceed|please do|ndio|sawa)\b/i.test(said.trim())) {
      lastTurn.current = null;
      const r = await doAll(t.idx, t.list);
      return r.did.length ? `Done: ${r.did.join(", ")}.${r.failed.length ? ` But ${r.failed.join("; ")}. It's on screen to fix.` : ""}` : `That didn't work: ${r.failed.join("; ")}. Check the card on screen.`;
    }
    if (t && pending.length && /^(no|nope|cancel|don't|do not|stop|hapana)\b/i.test(said.trim())) { lastTurn.current = null; return "Okay, I won't do that."; }
    const r = await send(said, undefined, false, true);
    if (!r) return "Sorry, I couldn't do that. Try again.";
    lastTurn.current = { list: r.list, idx: r.idx };
    const m = r.reply;
    const acts = (m.actions || []).filter((a) => a.kind === "do");
    return [speakable(m.text),
      m.quote ? "The quote is on screen. You can edit it or download it." : "",
      m.design ? "The design is on screen." : "",
      acts.length ? `To check: ${acts.map(actionSummary).join("; ")}. Shall I go ahead? Say yes, or tell me what to change.` : ""].filter(Boolean).join(" ");
  };
  const stop = () => abortRef.current?.abort();
  // Speak: the words are sent as soon as they are transcribed, so the AI just does it.
  const [heardSend, setHeardSend] = useState(0);
  const heardTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelHeard = () => { if (heardTimer.current) clearInterval(heardTimer.current); heardTimer.current = null; setHeardSend(0); };
  const voice = useVoice((t) => {
    setQ(t); setHeardSend(5);
    if (heardTimer.current) clearInterval(heardTimer.current);
    heardTimer.current = setInterval(() => setHeardSend((n) => {
      if (n <= 1) { if (heardTimer.current) clearInterval(heardTimer.current); heardTimer.current = null; setTimeout(() => sendHeard.current(), 0); return 0; }
      return n - 1;
    }), 1000);
  });
  const sendHeard = useRef(() => {});
  sendHeard.current = () => send(undefined, undefined, false, true);
  useEffect(() => () => { if (heardTimer.current) clearInterval(heardTimer.current); }, []);
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
    abortRef.current?.abort(); reset("general"); setPreview(null); setQ(""); setAtt([]);
    send(start.text, start.images, true);
    onStarted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start?.key]);
  const newChat = (c = "general") => { abortRef.current?.abort(); reset(c); setPreview(null); setQ(""); requestAnimationFrame(() => inputRef.current?.focus()); };
  const pick = (c: Category) => { if (started) newChat(c.id); else setCategory(category === c.id ? "general" : c.id); };
  const useTool = (t: Tool) => { if (t.kind === "design") setDesignOpen(true); else if (t.kind === "photo") fileRef.current?.click(); else if (t.kind === "financial") setPreview({ kind: "financial" }); else if (t.view) onNavigate(t.view); };
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
      {att.length > 0 && (
        <div className="px-1 pb-2">
          <div className="flex flex-wrap gap-2">
            {att.map((a) => (
              <div key={a.url} className={`relative rounded-lg overflow-hidden border border-[#222A35] ${a.image ? "w-16 h-16" : "h-16 max-w-[220px] bg-[#0A0E14] pl-2.5 pr-7 flex items-center gap-2"}`}>
                {a.image ? <img src={a.url} alt="Attached" className="w-full h-full object-cover" />
                  : <><FileText className="w-5 h-5 text-[#FF8A47] shrink-0" /><span className="text-[11.5px] text-[#C2CAD6] line-clamp-2 break-all">{a.name}</span></>}
                <button onClick={() => setAtt((x) => x.filter((y) => y.url !== a.url))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-[#ffffff] flex items-center justify-center" aria-label={`Remove ${a.name}`}><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
          {att.some((a) => a.image) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2" role="radiogroup" aria-label="What is the photo for?">
              <span className="text-[11px] text-[#5B6675] mr-0.5">Photo is for:</span>
              {([["auto", "Let AI decide"], ["logo", "My logo on the quote"], ["ask", "Ask about it"]] as [ImageMode, string][]).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={imgMode === k} onClick={() => setImgMode(k)} className={`h-6 px-2 rounded-full text-[11px] border ${imgMode === k ? "border-[#FF6B1A]/50 bg-[#FF6B1A]/10 text-[#FF8A47]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.docx,.xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => attach(e.target.files)} />
      {heardSend > 0 && (
        <div className="mx-1 mb-1.5 flex items-center gap-2 rounded-lg bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 px-2.5 py-1.5 text-[12px] text-[#FF8A47]">
          <Mic className="w-3.5 h-3.5 shrink-0" /><span className="flex-1">Check what I heard. Sending in {heardSend}s.</span>
          <button onClick={() => { cancelHeard(); inputRef.current?.focus(); }} className="underline">Fix it</button>
          <button onClick={() => { cancelHeard(); send(undefined, undefined, false, true); }} className="h-6 px-2 rounded-md bg-[#FF6B1A] text-[#ffffff]">Send now</button>
        </div>
      )}
      <textarea ref={inputRef} aria-label="Message Buildsasa AI" value={q} onChange={(e) => { cancelHeard(); setQ(e.target.value); }} onFocus={cancelHeard} rows={big ? 2 : 1}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder={cat ? `Ask about ${cat.label.toLowerCase()}…` : firstRun && !started ? "e.g. A 3-bedroom bungalow in Kitengela for Mr Kamau, KES 6.5M, starting next month" : "Tell me what happened on site, or ask for a quote, payment request or wage bill…"}
        className="w-full resize-none bg-transparent px-2 py-1 text-[16px] sm:text-[14px] text-white placeholder:text-[#5B6675] focus:outline-none" />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
      {voice.state === "recording" ? (
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse" />
          <span className="text-[13px] text-white">Listening… {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")}</span>
          <span className="text-[11.5px] text-[#8A95A5] hidden sm:inline">Say what you want done, e.g. "Create a project for a 4-bedroom house in Ruiru and invite Jane as site engineer"</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={voice.cancel} className="h-9 px-3 rounded-xl border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white">Cancel</button>
            <button onClick={voice.stop} aria-label="Stop and send" className="h-9 px-3 rounded-xl bg-[#FF6B1A] text-[#ffffff] text-[12.5px] inline-flex items-center gap-1.5"><Square className="w-3 h-3 fill-current" /> Send</button>
          </div>
        </div>
      ) : (
      <div className="flex items-center gap-1.5 sm:gap-2 mt-1">
        <button onClick={() => fileRef.current?.click()} disabled={uploading || !!busy} title="Attach photos or documents: a room to redesign, your logo, a site photo, a BOQ, drawing or tender (PDF, Word, Excel)" aria-label="Attach files" className="h-9 w-9 sm:h-8 sm:w-8 shrink-0 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] flex items-center justify-center disabled:opacity-50">{uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}</button>
        <button onClick={openCamera} disabled={uploading || !!busy} title="Take a photo" aria-label="Take a photo" className="h-9 w-9 sm:h-8 sm:w-8 shrink-0 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] flex items-center justify-center disabled:opacity-50"><Camera className="w-4 h-4" /></button>
        {cat ? (
          <button onClick={() => setCategory("general")} className="h-8 min-w-0 pl-2.5 pr-2 rounded-full bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 text-[#FF8A47] text-[12px] inline-flex items-center gap-1.5" title="Remove the focus">
            <cat.icon className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{cat.label}</span> <X className="w-3.5 h-3.5 shrink-0" />
          </button>
        ) : (
          <span className="text-[11.5px] text-[#5B6675] pl-1 hidden md:inline truncate">Type, talk, snap a photo or attach a file.</span>
        )}
        {cat?.tool && (!cat.money || canSeeMoney) && (!cat.tool.view || isViewVisible(cat.tool.view as any)) && cat.tool.kind !== "design" && (
          <button onClick={() => useTool(cat.tool!)} className="h-8 px-2.5 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white text-[12px] hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap"><ArrowUpRight className="w-3.5 h-3.5" /> {cat.tool.label}</button>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {false && !busy && <button onClick={() => setVoiceChat(true)} disabled={uploading} title="Voice chat: talk and hear the answer, hands-free" aria-label="Voice chat" className="h-9 px-2.5 rounded-xl border border-[#FF6B1A]/40 text-[#FF8A47] hover:bg-[#FF6B1A]/10 inline-flex items-center gap-1.5 text-[12.5px] disabled:opacity-60"><AudioLines className="w-4 h-4" /><span className="hidden sm:inline">Voice chat</span></button>}
          {!busy && <button onClick={voice.start} disabled={voice.state !== "idle" || uploading} title="Speak instead of typing" aria-label="Speak" className="h-9 w-9 rounded-xl border border-[#222A35] text-[#C2CAD6] hover:text-white flex items-center justify-center disabled:opacity-60">{voice.state === "transcribing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}</button>}
          {busy
            ? <button onClick={stop} title="Stop" className="h-9 w-9 rounded-xl bg-[#222A35] text-white flex items-center justify-center"><Square className="w-3.5 h-3.5 fill-current" /></button>
            : <button onClick={() => send()} disabled={(!q.trim() && !att.length) || uploading} title="Send" aria-label="Send" className="h-9 w-9 rounded-xl bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-35"><ArrowUp className="w-4 h-4" /></button>}
        </div>
      </div>
      )}
    </div>
  );

  return (
    <div className="h-full flex min-h-0 bg-[#0A0E14]">
      {voiceChat && <VoiceChat onTurn={voiceTurn} onClose={() => { setVoiceChat(false); lastTurn.current = null; }} />}
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
            {/* Categories as a dropdown, so the history list keeps the room. */}
            <div className="px-3 pb-2 relative">
              <button onClick={() => setCatMenu((v) => !v)} aria-expanded={catMenu} aria-haspopup="listbox"
                className="w-full h-9 px-2.5 rounded-lg border border-[#222A35] bg-[#0A0E14] text-[12.5px] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] inline-flex items-center gap-2">
                {cat ? <cat.icon className="w-4 h-4 text-[#FF6B1A]" /> : <Sparkles className="w-4 h-4 text-[#8A95A5]" />}
                <span className="truncate flex-1 text-left">{cat ? cat.label : "Start a chat about…"}</span>
                <ChevronDown className={`w-4 h-4 text-[#5B6675] transition-transform ${catMenu ? "rotate-180" : ""}`} />
              </button>
              {catMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCatMenu(false)} />
                  <div role="listbox" aria-label="Categories" className="absolute left-3 right-3 top-[calc(100%-4px)] z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-[#222A35] bg-[#11161D] shadow-[0_12px_32px_rgba(0,0,0,0.25)] py-1">
                    {cats.map((c) => (
                      <button key={c.id} role="option" aria-selected={category === c.id} onClick={() => { setCatMenu(false); newChat(c.id); }}
                        className={`w-full h-8 px-2.5 text-[12.5px] inline-flex items-center gap-2 ${category === c.id ? "bg-[#FF6B1A]/10 text-[#FF8A47]" : "text-[#C2CAD6] hover:bg-[#161C24] hover:text-white"}`}>
                        <c.icon className="w-4 h-4 shrink-0" /> <span className="truncate">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
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

        {!started && firstRun ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 pt-[12vh] pb-10">
              <h1 className="text-center text-[32px] sm:text-[38px] text-white font-display tracking-tight flex items-center justify-center gap-3">
                <Sparkles className="w-8 h-8 text-[#FF6B1A]" /> Karibu{name ? `, ${name}` : ""}
              </h1>
              <p className="text-center text-[14px] text-[#C2CAD6] mt-3 max-w-xl mx-auto leading-relaxed">
                I'm Buildsasa AI, your site secretary. Let's set up your first site: <span className="text-white">what are you building, where, and for whom?</span> Type it, say it, or attach a drawing or BOQ.
              </p>
              <div className="mt-7">{composer(true)}</div>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                <button onClick={() => { setQ("My first site is a "); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }}
                  className="h-8 px-3 rounded-full border border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/50 hover:text-white text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#FF8A47]" /> Describe my first site
                </button>
                <button onClick={() => fileRef.current?.click()}
                  className="h-8 px-3 rounded-full border border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/50 hover:text-white text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-[#FF8A47]" /> Set it up from a drawing or BOQ
                </button>
                <button onClick={() => onFirstRunDone?.()}
                  className="h-8 px-3 rounded-full text-[12.5px] text-[#8A95A5] hover:text-white inline-flex items-center">
                  Skip, I'll look around
                </button>
              </div>
            </div>
          </div>
        ) : !started ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 pt-[12vh] pb-10">
              <h1 className="text-center text-[32px] sm:text-[38px] text-white font-display tracking-tight flex items-center justify-center gap-3">
                <Sparkles className="w-8 h-8 text-[#FF6B1A]" /> {greeting()}{name ? `, ${name}` : ""}
              </h1>
              <p className="text-center text-[13.5px] text-[#8A95A5] mt-2">Tell me what happened on site, or what you need done. Type, talk or snap a photo.</p>
              {coName.ask && (
                <div className="mt-6 rounded-2xl border border-[#FF6B1A]/40 bg-[#FF6B1A]/[0.06] p-4">
                  <div className="text-[14px] text-white font-medium">What's your company called?</div>
                  <div className="text-[12.5px] text-[#8A95A5] mt-0.5">It goes at the top of your quotes and payment requests. Work alone? Leave it and we'll use your own name.</div>
                  <div className="mt-3 flex gap-2">
                    <input aria-label="Company name" value={coName.value} onChange={(e) => setCoName((x) => ({ ...x, value: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && saveCoName()}
                      placeholder="e.g. Mwangi Builders Ltd" className="flex-1 min-w-0 h-10 rounded-lg bg-[#0A0E14] border border-[#222A35] px-3 text-[14px] text-white focus:outline-none focus:border-[#FF6B1A]/60" />
                    <button onClick={saveCoName} disabled={!coName.value.trim() || coName.busy} className="h-10 px-4 rounded-lg bg-[#FF6B1A] text-[#ffffff] text-[13px] font-medium disabled:opacity-50">{coName.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</button>
                  </div>
                  <button onClick={() => setCoName({ ask: false, value: "" })} className="mt-2 text-[12px] text-[#8A95A5] hover:text-white">Not now</button>
                </div>
              )}
              <div className="mt-7">{composer(true)}</div>
              <GettingStarted canSeeMoney={canSeeMoney} onFill={(t) => { setQ(t); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }} />
              {/* Today's brief (idea.md 7.2.1): at most five lines, each with one button for the next step. */}
              {brief && brief.length > 0 && (
                <div className="mt-6 rounded-2xl border border-[#222A35] bg-[#11161D] divide-y divide-[#222A35] overflow-hidden" aria-label="Today">
                  {brief.slice(0, 5).map((b) => { const I = BRIEF_ICON[b.icon] || AlertTriangle; return (
                    <div key={b.id} className="flex items-center gap-3 px-3.5 py-3">
                      <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${b.tone === "red" ? "bg-[#EF4444]/10 text-[#EF4444]" : b.tone === "amber" ? "bg-[#F59E0B]/10 text-[#F59E0B]" : "bg-[#3B82F6]/10 text-[#3B82F6]"}`}><I className="w-4 h-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] text-white leading-snug">{b.title}</span>
                        <span className="block text-[11.5px] text-[#8A95A5] truncate">{b.detail}</span>
                      </span>
                      <button onClick={() => (b.view ? onNavigate(b.view as any) : b.fill ? (setQ(b.fill), requestAnimationFrame(() => inputRef.current?.focus())) : b.ask && send(b.ask))}
                        className="shrink-0 h-9 px-3 rounded-lg border border-[#2C3744] bg-[#161C24] text-[12.5px] text-white hover:border-[#FF6B1A]/60 transition-transform active:scale-[0.97] max-w-[46%] truncate">{b.button || "Open"}</button>
                    </div>
                  ); })}
                </div>
              )}
              {/* One tap to the jobs contractors do every day. */}
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {QUICK.filter((x) => canSeeMoney || !x.money).map((x) => (
                  <button key={x.label} onClick={() => (x.photo ? fileRef.current?.click() : x.fill ? (setQ(x.fill), requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } })) : send(x.ask!))}
                    className="h-8 px-3 rounded-full border border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/50 hover:text-white text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-1.5">
                    <x.icon className="w-3.5 h-3.5 text-[#FF8A47]" /> {x.label}
                  </button>
                ))}
              </div>

              {/* What the AI can do: it makes real records (quotes, payment requests, logs), not just chat. */}
              <div className="mt-8">
                <button onClick={() => window.dispatchEvent(new Event("buildsasa:design"))}
                  className="w-full mb-3 text-left rounded-2xl border border-[#FF6B1A]/40 bg-gradient-to-br from-[#FF6B1A]/15 to-[#FF6B1A]/[0.03] px-4 py-4 flex items-center gap-4 hover:border-[#FF6B1A]/70 transition-[border-color,transform] duration-150 active:scale-[0.99]">
                  <span className="w-11 h-11 shrink-0 rounded-xl bg-[#FF6B1A] flex items-center justify-center"><DraftingCompass className="w-5 h-5 text-white" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-white font-medium">AI Design Studio</span>
                    <span className="block text-[12.5px] text-[#C2CAD6] leading-snug mt-0.5">2D floor plans, 3D renders, facades and interiors from a description or a photo. Show the client before you build.</span>
                  </span>
                  <ArrowUpRight className="w-5 h-5 text-[#FF8A47] shrink-0" />
                </button>
                <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2 px-1">What Buildsasa AI does for you</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CAN.filter((x) => canSeeMoney || !x.money).map((x) => (
                    <button key={x.title} onClick={() => { setQ(x.fill); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }}
                      className="text-left rounded-xl border border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/50 px-3.5 py-3 flex items-start gap-3 transition-[border-color,transform] duration-150 active:scale-[0.98]">
                      <span className="w-8 h-8 shrink-0 rounded-lg bg-[#FF6B1A]/10 flex items-center justify-center"><x.icon className="w-4 h-4 text-[#FF8A47]" /></span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] text-white">{x.title}</span>
                        <span className="block text-[12px] text-[#8A95A5] leading-snug mt-0.5">{x.text}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11.5px] text-[#5B6675] mt-3 px-1">Chatting, quotes, payment requests, logs and budgets are free and unlimited. Designs and renders use Sasa Credits: your plan includes some every month, and you can top up any time in Billing.</p>
              </div>

            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {messages.map((m, i) => m.role === "user" ? (
                  <div key={i} className="group flex justify-end items-end gap-1.5">
                    <button onClick={() => edit(i)} disabled={!!busy} title="Edit and ask again" className="h-7 w-7 rounded-md text-[#5B6675] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[#161C24] flex items-center justify-center disabled:opacity-0"><Pencil className="w-3.5 h-3.5" /></button>
                    <div className="max-w-[80%] flex flex-col items-end gap-1.5">
                      {m.images?.map((u) => <img key={u} src={u} alt="Attached" className="max-w-[240px] max-h-44 rounded-xl border border-[#222A35] object-cover" />)}
                      {m.files?.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="h-10 max-w-[260px] px-3 rounded-xl border border-[#222A35] bg-[#11161D] inline-flex items-center gap-2 text-[12.5px] text-[#C2CAD6] hover:text-white"><FileText className="w-4 h-4 text-[#FF8A47] shrink-0" /><span className="truncate">{f.name}</span></a>)}
                      <div className="rounded-2xl rounded-br-md bg-[#161C24] text-white text-[14px] leading-relaxed px-4 py-2.5 whitespace-pre-wrap">{m.text}</div>
                    </div>
                  </div>
                ) : i === 0 && m.text === AI_GREETING.text ? null : (
                  <div key={i} className="flex gap-3">
                    <span className="w-8 h-8 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /></span>
                    <div className="min-w-0 flex-1 pt-1 text-[14px] leading-relaxed text-[#D5DBE3]">
                      <AiRichText text={m.text} onPreview={(head, rows) => setPreview({ kind: "table", title: messages[i - 1]?.text.slice(0, 80) || "Table", head, rows })} />
                      {m.design && <div className="mt-3"><DesignCard d={m.design} onPreview={() => setPreview({ kind: "design", d: m.design! })} /></div>}
                      {m.actions?.map((a, k) => a.kind === "save" ? (
                        <SaveCard key={`s${k}`} action={a} text={estimateText(m)} onOpen={onNavigate}
                          onSaved={(id) => patchActions(i, (as) => as.map((x, n) => (n === k && x.kind === "save" ? { ...x, savedId: id } : x)))}
                          onDismiss={a.savedId ? undefined : () => patchActions(i, (as) => as.filter((_, n) => n !== k))} />
                      ) : a.kind === "do" ? (
                        <ActionCard key={`d${k}-${a.action}`} action={a} onOpen={onNavigate}
                          newProjectId={createdProjectId(m)}
                          onDone={(done) => patchActions(i, (as) => as.map((x, n) => (n === k && x.kind === "do" ? { ...x, done } : x)))}
                          onChange={(data) => patchActions(i, (as) => as.map((x, n) => (n === k && x.kind === "do" ? { ...x, data } : x)))}
                          onUndo={() => patchActions(i, (as) => as.map((x, n) => (n === k && x.kind === "do" ? { ...x, done: undefined } : x)))}
                          onDismiss={() => patchActions(i, (as) => as.filter((_, n) => n !== k))} />
                      ) : null)}
                      {(m.actions || []).filter((a) => a.kind === "do" && !a.done).length > 1 && (
                        <button onClick={() => doAll(i)} disabled={doingAll} className="mt-2.5 h-10 px-4 rounded-xl bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[13px] font-medium inline-flex items-center gap-2 disabled:opacity-60">
                          {doingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Do all {(m.actions || []).filter((a) => a.kind === "do" && !a.done).length}
                        </button>
                      )}
                      {m.quote && <QuoteCard q={m.quote} onChange={(nq) => patchQuote(i, nq)} onEdit={() => setPreview({ kind: "quote", i })} onOpenQuotes={() => onNavigate("quotes")} />}
                      {!m.quote && !m.actions?.some((a) => a.kind === "do") && (m.design ? !!m.design.estimate?.items?.length : m.text.length > 60 && !/^(I couldn't|Stopped)/.test(m.text)) && (
                        <AnswerTools text={estimateText(m)} question={m.design ? `Design estimate — ${m.design.prompt}` : messages[i - 1]?.text}
                          onSaveQuote={() => {
                            // Turn this answer's priced table into an editable quote.
                            const prev = [...messages.slice(0, i)].reverse().find((x) => x.quote)?.quote;
                            const d = draftFromAnswer(estimateText(m), { title: m.design ? m.design.prompt.slice(0, 80) : docTitle(messages[i - 1]?.text) }, prev);
                            if (d) { patchQuote(i, d); setPreview({ kind: "quote", i }); }
                          }} />
                      )}
                      {(!!m.form || !!m.actions?.some((a) => a.kind === "open" || a.kind === "project")) && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {m.form && <button onClick={() => setPreview({ kind: "form", form: m.form! })} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-3 py-1.5 text-[12px] font-medium"><ClipboardList className="w-3.5 h-3.5" /> Preview checklist</button>}
                          {m.actions?.filter((a) => a.kind === "open" || a.kind === "project").map((a, k) => <button key={k} onClick={() => run(a)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A47] hover:bg-[#FF6B1A]/25 px-3 py-1.5 text-[12px] font-medium"><ArrowUpRight className="w-3.5 h-3.5" /> Open {a.label}</button>)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <div className="flex gap-3"><span className="w-8 h-8 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-[#FF6B1A] animate-pulse" /></span><div className="pt-1.5 text-[13px] text-[#8A95A5] inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {busy === "design" ? "Designing your space and pricing the materials… this takes up to a minute." : busy === "read" ? "Reading your files…" : "Thinking…"}</div></div>}
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
              <div className="text-[13px] text-white truncate flex-1">{preview.kind === "table" ? preview.title : preview.kind === "form" ? preview.form.title : preview.kind === "design" ? "Visualizer" : preview.kind === "quote" ? `Edit quote${messages[preview.i]?.quote?.quoteNumber ? ` · ${messages[preview.i].quote!.quoteNumber}` : ""}` : "Financial report"}</div>
              {preview.kind === "table" && <>
                <button onClick={() => exportAnswer(tableMarkdown(preview.head, preview.rows), "pdf", preview.title)} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6] hover:bg-[#161C24] inline-flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> PDF</button>
                <button onClick={() => exportAnswer(tableMarkdown(preview.head, preview.rows), "xlsx", preview.title)} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#FF8A47] hover:bg-[#161C24] inline-flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
                <button onClick={() => exportCsv(preview.head, preview.rows)} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:bg-[#161C24] inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> CSV</button>
              </>}
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
              {preview.kind === "quote" && messages[preview.i]?.quote && <QuoteEditor q={messages[preview.i].quote!} onChange={(nq) => patchQuote(preview.i, nq)} onOpenQuotes={() => onNavigate("quotes")} />}
            </div>
          </aside>
        </>
      )}
      {designOpen && <DesignStudio onClose={() => setDesignOpen(false)} />}
      {camOpen && <CameraModal onClose={() => setCamOpen(false)} onCapture={(f) => { const dt = new DataTransfer(); dt.items.add(f); attach(dt.files); }} />}
    </div>
  );
}
