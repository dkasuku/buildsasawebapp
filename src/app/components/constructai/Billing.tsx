// ============================================================================
// Billing & Subscription — Paystack-ready (add PAYSTACK_SECRET_KEY in backend
// /.env to go live; until then it runs in demo mode). Monthly + Yearly plans.
// ============================================================================

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, ShieldCheck, Loader2, CreditCard, FileText, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type BillingInvoiceDto, type UserProfile } from "../../services/api";

type Plan = { id: string; name: string; cycle: string; usd: number; kes: number; note?: string };

const FEATURES = [
  "Unlimited projects & drawings",
  "Checklists, punch list & inspections",
  "Change orders & financial tracking",
  "Buildsasa AI assistant & reports",
  "Multi-assignee tasks & approvals",
  "Document storage & sharing",
];

export default function Billing({ role }: { role: Role }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [configured, setConfigured] = useState(false);
  const [sub, setSub] = useState<any>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceDto[]>([]);
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const isOwner = !!ROLES[role]?.isWorkspaceOwner;

  const load = async () => {
    try {
      const [p, s, inv, prof] = await Promise.all([
        api.getBillingPlans(),
        api.getSubscription().catch(() => null),
        api.getBillingInvoices().catch(() => []),
        api.me().catch(() => null),
      ]);
      setPlans(p.plans); setConfigured(p.configured); setSub(s); setInvoices(Array.isArray(inv) ? inv : []); setProfile(prof);
    } catch { /* offline */ }
    setLoading(false);
  };

  const invStatus = (i: BillingInvoiceDto) => i.status === "paid"
    ? { label: "Paid", cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" }
    : new Date(i.dueDate) < new Date()
      ? { label: "Overdue", cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30" }
      : { label: "Unpaid", cls: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30" };
  const invAmount = (i: BillingInvoiceDto) => i.currency === "USD" ? `$${i.amountUSD}` : `KES ${i.amountKES.toLocaleString()}`;

  const payInvoice = async (id: string) => {
    setBusy("inv-" + id);
    try {
      const r = await api.payBillingInvoice(id);
      if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return; }
      if (r.alreadyPaid) toast("Invoice already paid");
      else if (r.demo) toast(r.message || "Demo mode — connect Paystack to charge.", { duration: 6000 });
      await load();
    } catch (e: any) { toast.error(e.message || "Could not start payment"); }
    setBusy(null);
  };
  const markPaid = async (id: string) => {
    setBusy("inv-" + id);
    try { await api.markBillingInvoicePaid(id); toast.success("Invoice marked paid"); await load(); window.dispatchEvent(new Event("buildsasa:billing-updated")); }
    catch (e: any) { toast.error(e.message || "Could not update invoice"); }
    setBusy(null);
  };

  const downloadInvoicePdf = (i: BillingInvoiceDto) => {
    try {
      const paid = i.status === "paid";
      const money = (n: number) => i.currency === "USD" ? `$${Math.round(n).toLocaleString()}` : `KSh ${Math.round(n).toLocaleString()}`;
      const total = i.currency === "USD" ? i.amountUSD : i.amountKES;
      const doc = new jsPDF();
      const W = doc.internal.pageSize.getWidth();
      const left = 16;

      // Header — brand (left) + INVOICE/status (right)
      doc.setTextColor(255, 107, 26);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("Buildsasa", left, 24);
      doc.setTextColor(17, 22, 29);
      doc.setFontSize(16);
      doc.text("INVOICE", W - left, 22, { align: "right" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(paid ? 34 : 245, paid ? 197 : 158, paid ? 94 : 11);
      doc.text(paid ? "PAID" : "UNPAID", W - left, 29, { align: "right" });

      // Divider
      doc.setDrawColor(220, 224, 230);
      doc.line(left, 34, W - left, 34);

      // Invoice meta
      doc.setTextColor(17, 22, 29);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(`Invoice ${i.number}`, left, 46);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 102, 117);
      let y = 53;
      doc.text(`Issued: ${new Date(i.issuedAt).toLocaleDateString()}`, left, y); y += 6;
      doc.text(`Due: ${new Date(i.dueDate).toLocaleDateString()}`, left, y); y += 6;
      if (i.paidAt) { doc.text(`Paid: ${new Date(i.paidAt).toLocaleDateString()}`, left, y); y += 6; }

      // Billed to
      const billedName = profile?.name || "";
      const billedEmail = profile?.email || "";
      if (billedName || billedEmail) {
        doc.setTextColor(17, 22, 29);
        doc.setFont("helvetica", "bold");
        doc.text("Billed to", W - left, 46, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(90, 102, 117);
        let yr = 53;
        if (billedName) { doc.text(billedName, W - left, yr, { align: "right" }); yr += 6; }
        if (billedEmail) { doc.text(billedEmail, W - left, yr, { align: "right" }); }
      }

      // Line item table
      const tableTop = Math.max(y, 70) + 4;
      doc.setFillColor(255, 107, 26);
      doc.rect(left, tableTop, W - left * 2, 9, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Description", left + 4, tableTop + 6);
      doc.text("Amount", W - left - 4, tableTop + 6, { align: "right" });

      doc.setTextColor(17, 22, 29);
      doc.setFont("helvetica", "normal");
      const rowY = tableTop + 17;
      doc.text(i.description || "Subscription", left + 4, rowY);
      doc.text(money(total), W - left - 4, rowY, { align: "right" });
      doc.setDrawColor(220, 224, 230);
      doc.line(left, rowY + 4, W - left, rowY + 4);

      // Total
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Total", left + 4, rowY + 14);
      doc.text(money(total), W - left - 4, rowY + 14, { align: "right" });

      // Footer
      const H = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 102, 117);
      doc.text("Thank you for your business", left, H - 20);
      doc.setTextColor(255, 107, 26);
      doc.setFont("helvetica", "bold");
      doc.text("Buildsasa", left, H - 14);

      doc.save(`Invoice_${i.number}.pdf`);
    } catch (e: any) {
      toast.error("Could not generate PDF");
    }
  };

  useEffect(() => {
    load();
    // Handle Paystack redirect back (?reference=...)
    const ref = new URLSearchParams(window.location.search).get("reference") || new URLSearchParams(window.location.search).get("trxref");
    if (ref) {
      api.billingVerify(ref).then((r) => { if (r.ok) { toast.success("Subscription activated 🎉"); load(); window.dispatchEvent(new Event("buildsasa:billing-updated")); } else toast.error("Payment not completed"); }).catch(() => {});
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line
  }, []);

  const fmt = (p: Plan) => currency === "USD" ? `$${p.usd}` : `KES ${p.kes.toLocaleString()}`;

  const subscribe = async (planId: string) => {
    setBusy(planId);
    try {
      const r = await api.billingCheckout(planId, undefined, currency);
      if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return; }
      if (r.demo) toast(r.message || "Demo mode — connect Paystack to charge.", { duration: 6000 });
      await load();
    } catch (e: any) { toast.error(e.message || "Checkout failed"); }
    setBusy(null);
  };

  const active = sub && sub.status === "active";

  return (
    <div className="px-4 sm:px-7 py-6 max-w-4xl">
      {/* current status */}
      <div className={`rounded-xl border p-5 mb-5 ${active ? "border-[#22C55E]/40 bg-[#22C55E]/5" : "border-[#222A35] bg-[#11161D]"}`}>
        <div className="flex items-center gap-2 text-[13px] text-white font-display">
          <ShieldCheck className={`w-4 h-4 ${active ? "text-[#22C55E]" : "text-[#8A95A5]"}`} />
          {active ? "Your subscription is active" : "No active subscription"}
        </div>
        <div className="text-[12px] text-[#8A95A5] mt-1">
          {active
            ? `${sub.plan === "yearly" ? "Yearly" : "Monthly"} plan · renews ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—"}`
            : "Choose a plan below to unlock the full workspace."}
        </div>
        {!configured && <div className="mt-2 text-[11px] text-[#F5A623] flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> Demo mode — add your Paystack key in <span className="font-mono">backend/.env</span> to take real payments.</div>}
      </div>

      {/* currency toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-[14px] text-white font-display">Choose your plan</div>
        <div className="flex border border-[#222A35] rounded-md overflow-hidden text-[11px]">
          {(["KES", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={`h-8 px-3 ${currency === c ? "bg-[#FF6B1A] text-white" : "bg-[#11161D] text-[#8A95A5]"}`}>{c}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-[13px] text-[#8A95A5] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading plans…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {plans.map((p) => {
            const isYearly = p.cycle === "yearly";
            const mine = active && sub.plan === p.id;
            return (
              <div key={p.id} className={`rounded-xl border p-5 flex flex-col ${isYearly ? "border-[#FF6B1A]/50 bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#11161D]"}`}>
                <div className="flex items-center justify-between">
                  <div className="text-[13px] text-white font-display flex items-center gap-1.5">{isYearly && <Sparkles className="w-4 h-4 text-[#FF6B1A]" />}{p.name.replace("Buildsasa Pro — ", "")}</div>
                  {isYearly && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FF6B1A]/15 text-[#FF6B1A]">Best value</span>}
                </div>
                <div className="mt-3"><span className="text-[28px] text-white font-display">{fmt(p)}</span><span className="text-[12px] text-[#8A95A5]"> / {p.cycle === "yearly" ? "year" : p.cycle === "weekly" ? "week" : "month"}</span></div>
                {p.note && <div className="text-[11px] text-[#22C55E] mt-1">{p.note}</div>}
                <ul className="mt-4 space-y-1.5 flex-1">
                  {FEATURES.map((f) => <li key={f} className="text-[12px] text-[#C2CAD6] flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] mt-0.5 shrink-0" />{f}</li>)}
                </ul>
                <button
                  disabled={!!busy || mine}
                  onClick={() => subscribe(p.id)}
                  className={`mt-5 h-10 rounded-md text-[12px] font-medium flex items-center justify-center gap-2 disabled:opacity-60 ${isYearly ? "bg-[#FF6B1A] text-white hover:bg-[#FF7E33]" : "border border-[#222A35] text-white hover:bg-[#161C24]"}`}
                >
                  {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : mine ? <><CheckCircle2 className="w-4 h-4" /> Current plan</> : <><CreditCard className="w-4 h-4" /> Subscribe</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {invoices.length > 0 && (
        <div className="mt-7">
          <div className="text-[14px] text-white font-display mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-[#FF6B1A]" /> Invoices</div>
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] divide-y divide-[#222A35]">
            {invoices.map((i) => {
              const st = invStatus(i);
              const overdue = st.label === "Overdue";
              const paying = busy === "inv-" + i.id;
              return (
                <div key={i.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span><span className="text-[12px] text-white font-medium">{i.number}</span></div>
                    <div className="text-[12px] text-[#C2CAD6] mt-0.5 truncate">{i.description}</div>
                    <div className="text-[11px] text-[#8A95A5] mt-0.5">Issued {new Date(i.issuedAt).toLocaleDateString()} · Due {new Date(i.dueDate).toLocaleDateString()}{i.paidAt ? ` · Paid ${new Date(i.paidAt).toLocaleDateString()}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-[14px] text-white tabular-nums">{invAmount(i)}</div>
                    <button onClick={() => downloadInvoicePdf(i)} title="Download PDF" className="h-9 px-3 rounded-md border border-[#222A35] bg-[#11161D] text-[11px] text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download</button>
                    {i.status !== "paid" && <button disabled={paying} onClick={() => payInvoice(i.id)} className={`h-9 px-3 rounded-md text-[12px] text-white flex items-center gap-1.5 disabled:opacity-50 ${overdue ? "bg-[#EF4444] hover:bg-[#EF4444]/90" : "bg-[#FF6B1A] hover:bg-[#FF7E33]"}`}>{paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />} Pay invoice</button>}
                    {i.status !== "paid" && isOwner && <button disabled={paying} onClick={() => markPaid(i.id)} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white disabled:opacity-50">Mark paid</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[11px] text-[#5B6675] mt-5">Secure payments via Paystack · M-Pesa, card & bank · cancel anytime. Prices billed in {currency}.</div>
    </div>
  );
}
