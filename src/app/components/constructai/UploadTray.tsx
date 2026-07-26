// Visible feedback for in-flight uploads.
//
// The gap this fills: picking a file used to change nothing on screen until the
// upload finished. On a site connection that is several seconds of silence, and
// if the upload then failed there was nothing to show at all — so a working
// picker was indistinguishable from a broken one. Here the thumbnail appears the
// moment you pick, with a progress bar, and a failure stays on screen with the
// real reason and a Retry.
import { AlertCircle, CheckCircle2, FileText, RefreshCw, X } from "lucide-react";
import type { useFileUpload } from "./useFileUpload";

export function UploadTray({ state, className }: { state: ReturnType<typeof useFileUpload>; className?: string }) {
  const { pending, remove, retryFailed } = state;
  if (!pending.length) return null;
  const failed = pending.filter((p) => p.status === "error").length;

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      {pending.map((p) => (
        <div
          key={p.id}
          className={`flex items-center gap-2 p-2 rounded-md border ${p.status === "error" ? "border-[#EF4444]/40 bg-[#EF4444]/5" : "border-[#222A35] bg-[#0A0E14]"}`}
        >
          {p.previewUrl
            ? <img src={p.previewUrl} alt="" className="w-9 h-9 rounded object-cover border border-[#222A35] shrink-0" />
            : <div className="w-9 h-9 rounded bg-[#161C24] border border-[#222A35] flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-[#8A95A5]" /></div>}
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-white truncate">{p.file.name}</div>
            {p.status === "uploading" && (
              <div className="mt-1 h-1 rounded-full bg-[#222A35] overflow-hidden">
                <div className="h-full bg-[#FF6B1A] transition-all" style={{ width: `${p.progress}%` }} />
              </div>
            )}
            {p.status === "error" && <div className="text-[10px] text-[#EF4444] leading-tight mt-0.5">{p.error}</div>}
            {p.status === "done" && <div className="text-[10px] text-[#22C55E] mt-0.5">Uploaded</div>}
          </div>
          {p.status === "done" && <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />}
          {p.status === "error" && <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />}
          <button type="button" onClick={() => remove(p.id)} title="Dismiss" className="text-[#5B6675] hover:text-white shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {failed > 0 && (
        <button
          type="button"
          onClick={() => retryFailed()}
          className="h-8 px-3 rounded-md border border-[#222A35] text-[11px] text-[#FF6B1A] hover:bg-[#161C24] flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" /> Retry {failed} failed {failed === 1 ? "upload" : "uploads"}
        </button>
      )}
    </div>
  );
}

export default UploadTray;
