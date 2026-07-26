import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Square, Pencil, SquarePen, ClipboardList, Loader2, CheckCircle2, TrendingUp, Download, MessageSquare } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { AI_GREETING, looksLikeFormRequest, inferTradeCategory, aiErrorText, type Msg, type AiFormDraft } from "./AiAssistantPanel";
import api, { type ProjectOverviewDto } from "../../services/api";
import { useProjects } from "./useProjects";

function aiReply(q: string): string {
  const l = q.toLowerCase();
  if (l.includes("safety") || l.includes("ppe")) return "Ensure all workers wear hard hats, hi-vis vests, safety boots, and gloves. Hold daily toolbox talks. Maintain clear emergency exits and keep first aid kits stocked.";
  if (l.includes("schedule") || l.includes("delay")) return "Break work into weekly milestones with buffer days. Hold daily 15-min standups. Use critical path analysis. Pre-order long-lead materials 4-6 weeks ahead.";
  if (l.includes("budget") || l.includes("cost") || l.includes("overrun")) return "Lock subcontractor rates with fixed-price contracts. Track every variation against the BOQ. Reconcile invoices weekly. Maintain 10-15% contingency.";
  if (l.includes("concrete") || l.includes("rebar")) return "Test slump before every pour. Take cube samples for 7/28-day crush tests. Keep rebar clean with proper cover (25-50mm). Cure for 7 days minimum.";
  if (l.includes("electrical") || l.includes("wiring")) return "Megger test all circuits before energizing (>1 MOhm). Verify earth continuity (<1 Ohm). Properly gland and seal all cables. Label every breaker.";
  if (l.includes("plumbing") || l.includes("drain")) return "Hydrostatic test at 1.5x WP for 30 min with zero drop. Verify drain slopes min 1/4 in/ft. Use approved sealants. Tag all isolation valves.";
  if (l.includes("inspection") || l.includes("quality")) return "Use three-tier QA: (1) crew self-check, (2) trade lead sign-off, (3) independent QC with photos. Log non-conformances with photos and deadlines.";
  if (l.includes("subcontractor")) return "Verify insurance/bonding before site access. Hold pre-start meetings. Require daily photo reports. Process payments only after signed completion certs.";
  if (l.includes("change order") || l.includes("variation")) return "Document in writing immediately. Assess cost/schedule impact within 48h. Obtain written client approval before proceeding. Update BOQ and schedule.";
  return "I'm Buildsasa AI, your construction assistant. I can help with safety, QA checklists, cost control, scheduling, and subcontractor management. What would you like to explore?";
}

// Build a financial report from the project's REAL figures.
//
// This used to be a lookup table of invented budgets keyed by demo project
// names ("Harborfront Tower", …), with a random-number cash flow. Any project
// the user had actually created missed the table entirely and silently got the
// same fallback numbers — a plausible-looking report about nothing. Everything
// below now comes from the project's own ledger, budget categories and invoices,
// and where a figure genuinely isn't recorded yet the report says so.
const KSH = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const USD_TO_KES = 130;

function genFinancial(projectName: string, type: string, ov: ProjectOverviewDto) {
  const f = ov.financials;
  const budget = f.budget * USD_TO_KES;
  const spent = f.actual * USD_TO_KES;
  const cashIn = f.cashIn * USD_TO_KES;
  const cashOut = f.cashOut * USD_TO_KES;
  const header = `Project: ${projectName}`;

  if (type === "summary") {
    const lines = [header];
    if (budget > 0) {
      const pct = Math.round((spent / budget) * 100);
      const variance = spent - budget;
      lines.push(
        `Budget: ${KSH(budget)}`,
        `Spent to date: ${KSH(spent)} (${pct}% of budget)`,
        `Remaining: ${KSH(budget - spent)}`,
        `Position: ${variance > 0 ? `Over budget by ${KSH(variance)}` : `Under budget by ${KSH(Math.abs(variance))}`}`,
      );
    } else {
      lines.push("Budget: not set — add cost categories in Financials to track budget vs. spend.");
      if (spent > 0) lines.push(`Recorded spend: ${KSH(spent)}`);
    }
    lines.push(
      `Cash in: ${KSH(cashIn)}`,
      `Cash out: ${KSH(cashOut)}`,
      `Net cash: ${KSH(cashIn - cashOut)}`,
      `Committed to subcontracts: ${KSH(f.committed * USD_TO_KES)}`,
      `Invoiced: ${KSH(f.invoicedTotal)} · unpaid ${KSH(f.invoicedUnpaid)}`,
      `Change orders raised: ${ov.counts.changeOrders}`,
    );
    return { title: "Financial Summary", lines };
  }

  if (type === "breakdown") {
    if (!f.expenses.length) {
      return { title: "Cost Breakdown", lines: [header, "No cost categories recorded for this project yet.", "Add them in Financials and this breakdown will fill in."] };
    }
    const totalActual = f.expenses.reduce((s, e) => s + (Number(e.actualUSD) || 0), 0);
    return {
      title: "Cost Breakdown",
      lines: [
        header,
        ...f.expenses.map((e) => {
          const a = (Number(e.actualUSD) || 0) * USD_TO_KES;
          const b = (Number(e.budgetUSD) || 0) * USD_TO_KES;
          const share = totalActual > 0 ? Math.round(((Number(e.actualUSD) || 0) / totalActual) * 100) : 0;
          return `${e.name}: ${KSH(a)} of ${KSH(b)} budget (${share}% of total spend)`;
        }),
        `Total: ${KSH(totalActual * USD_TO_KES)}`,
      ],
    };
  }

  // Cash flow: actuals only. A forecast invented from a random multiplier is
  // worse than no forecast, so it is not produced here.
  const lines = [header, `Cash in to date: ${KSH(cashIn)}`, `Cash out to date: ${KSH(cashOut)}`, `Net position: ${KSH(cashIn - cashOut)}`];
  if (f.invoicedUnpaid > 0) lines.push(`Expected in from unpaid invoices: ${KSH(f.invoicedUnpaid)}`);
  const outstanding = f.committed * USD_TO_KES - cashOut;
  if (outstanding > 0) lines.push(`Committed but not yet paid: ${KSH(outstanding)}`);
  if (cashIn === 0 && cashOut === 0) lines.push("No ledger entries recorded for this project yet — add them in Financials.");
  return { title: "Cash Flow", lines };
}

// `messages`/`setMessages` are the SAME session state owned by App, so this
// full-view "Ask AI" tab and the slide-in AiAssistantPanel share one conversation.
export default function BuildflexAI({ role, messages, setMessages, onOpenForm }: { role: Role; messages: Msg[]; setMessages: Dispatch<SetStateAction<Msg[]>>; onOpenForm?: (form: AiFormDraft) => void }) {
  const perms = ROLES[role];
  const [tab, setTab] = useState<"ask"|"financials">("ask");
  const [askIn, setAskIn] = useState(""); const [askLoad, setAskLoad] = useState(false); const chatEnd = useRef<HTMLDivElement>(null);
  const askAbortRef = useRef<AbortController|null>(null);
  const askInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, askLoad]);

  // Real projects for the report picker; fProj holds the project ID.
  const { projects: projectOptions } = useProjects();
  const [fProj, setFProj] = useState(""); const [fType, setFType] = useState<"summary"|"breakdown"|"cashflow">("summary"); const [fResult, setFResult] = useState<{title:string;lines:string[]}|null>(null);
  const [fLoading, setFLoading] = useState(false);
  useEffect(() => { if (!fProj && projectOptions.length) setFProj(projectOptions[0].id); }, [projectOptions, fProj]);

  const askSend = async () => {
    const q = askIn.trim();
    if (!q || askLoad) return;
    const history = messages.map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
    setMessages(m => [...m, { role: "user", text: q }]);
    setAskIn("");
    setAskLoad(true);
    const controller = new AbortController();
    askAbortRef.current = controller;
    try {
      if (looksLikeFormRequest(q)) {
        const res = await api.buildChecklistAI({ prompt: q }, controller.signal);
        const items = Array.isArray(res.items) ? res.items : [];
        const guess = inferTradeCategory(q);
        const trade = res.trade || guess.trade;
        const category = res.category || guess.category;
        const reply = (res.reply || "").trim() || (items.length
          ? `I drafted "${res.title || "a checklist"}" (${trade} · ${category}) with ${items.length} item${items.length > 1 ? "s" : ""}. Open it in the Form Builder to review, edit, and save.`
          : "I couldn't turn that into checklist items — try naming the trade and what to inspect.");
        setMessages(m => [...m, items.length
          ? { role: "ai", text: reply, form: { title: res.title || "Untitled checklist", trade, category, items } }
          : { role: "ai", text: reply }]);
      } else {
        const res = await api.aiAssistant(q, history, controller.signal);
        setMessages(m => [...m, { role: "ai", text: res.answer || aiReply(q) }]);
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) setMessages(m => [...m, { role: "ai", text: "⏹ Stopped." }]);
      else if (looksLikeFormRequest(q)) setMessages(m => [...m, { role: "ai", text: `Form generation failed: ${aiErrorText(err)}. Check that an AI key (OpenAI or DeepSeek) is set and funded on the backend.` }]);
      else setMessages(m => [...m, { role: "ai", text: aiReply(q) }]);
    }
    askAbortRef.current = null;
    setAskLoad(false);
  };
  const askStop = () => { askAbortRef.current?.abort(); };
  const editAsk = (i: number) => {
    if (askLoad) return;
    const m = messages[i]; if (!m || m.role !== "user") return;
    setAskIn(m.text);
    setMessages(arr => arr.slice(0, i));
    requestAnimationFrame(() => askInputRef.current?.focus());
  };
  const newChat = () => { askAbortRef.current?.abort(); setMessages([AI_GREETING]); setAskIn(""); };

  const fProjName = projectOptions.find((p) => p.id === fProj)?.name ?? "";
  // Fetch the project's actual financial position, then format it. The report is
  // no longer generated from a hardcoded table.
  const genFin = async () => {
    if (!fProj) { toast.error("Pick a project for the report"); return; }
    if (fLoading) return;
    setFLoading(true);
    try {
      const ov = await api.getProjectOverview(fProj);
      setFResult(genFinancial(fProjName || ov.project.name, fType, ov));
    } catch (e: any) {
      toast.error(`Could not build the report — ${e?.message || "unknown error"}`);
    } finally {
      setFLoading(false);
    }
  };
  const exportFin = () => { if (!fResult) return; const blob=new Blob([[fResult.title,"",...fResult.lines].join("\n")],{type:"text/plain"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`report-${(fProjName || "project").replace(/\s+/g,"-")}.txt`; a.click(); URL.revokeObjectURL(url); toast.success("Report downloaded"); };

  const TIP = "text-[10px] px-2 py-1 rounded-md bg-[#0A0E14] border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40";
  const BTN = (t: string) => `h-9 px-3 text-[12px] flex items-center gap-1.5 ${tab===t?"bg-[#161C24] text-white":"text-[#8A95A5]"}`;

  return (
    <div className="px-4 sm:px-7 py-6 space-y-6">
      <div><div className="flex items-center gap-2 text-[14px] text-white font-display"><Sparkles className="w-5 h-5 text-[#FF6B1A]" /> Buildsasa AI</div><div className="text-[11px] text-[#8A95A5] mt-0.5">AI assistant for financial reports and building expertise</div></div>
      <div className="flex border border-[#222A35] rounded-md overflow-hidden w-fit">
        <button onClick={()=>setTab("ask")} className={BTN("ask")}><MessageSquare className="w-3 h-3" /> Ask AI</button>
        {perms.financials && <button onClick={()=>setTab("financials")} className={BTN("financials")}><TrendingUp className="w-3 h-3" /> Financial Reports</button>}
      </div>

      {tab==="ask"&&(
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden flex flex-col" style={{height:"calc(100vh - 260px)",minHeight:360}}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#222A35]">
            <div className="text-[11px] text-[#8A95A5]">Shared with the quick-chat panel</div>
            <button onClick={newChat} title="New chat" className="h-7 px-2 rounded-md text-[11px] text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center gap-1.5"><SquarePen className="w-3.5 h-3.5" /> New chat</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m,i)=>(<div key={i} className={`group flex items-end gap-2.5 ${m.role==="user"?"justify-end":"justify-start"}`}>
              {m.role==="ai"&&<div className="w-7 h-7 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5 text-[#FF6B1A]" /></div>}
              {m.role==="user"&&<button onClick={()=>editAsk(i)} disabled={askLoad} title="Edit & re-ask" className="mb-0.5 h-6 w-6 shrink-0 rounded-md text-[#5B6675] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[#161C24] flex items-center justify-center transition-opacity disabled:opacity-0"><Pencil className="w-3.5 h-3.5" /></button>}
              <div className="flex flex-col items-start gap-1.5 max-w-[75%]">
                <div className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${m.role==="user"?"bg-[#3B82F6]/15 text-white border border-[#3B82F6]/30":"bg-[#0A0E14] text-[#E6EAF0] border border-[#222A35]"}`}>{m.text}</div>
                {m.role==="ai"&&m.form&&onOpenForm&&(
                  <button onClick={()=>onOpenForm(m.form!)} className="inline-flex items-center gap-1.5 rounded-md bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#FF8A45] hover:bg-[#FF6B1A]/25 px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"><ClipboardList className="w-3.5 h-3.5" /> Open in Form Builder</button>
                )}
              </div>
            </div>))}
            {askLoad&&<div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5 text-[#FF6B1A]" /></div><div className="bg-[#0A0E14] border border-[#222A35] rounded-xl px-3 py-2"><Loader2 className="w-3.5 h-3.5 text-[#8A95A5] animate-spin" /></div></div>}
            <div ref={chatEnd} />
          </div>
          <div className="p-3 border-t border-[#222A35]">
            <div className="flex items-center gap-2"><input ref={askInputRef} value={askIn} onChange={e=>setAskIn(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); askSend(); } }} placeholder="Ask about safety, scheduling, materials, cost control..." className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />{askLoad?(<button onClick={askStop} title="Stop generating" className="h-9 px-3 rounded-md bg-[#222A35] text-white text-[12px] flex items-center gap-1.5 hover:bg-[#2C3744]"><Square className="w-3 h-3 fill-current" /> Stop</button>):(<button onClick={askSend} disabled={!askIn.trim()} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33] disabled:opacity-40"><Send className="w-3.5 h-3.5" /> Send</button>)}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">{"How do I control project costs?;What PPE is required?;Concrete curing best practices;Electrical QA checklist tips;How to handle change orders?".split(";").map(q=>(<button key={q} onClick={()=>setAskIn(q)} className={TIP}>{q}</button>))}</div>
          </div>
        </div>
      )}

      {tab==="financials"&& perms.financials && (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-[#222A35]"><div className="flex items-center gap-2 text-[13px] text-white font-display"><TrendingUp className="w-4 h-4 text-[#FF6B1A]" /> Financial Report Generator</div><div className="text-[11px] text-[#8A95A5] mt-0.5">Select one of your projects and a report type. Every figure is read from that project’s own ledger, budget categories and invoices.</div></div>
            <div className="p-4 sm:p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Project</div><select value={fProj} onChange={e=>setFProj(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"><option value="">{projectOptions.length?"Select a project…":"No projects yet — create one first"}</option>{projectOptions.map(p=><option key={p.id} value={p.id}>{p.code?`${p.code} · ${p.name}`:p.name}</option>)}</select></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Report Type</div><select value={fType} onChange={e=>setFType(e.target.value as any)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"><option value="summary">Financial Summary</option><option value="breakdown">Cost Breakdown</option><option value="cashflow">Cash Flow (actuals)</option></select></div>
              </div>
              <button onClick={genFin} disabled={fLoading||!fProj} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33] disabled:opacity-50"><TrendingUp className="w-3.5 h-3.5" /> {fLoading?"Building report…":"Generate Report"}</button>
            </div>
          </div>
          {fResult&&(
            <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-[#222A35] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div><div className="text-[13px] text-white font-display flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#22C55E]" /> {fResult.title}</div></div>
                <button onClick={exportFin} className="h-8 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download</button>
              </div>
              <div className="p-4 space-y-1"><pre className="text-[12px] text-[#C2CAD6] whitespace-pre-wrap font-mono leading-relaxed">{fResult.lines.join("\n")}</pre></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
