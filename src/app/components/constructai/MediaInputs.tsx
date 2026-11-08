// Camera and voice for Buildsasa AI. On phones the camera button opens the
// native camera; on laptops it shows the webcam in a dialog. Voice records a
// short clip and the server turns it into text (works in every modern browser,
// including Safari on iPhone).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { NEED_CREDITS_EVENT } from "../../services/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
export const isTouch = () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

/** Webcam dialog: take a photo and hand it back as a File. */
export function CameraModal({ onCapture, onClose }: { onCapture: (f: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        stream.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setError("");
      } catch (e: any) { setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in your browser settings." : "No camera was found on this device."); }
    })();
    return () => { cancelled = true; };
  }, [facing]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => { if (b) { onCapture(new File([b], `camera-${Date.now()}.jpg`, { type: "image/jpeg" })); onClose(); } }, "image/jpeg", 0.9);
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-3" role="dialog" aria-label="Take a photo">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0F141B] border border-[#222A35] overflow-hidden">
        <div className="h-11 flex items-center px-4 text-[13px] text-white border-b border-[#222A35]"><Camera className="w-4 h-4 text-[#FF6B1A] mr-2" /> Take a photo
          <button onClick={onClose} className="ml-auto text-[#8A95A5] hover:text-white" aria-label="Close camera"><X className="w-4 h-4" /></button></div>
        <div className="bg-black aspect-video flex items-center justify-center">
          {error ? <p className="text-[13px] text-[#C2CAD6] px-6 text-center">{error}</p> : <video ref={video} playsInline muted className="w-full h-full object-contain" />}
        </div>
        <div className="p-3 flex items-center justify-center gap-3">
          <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="h-10 w-10 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white flex items-center justify-center" aria-label="Switch camera"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={snap} disabled={!!error} className="h-14 w-14 rounded-full bg-[#ffffff] border-4 border-[#FF6B1A] disabled:opacity-40" aria-label="Capture photo" />
          <span className="w-10" />
        </div>
      </div>
    </div>
  );
}

/** Record a voice note and get it back as text. */
/** Speech to text on the server. Past the daily voice allowance the app offers credits. */
export async function transcribe(blob: Blob, mime?: string): Promise<string> {
  const fd = new FormData();
  const m = mime || blob.type || "audio/webm";
  fd.append("file", blob, `voice.${m.includes("mp4") ? "m4a" : m.includes("ogg") ? "ogg" : "webm"}`);
  const res = await fetch(`${API_URL}/api/ai/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("constructai-token") || ""}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (res.status === 402 && j?.code) { try { window.dispatchEvent(new CustomEvent(NEED_CREDITS_EVENT, { detail: j })); } catch { /* */ } }
  if (!res.ok) throw new Error(j.error || "Couldn't understand the recording.");
  return String(j.text || "").trim();
}

export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const cb = useRef(onText); cb.current = onText;

  const stopTracks = () => rec.current?.stream.getTracks().forEach((t) => t.stop());
  useEffect(() => () => { cancelled.current = true; if (timer.current) clearInterval(timer.current); stopTracks(); }, []);

  const start = async () => {
    if (state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast.error("Voice isn't supported in this browser. Type instead.");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      chunks.current = []; cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stopTracks();
        if (timer.current) clearInterval(timer.current);
        if (cancelled.current) { setState("idle"); return; }
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 1200) { setState("idle"); return toast.error("That was too short. Hold on and speak, then tap stop."); }
        setState("transcribing");
        try {
          const text = await transcribe(blob, r.mimeType);
          if (text) cb.current(text); else toast.error("I didn't catch anything. Try again a little closer to the mic.");
        } catch (e: any) { toast.error(e?.message || "Couldn't understand the recording."); }
        setState("idle");
      };
      rec.current = r;
      r.start();
      setSeconds(0); setState("recording");
      timer.current = setInterval(() => setSeconds((x) => { if (x >= 179) r.stop(); return x + 1; }), 1000);
    } catch (e: any) { toast.error(e?.name === "NotAllowedError" ? "Microphone access was blocked. Allow it for this site in your browser settings." : "No microphone was found."); }
  };
  const stop = () => { if (rec.current?.state === "recording") rec.current.stop(); };
  const cancel = () => { cancelled.current = true; stop(); };
  return { state, seconds, start, stop, cancel };
}

export const VoiceSpinner = () => <Loader2 className="w-4 h-4 animate-spin" />;
