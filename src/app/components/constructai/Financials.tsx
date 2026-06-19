import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type ExpenseDto, type LedgerEntryDto, type ProjectDto } from "../../services/api";

type LedgerRow = { date: string; desc: string; type: "in" | "out"; category: string; amountUSD: number };
type LedgerEntryWithId = LedgerRow & { id?: string };
const seedLedger: LedgerRow[] = [
  { date: "May 18", desc: "Owner draw #3 received", type: "in", category: "Owner funding", amountUSD: 420000 },
  { date: "May 19", desc: "Concrete supplier progress billing", type: "out", category: "Materials", amountUSD: 88000 },
  { date: "May 20", desc: "Field payroll (wages + overtime)", type: "out", category: "Labor", amountUSD: 152000 },
  { date: "May 21", desc: "Steel change order (approved)", type: "out", category: "Materials", amountUSD: 64000 },
  { date: "May 22", desc: "Owner allowance credit", type: "in", category: "Owner funding", amountUSD: 18000 },
  { date: "May 23", desc: "MEP subcontractor billing", type: "out", category: "Subcontract", amountUSD: 91000 },
  { date: "May 24", desc: "Equipment rental (crane)", type: "out", category: "Equipment", amountUSD: 28000 },
  { date: "May 24", desc: "Site utilities (power/water)", type: "out", category: "Overhead", amountUSD: 7500 },
  { date: "May 25", desc: "Owner draw #4 received", type: "in", category: "Owner funding", amountUSD: 310000 },
  { date: "May 25", desc: "Safety supplies & PPE", type: "out", category: "Overhead", amountUSD: 6200 },
  { date: "May 26", desc: "Interior finishes package", type: "out", category: "Materials", amountUSD: 48000 },
  { date: "May 27", desc: "Subcontractor QA/QC allowance", type: "out", category: "Subcontract", amountUSD: 22000 },
  { date: "May 27", desc: "Owner retention release", type: "in", category: "Owner funding", amountUSD: 40000 },
  { date: "May 28", desc: "Field payroll (regular)", type: "out", category: "Labor", amountUSD: 121000 },
  { date: "May 29", desc: "Change order credit from supplier", type: "in", category: "Materials", amountUSD: 9500 },
];

type ExpenseRow = { name: string; amountUSD: number; budgetUSD: number; color: string };
type ExpenseWithId = ExpenseRow & { id?: string };
const seedExpenses: ExpenseRow[] = [
  { name: "Labor", amountUSD: 420000, budgetUSD: 500000, color: "#FF6B1A" },
  { name: "Materials", amountUSD: 350000, budgetUSD: 420000, color: "#3B82F6" },
  { name: "Subcontract", amountUSD: 280000, budgetUSD: 320000, color: "#8B5CF6" },
  { name: "Equipment", amountUSD: 120000, budgetUSD: 150000, color: "#22C55E" },
  { name: "Overhead", amountUSD: 52000, budgetUSD: 80000, color: "#F97316" },
  { name: "Contingency", amountUSD: 60000, budgetUSD: 100000, color: "#F5A623" },
];

export default function Financials({ role = "Contractor" }: { role?: Role }) {
  const { currency } = useCurrency();
  const perms = ROLES[role];
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [ledgerRows, setLedgerRows] = useState<LedgerEntryWithId[]>(seedLedger);
  const [expenseRows, setExpenseRows] = useState<ExpenseWithId[]>(seedExpenses);
  const [newLedger, setNewLedger] = useState({ date: "", desc: "", type: "out" as "in" | "out", category: "Materials", amountUSD: 0 });
  const [newExpense, setNewExpense] = useState({ name: "", budgetUSD: 0, actualUSD: 0 });

  useEffect(() => {
    api.getProjects().then((ps) => {
      if (ps?.length) {
        setProjects(ps);
        const first = ps[0];
        setProjectId(first.id || first.code);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getProjectLedger(projectId).then((rows: LedgerEntryDto[]) => {
      if (!rows.length) return;
      setLedgerRows(rows.map((r) => ({
        date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        desc: r.desc,
        type: r.type,
        category: r.category,
        amountUSD: r.amountUSD,
        id: r.id,
      })));
    }).catch(() => {});

    api.getProjectExpenses(projectId).then((rows: ExpenseDto[]) => {
      if (!rows.length) return;
      // Simple color palette reuse
      const palette = ["#FF6B1A", "#3B82F6", "#8B5CF6", "#22C55E", "#F97316", "#F5A623"];
      setExpenseRows(rows.map((r, idx) => ({ name: r.name, amountUSD: r.actualUSD, budgetUSD: r.budgetUSD, color: palette[idx % palette.length], id: r.id })));
    }).catch(() => {});
  }, [projectId]);

  const totals = useMemo(() => {
    const cashIn = ledgerRows.filter((l) => l.type === "in").reduce((sum, l) => sum + l.amountUSD, 0);
    const cashOut = ledgerRows.filter((l) => l.type === "out").reduce((sum, l) => sum + l.amountUSD, 0);
    const net = cashIn - cashOut;
    const budget = expenseRows.reduce((s, e) => s + e.budgetUSD, 0);
    const actual = expenseRows.reduce((s, e) => s + e.amountUSD, 0);
    const variance = budget - actual;
    return { cashIn, cashOut, net, budget, actual, variance };
  }, [ledgerRows, expenseRows]);

  const fmt = (amountUSD: number) => formatCurrency(amountUSD, currency);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ledgerData = ledgerRows.map((r) => ({
      Date: r.date,
      Description: r.desc,
      Type: r.type === "in" ? "Income" : "Expense",
      Category: r.category,
      Amount: r.amountUSD,
    }));
    const ws1 = XLSX.utils.json_to_sheet(ledgerData);
    XLSX.utils.book_append_sheet(wb, ws1, "Ledger");

    const expData = expenseRows.map((r) => ({
      Category: r.name,
      Budget: r.budgetUSD,
      Actual: r.amountUSD,
      Variance: r.budgetUSD - r.amountUSD,
      "% Used": `${((r.amountUSD / r.budgetUSD) * 100).toFixed(1)}%`,
    }));
    const ws2 = XLSX.utils.json_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, ws2, "Budget");

    XLSX.writeFile(wb, `Financials_${projectId || "all"}_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Excel export downloaded");
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Financial Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Project: ${projectId || "All Projects"} · Generated: ${new Date().toLocaleDateString()}`, 14, 28);

    // @ts-ignore
    doc.autoTable({
      startY: 36,
      head: [["Date", "Description", "Type", "Category", "Amount"]],
      body: ledgerRows.map((r) => [r.date, r.desc, r.type === "in" ? "Income" : "Expense", r.category, fmt(r.amountUSD)]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [255, 107, 26] },
    });

    // @ts-ignore
    const finalY = doc.lastAutoTable?.finalY || 60;
    doc.setFontSize(11);
    doc.text("Budget Summary", 14, finalY + 10);
    // @ts-ignore
    doc.autoTable({
      startY: finalY + 14,
      head: [["Category", "Budget", "Actual", "Variance", "% Used"]],
      body: expenseRows.map((r) => [
        r.name,
        fmt(r.budgetUSD),
        fmt(r.amountUSD),
        fmt(r.budgetUSD - r.amountUSD),
        `${((r.amountUSD / r.budgetUSD) * 100).toFixed(1)}%`,
      ]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [255, 107, 26] },
    });

    doc.save(`Financials_${projectId || "all"}_${new Date().toISOString().split("T")[0]}.pdf`);
    toast.success("PDF export downloaded");
  };

  const addLedger = async () => {
    if (!projectId) return toast.error("Select a project");
    if (!newLedger.date || !newLedger.desc.trim()) return toast.error("Date and description required");
    const entry: LedgerEntryWithId = { ...newLedger, amountUSD: Number(newLedger.amountUSD) || 0 };
    setNewLedger({ date: "", desc: "", type: "out", category: "Materials", amountUSD: 0 });
    try {
      const created = await api.createLedgerEntry(projectId, { ...entry, date: newLedger.date } as any);
      await api.getProjectLedger(projectId).then((rows: LedgerEntryDto[]) => {
        if (!rows.length) return;
        setLedgerRows(rows.map((r) => ({
          date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          desc: r.desc,
          type: r.type,
          category: r.category,
          amountUSD: r.amountUSD,
          id: r.id,
        })));
      });
    } catch (e) {
      setLedgerRows((prev) => [...prev, entry]);
    }
  };

  const addExpense = async () => {
    if (!projectId) return toast.error("Select a project");
    if (!newExpense.name.trim()) return toast.error("Name required");
    const row: ExpenseWithId = { ...newExpense, color: "#FF6B1A", amountUSD: newExpense.actualUSD };
    setNewExpense({ name: "", budgetUSD: 0, actualUSD: 0 });
    try {
      await api.createExpense(projectId, { name: row.name, budgetUSD: row.budgetUSD, actualUSD: row.amountUSD } as any);
      await api.getProjectExpenses(projectId).then((rows: ExpenseDto[]) => {
        if (!rows.length) return;
        const palette = ["#FF6B1A", "#3B82F6", "#8B5CF6", "#22C55E", "#F97316", "#F5A623"];
        setExpenseRows(rows.map((r, idx) => ({ name: r.name, amountUSD: r.actualUSD, budgetUSD: r.budgetUSD, color: palette[idx % palette.length], id: r.id })));
      });
    } catch (e) {
      setExpenseRows((prev) => [...prev, row]);
    }
  };

  const deleteLedger = async (entryId?: string) => {
    if (!projectId || !entryId) return;
    try {
      await api.deleteLedgerEntry(projectId, entryId);
      setLedgerRows((prev) => prev.filter((r) => r.id !== entryId));
    } catch (e) {
      toast.error("Failed to delete entry");
    }
  };

  const updateLedger = async (entry: LedgerEntryWithId) => {
    if (!projectId || !entry.id) return;
    try {
      await api.updateLedgerEntry(projectId, entry.id, {
        desc: entry.desc,
        category: entry.category,
        type: entry.type,
        amountUSD: entry.amountUSD,
        date: new Date().toISOString(),
      });
      toast.success("Ledger updated");
    } catch (e) {
      toast.error("Failed to update");
    }
  };

  const deleteExpense = async (expenseId?: string) => {
    if (!projectId || !expenseId) return;
    try {
      await api.deleteExpense(projectId, expenseId);
      setExpenseRows((prev) => prev.filter((r) => r.id !== expenseId));
    } catch (e) {
      toast.error("Failed to delete expense");
    }
  };

  const updateExpense = async (expenseId?: string, actualUSD?: number, budgetUSD?: number) => {
    if (!projectId || !expenseId) return;
    try {
      await api.updateExpense(projectId, expenseId, { actualUSD, budgetUSD });
    } catch (e) {
      // silent
    }
  };

  if (!perms.financials) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 text-[13px] text-[#8A95A5]">
          You don't have access to financials. Contact the site manager.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div>
          <div className="text-[13px] text-white font-display">Financial tracker</div>
          <div className="text-[11px] text-[#8A95A5]">Money in/out, budget vs actual, exports</div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-white">
          <span className="text-[#8A95A5]">Project</span>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white"
          >
            {projects.length === 0 && <option value="">Seeded</option>}
            {projects.map((p) => (
              <option key={p.id || p.code} value={p.id || p.code}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportExcel} className="h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12px] text-white flex items-center gap-1.5 hover:border-[#FF6B1A]/50">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
          </button>
          <button onClick={exportPdf} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]">
            <FileText className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { icon: Wallet, label: "Cash in", value: fmt(totals.cashIn), tone: "text-[#22C55E]", bg: "bg-[#22C55E]/15" },
          { icon: Receipt, label: "Cash out", value: fmt(totals.cashOut), tone: "text-[#EF4444]", bg: "bg-[#EF4444]/15" },
          { icon: PiggyBank, label: "Net", value: fmt(totals.net), tone: totals.net >= 0 ? "text-[#22C55E]" : "text-[#EF4444]", bg: "bg-[#FF6B1A]/15" },
          { icon: TrendingUp, label: "Budget vs actual", value: `${fmt(totals.actual)} / ${fmt(totals.budget)}`, tone: totals.variance >= 0 ? "text-[#22C55E]" : "text-[#EF4444]", bg: "bg-[#3B82F6]/15" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
            <div className={`w-9 h-9 rounded-md ${k.bg} flex items-center justify-center text-white`}>
              <k.icon className="w-4 h-4" />
            </div>
            <div className={`text-[20px] sm:text-[22px] text-white mt-3 font-display`}>{k.value}</div>
            <div className={`text-[11px] text-[#8A95A5] flex items-center gap-1 ${k.tone}`}>{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
            <div className="text-[13px] text-white font-display">Ledger</div>
            <button onClick={() => toast("Sharing ledger to team chat")} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1">
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                  <th className="text-left px-5 py-2.5">Date</th>
                  <th className="text-left px-3 py-2.5">Description</th>
                  <th className="text-left px-3 py-2.5">Category</th>
                  <th className="text-left px-3 py-2.5">Type</th>
                  <th className="text-right px-5 py-2.5">Amount</th>
                  <th className="text-right px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row, idx) => (
                  <tr key={idx} className="border-t border-[#222A35]">
                    <td className="px-5 py-2.5 text-white whitespace-nowrap">{row.date}</td>
                    <td className="px-3 py-2.5 text-[#C2CAD6]">
                      <input
                        value={row.desc}
                        onChange={(e) => setLedgerRows((prev) => prev.map((r, i) => i === idx ? { ...r, desc: e.target.value } : r))}
                        className="w-full bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">
                      <input
                        value={row.category}
                        onChange={(e) => setLedgerRows((prev) => prev.map((r, i) => i === idx ? { ...r, category: e.target.value } : r))}
                        className="w-full bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={row.type}
                        onChange={(e) => setLedgerRows((prev) => prev.map((r, i) => i === idx ? { ...r, type: e.target.value as "in" | "out" } : r))}
                        className="bg-[#0A0E14] border border-[#222A35] rounded px-2 py-1 text-[12px] text-white"
                      >
                        <option value="in">In</option>
                        <option value="out">Out</option>
                      </select>
                    </td>
                    <td className="px-5 py-2.5 text-right text-white">
                      <input
                        value={row.amountUSD}
                        onChange={(e) => setLedgerRows((prev) => prev.map((r, i) => i === idx ? { ...r, amountUSD: Number(e.target.value) || 0 } : r))}
                        type="number"
                        className="w-24 bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white text-right"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-2">
                      {row.id ? (
                        <>
                          <button onClick={() => updateLedger(row)} className="text-[11px] text-[#8A95A5] hover:text-white">Save</button>
                          <button onClick={() => deleteLedger(row.id)} className="text-[11px] text-[#FF6B1A] hover:underline">Delete</button>
                        </>
                      ) : (
                        <span className="text-[11px] text-[#5B6675]">Local</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4 border-t border-[#222A35] grid grid-cols-1 sm:grid-cols-5 gap-2 text-[12px] text-white">
              <input value={newLedger.date} onChange={(e) => setNewLedger((s) => ({ ...s, date: e.target.value }))} type="date" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newLedger.desc} onChange={(e) => setNewLedger((s) => ({ ...s, desc: e.target.value }))} placeholder="Description" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newLedger.category} onChange={(e) => setNewLedger((s) => ({ ...s, category: e.target.value }))} placeholder="Category" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <select value={newLedger.type} onChange={(e) => setNewLedger((s) => ({ ...s, type: e.target.value as "in" | "out" }))} className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9">
                <option value="in">In</option>
                <option value="out">Out</option>
              </select>
              <div className="flex gap-2">
                <input value={newLedger.amountUSD} onChange={(e) => setNewLedger((s) => ({ ...s, amountUSD: Number(e.target.value) || 0 }))} type="number" placeholder="Amount" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 w-full" />
                <button onClick={addLedger} className="px-3 rounded-md bg-[#FF6B1A] text-white text-[12px]">Add</button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-white font-display">Expense categories</div>
            <div className="text-[11px] text-[#5B6675]">Budget vs actual</div>
          </div>
          <div className="space-y-3">
            {expenseRows.map((e, idx) => {
              const pct = Math.min(100, Math.round((e.amountUSD / e.budgetUSD) * 100));
              return (
                <div key={e.name}>
                  <div className="flex items-center justify-between text-[12px] text-white">
                    <span>{e.name}</span>
                    <div className="flex items-center gap-2 text-[11px] text-[#8A95A5]">
                      <input
                        value={e.amountUSD}
                        onChange={(ev) => setExpenseRows((prev) => prev.map((row, i) => i === idx ? { ...row, amountUSD: Number(ev.target.value) || 0 } : row))}
                        onBlur={() => e.id && projectId && api.updateExpense(projectId, e.id, { actualUSD: e.amountUSD }).catch(() => {})}
                        type="number"
                        className="w-20 bg-transparent border border-[#222A35] rounded px-2 py-1 text-white text-right"
                      />
                      <span>/</span>
                      <input
                        value={e.budgetUSD}
                        onChange={(ev) => setExpenseRows((prev) => prev.map((row, i) => i === idx ? { ...row, budgetUSD: Number(ev.target.value) || 0 } : row))}
                        onBlur={() => e.id && projectId && api.updateExpense(projectId, e.id, { budgetUSD: e.budgetUSD }).catch(() => {})}
                        type="number"
                        className="w-20 bg-transparent border border-[#222A35] rounded px-2 py-1 text-white text-right"
                      />
                    </div>
                  </div>
                  <div className="h-2 mt-1 rounded-full bg-[#222A35] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: e.color }} />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-[#5B6675] mt-0.5">
                    <span>{pct}% of budget</span>
                    {e.id && <button onClick={() => deleteExpense(e.id)} className="text-[11px] text-[#FF6B1A] hover:underline">Delete</button>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px] text-white">
            <input value={newExpense.name} onChange={(e) => setNewExpense((s) => ({ ...s, name: e.target.value }))} placeholder="Category" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
            <input value={newExpense.actualUSD} onChange={(e) => setNewExpense((s) => ({ ...s, actualUSD: Number(e.target.value) || 0 }))} type="number" placeholder="Actual" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
            <div className="flex gap-2">
              <input value={newExpense.budgetUSD} onChange={(e) => setNewExpense((s) => ({ ...s, budgetUSD: Number(e.target.value) || 0 }))} type="number" placeholder="Budget" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 w-full" />
              <button onClick={addExpense} className="px-3 rounded-md bg-[#FF6B1A] text-white text-[12px]">Add</button>
            </div>
          </div>
          <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
            <div className="flex items-center gap-2 text-[12px] text-white">
              {totals.variance >= 0 ? <TrendingUp className="w-4 h-4 text-[#22C55E]" /> : <TrendingDown className="w-4 h-4 text-[#EF4444]" />}
              <span>Variance: {fmt(totals.variance)}</span>
            </div>
            <div className="text-[11px] text-[#8A95A5] mt-1">Positive = under budget. Negative = over budget.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
