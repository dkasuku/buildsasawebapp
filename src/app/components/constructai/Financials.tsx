import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, Share2, Plus, Layers, ClipboardList, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { EmptyState } from "./EmptyState";
import CommitmentDrawer from "./CommitmentDrawer";
import api, {
  type ExpenseDto,
  type LedgerEntryDto,
  type ProjectDto,
  type CommitmentDto,
  type PaymentApplicationDto,
  type RetentionRecordDto,
  type CostCodeDto,
} from "../../services/api";

type LedgerRow = { date: string; desc: string; type: "in" | "out"; category: string; amountUSD: number };
type LedgerEntryWithId = LedgerRow & { id?: string };

type ExpenseRow = { name: string; amountUSD: number; budgetUSD: number; color: string };
type ExpenseWithId = ExpenseRow & { id?: string };

type Tab = "overview" | "ledger" | "commitments" | "applications" | "retention" | "budget"; // financials sub-tabs

const COMMITMENT_STATUSES = ["active", "completed", "overdue", "on_hold"];

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status || "active").toLowerCase();
  const tone =
    s === "completed" || s === "approved" || s === "paid" || s === "released"
      ? "text-[#22C55E] bg-[#22C55E]/15"
      : s === "overdue" || s === "rejected"
      ? "text-[#EF4444] bg-[#EF4444]/15"
      : s === "on_hold" || s === "under_review" || s === "submitted"
      ? "text-[#F5A623] bg-[#F5A623]/15"
      : "text-[#3B82F6] bg-[#3B82F6]/15";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] capitalize ${tone}`}>{s.replace(/_/g, " ")}</span>;
}

export default function Financials({ role = "Contractor" }: { role?: Role }) {
  const { currency } = useCurrency();
  const perms = ROLES[role];
  const canApprove = !!perms.financials; // "Finance can approve" capability gates approve/pay/release
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [ledgerRows, setLedgerRows] = useState<LedgerEntryWithId[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseWithId[]>([]);
  const [newLedger, setNewLedger] = useState({ date: "", desc: "", type: "out" as "in" | "out", category: "Materials", amountUSD: 0, invoiceNumber: "", poNumber: "", subcontractNumber: "", changeOrderNumber: "" });
  const [newExpense, setNewExpense] = useState({ name: "", budgetUSD: 0, actualUSD: 0 });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  // New-section state
  const [commitments, setCommitments] = useState<CommitmentDto[]>([]);
  const [applications, setApplications] = useState<PaymentApplicationDto[]>([]);
  const [retention, setRetention] = useState<RetentionRecordDto[]>([]);
  const [costCodes, setCostCodes] = useState<CostCodeDto[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Modals
  const [showCommitmentModal, setShowCommitmentModal] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const [newCommitment, setNewCommitment] = useState({ vendor: "", scope: "", contractValue: 0, retentionPct: 0, status: "active", costCodeId: "" });
  const [newApp, setNewApp] = useState({ number: "", period: "", commitmentId: "", workCompletedThisPeriod: 0, previousCertified: 0, requestedAmount: 0, retentionPct: 0 });
  const [newCostCode, setNewCostCode] = useState({ code: "", description: "" });

  useEffect(() => {
    api.getProjects().then((ps) => {
      if (ps?.length) {
        setProjects(ps);
        const first = ps[0];
        setProjectId(first.id || first.code);
      }
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getProjectLedger(projectId).then((rows: LedgerEntryDto[]) => {
      setLedgerRows((rows ?? []).map((r) => ({
        date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        desc: r.desc,
        type: r.type,
        category: r.category,
        amountUSD: r.amountUSD,
        id: r.id,
      })));
    }).catch(() => {});

    api.getProjectExpenses(projectId).then((rows: ExpenseDto[]) => {
      // Simple color palette reuse
      const palette = ["#FF6B1A", "#3B82F6", "#8B5CF6", "#22C55E", "#F97316", "#F5A623"];
      setExpenseRows((rows ?? []).map((r, idx) => ({ name: r.name, amountUSD: r.actualUSD, budgetUSD: r.budgetUSD, color: palette[idx % palette.length], id: r.id })));
    }).catch(() => {});

    refreshCommitments(projectId);
    refreshApplications(projectId);
    refreshRetention(projectId);
  }, [projectId]);

  // Cost codes are global (not project-scoped).
  useEffect(() => {
    api.getCostCodes().then((cs) => setCostCodes(cs ?? [])).catch(() => setCostCodes([]));
  }, []);

  const refreshCommitments = (pid: string) =>
    api.getCommitments(pid).then((cs) => setCommitments(cs ?? [])).catch(() => setCommitments([]));
  const refreshApplications = (pid: string) =>
    api.getPaymentApplications(pid).then((as) => setApplications(as ?? [])).catch(() => setApplications([]));
  const refreshRetention = (pid: string) =>
    api.getRetention(pid).then((rs) => setRetention(rs ?? [])).catch(() => setRetention([]));
  const refreshCostCodes = () =>
    api.getCostCodes().then((cs) => setCostCodes(cs ?? [])).catch(() => setCostCodes([]));

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
      "% Used": r.budgetUSD > 0 ? `${((r.amountUSD / r.budgetUSD) * 100).toFixed(1)}%` : "—",
    }));
    const ws2 = XLSX.utils.json_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, ws2, "Budget");

    if (commitments.length) {
      const cData = commitments.map((c) => ({
        Vendor: c.vendor,
        Scope: c.scope,
        "Contract value": Number(c.contractValue || 0),
        "Approved variations": Number(c.approvedVariations || 0),
        "Invoiced to date": Number(c.invoicedToDate || 0),
        "Paid to date": Number(c.paidToDate || 0),
        "Retention held": Number(c.retentionHeld || 0),
        "Balance remaining": Number(c.balanceRemaining || 0),
        Status: c.status || "active",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cData), "Commitments");
    }
    if (applications.length) {
      const aData = applications.map((a) => ({
        Number: a.number,
        Period: a.period || "",
        Vendor: commitmentById(a.commitmentId)?.vendor || "",
        Requested: Number(a.requestedAmount || 0),
        Retention: Number(a.retentionAmount || 0),
        "Net payable": Number(a.netPayable || 0),
        Status: a.status,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aData), "Applications");
    }

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
        r.budgetUSD > 0 ? `${((r.amountUSD / r.budgetUSD) * 100).toFixed(1)}%` : "—",
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
    const entry: LedgerEntryWithId = {
      date: newLedger.date,
      desc: newLedger.desc,
      type: newLedger.type,
      category: newLedger.category,
      amountUSD: Number(newLedger.amountUSD) || 0,
    };
    const refs = {
      invoiceNumber: newLedger.invoiceNumber || undefined,
      poNumber: newLedger.poNumber || undefined,
      subcontractNumber: newLedger.subcontractNumber || undefined,
      changeOrderNumber: newLedger.changeOrderNumber || undefined,
    };
    setNewLedger({ date: "", desc: "", type: "out", category: "Materials", amountUSD: 0, invoiceNumber: "", poNumber: "", subcontractNumber: "", changeOrderNumber: "" });
    try {
      await api.createLedgerEntry(projectId, { ...entry, date: newLedger.date, ...refs } as any);
      await api.getProjectLedger(projectId).then((rows: LedgerEntryDto[]) => {
        setLedgerRows((rows ?? []).map((r) => ({
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
        const palette = ["#FF6B1A", "#3B82F6", "#8B5CF6", "#22C55E", "#F97316", "#F5A623"];
        setExpenseRows((rows ?? []).map((r, idx) => ({ name: r.name, amountUSD: r.actualUSD, budgetUSD: r.budgetUSD, color: palette[idx % palette.length], id: r.id })));
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

  // --- Commitments ---
  const createCommitment = async () => {
    if (!projectId) return toast.error("Select a project");
    if (!newCommitment.vendor.trim()) return toast.error("Vendor required");
    try {
      await api.createCommitment(projectId, {
        vendor: newCommitment.vendor,
        scope: newCommitment.scope,
        contractValue: Number(newCommitment.contractValue) || 0,
        retentionPct: Number(newCommitment.retentionPct) || 0,
        status: newCommitment.status,
        costCodeId: newCommitment.costCodeId || null,
      });
      setShowCommitmentModal(false);
      setNewCommitment({ vendor: "", scope: "", contractValue: 0, retentionPct: 0, status: "active", costCodeId: "" });
      await refreshCommitments(projectId);
      toast.success("Commitment added");
    } catch {
      toast.error("Failed to add commitment");
    }
  };

  // --- Payment applications ---
  const appRetentionAmount = (Number(newApp.requestedAmount) || 0) * (Number(newApp.retentionPct) || 0) / 100;
  const appNetPayable = (Number(newApp.requestedAmount) || 0) - appRetentionAmount;

  const createApplication = async () => {
    if (!projectId) return toast.error("Select a project");
    if (!newApp.number.trim()) return toast.error("Application number required");
    try {
      await api.createPaymentApplication(projectId, {
        number: newApp.number,
        period: newApp.period || null,
        commitmentId: newApp.commitmentId || null,
        workCompletedThisPeriod: Number(newApp.workCompletedThisPeriod) || 0,
        previousCertified: Number(newApp.previousCertified) || 0,
        requestedAmount: Number(newApp.requestedAmount) || 0,
        retentionPct: Number(newApp.retentionPct) || 0,
        retentionAmount: appRetentionAmount,
        netPayable: appNetPayable,
        status: "draft",
      });
      setShowAppModal(false);
      setNewApp({ number: "", period: "", commitmentId: "", workCompletedThisPeriod: 0, previousCertified: 0, requestedAmount: 0, retentionPct: 0 });
      await refreshApplications(projectId);
      toast.success("Application created");
    } catch {
      toast.error("Failed to create application");
    }
  };

  const runAppAction = async (fn: () => Promise<unknown>, ok: string) => {
    if (!projectId) return;
    try {
      await fn();
      await refreshApplications(projectId);
      await refreshCommitments(projectId);
      await refreshRetention(projectId);
      toast.success(ok);
    } catch {
      toast.error("Action failed");
    }
  };

  const submitApp = (id: string) => runAppAction(() => api.submitPaymentApplication(projectId!, id), "Submitted for review");
  const approveApp = (id: string) => runAppAction(() => api.approvePaymentApplication(projectId!, id), "Application approved");
  const payApp = (id: string) => runAppAction(() => api.markPaymentApplicationPaid(projectId!, id), "Marked paid");
  const confirmReject = async () => {
    if (!rejectingId) return;
    await runAppAction(() => api.rejectPaymentApplication(projectId!, rejectingId, rejectComment || undefined), "Application rejected");
    setRejectingId(null);
    setRejectComment("");
  };

  // --- Retention ---
  const releaseRetentionRecord = async (id: string) => {
    if (!projectId) return;
    try {
      await api.releaseRetention(projectId, id);
      await refreshRetention(projectId);
      await refreshCommitments(projectId);
      toast.success("Retention released");
    } catch {
      toast.error("Failed to release retention");
    }
  };

  // --- Cost codes ---
  const addCostCode = async () => {
    if (!newCostCode.code.trim()) return toast.error("Code required");
    try {
      await api.createCostCode({ code: newCostCode.code, description: newCostCode.description || undefined });
      setNewCostCode({ code: "", description: "" });
      await refreshCostCodes();
      toast.success("Cost code added");
    } catch {
      toast.error("Failed to add cost code");
    }
  };
  const saveCostCode = async (cc: CostCodeDto) => {
    try {
      await api.updateCostCode(cc.id, { code: cc.code, description: cc.description });
      toast.success("Cost code updated");
    } catch {
      toast.error("Failed to update cost code");
    }
  };
  const removeCostCode = async (id: string) => {
    try {
      await api.deleteCostCode(id);
      await refreshCostCodes();
    } catch {
      toast.error("Failed to delete cost code");
    }
  };

  // Budget-by-cost-code derivation
  const budgetByCode = useMemo(() => {
    return costCodes.map((cc) => {
      const committed = commitments
        .filter((c) => c.costCodeId === cc.id)
        .reduce((s, c) => s + (Number(c.contractValue) || 0), 0);
      const ledgerPaid = ledgerRows
        .filter((l) => (l as any).costCodeId === cc.id && l.type === "out")
        .reduce((s, l) => s + l.amountUSD, 0);
      const appsPaid = applications
        .filter((a) => a.costCodeId === cc.id && a.status === "paid")
        .reduce((s, a) => s + (Number(a.netPayable) || 0), 0);
      const actual = ledgerPaid + appsPaid;
      // No explicit per-code budget field on CostCodeDto; treat committed as the working budget baseline.
      const budget = committed;
      return { cc, budget, committed, actual, variance: budget - actual };
    });
  }, [costCodes, commitments, ledgerRows, applications]);

  const commitmentById = (id?: string | null) => commitments.find((c) => c.id === id);

  if (!perms.financials) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 text-[13px] text-[#8A95A5]">
          You don't have access to financials. Contact the site manager.
        </div>
      </div>
    );
  }

  if (loaded && projects.length === 0) {
    return (
      <div className="px-4 sm:px-7 py-6">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-8 text-center">
          <div className="w-11 h-11 rounded-lg bg-[#FF6B1A]/15 flex items-center justify-center mx-auto">
            <Wallet className="w-5 h-5 text-[#FF6B1A]" />
          </div>
          <div className="text-[14px] text-white font-display mt-3">No financials yet</div>
          <div className="text-[12px] text-[#8A95A5] mt-1 max-w-md mx-auto">Create a project first, then track its cash in/out and budget vs actual here — and export to Excel or PDF anytime.</div>
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

      {/* Tab bar */}
      <div className="flex flex-nowrap gap-1 border-b border-[#222A35] overflow-x-auto whitespace-nowrap">
        {([
          { id: "overview", label: "Overview", icon: Wallet },
          { id: "ledger", label: "Ledger", icon: Receipt },
          { id: "commitments", label: "Commitments", icon: Layers },
          { id: "applications", label: "Applications", icon: ClipboardList },
          { id: "retention", label: "Retention", icon: ShieldCheck },
          { id: "budget", label: "Budget", icon: PiggyBank },
        ] as { id: Tab; label: string; icon: any }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 px-3 text-[12px] flex items-center gap-1.5 border-b-2 -mb-px ${
              tab === t.id ? "border-[#FF6B1A] text-white" : "border-transparent text-[#8A95A5] hover:text-white"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW — existing summary cards */}
      {tab === "overview" && (
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
      )}

      {/* LEDGER — existing ledger table + expense categories */}
      {tab === "ledger" && (
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
                {ledgerRows.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-6 text-center text-[12px] text-[#5B6675]">No ledger entries yet — add your first below.</td></tr>
                )}
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
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] text-white">
              <input value={newLedger.invoiceNumber} onChange={(e) => setNewLedger((s) => ({ ...s, invoiceNumber: e.target.value }))} placeholder="Invoice #" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newLedger.poNumber} onChange={(e) => setNewLedger((s) => ({ ...s, poNumber: e.target.value }))} placeholder="PO #" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newLedger.subcontractNumber} onChange={(e) => setNewLedger((s) => ({ ...s, subcontractNumber: e.target.value }))} placeholder="Subcontract #" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newLedger.changeOrderNumber} onChange={(e) => setNewLedger((s) => ({ ...s, changeOrderNumber: e.target.value }))} placeholder="Change order #" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
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
              const pct = e.budgetUSD > 0 ? Math.min(100, Math.round((e.amountUSD / e.budgetUSD) * 100)) : 0;
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
            {expenseRows.length === 0 && (
              <div className="text-[12px] text-[#5B6675] py-2">No categories yet — add one below to track budget vs actual.</div>
            )}
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
      )}

      {/* COMMITMENTS */}
      {tab === "commitments" && (
        !projectId ? (
          <EmptyState icon={Layers} title="No project selected" description="Choose a project to track its commitments." />
        ) : commitments.length === 0 ? (
          <EmptyState icon={Layers} title="No commitments yet" description="Record vendor contracts and track invoiced, paid and retention against each." actionLabel="+ Add commitment" onAction={() => setShowCommitmentModal(true)} />
        ) : (
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
              <div className="text-[13px] text-white font-display">Commitments</div>
              <button onClick={() => setShowCommitmentModal(true)} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add commitment
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5">Vendor</th>
                    <th className="text-right px-3 py-2.5">Contract value</th>
                    <th className="text-right px-3 py-2.5">Approved variations</th>
                    <th className="text-right px-3 py-2.5">Invoiced to date</th>
                    <th className="text-right px-3 py-2.5">Paid to date</th>
                    <th className="text-right px-3 py-2.5">Retention held</th>
                    <th className="text-right px-3 py-2.5">Balance remaining</th>
                    <th className="text-left px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {commitments.map((c) => (
                    <tr key={c.id} onClick={() => setDrawerId(c.id)} className="border-t border-[#222A35] cursor-pointer hover:bg-[#161C24]">
                      <td className="px-5 py-2.5 text-white">{c.vendor}<div className="text-[10px] text-[#5B6675]">{c.scope}</div></td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(c.contractValue || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(c.approvedVariations || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(c.invoicedToDate || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(c.paidToDate || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(c.retentionHeld || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-white">{fmt(Number(c.balanceRemaining || 0))}</td>
                      <td className="px-5 py-2.5"><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* APPLICATIONS */}
      {tab === "applications" && (
        !projectId ? (
          <EmptyState icon={ClipboardList} title="No project selected" description="Choose a project to manage payment applications." />
        ) : applications.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No applications yet" description="Create a payment application, submit it for review, then approve and pay." actionLabel="+ New application" onAction={() => setShowAppModal(true)} />
        ) : (
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
              <div className="text-[13px] text-white font-display">Payment applications</div>
              <button onClick={() => setShowAppModal(true)} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> New application
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5">Number</th>
                    <th className="text-left px-3 py-2.5">Period</th>
                    <th className="text-left px-3 py-2.5">Commitment / Vendor</th>
                    <th className="text-right px-3 py-2.5">Requested</th>
                    <th className="text-right px-3 py-2.5">Retention</th>
                    <th className="text-right px-3 py-2.5">Net payable</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                    <th className="text-right px-5 py-2.5">Workflow</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id} className="border-t border-[#222A35]">
                      <td className="px-5 py-2.5 text-white">#{a.number}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{a.period || "—"}</td>
                      <td className="px-3 py-2.5 text-[#C2CAD6]">{commitmentById(a.commitmentId)?.vendor || "—"}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(a.requestedAmount || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(a.retentionAmount || 0))}</td>
                      <td className="px-3 py-2.5 text-right text-white">{fmt(Number(a.netPayable || 0))}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                      <td className="px-5 py-2.5 text-right space-x-2 whitespace-nowrap">
                        {a.status === "draft" && (
                          <button onClick={() => submitApp(a.id)} className="text-[11px] text-[#FF6B1A] hover:underline">Submit</button>
                        )}
                        {(a.status === "submitted" || a.status === "under_review") && canApprove && (
                          <>
                            <button onClick={() => approveApp(a.id)} className="text-[11px] text-[#22C55E] hover:underline">Approve</button>
                            <button onClick={() => { setRejectingId(a.id); setRejectComment(""); }} className="text-[11px] text-[#EF4444] hover:underline">Reject</button>
                          </>
                        )}
                        <button
                          onClick={() => payApp(a.id)}
                          disabled={a.status !== "approved" || !canApprove}
                          className={`text-[11px] ${a.status === "approved" && canApprove ? "text-[#3B82F6] hover:underline" : "text-[#5B6675] cursor-not-allowed"}`}
                        >
                          Mark paid
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* RETENTION */}
      {tab === "retention" && (
        !projectId ? (
          <EmptyState icon={ShieldCheck} title="No project selected" description="Choose a project to view retention held against commitments." />
        ) : retention.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No retention records" description="Retention appears here once commitments hold retention or applications certify amounts." />
        ) : (
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A35] text-[13px] text-white font-display">Retention</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5">Vendor</th>
                    <th className="text-right px-3 py-2.5">Retention %</th>
                    <th className="text-right px-3 py-2.5">Held</th>
                    <th className="text-right px-3 py-2.5">Released</th>
                    <th className="text-right px-3 py-2.5">Remaining</th>
                    <th className="text-left px-3 py-2.5">Release date</th>
                    <th className="text-left px-3 py-2.5">Aging</th>
                    <th className="text-right px-5 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {retention.map((r) => {
                    const c = commitmentById(r.commitmentId);
                    const isReleased = r.status === "released";
                    const due = r.releaseDate ? new Date(r.releaseDate) : null;
                    const aging = !due ? null : isReleased ? null : due.getTime() < Date.now() ? "Overdue" : "Upcoming";
                    return (
                      <tr key={r.id} className="border-t border-[#222A35]">
                        <td className="px-5 py-2.5 text-white">{c?.vendor || "—"}</td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{Number(c?.retentionPct || 0)}%</td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(r.amountHeld || 0))}</td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(Number(r.amountReleased || 0))}</td>
                        <td className="px-3 py-2.5 text-right text-white">{fmt(Number(r.remaining || 0))}</td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{due ? due.toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2.5">
                          {aging === "Overdue" ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] text-[#EF4444] bg-[#EF4444]/15">Overdue</span>
                          ) : aging === "Upcoming" ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] text-[#F5A623] bg-[#F5A623]/15">Upcoming</span>
                          ) : (
                            <span className="text-[10px] text-[#5B6675]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {!isReleased && canApprove ? (
                            <button onClick={() => releaseRetentionRecord(r.id)} className="text-[11px] text-[#FF6B1A] hover:underline">Release</button>
                          ) : (
                            <StatusBadge status={r.status} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* BUDGET — by cost code */}
      {tab === "budget" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A35] text-[13px] text-white font-display">Budget vs actual by cost code</div>
            {costCodes.length === 0 ? (
              <EmptyState icon={PiggyBank} title="No cost codes yet" description="Add cost codes below to track committed and actual spend per code." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[12px]">
                  <thead>
                    <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5">Code</th>
                      <th className="text-right px-3 py-2.5">Budget (committed)</th>
                      <th className="text-right px-3 py-2.5">Committed</th>
                      <th className="text-right px-3 py-2.5">Actual</th>
                      <th className="text-right px-5 py-2.5">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetByCode.map(({ cc, budget, committed, actual, variance }) => (
                      <tr key={cc.id} className="border-t border-[#222A35]">
                        <td className="px-5 py-2.5 text-white">{cc.code}<div className="text-[10px] text-[#5B6675]">{cc.description}</div></td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(budget)}</td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(committed)}</td>
                        <td className="px-3 py-2.5 text-right text-[#C2CAD6]">{fmt(actual)}</td>
                        <td className={`px-5 py-2.5 text-right ${variance >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{fmt(variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Manage cost codes */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 space-y-3">
            <div className="text-[13px] text-white font-display">Manage cost codes</div>
            <div className="space-y-2">
              {costCodes.map((cc) => (
                <div key={cc.id} className="flex items-center gap-2 text-[12px]">
                  <input
                    value={cc.code}
                    onChange={(e) => setCostCodes((prev) => prev.map((x) => x.id === cc.id ? { ...x, code: e.target.value } : x))}
                    className="w-28 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 text-white"
                  />
                  <input
                    value={cc.description ?? ""}
                    onChange={(e) => setCostCodes((prev) => prev.map((x) => x.id === cc.id ? { ...x, description: e.target.value } : x))}
                    placeholder="Description"
                    className="flex-1 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 text-white"
                  />
                  <button onClick={() => saveCostCode(cc)} className="text-[11px] text-[#8A95A5] hover:text-white">Save</button>
                  <button onClick={() => removeCostCode(cc.id)} className="text-[11px] text-[#EF4444] hover:underline">Delete</button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px] text-white">
              <input value={newCostCode.code} onChange={(e) => setNewCostCode((s) => ({ ...s, code: e.target.value }))} placeholder="Code" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newCostCode.description} onChange={(e) => setNewCostCode((s) => ({ ...s, description: e.target.value }))} placeholder="Description" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <button onClick={addCostCode} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px]">Add cost code</button>
            </div>
          </div>

          {/* Existing expense-categories budget UI kept accessible here */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-white font-display">Expense categories</div>
              <div className="text-[11px] text-[#5B6675]">Budget vs actual</div>
            </div>
            <div className="space-y-3">
              {expenseRows.map((e, idx) => {
                const pct = e.budgetUSD > 0 ? Math.min(100, Math.round((e.amountUSD / e.budgetUSD) * 100)) : 0;
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
              {expenseRows.length === 0 && (
                <div className="text-[12px] text-[#5B6675] py-2">No categories yet — add one below to track budget vs actual.</div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px] text-white">
              <input value={newExpense.name} onChange={(e) => setNewExpense((s) => ({ ...s, name: e.target.value }))} placeholder="Category" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <input value={newExpense.actualUSD} onChange={(e) => setNewExpense((s) => ({ ...s, actualUSD: Number(e.target.value) || 0 }))} type="number" placeholder="Actual" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9" />
              <div className="flex gap-2">
                <input value={newExpense.budgetUSD} onChange={(e) => setNewExpense((s) => ({ ...s, budgetUSD: Number(e.target.value) || 0 }))} type="number" placeholder="Budget" className="bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 w-full" />
                <button onClick={addExpense} className="px-3 rounded-md bg-[#FF6B1A] text-white text-[12px]">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Commitment modal */}
      {showCommitmentModal && (
        <Modal title="Add commitment" onClose={() => setShowCommitmentModal(false)}>
          <div className="space-y-3 text-[12px] text-white">
            <Labeled label="Vendor"><input value={newCommitment.vendor} onChange={(e) => setNewCommitment((s) => ({ ...s, vendor: e.target.value }))} className={inputCls} /></Labeled>
            <Labeled label="Scope"><input value={newCommitment.scope} onChange={(e) => setNewCommitment((s) => ({ ...s, scope: e.target.value }))} className={inputCls} /></Labeled>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Contract value"><input type="number" value={newCommitment.contractValue} onChange={(e) => setNewCommitment((s) => ({ ...s, contractValue: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
              <Labeled label="Retention %"><input type="number" value={newCommitment.retentionPct} onChange={(e) => setNewCommitment((s) => ({ ...s, retentionPct: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Status">
                <select value={newCommitment.status} onChange={(e) => setNewCommitment((s) => ({ ...s, status: e.target.value }))} className={inputCls}>
                  {COMMITMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </Labeled>
              <Labeled label="Cost code (optional)">
                <select value={newCommitment.costCodeId} onChange={(e) => setNewCommitment((s) => ({ ...s, costCodeId: e.target.value }))} className={inputCls}>
                  <option value="">— none —</option>
                  {costCodes.map((cc) => <option key={cc.id} value={cc.id}>{cc.code}</option>)}
                </select>
              </Labeled>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCommitmentModal(false)} className="h-9 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Cancel</button>
              <button onClick={createCommitment} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px]">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Application modal */}
      {showAppModal && (
        <Modal title="New payment application" onClose={() => setShowAppModal(false)}>
          <div className="space-y-3 text-[12px] text-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Number"><input value={newApp.number} onChange={(e) => setNewApp((s) => ({ ...s, number: e.target.value }))} className={inputCls} /></Labeled>
              <Labeled label="Period"><input value={newApp.period} onChange={(e) => setNewApp((s) => ({ ...s, period: e.target.value }))} placeholder="e.g. May 2026" className={inputCls} /></Labeled>
            </div>
            <Labeled label="Commitment">
              <select value={newApp.commitmentId} onChange={(e) => setNewApp((s) => ({ ...s, commitmentId: e.target.value }))} className={inputCls}>
                <option value="">— none —</option>
                {commitments.map((c) => <option key={c.id} value={c.id}>{c.vendor}{c.scope ? ` — ${c.scope}` : ""}</option>)}
              </select>
            </Labeled>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Work completed this period"><input type="number" value={newApp.workCompletedThisPeriod} onChange={(e) => setNewApp((s) => ({ ...s, workCompletedThisPeriod: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
              <Labeled label="Previously certified"><input type="number" value={newApp.previousCertified} onChange={(e) => setNewApp((s) => ({ ...s, previousCertified: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Requested amount"><input type="number" value={newApp.requestedAmount} onChange={(e) => setNewApp((s) => ({ ...s, requestedAmount: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
              <Labeled label="Retention %"><input type="number" value={newApp.retentionPct} onChange={(e) => setNewApp((s) => ({ ...s, retentionPct: Number(e.target.value) || 0 }))} className={inputCls} /></Labeled>
            </div>
            <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 text-[12px] text-[#C2CAD6] flex justify-between">
              <span>Retention amount: <span className="text-white">{fmt(appRetentionAmount)}</span></span>
              <span>Net payable: <span className="text-white">{fmt(appNetPayable)}</span></span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAppModal(false)} className="h-9 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Cancel</button>
              <button onClick={createApplication} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px]">Create</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {rejectingId && (
        <Modal title="Reject application" onClose={() => setRejectingId(null)}>
          <div className="space-y-3 text-[12px] text-white">
            <Labeled label="Comments">
              <textarea value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} rows={3} placeholder="Reason for rejection" className={`${inputCls} h-auto py-2`} />
            </Labeled>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setRejectingId(null)} className="h-9 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Cancel</button>
              <button onClick={confirmReject} className="h-9 px-4 rounded-md bg-[#EF4444] hover:bg-[#EF4444]/80 text-white text-[12px]">Reject</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Commitment detail drawer */}
      {drawerId && projectId && (
        <CommitmentDrawer
          projectId={projectId}
          commitmentId={drawerId}
          costCodes={costCodes}
          canDelete={canApprove}
          fmt={fmt}
          onClose={() => setDrawerId(null)}
          onDeleted={() => { setDrawerId(null); refreshCommitments(projectId); }}
        />
      )}
    </div>
  );
}

const inputCls = "w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2 h-9 text-white text-[12px]";

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-[#8A95A5]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-[#222A35] bg-[#11161D] p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[13px] text-white font-display">{title}</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
