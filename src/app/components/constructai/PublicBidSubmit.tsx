// ============================================================================
// PublicBidSubmit — standalone, NO-AUTH page reached via a public tender link
// (/?bid=TOKEN). Any subcontractor with the link can view the tender and
// submit a bid without an account.
// ============================================================================

import { useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, Send, Calendar, Wallet, Paperclip } from "lucide-react";
import api from "../../services/api";
import { formatCurrency } from "./currency";

type PublicPkg = {
  title: string;
  trade?: string | null;
  description?: string | null;
  budgetKES?: number | null;
  dueDate?: string | null;
  status: string;
  companyName?: string | null;
};

const fmtDate = (d?: string | null) => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
};

export function PublicBidSubmit({ token, theme }: { token: string; theme?: "dark" | "light" }) {
  const [pkg, setPkg] = useState<PublicPkg | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "done">("loading");
  const [error, setError] = useState("");

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getPublicBidPackage(token)
      .then((r) => {
        if (!alive) return;
        if (r.status && r.status !== "open") {
          setError("This tender is not open for bids.");
          setStatus("error");
          return;
        }
        setPkg(r);
        setStatus("ready");
      })
      .catch((e) => { if (!alive) return; setError(e?.message || "This tender isn't available."); setStatus("error"); });
    return () => { alive = false; };
  }, [token]);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await api.uploadFile(file);
      setFileUrl(url);
    } catch {
      setError("Could not upload file. You can still submit without it.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!company.trim()) { setError("Please enter your company / name."); return; }
    if (!amount || Number(amount) <= 0) { setError("Please enter your bid amount."); return; }
    setError("");
    setBusy(true);
    try {
      await api.submitPublicBid(token, {
        subcontractor: company.trim(),
        contactName: company.trim(),
        contactEmail: email.trim() || undefined,
        contactPhone: phone.trim() || undefined,
        trade: pkg?.trade || undefined,
        amount: Number(amount),
        notes: notes.trim() || undefined,
        fileUrl: fileUrl || undefined,
      });
      setStatus("done");
    } catch (e: any) {
      setError(e?.message || "Could not submit your bid. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full h-10 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]";
  const label = "text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1";

  const Shell = (children: any) => (
    <div className={`min-h-screen w-full ${theme === "light" ? "theme-light bg-[#F4F6FA]" : "bg-[#0A0E14]"}`} style={theme === "light" ? { backgroundColor: "#F4F6FA" } : undefined}>
      <div className="border-b border-[#222A35] bg-[#11161D]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center"><img src="/Buildsasa.png" alt="Buildsasa" className="w-full h-full object-cover" /></div>
          <div className="text-[14px] text-white tracking-tight font-display">Buildsasa</div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">{children}</div>
    </div>
  );

  if (status === "loading") return Shell(<div className="text-[13px] text-[#8A95A5] flex items-center gap-2 py-16 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading tender…</div>);

  if (status === "error") return Shell(
    <div className="text-center py-16">
      <div className="w-12 h-12 rounded-full bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center mx-auto"><AlertTriangle className="w-6 h-6 text-[#EF4444]" /></div>
      <div className="text-[15px] text-white font-display mt-3">Tender unavailable</div>
      <p className="text-[12.5px] text-[#8A95A5] mt-1.5">{error}</p>
    </div>
  );

  if (status === "done") return Shell(
    <div className="text-center py-16">
      <div className="w-12 h-12 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center mx-auto"><Check className="w-6 h-6 text-[#22C55E]" /></div>
      <div className="text-[16px] text-white font-display mt-3">Bid submitted — thank you</div>
      <p className="text-[12.5px] text-[#8A95A5] mt-1.5">Your bid for "{pkg?.title}" was received{pkg?.companyName ? ` by ${pkg.companyName}` : ""}. You'll be contacted if shortlisted.</p>
    </div>
  );

  const due = fmtDate(pkg?.dueDate);

  return Shell(
    <>
      <div className="text-[20px] text-white font-display">{pkg?.title}</div>
      <div className="text-[12px] text-[#5B6675] mt-0.5">{pkg?.trade || "General"}{pkg?.companyName ? ` · ${pkg.companyName}` : ""}</div>

      {/* Tender summary */}
      <div className="mt-5 rounded-xl border border-[#222A35] bg-[#11161D] p-4 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <div className={label}>Budget guide</div>
          <div className="text-white flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-[#5B6675]" />{pkg?.budgetKES != null ? formatCurrency(Math.round(pkg.budgetKES), "KES") : "Open"}</div>
        </div>
        <div>
          <div className={label}>Bids due</div>
          <div className="text-white flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-[#5B6675]" />{due || "Open"}</div>
        </div>
        {pkg?.description && (
          <div className="col-span-2">
            <div className={label}>Scope</div>
            <div className="text-[#E6EAF0] leading-relaxed whitespace-pre-wrap">{pkg.description}</div>
          </div>
        )}
      </div>

      {/* Bid form */}
      <div className="mt-6 space-y-4">
        <div className="text-[13px] text-white font-display">Submit your bid</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><div className={label}>Your company / name <span className="text-[#EF4444]">*</span></div><input value={company} onChange={(e) => setCompany(e.target.value)} className={input} placeholder="e.g. Acme Electrical Ltd" /></div>
          <div><div className={label}>Email</div><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="you@company.com" /></div>
          <div><div className={label}>Phone</div><input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="+254…" /></div>
          <div><div className={label}>Your bid amount (KES) <span className="text-[#EF4444]">*</span></div><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} placeholder="0" /></div>
        </div>

        <div><div className={label}>Notes / inclusions</div><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-[#11161D] border border-[#222A35] rounded-md px-3 py-2 text-[13px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" placeholder="Scope assumptions, lead time, exclusions…" /></div>

        <div>
          <div className={label}>Attachment (optional)</div>
          <label className="inline-flex items-center gap-2 h-10 px-3 rounded-md border border-[#222A35] bg-[#11161D] text-[12px] text-[#8A95A5] hover:text-white cursor-pointer">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
            {uploading ? "Uploading…" : fileUrl ? "Replace file" : "Attach quote / document"}
            <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="ml-2 text-[11px] text-[#3B82F6] hover:underline">View attached</a>}
        </div>

        {error && <div className="text-[12px] text-[#EF4444]">{error}</div>}

        <button onClick={submit} disabled={busy} className="w-full h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit bid</button>
        <div className="text-[10px] text-[#5B6675] text-center">Powered by Buildsasa · your bid is sent to the tender owner</div>
      </div>
    </>
  );
}

export default PublicBidSubmit;
