// ============================================================================
// Billing & Subscription — live via Paystack (M-Pesa, card, bank).
// Standard plans: Monthly and Yearly.
// ============================================================================

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, ShieldCheck, Loader2, CreditCard, FileText, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import type { Role } from "./roles";
import api, { type BillingInvoiceDto, type UserProfile } from "../../services/api";

type Plan = { id: string; name: string; cycle: string; usd: number; kes: number; note?: string; features?: string[] };

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
  const [sub, setSub] = useState<any>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceDto[]>([]);
  const [currency, setCurrency] = useState<"USD" | "KES">("USD");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // "Mark paid" is a Buildsasa-staff override for offline payments, NOT a customer
  // action — being the owner of your own workspace must not unlock free access.
  // The backend enforces this too (403); this only hides the button.
  const isPlatformAdmin = (() => {
    try { return !!JSON.parse(localStorage.getItem("constructai-user") || "{}")?.platformAdmin; } catch { return false; }
  })();

  const load = async () => {
    try {
      const [p, s, inv, prof] = await Promise.all([
        api.getBillingPlans(),
        api.getSubscription().catch(() => null),
        api.getBillingInvoices().catch(() => []),
        api.me().catch(() => null),
      ]);
      setPlans(p.plans); setSub(s); setInvoices(Array.isArray(inv) ? inv : []); setProfile(prof);
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
      if (r.comp) toast.success("This account has free access — nothing to pay.");
      else if (r.alreadyPaid) toast("Invoice already paid");
      else if (r.demo) toast.error("Payments are temporarily unavailable. Please try again shortly, or contact support.", { duration: 6000 });
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
    // Returning from Paystack (?reference=… / ?trxref=…)? Verify once, THEN load once.
    // Previously we fired load() on mount *and* again after verify, which meant ~8
    // backend round-trips on return — that's what made this feel so slow.
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("reference") || q.get("trxref");
    if (!ref) { load(); return; }

    window.history.replaceState({}, "", window.location.pathname); // clean URL immediately
    setVerifying(true);
    api.billingVerify(ref)
      .then((r) => {
        if (r.ok) { toast.success("Subscription activated 🎉"); window.dispatchEvent(new Event("buildsasa:billing-updated")); }
        else toast("Payment wasn't completed — you haven't been charged.", { duration: 5000 });
      })
      .catch(() => toast.error("We couldn't confirm that payment. If you were charged, contact support."))
      .finally(() => { setVerifying(false); load(); });
    // eslint-disable-next-line
  }, []);

  // Cancelling on Paystack sends the user *back* to this page, which the browser
  // may restore from its back/forward cache — React never remounts, so `busy` is
  // still set and the Subscribe button spins forever (and disables the others).
  // Clear it whenever this page is shown again.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { setBusy(null); setVerifying(false); } };
    const onVisible = () => { if (document.visibilityState === "visible") setBusy(null); };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const fmt = (p: Plan) => currency === "USD" ? `$${p.usd}` : `KES ${p.kes.toLocaleString()}`;

  const subscribe = async (planId: string) => {
    setBusy(planId);
    try {
      const r = await api.billingCheckout(planId, undefined, currency);
      if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return; }
      if (r.comp) toast.success("This account has free access — nothing to pay.");
      else if (r.demo) toast.error("Payments are temporarily unavailable. Please try again shortly, or contact support.", { duration: 6000 });
      await load();
    } catch (e: any) { toast.error(e.message || "Checkout failed"); }
    setBusy(null);
  };

  const active = sub && sub.status === "active";
  // Comped account (platform staff / FREE_ACCESS_EMAILS): the backend reports an
  // always-active "comp" subscription and returns no invoices. Show that plainly
  // instead of a plan picker they must never be charged through.
  const comped = !!(sub && sub.comp);

  // Coming back from Paystack: say what's happening instead of a bare spinner.
  if (verifying) {
    return (
      <div className="px-4 sm:px-7 py-20 max-w-4xl flex flex-col items-center text-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#FF6B1A]" />
        <div className="text-[15px] text-white font-display mt-4">Confirming your payment…</div>
        <p className="text-[12.5px] text-[#8A95A5] mt-2 max-w-sm leading-relaxed">
          We're checking this with Paystack. This takes a few seconds — please don't close or refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-7 py-6 max-w-4xl">
      {/* Current status. Rendered only once the real subscription state is known —
          otherwise it briefly flashes "No active subscription" at paying customers. */}
      {loading ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 mb-5 flex items-center gap-2 text-[12.5px] text-[#8A95A5]">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking your subscription…
        </div>
      ) : (
        <div className={`rounded-xl border p-5 mb-5 ${active ? "border-[#22C55E]/40 bg-[#22C55E]/5" : "border-[#222A35] bg-[#11161D]"}`}>
          <div className="flex items-center gap-2 text-[13px] text-white font-display">
            <ShieldCheck className={`w-4 h-4 ${active ? "text-[#22C55E]" : "text-[#8A95A5]"}`} />
            {comped ? "Free access — no payment required" : active ? "Your subscription is active" : "No active subscription"}
          </div>
          <div className="text-[12px] text-[#8A95A5] mt-1">
            {comped
              ? "This account is comped: the full workspace is unlocked, you're never billed, and no invoices are issued."
              : active
                ? `${sub.plan === "standard-yearly" || sub.plan === "yearly" ? "Yearly" : "Monthly"} plan · renews ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—"}`
                : "Choose a plan below to unlock the full workspace."}
          </div>
        </div>
      )}

      {/* currency toggle — comped accounts have nothing to price, so no picker */}
      {!comped && (
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] text-white font-display">Choose your plan</div>
          <div className="flex border border-[#222A35] rounded-md overflow-hidden text-[11px]">
            {(["USD", "KES"] as const).map((c) => (
              <button key={c} onClick={() => setCurrency(c)} className={`h-8 px-3 ${currency === c ? "bg-[#FF6B1A] text-white" : "bg-[#11161D] text-[#8A95A5]"}`}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {comped ? null : loading ? (
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
                  {/* Per-plan features come from the admin-managed catalogue; fall
                      back to the shared list when a plan has none set. */}
                  {(p.features && p.features.length ? p.features : FEATURES).map((f) => <li key={f} className="text-[12px] text-[#C2CAD6] flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] mt-0.5 shrink-0" />{f}</li>)}
                </ul>
                <button
                  disabled={!!busy || mine}
                  onClick={() => subscribe(p.id)}
                  className={`mt-5 h-10 rounded-md text-[12px] font-medium flex items-center justify-center gap-2 disabled:opacity-60 ${isYearly ? "bg-[#FF6B1A] text-white hover:bg-[#FF7E33]" : "border border-[#222A35] text-white hover:bg-[#161C24]"}`}
                >
                  {busy === p.id
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Taking you to Paystack…</>
                    : mine ? <><CheckCircle2 className="w-4 h-4" /> Current plan</> : <><CreditCard className="w-4 h-4" /> Subscribe</>}
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
                    {i.status !== "paid" && isPlatformAdmin && <button disabled={paying} onClick={() => markPaid(i.id)} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white disabled:opacity-50">Mark paid</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!comped && <div className="text-[11px] text-[#5B6675] mt-5">Secure payments via Paystack · M-Pesa, card & bank · cancel anytime. Prices billed in {currency}.</div>}
    </div>
  );
}
