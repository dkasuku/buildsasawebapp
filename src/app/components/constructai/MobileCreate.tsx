import { Mic, Camera, MapPin, Sparkles, ChevronLeft, X, Check, Image as ImageIcon, Paperclip, DollarSign, Calendar, AlertTriangle } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";

function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="text-center text-[11px] text-[#8A95A5] mb-3 uppercase tracking-wider">{label}</div>
      <div className="mx-auto w-[340px] h-[700px] rounded-[44px] border-[10px] border-[#0A0E14] bg-[#0A0E14] shadow-[0_30px_80px_rgba(0,0,0,0.5)] overflow-hidden relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[110px] h-[26px] bg-black rounded-b-2xl z-20" />
        <div className="h-full overflow-hidden flex flex-col bg-[#0A0E14]">
          <div className="h-11 flex items-center justify-between px-6 pt-1 text-[11px] text-white">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-white rounded-sm" />
              <span className="w-4 h-2 border border-white rounded-sm" />
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function MobileCreate() {
  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6">
      <div className="mb-5">
        <div className="text-[18px] text-white tracking-tight font-display">AI Creation Flow · Mobile</div>
        <div className="text-[12px] text-[#8A95A5]">Three-step jobsite capture — voice, photo, AI draft. One-handed and glove-friendly.</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 justify-items-center">
        {/* Step 1 — Voice */}
        <PhoneFrame label="Step 1 · Capture by voice">
          <div className="flex items-center justify-between px-4 py-3">
            <button className="w-9 h-9 rounded-full bg-[#11161D] flex items-center justify-center text-white"><X className="w-4 h-4" /></button>
            <span className="text-[12px] text-[#8A95A5]">New Change Order</span>
            <span className="text-[12px] text-[#FF6B1A]">Save draft</span>
          </div>
          <div className="px-5 mt-2">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Project</div>
            <div className="text-[15px] text-white mt-1" style={{ fontWeight: 500 }}>Harborfront Tower</div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#8A95A5] mt-1"><MapPin className="w-3 h-3" /> Level 14, East Wing · GPS verified</div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#FF6B1A]/20 animate-ping" />
              <div className="absolute -inset-4 rounded-full bg-[#FF6B1A]/10" />
              <div className="absolute -inset-8 rounded-full bg-[#FF6B1A]/5" />
              <button className="relative w-[120px] h-[120px] rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#FF8A4A] flex items-center justify-center shadow-[0_20px_50px_rgba(255,107,26,0.5)]">
                <Mic className="w-12 h-12 text-white" strokeWidth={2} />
              </button>
            </div>
            <div className="text-[14px] text-white mt-8" style={{ fontWeight: 500 }}>Listening…</div>
            <div className="text-[11px] text-[#8A95A5] mt-1">00:42 · Tap to stop</div>
            <div className="mt-6 flex gap-1 items-end h-8">
              {[8, 14, 22, 18, 26, 32, 20, 14, 28, 22, 12, 18, 30, 16].map((h, i) => (
                <div key={i} className="w-1 rounded-full bg-[#FF6B1A]" style={{ height: h }} />
              ))}
            </div>
          </div>
          <div className="px-5 pb-8">
            <div className="rounded-2xl bg-[#11161D] border border-[#222A35] p-4">
              <div className="text-[10px] text-[#FF6B1A] uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3 h-3" /> Live transcription</div>
              <div className="text-[12px] text-white mt-2 leading-relaxed">
                "Hey, on level fourteen east wing we need to add eight more VAV boxes because the owner bumped the cooling spec from two tons to three and a half…"
              </div>
            </div>
          </div>
        </PhoneFrame>

        {/* Step 2 — Photos */}
        <PhoneFrame label="Step 2 · Attach jobsite evidence">
          <div className="flex items-center justify-between px-4 py-3">
            <button className="w-9 h-9 rounded-full bg-[#11161D] flex items-center justify-center text-white"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[12px] text-[#8A95A5]">Step 2 of 3</span>
            <span className="text-[12px] text-[#FF6B1A]">Skip</span>
          </div>
          <div className="px-5 mt-2">
            <div className="text-[18px] text-white" style={{ fontWeight: 500 }}>Add photos</div>
            <div className="text-[12px] text-[#8A95A5] mt-0.5">AI will tag location, equipment, and condition.</div>
          </div>
          <div className="px-5 mt-4 grid grid-cols-2 gap-2">
            {[
              "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&q=80",
              "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=400&q=80",
              "https://images.unsplash.com/photo-1531834685032-c34bf0d84c77?w=400&q=80",
            ].map((s, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-[#222A35]">
                <ImageWithFallback src={s} alt="" className="w-full h-full object-cover" />
                <div className="absolute top-2 left-2 text-[9px] text-white bg-black/50 backdrop-blur px-1.5 py-0.5 rounded">AI: ductwork</div>
                <button className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"><X className="w-3 h-3 text-white" /></button>
              </div>
            ))}
            <button className="aspect-square rounded-xl border-2 border-dashed border-[#222A35] flex flex-col items-center justify-center text-[#8A95A5]">
              <Camera className="w-7 h-7" />
              <span className="text-[10px] mt-1">Take photo</span>
            </button>
          </div>
          <div className="px-5 mt-4">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Quick add</div>
            <div className="space-y-2">
              {[
                { i: Paperclip, l: "Attach drawing markup", s: "M-401 Rev 4 detected" },
                { i: ImageIcon, l: "Pull from gallery", s: "12 site photos today" },
              ].map((q, i) => (
                <button key={i} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#11161D] border border-[#222A35] text-left">
                  <q.i className="w-4 h-4 text-[#FF6B1A]" />
                  <div className="flex-1">
                    <div className="text-[12px] text-white">{q.l}</div>
                    <div className="text-[10px] text-[#5B6675]">{q.s}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-auto px-5 pb-8 pt-4">
            <button className="w-full h-14 rounded-2xl bg-[#FF6B1A] text-white text-[14px] flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(255,107,26,0.4)]">
              Continue to AI draft →
            </button>
          </div>
        </PhoneFrame>

        {/* Step 3 — Review AI draft */}
        <PhoneFrame label="Step 3 · Review AI draft">
          <div className="flex items-center justify-between px-4 py-3">
            <button className="w-9 h-9 rounded-full bg-[#11161D] flex items-center justify-center text-white"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[12px] text-[#8A95A5]">Step 3 of 3</span>
            <span className="text-[12px] text-[#FF6B1A]">Edit</span>
          </div>
          <div className="px-5 mt-1 overflow-y-auto flex-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[10px] text-[#FF6B1A] uppercase tracking-wider">
              <Sparkles className="w-3 h-3" /> Drafted in 43 seconds
            </div>
            <h2 className="text-[18px] text-white mt-3 tracking-tight leading-tight" style={{ fontWeight: 500 }}>
              Additional VAV boxes — east wing reconfiguration
            </h2>
            <p className="text-[12px] text-[#8A95A5] mt-2 leading-relaxed">
              Owner-requested increase in cooling capacity from 2 to 3.5 tons per zone requires 8 additional VAV terminal units, branch ductwork, and rerouting on Level 14 east wing.
            </p>

            <div className="mt-4 space-y-2">
              {[
                { i: DollarSign, l: "Estimated cost", v: "+$284,000", c: "#FF6B1A" },
                { i: Calendar, l: "Schedule impact", v: "+4 days", c: "#F5A623" },
                { i: AlertTriangle, l: "Trigger", v: "Owner change", c: "#3B82F6" },
              ].map((m) => (
                <div key={m.l} className="flex items-center gap-3 p-3 rounded-xl bg-[#11161D] border border-[#222A35]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${m.c}20`, color: m.c }}>
                    <m.i className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{m.l}</div>
                    <div className="text-[14px] text-white" style={{ fontWeight: 500 }}>{m.v}</div>
                  </div>
                  <Check className="w-4 h-4 text-[#22C55E]" />
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Route to</div>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#11161D] border border-[#222A35]">
                <div className="w-8 h-8 rounded-full bg-[#3B82F6] text-white text-[11px] flex items-center justify-center">TN</div>
                <div className="flex-1">
                  <div className="text-[12px] text-white">Tomás Nguyen</div>
                  <div className="text-[10px] text-[#5B6675]">Project Manager · responds in ~2h</div>
                </div>
              </div>
            </div>
          </div>
          <div className="px-5 pb-8 pt-3 border-t border-[#222A35]">
            <div className="grid grid-cols-2 gap-2">
              <button className="h-12 rounded-2xl border border-[#222A35] text-white text-[12px]">Save draft</button>
              <button className="h-12 rounded-2xl bg-[#FF6B1A] text-white text-[12px] shadow-[0_10px_30px_rgba(255,107,26,0.4)]">Submit for review</button>
            </div>
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}
