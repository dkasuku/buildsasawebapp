// ============================================================================
// PublicQuoteView — standalone, NO-AUTH page reached via a shared quote link
// (/?quote=TOKEN). The client sees the quote and accepts or declines it. Always
// light and plain: the reader is a homeowner on a phone, not an app user.
// ============================================================================

import { useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, X } from "lucide-react";
import api, { type PublicQuoteDto } from "../../services/api";
import { quoteTotals } from "./Quotes";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const day = (d?: string | null) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; }
};

export function PublicQuoteView({ token }: { token: string }) {
  const [quote, setQuote] = useState<PublicQuoteDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"idle" | "accept" | "decline">("idle");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = () => api.getPublicQuote(token)
    .then((q) => { setQuote(q); setState("ready"); })
    .catch((e) => { setError(e?.message || "This quote is not available."); setState("error"); });
  useEffect(() => { load(); }, [token]);

  const respond = async (decision: "accept" | "decline") => {
    if (decision === "accept" && !name.trim()) { setFormError("Please type your full name to accept."); return; }
    setBusy(true);
    setFormError("");
    try {
      await api.respondToQuote(token, { decision, name: name.trim(), reason: reason.trim() });
      setMode("idle");
      await load();
    } catch (e: any) {
      setFormError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const Shell = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "#F4F6FA", color: "#1B1F24", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ background: "#0B2A4A" }}>
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden"><img src="/Buildsasa.png" alt="" className="w-full h-full object-cover" /></div>
          <div className="text-[14px] text-white font-semibold">{quote?.companyName || "Quotation"}</div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">{children}</div>
      <div className="text-center text-[11px] pb-8" style={{ color: "#8A95A5" }}>
        Sent with <a href="https://buildsasa.com" target="_blank" rel="noopener noreferrer" style={{ color: "#F45B1E" }}>Buildsasa</a>
      </div>
    </div>
  );

  if (state === "loading") return Shell(<div className="flex items-center justify-center gap-2 py-20 text-[13px]" style={{ color: "#5B6675" }}><Loader2 className="w-4 h-4 animate-spin" /> Loading quote…</div>);
  if (state === "error" || !quote) return Shell(
    <div className="text-center py-20">
      <AlertTriangle className="w-10 h-10 mx-auto" style={{ color: "#EF4444" }} />
      <div className="text-[16px] font-semibold mt-3">Quote unavailable</div>
      <p className="text-[13px] mt-1.5" style={{ color: "#5B6675" }}>{error}</p>
    </div>,
  );

  const t = quoteTotals(quote.items, quote.discount, quote.taxRate);
  const sections: { name: string; items: PublicQuoteDto["items"] }[] = [];
  quote.items.forEach((i) => {
    const n = i.section || "";
    const last = sections[sections.length - 1];
    if (last && last.name === n) last.items.push(i); else sections.push({ name: n, items: [i] });
  });
  const canRespond = quote.status === "sent";
  const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #E6E9EE" };

  return Shell(
    <div className="space-y-4">
      {quote.status === "accepted" && (
        <div className="flex items-start gap-3 p-4" style={{ ...card, background: "#ECFDF3", borderColor: "#A6F0C4" }}>
          <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#16A34A" }} />
          <div className="text-[13px]"><strong>Quote accepted</strong>{quote.acceptedBy ? ` by ${quote.acceptedBy}` : ""}{quote.respondedAt ? ` on ${day(quote.respondedAt)}` : ""}. Thank you, {quote.companyName || "the team"} will be in touch to get started.</div>
        </div>
      )}
      {quote.status === "declined" && (
        <div className="flex items-start gap-3 p-4" style={{ ...card, background: "#FEF2F2", borderColor: "#FECACA" }}>
          <X className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#DC2626" }} />
          <div className="text-[13px]"><strong>Quote declined.</strong> Thank you for letting us know. If you'd like a revised quote, just get in touch.</div>
        </div>
      )}
      {quote.status === "expired" && (
        <div className="p-4 text-[13px]" style={{ ...card, background: "#FFFBEB", borderColor: "#FDE68A" }}>
          <strong>This quote expired on {day(quote.validUntil)}.</strong> Please contact {quote.companyName || "us"} for an updated quote.
        </div>
      )}
      {quote.status === "draft" && (
        <div className="p-4 text-[13px]" style={{ ...card, background: "#FFFBEB", borderColor: "#FDE68A" }}>
          This quote is being revised. You'll receive the updated version shortly.
        </div>
      )}

      <div className="p-5" style={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "#F45B1E" }}>Quotation {quote.quoteNumber}</div>
            <div className="text-[20px] font-semibold mt-1 leading-tight">{quote.title}</div>
            <div className="text-[13px] mt-1" style={{ color: "#5B6675" }}>For {quote.clientName}{quote.clientAddress ? ` · ${quote.clientAddress}` : ""}</div>
          </div>
          <div className="text-right text-[12px]" style={{ color: "#5B6675" }}>
            <div>Issued {day(quote.issuedAt)}</div>
            {quote.validUntil && <div>Valid until {day(quote.validUntil)}</div>}
          </div>
        </div>
      </div>

      <div style={card} className="overflow-hidden">
        {sections.map((s, si) => (
          <div key={si}>
            {s.name && <div className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ background: "#F7F8FA", color: "#5B6675" }}>{s.name}</div>}
            {s.items.map((i, ii) => (
              <div key={ii} className="px-5 py-3 flex items-start justify-between gap-3" style={{ borderTop: "1px solid #EEF0F3" }}>
                <div className="min-w-0">
                  <div className="text-[13.5px]">{i.description}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "#8A95A5" }}>{i.quantity} {i.unit} × {kes(i.rate)}</div>
                </div>
                <div className="text-[13.5px] font-medium whitespace-nowrap">{kes(i.quantity * i.rate)}</div>
              </div>
            ))}
          </div>
        ))}
        <div className="px-5 py-4 space-y-1.5 text-[13px]" style={{ borderTop: "1px solid #E6E9EE", background: "#FBFBFC" }}>
          <div className="flex justify-between"><span style={{ color: "#5B6675" }}>Subtotal</span><span>{kes(t.subtotal)}</span></div>
          {t.discount > 0 && <div className="flex justify-between"><span style={{ color: "#5B6675" }}>Discount</span><span>- {kes(t.discount)}</span></div>}
          {quote.taxRate ? <div className="flex justify-between"><span style={{ color: "#5B6675" }}>VAT ({quote.taxRate}%)</span><span>{kes(t.tax)}</span></div> : null}
          <div className="flex justify-between pt-2 text-[16px] font-semibold" style={{ borderTop: "1px solid #E6E9EE" }}><span>Total</span><span>{kes(quote.total)}</span></div>
          {quote.depositPercent ? <div className="flex justify-between" style={{ color: "#F45B1E" }}><span>Deposit to start ({quote.depositPercent}%)</span><span>{kes(quote.total * quote.depositPercent / 100)}</span></div> : null}
        </div>
      </div>

      {(quote.notes || quote.terms) && (
        <div className="p-5 space-y-3 text-[13px]" style={card}>
          {quote.notes && <div><div className="font-semibold mb-1">Scope notes</div><div className="whitespace-pre-wrap" style={{ color: "#4B5563" }}>{quote.notes}</div></div>}
          {quote.terms && <div><div className="font-semibold mb-1">Terms</div><div className="whitespace-pre-wrap" style={{ color: "#4B5563" }}>{quote.terms}</div></div>}
        </div>
      )}

      {canRespond && (
        <div className="p-5" style={card}>
          {mode === "idle" && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => { setMode("accept"); setFormError(""); }} className="sm:flex-1 rounded-lg text-white text-[15px] font-semibold" style={{ background: "#16A34A", height: 48 }}>Accept quote</button>
              <button onClick={() => { setMode("decline"); setFormError(""); }} className="sm:flex-1 rounded-lg text-[15px]" style={{ border: "1px solid #D0D5DD", color: "#374151", background: "#fff", height: 48 }}>Decline</button>
            </div>
          )}
          {mode === "accept" && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold">Accept {kes(quote.total)} for {quote.title}</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name" autoFocus className="w-full rounded-lg px-3 text-[16px] outline-none" style={{ height: 44, border: "1px solid #D0D5DD", color: "#1B1F24", background: "#fff" }} />
              <p className="text-[12px]" style={{ color: "#5B6675" }}>Typing your name confirms you accept this quote and its terms.</p>
              {formError && <div className="text-[12.5px]" style={{ color: "#DC2626" }}>{formError}</div>}
              <div className="flex gap-2">
                <button onClick={() => setMode("idle")} className="px-4 rounded-lg text-[14px]" style={{ border: "1px solid #D0D5DD", color: "#374151", background: "#fff", height: 44 }}>Back</button>
                <button onClick={() => respond("accept")} disabled={busy} className="flex-1 rounded-lg text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#16A34A", height: 44 }}>{busy ? "Sending…" : "Confirm acceptance"}</button>
              </div>
            </div>
          )}
          {mode === "decline" && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold">Decline this quote</div>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Optional: let us know why (price, timing, scope…)" className="w-full rounded-lg px-3 py-2 text-[14px] outline-none" style={{ border: "1px solid #D0D5DD", color: "#1B1F24", background: "#fff" }} />
              {formError && <div className="text-[12.5px]" style={{ color: "#DC2626" }}>{formError}</div>}
              <div className="flex gap-2">
                <button onClick={() => setMode("idle")} className="px-4 rounded-lg text-[14px]" style={{ border: "1px solid #D0D5DD", color: "#374151", background: "#fff", height: 44 }}>Back</button>
                <button onClick={() => respond("decline")} disabled={busy} className="flex-1 rounded-lg text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#DC2626", height: 44 }}>{busy ? "Sending…" : "Decline quote"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
  );
}
