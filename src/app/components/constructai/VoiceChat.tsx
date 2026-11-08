// Hands-free voice chat with Buildsasa AI, for people on site who don't want
// to type: talk, the AI answers out loud, and it listens again. It notices when
// you stop talking (no button to press), and you can say "yes, do it" to confirm
// the actions it proposes. Spoken replies use the AI voice, falling back to the
// phone's own voice if that is unavailable.
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Volume2, VolumeX, X } from "lucide-react";
import api from "../../services/api";
import { MIC, recorderFor, transcribe } from "./MediaInputs";

/** Markdown → something worth saying out loud: no tables, links or symbols. */
export function speakable(md: string, max = 520): string {
  const hadTable = /^\s*\|.*\|\s*$/m.test(md);
  let s = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#>`~]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\bKES\s?([\d,]+)/g, "$1 shillings")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) { const cut = s.slice(0, max); s = cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), 200) + 1) + " The rest is on screen."; }
  if (hadTable) s += " I've put the details on screen.";
  return s;
}

let current: { stop: () => void } | null = null;
/** Say something: the AI voice first, the phone's voice if that fails. Resolves when finished. */
export function speakText(text: string, audioEl?: HTMLAudioElement | null): Promise<void> {
  current?.stop();
  const words = speakable(text);
  if (!words) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let stopped = false;
    const ac = new AbortController();
    const done = () => { if (current === handle) current = null; resolve(); };
    const browser = () => {
      if (stopped || !("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(words);
      u.lang = "en-GB"; u.rate = 1.03;
      u.onend = done; u.onerror = done;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    };
    const handle = { stop: () => { stopped = true; ac.abort(); try { audio.pause(); } catch { /* */ } try { window.speechSynthesis?.cancel(); } catch { /* */ } done(); } };
    const audio = audioEl || new Audio();
    current = handle;
    api.aiSpeak(words, ac.signal)
      .then((r) => {
        if (stopped) return;
        audio.src = r.audio;
        audio.onended = done;
        audio.onerror = browser;
        return audio.play().catch(browser);
      })
      .catch(() => { if (!stopped) browser(); });
  });
}
export const stopSpeaking = () => current?.stop();

type Phase = "idle" | "listening" | "thinking" | "speaking";

/** onTurn gets what the user said and returns what to say back. */
export function VoiceChat({ onTurn, onClose }: { onTurn: (text: string) => Promise<string>; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const turn = useRef(onTurn); turn.current = onTurn;
  const live = useRef(true);
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const stopRec = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => { live.current = false; stopRec.current?.(); stopSpeaking(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  /** Record until the speaker goes quiet; null if nothing was said. */
  const listen = async (): Promise<string | null> => {
    const stream = streamRef.current || (streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: MIC }));
    const rec = recorderFor(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx: AudioContext = new Ctx();
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    return new Promise((resolve) => {
      let spoke = false, quietSince = 0, raf = 0, finished = false, floor = 0.01, quietest = 0.01, loudFor = 0;
      const began = Date.now();
      const finish = (send: boolean) => {
        if (finished) return; finished = true;
        cancelAnimationFrame(raf); ctx.close().catch(() => {}); setLevel(0);
        rec.onstop = async () => {
          if (!send || !spoke) return resolve(null);
          try { resolve(await transcribe(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), rec.mimeType)); } catch { resolve(null); }
        };
        if (rec.state === "recording") rec.stop(); else resolve(null);
      };
      stopRec.current = () => finish(false);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 8));
        const now = Date.now();
        // Background noise (generator, mixer, wind), learned only from the
        // quietest moments (the gaps between words), so someone who starts
        // talking straight away isn't mistaken for noise. Capped so a loud site
        // still hears a raised voice.
        quietest = Math.min(quietest * 1.002 + 0.00002, rms);
        floor = Math.min(0.03, floor * 0.95 + quietest * 0.05);
        const talking = rms > Math.max(0.02, floor * 3);
        // A single click or knock isn't speech: it has to last about 50 ms.
        if (talking) { loudFor += 1; if (loudFor >= 3) spoke = true; quietSince = 0; } else { loudFor = 0; if (spoke) quietSince ||= now; }
        if (spoke && quietSince && now - quietSince > 1800) return finish(true);   // finished talking
        if (!spoke && now - began > 12000) return finish(false);                   // nobody spoke: pause
        if (now - began > 60000) return finish(true);                              // a minute at most
        raf = requestAnimationFrame(tick);
      };
      rec.start(250);
      raf = requestAnimationFrame(tick);
    });
  };

  const loop = async () => {
    while (live.current) {
      setPhase("listening");
      let text: string | null = null;
      try { text = await listen(); }
      catch (e: any) { setSaid(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it for this site, then try again." : "I couldn't use the microphone."); setPhase("idle"); return; }
      if (!live.current) return;
      if (!text) { setPhase("idle"); return; }   // silence: wait for a tap
      setHeard(text); setSaid(""); setPhase("thinking");
      let reply = "";
      try { reply = await turn.current(text); } catch { reply = "Sorry, that didn't work. Try again."; }
      if (!live.current) return;
      setSaid(reply);
      if (reply && !mutedRef.current) { setPhase("speaking"); await speakText(reply, audioEl.current); }
      if (/\b(bye|goodbye|that's all|thats all|stop listening|end (the )?(voice )?chat)\b/i.test(text)) { setPhase("idle"); return; }
    }
  };
  const begin = () => {
    // A tap unlocks audio playback on phones for the rest of the chat.
    if (!audioEl.current) { audioEl.current = new Audio(); audioEl.current.play().catch(() => {}); }
    if (phase === "speaking") { stopSpeaking(); return; }
    if (phase === "listening") { stopRec.current?.(); return; }
    if (phase === "idle") loop();
  };
  // Start listening as soon as the voice chat opens (opening it was the tap).
  useEffect(() => { begin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = { idle: "Tap to talk", listening: "Listening… speak clearly, I'll answer when you pause", thinking: "Working on it…", speaking: "Speaking. Tap to interrupt" }[phase];
  return (
    <div className="fixed inset-0 z-[80] bg-[#0A0E14]/95 backdrop-blur flex flex-col items-center justify-center px-6 text-center" role="dialog" aria-modal="true" aria-label="Voice chat with Buildsasa AI">
      <button onClick={onClose} className="absolute top-4 right-4 h-10 px-3 rounded-full border border-[#222A35] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 text-[13px]" aria-label="End voice chat"><X className="w-4 h-4" /> End</button>
      <div className="text-[12px] uppercase tracking-[0.18em] text-[#8A95A5] mb-6">Buildsasa AI · voice</div>
      <button onClick={begin} aria-label={label}
        className={`relative w-40 h-40 sm:w-48 sm:h-48 rounded-full flex items-center justify-center transition-transform ${phase === "speaking" ? "bg-[#FF6B1A]" : phase === "listening" ? "bg-[#FF6B1A]/20 border-2 border-[#FF6B1A]" : "bg-[#161C24] border border-[#2C3744]"}`}
        style={{ transform: `scale(${1 + (phase === "listening" ? level * 0.25 : 0)})` }}>
        {phase === "listening" && <span className="absolute inset-0 rounded-full border-2 border-[#FF6B1A]/40 animate-ping" />}
        {phase === "thinking" ? <Loader2 className="w-12 h-12 text-[#FF8A47] animate-spin" /> : phase === "speaking" ? <Volume2 className="w-12 h-12 text-[#ffffff]" /> : phase === "listening" ? <Mic className="w-12 h-12 text-[#FF8A47]" /> : <MicOff className="w-12 h-12 text-[#8A95A5]" />}
      </button>
      <div className="mt-6 text-[14px] text-white min-h-[22px]">{label}</div>
      {heard && <div className="mt-5 max-w-lg text-[13px] text-[#8A95A5]">You: <span className="text-[#C2CAD6]">{heard}</span></div>}
      {said && <div className="mt-2 max-w-lg text-[14px] text-white leading-relaxed line-clamp-6">{speakable(said, 400)}</div>}
      <div className="mt-8 flex items-center gap-2">
        <button onClick={() => { setMuted((m) => !m); if (!muted) stopSpeaking(); }} className="h-10 px-3.5 rounded-full border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5">
          {muted ? <><VolumeX className="w-4 h-4" /> Replies muted</> : <><Volume2 className="w-4 h-4" /> Replies out loud</>}
        </button>
      </div>
      <div className="mt-6 text-[11.5px] text-[#5B6675] max-w-sm">Try: "How far is Kitengela House?", "Log today: 12 workers, slab cast on block B", or "Create an invoice for Mr Otieno, deposit 500,000". Say "yes, do it" to confirm, or "goodbye" to stop.</div>
    </div>
  );
}
