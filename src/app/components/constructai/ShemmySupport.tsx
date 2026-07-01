// ============================================================================
// ShemmySupport — a self-contained floating customer-support widget for
// Buildsasa. "Shemmy" is the friendly support assistant; she answers questions
// about using the software via the public /api/support/chat endpoint.
//
// Self-contained: holds its own message state (no persistence), renders a round
// launcher at bottom-right, and a dark-themed chat panel above it. Mounted once
// in the signed-in app shell (see App.tsx) — not on public/login screens.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X, Loader2 } from "lucide-react";
import api from "../../services/api";

type SupportMsg = { role: "user" | "assistant"; content: string };

const SHEMMY_AVATAR = "/Buildsasa.png";

const WELCOME: SupportMsg = {
  role: "assistant",
  content: "Hi, I'm Shemmy 👋 your Buildsasa support assistant. How can I help you today?",
};

const WHATSAPP_URL = "https://wa.me/254769041607";
const SUPPORT_EMAIL = "hello@buildsasa.com";

const ERROR_FALLBACK = "Sorry, I'm having trouble right now — message us on WhatsApp or email hello@buildsasa.com and a person will help.";

function Avatar({ size = 28 }: { size?: number }) {
  return (
    <img
      src={SHEMMY_AVATAR}
      alt="Shemmy"
      width={size}
      height={size}
      className="rounded-full object-cover bg-[#161C24] border border-[#222A35] shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

export function ShemmySupport() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<SupportMsg[]>([WELCOME]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the message list pinned to the latest message / typing indicator.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: SupportMsg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api.supportChat(next.map((m) => ({ role: m.role, content: m.content })));
      const reply = (res?.reply || "").trim() || ERROR_FALLBACK;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: ERROR_FALLBACK }]);
    }
    setBusy(false);
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-[56] w-[360px] max-w-[calc(100vw-2.5rem)] max-h-[70vh] flex flex-col rounded-xl border border-[#222A35] bg-[#11161D] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="shrink-0 px-4 py-3 border-b border-[#222A35] bg-[#0A0E14] flex items-center gap-2.5">
            <Avatar size={32} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-white font-display leading-tight">Shemmy</div>
              <div className="text-[10px] text-[#5B6675]">Buildsasa support</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close support chat"
              title="Close"
              className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Message list */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && <Avatar size={26} />}
                <div
                  className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap max-w-[80%] ${
                    m.role === "user"
                      ? "bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[#E6EAF0]"
                      : "bg-[#161C24] border border-[#222A35] text-[#C2CAD6]"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-end gap-2 justify-start">
                <Avatar size={26} />
                <div className="rounded-lg px-3 py-2 text-[12px] bg-[#161C24] border border-[#222A35] text-[#8A95A5] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Shemmy is typing…
                </div>
              </div>
            )}
          </div>

          {/* Human handoff */}
          <div className="px-3 py-2 border-t border-[#222A35] shrink-0 flex items-center gap-2 text-[11px] text-[#8A95A5]">
            <span>Talk to a human:</span>
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-[#22C55E] hover:underline">WhatsApp</a>
            <span className="text-[#3A4350]">·</span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#FF6B1A] hover:underline">Email</a>
          </div>

          {/* Input row */}
          <div className="p-3 border-t border-[#222A35] shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask Shemmy a question…"
                className="flex-1 resize-none max-h-28 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]"
              />
              <button
                onClick={send}
                disabled={!input.trim() || busy}
                aria-label="Send message"
                title="Send"
                className="h-9 w-9 shrink-0 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Shemmy support" : "Open Shemmy support"}
        title="Shemmy — Buildsasa support"
        className="fixed bottom-5 right-5 z-[55] h-14 w-14 rounded-full bg-[#11161D] border border-[#222A35] shadow-2xl flex items-center justify-center hover:border-[#FF6B1A]/50 transition-colors group"
      >
        {open ? (
          <X className="w-6 h-6 text-[#8A95A5] group-hover:text-white" />
        ) : (
          <>
            <img src={SHEMMY_AVATAR} alt="Shemmy" className="w-10 h-10 rounded-full object-cover" />
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-[#FF6B1A] border-2 border-[#0A0E14]" />
          </>
        )}
      </button>
    </>
  );
}

export default ShemmySupport;
