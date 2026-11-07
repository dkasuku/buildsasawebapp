// Financial reports built from a project's real ledger, budget categories and
// invoices. Opens in the Buildsasa AI page's preview pane (Money category).
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, TrendingUp, Download } from "lucide-react";
import api, { type ProjectOverviewDto } from "../../services/api";
import { useProjects } from "./useProjects";

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

export function FinancialReports() {
  // Real projects for the report picker; fProj holds the project ID.
  const { projects: projectOptions } = useProjects();
  const [fProj, setFProj] = useState(""); const [fType, setFType] = useState<"summary"|"breakdown"|"cashflow">("summary"); const [fResult, setFResult] = useState<{title:string;lines:string[]}|null>(null);
  const [fLoading, setFLoading] = useState(false);
  useEffect(() => { if (!fProj && projectOptions.length) setFProj(projectOptions[0].id); }, [projectOptions, fProj]);
  const fProjName = projectOptions.find((p) => p.id === fProj)?.name ?? "";
  // Fetch the project's actual financial position, then format it.
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

  return (
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
  );
}
