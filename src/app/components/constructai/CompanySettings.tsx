// Company profile: the name, logo and contact details printed on quotes and
// invoices and shown on the client's quote page and portal. Editable by the
// company owner and executives; everyone else sees it read-only.

import { MapPicker } from "./MapPicker";
import { useEffect, useRef, useState } from "react";
import { SERVICES, clientApi } from "./client/clientData";
import { Stars, TrustBadge } from "./client/Trust";
import { toast } from "sonner";
import { Loader2, ImagePlus, Check } from "lucide-react";
import api, { absoluteFileUrl, type CompanyDto } from "../../services/api";
import { useFileUpload } from "./useFileUpload";
import { forgetCompanyLogo } from "../../services/brandPdf";

const lbl = "text-[10px] uppercase tracking-[0.08em] text-[#5B6675] mb-1 block";
const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] disabled:opacity-60";
const area = "w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-2 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] disabled:opacity-60";

type Form = { name: string; logoUrl: string; phone: string; email: string; address: string; kraPin: string; paymentDetails: string; quoteTerms: string; about: string };

export function CompanySettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [f, setF] = useState<Form>({ name: "", logoUrl: "", phone: "", email: "", address: "", kraPin: "", paymentDetails: "", quoteTerms: "", about: "" });
  // What the company offers, shown to clients browsing companies on Buildsasa.
  const [services, setServices] = useState<string[]>([]);
  const [trust, setTrust] = useState<Awaited<ReturnType<typeof clientApi.companyTrust>> | null>(null);
  useEffect(() => { clientApi.companyTrust().then(setTrust).catch(() => {}); }, []);
  const uploader = useFileUpload();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getCompany()
      .then((c: CompanyDto) => {
        setCanEdit(c.canEdit);
        setF({ name: c.name || "", logoUrl: c.logoUrl || "", phone: c.phone || "", email: c.email || "", address: c.address || "", kraPin: c.kraPin || "", paymentDetails: c.paymentDetails || "", quoteTerms: c.quoteTerms || "", about: (c as any).about || "" });
        try { const sv = JSON.parse((c as any).services || "[]"); setServices(Array.isArray(sv) ? sv : []); } catch { setServices([]); }
      })
      .catch((e) => toast.error(e.message || "Could not load the company profile"))
      .finally(() => setLoading(false));
  }, []);

  const pickLogo = async (files: FileList | null) => {
    const file = files?.[0];
    if (file && !/^image\/(png|jpe?g)$/.test(file.type)) return toast.error("Use a PNG or JPG logo so it prints on PDFs");
    const [url] = await uploader.upload(files);
    if (url) setF((x) => ({ ...x, logoUrl: url }));
  };

  const save = async () => {
    if (!f.name.trim()) return toast.error("The company name can't be empty");
    if (uploader.busy) return toast.error("Wait for the logo to finish uploading");
    setSaving(true);
    try {
      await api.updateCompany({ ...f, services: JSON.stringify(services) } as any);
      forgetCompanyLogo();
      // Quotes and other open screens refresh their branding.
      window.dispatchEvent(new Event("buildflex:company-updated"));
      toast.success("Company profile saved. It now appears on your quotes, invoices and client pages.");
    } catch (e: any) { toast.error(e.message || "Could not save"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="py-16 text-center text-[#5B6675] text-[13px]"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading…</div>;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const preview = uploader.pending[0]?.previewUrl || (f.logoUrl ? absoluteFileUrl(f.logoUrl) : "");

  return (
    <div className="p-5 space-y-4">
      <p className="text-[12px] text-[#8A95A5]">This is how your company appears to clients on quotes, invoices, the quote link and the client portal.{!canEdit && " Only the company owner or an executive can change it."}</p>

      <div>
        <span className={lbl}>Logo</span>
        <div className="flex items-center gap-3">
          <div className="w-28 h-16 rounded-md border border-[#222A35] bg-white flex items-center justify-center overflow-hidden">
            {preview ? <img src={preview} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-[#8A95A5]">No logo</span>}
          </div>
          {canEdit && (
            <div className="space-y-1">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploader.busy} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-white flex items-center gap-1.5 disabled:opacity-60">
                {uploader.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}{f.logoUrl ? "Change logo" : "Upload logo"}
              </button>
              {f.logoUrl && !uploader.busy && <button type="button" onClick={() => { setF({ ...f, logoUrl: "" }); uploader.reset(); }} className="text-[11px] text-[#8A95A5] hover:text-red-400">Remove</button>}
              <div className="text-[10px] text-[#5B6675]">PNG or JPG. A wide logo on a white background works best.</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { pickLogo(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      <div><span className={lbl}>Company name *</span><input placeholder="e.g. Kamau Builders Ltd" value={f.name} onChange={set("name")} disabled={!canEdit} className={input} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><span className={lbl}>Company phone</span><input type="tel" value={f.phone} onChange={set("phone")} disabled={!canEdit} placeholder="e.g. 0712 345 678" className={input} /></div>
        <div><span className={lbl}>Company email</span><input type="email" value={f.email} onChange={set("email")} disabled={!canEdit} placeholder="e.g. info@yourcompany.co.ke" className={input} /></div>
      </div>
      <div><span className={lbl}>Address</span>{canEdit ? <MapPicker value={f.address} onChange={(v) => setF((x) => ({ ...x, address: v }))} onLatLngChange={() => {}} placeholder="Search your office, e.g. Westlands, Nairobi" /> : <input placeholder="Set your office location above" value={f.address} disabled className={input} />}</div>
      <div className="grid grid-cols-2 gap-3">
        <div><span className={lbl}>KRA PIN</span><input value={f.kraPin} onChange={set("kraPin")} disabled={!canEdit} placeholder="e.g. P051234567X" className={input} /></div>
      </div>
      <div>
        <span className={lbl}>How clients pay you</span>
        <textarea value={f.paymentDetails} onChange={set("paymentDetails")} disabled={!canEdit} rows={3} placeholder={"e.g. M-Pesa Paybill 123456, Account: your invoice number\nBank: Equity Bank, A/C 0123456789"} className={area} />
        <div className="text-[10px] text-[#5B6675] mt-1">Printed on quotes and invoices and shown in the client portal.</div>
      </div>
      <div>
        <span className={lbl}>Default terms for new quotes</span>
        <textarea value={f.quoteTerms} onChange={set("quoteTerms")} disabled={!canEdit} rows={3} placeholder="e.g. Prices are in KES. Work starts on receipt of the deposit." className={area} />
      </div>

      {trust && (
        <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
          <span className={lbl}>Your trust score on Buildsasa</span>
          <div className="mt-1"><TrustBadge t={trust} detail /></div>
          <p className="text-[11.5px] text-[#8A95A5] mt-2">Clients see this when choosing a company, highest first. Raise it by logging site work every day, handing projects over on time and keeping clients happy. Low client ratings bring it down.{!trust.listed ? " Your company appears to clients while your subscription is active." : ""}</p>
          {trust.reviews.length > 0 && <div className="mt-2 space-y-1.5">{trust.reviews.slice(0, 5).map((r, i) => <div key={i} className="text-[11.5px] text-[#C2CAD6]"><Stars value={r.stars} size={3} /> <b>{r.clientName}</b>{r.comment ? `: ${r.comment}` : ""}</div>)}</div>}
        </div>
      )}
      <div>
        <span className={lbl}>Services you offer (clients use these to find you)</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {SERVICES.map((sv) => {
            const on = services.includes(sv);
            return <button key={sv} type="button" disabled={!canEdit} onClick={() => setServices((x) => (on ? x.filter((y) => y !== sv) : [...x, sv]))} className={`h-8 px-3 rounded-full text-[11.5px] border ${on ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{sv}</button>;
          })}
        </div>
      </div>
      <div>
        <span className={lbl}>About the company (shown to clients)</span>
        <textarea value={f.about} onChange={set("about")} disabled={!canEdit} rows={3} placeholder="e.g. We build homes and perimeter walls across Kiambu and Machakos, with 12 years of experience and our own borehole rig." className={area} />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={save} disabled={saving || uploader.busy} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[12px] flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save company profile
          </button>
        </div>
      )}
    </div>
  );
}
