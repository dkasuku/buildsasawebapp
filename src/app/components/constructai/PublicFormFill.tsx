// ============================================================================
// PublicFormFill — standalone, NO-AUTH page reached via a public share link
// (/?form=TOKEN). Anyone with the link can view and submit the form.
// ============================================================================

import { useEffect, useState } from "react";
import { HardHat, Check, Loader2, AlertTriangle, Send } from "lucide-react";
import api from "../../services/api";

const asArr = (v: any): string[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []); } catch { return v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []; } }
  return [];
};

export function PublicFormFill({ token, theme }: { token: string; theme?: "dark" | "light" }) {
  const [form, setForm] = useState<{ title: string; trade: string; category?: string; items: any[] } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "done">("loading");
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getPublicForm(token)
      .then((r) => { if (!alive) return; let items: any[] = []; try { items = JSON.parse(r.items || "[]"); } catch { items = []; } setForm({ title: r.title, trade: r.trade, category: r.category || undefined, items: Array.isArray(items) ? items : [] }); setStatus("ready"); })
      .catch((e) => { if (!alive) return; setError(e?.message || "This form is not available."); setStatus("error"); });
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const data = form.items.map((it, i) => ({
        group: it.questionGroup || it.group || "",
        question: it.caption || it.question || "",
        type: it.questionType || "text",
        answer: answers[i] ?? "",
      }));
      await api.submitPublicForm(token, { respondentName: name.trim() || undefined, respondentEmail: email.trim() || undefined, data });
      setStatus("done");
    } catch (e: any) { setError(e?.message || "Could not submit. Try again."); }
    setBusy(false);
  };

  // group items in order
  const groups: { group: string; items: { it: any; idx: number }[] }[] = [];
  const gmap = new Map<string, { it: any; idx: number }[]>();
  (form?.items || []).forEach((it, idx) => {
    const g = (it.questionGroup || it.group || "General").trim() || "General";
    if (!gmap.has(g)) { gmap.set(g, []); groups.push({ group: g, items: gmap.get(g)! }); }
    gmap.get(g)!.push({ it, idx });
  });

  const input = "w-full h-10 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]";

  const Shell = (children: any) => (
    <div className={`min-h-screen w-full ${theme === "light" ? "theme-light bg-[#F4F6FA]" : "bg-[#0A0E14]"}`} style={theme === "light" ? { backgroundColor: "#F4F6FA" } : undefined}>
      <div className="border-b border-[#222A35] bg-[#11161D]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#FF6B1A] to-[#FF8A4A] flex items-center justify-center"><HardHat className="w-[18px] h-[18px] text-white" strokeWidth={2.4} /></div>
          <div className="text-[14px] text-white tracking-tight font-display">Buildflex</div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">{children}</div>
    </div>
  );

  if (status === "loading") return Shell(<div className="text-[13px] text-[#8A95A5] flex items-center gap-2 py-16 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading form…</div>);

  if (status === "error") return Shell(
    <div className="text-center py-16">
      <div className="w-12 h-12 rounded-full bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center mx-auto"><AlertTriangle className="w-6 h-6 text-[#EF4444]" /></div>
      <div className="text-[15px] text-white font-display mt-3">Form unavailable</div>
      <p className="text-[12.5px] text-[#8A95A5] mt-1.5">{error}</p>
    </div>
  );

  if (status === "done") return Shell(
    <div className="text-center py-16">
      <div className="w-12 h-12 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center mx-auto"><Check className="w-6 h-6 text-[#22C55E]" /></div>
      <div className="text-[16px] text-white font-display mt-3">Submitted — thank you</div>
      <p className="text-[12.5px] text-[#8A95A5] mt-1.5">Your response to "{form?.title}" was recorded.</p>
    </div>
  );

  return Shell(
    <>
      <div className="text-[20px] text-white font-display">{form?.title}</div>
      <div className="text-[12px] text-[#5B6675] mt-0.5">{form?.trade}{form?.category ? ` · ${form.category}` : ""}</div>

      <div className="mt-6 space-y-5">
        {groups.map((g) => (
          <div key={g.group}>
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#FF6B1A] font-semibold mb-2 pb-1 border-b border-[#222A35]">{g.group}</div>
            <div className="space-y-3.5">
              {g.items.map(({ it, idx }) => {
                const val = answers[idx] || "";
                const opts = it.answerOptions !== undefined ? asArr(it.answerOptions) : asArr(it.options);
                const set = (v: string) => setAnswers((a) => ({ ...a, [idx]: v }));
                const type = it.questionType || "text";
                return (
                  <div key={idx} className="rounded-lg border border-[#222A35] bg-[#11161D] p-3.5">
                    <div className="text-[13px] text-white mb-2">{it.caption || it.question} {it.required && <span className="text-[#EF4444]">*</span>}</div>
                    {(type === "text" || type === "photo") && <input value={val} onChange={(e) => set(e.target.value)} placeholder={it.defaultAnswer || (type === "photo" ? "Describe / paste a link" : "")} className={input} />}
                    {(type === "number" || type === "percentage") && <input type="number" value={val} onChange={(e) => set(e.target.value)} placeholder={it.defaultAnswer || ""} className={input} />}
                    {type === "yes_no" && (
                      <div className="flex gap-2">{(opts.length ? opts : ["Yes", "No"]).map((o) => <button key={o} onClick={() => set(o)} className={`flex-1 h-9 rounded-md text-[12px] border ${val === o ? "bg-[#FF6B1A]/20 border-[#FF6B1A] text-[#FF6B1A]" : "bg-[#0A0E14] border-[#222A35] text-[#8A95A5]"}`}>{o}</button>)}</div>
                    )}
                    {type === "checkbox" && (
                      <div className="space-y-1.5">{opts.map((o) => { const checked = (val || "").split("|").includes(o); return (
                        <label key={o} className="flex items-center gap-2 text-[12.5px] text-white"><input type="checkbox" checked={checked} onChange={(e) => { const arr = (val || "").split("|").filter(Boolean); set(e.target.checked ? [...arr, o].join("|") : arr.filter((x) => x !== o).join("|")); }} className="accent-[#FF6B1A]" />{o}</label>
                      ); })}</div>
                    )}
                    {it.policy && <div className="text-[10px] text-[#5B6675] mt-1.5">Ref: {it.policy}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-[#222A35] bg-[#11161D] p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Your name (optional)</div><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
        <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Email (optional)</div><input value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></div>
      </div>

      <button onClick={submit} disabled={busy} className="w-full h-11 mt-5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit response</button>
      <div className="text-[10px] text-[#5B6675] text-center mt-3">Powered by Buildflex · your response is sent to the form owner</div>
    </>
  );
}

export default PublicFormFill;
