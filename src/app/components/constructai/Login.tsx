import { HardHat, ArrowRight, Github, ShieldCheck, Zap, Mic, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";
import api from "../../services/api";
import { ImageWithFallback } from "../figma/ImageWithFallback";

// Demo bypass is hidden in production. Enable locally with localStorage bf-allow-demo=1.
const ALLOW_DEMO = (() => { try { return localStorage.getItem("bf-allow-demo") === "1"; } catch { return false; } })();

export function Login({ onContinue, theme, setTheme }: { onContinue: (user?: { role?: string; name?: string; email?: string }) => void; theme?: "dark" | "light"; setTheme?: (t: "dark" | "light") => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("manager@example.com");
  const [password, setPassword] = useState("password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [devLink, setDevLink] = useState("");
  // Show a message when the backend bounced us back (e.g. Google sign-in blocked
  // because access is invite-only).
  useEffect(() => {
    try {
      const err = new URLSearchParams(window.location.search).get("auth_error");
      if (err) {
        setError(err === "invite_only"
          ? "That Google account isn't invited yet — access is invite-only. Ask your workspace admin to add you."
          : "Sign-in failed. Please try again.");
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch { /* noop */ }
  }, []);
  const sendReset = async () => {
    if (!email.trim()) return setError("Enter your email first");
    setLoading(true); setError(""); setInfo(""); setDevLink("");
    try {
      const res = await api.forgotPassword(email.trim());
      setInfo("If an account exists for that email, a reset link is on its way. Check your inbox.");
      if (res?.devLink) setDevLink(res.devLink);
    } catch (e: any) {
      setError(e?.message || "Could not send reset link");
    } finally { setLoading(false); }
  };
  const submit = async () => {
    setLoading(true); setError("");
    try {
      const res = mode === "signup"
        ? await api.signup(name.trim(), email.trim(), password)
        : await api.login(email.trim(), password);
      localStorage.setItem("constructai-token", res.token);
      try { localStorage.setItem("constructai-user", JSON.stringify(res.user)); } catch { /* noop */ }
      // Queue the guided tour on entering the app (a signup, or a sign-in by
      // someone who hasn't taken it yet). It won't re-appear on plain reloads.
      try { if (mode === "signup" || localStorage.getItem("constructai-tour-done") !== "1") localStorage.setItem("constructai-show-tour", "1"); } catch { /* noop */ }
      onContinue(res.user);
    } catch (e: any) {
      setError(e?.message || (mode === "signup" ? "Sign up failed" : "Login failed"));
    } finally { setLoading(false); }
  };
  return (
    <div className="h-screen w-full bg-[#0A0E14] grid grid-cols-1 lg:grid-cols-2">
      {/* Left — Form */}
      <div className="flex flex-col px-8 lg:px-16 py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#FF6B1A] to-[#FF8A4A] flex items-center justify-center">
              <HardHat className="w-5 h-5 text-white" strokeWidth={2.4} />
            </div>
            <div>
              <div className="text-[14px] text-white tracking-tight">ConstructAI</div>
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Change Order OS</div>
            </div>
          </div>
          {setTheme && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="h-9 w-9 rounded-md bg-[#11161D] border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
        </div>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-[400px]">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#222A35] bg-[#11161D] text-[10px] text-[#8A95A5] uppercase tracking-wider mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> All systems operational
            </div>
            <h1 className="text-[32px] text-white tracking-tight leading-[1.1]" style={{ fontWeight: 500 }}>
              {mode === "signup" ? <>Create your<br /> construction OS.</> : mode === "forgot" ? <>Reset your<br /> password.</> : <>Sign in to your<br /> construction OS.</>}
            </h1>
            <p className="text-[13px] text-[#8A95A5] mt-3">
              {mode === "forgot"
                ? "Enter your work email and we'll send you a link to set a new password."
                : "Manage change orders, field reports, and approvals across every jobsite — from foundation to ribbon-cutting."}
            </p>

            <div className="mt-7 space-y-3">
              {mode === "signup" && (
                <div>
                  <label className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Full Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Jane Mwangi"
                    className="mt-1.5 w-full h-11 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
              )}
              <div>
                <label className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Work Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full h-11 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                />
              </div>
              {mode !== "forgot" && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Password</label>
                    {mode === "login" && <button onClick={() => { setMode("forgot"); setError(""); setInfo(""); setDevLink(""); }} className="text-[11px] text-[#FF6B1A] hover:underline">Forgot?</button>}
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1.5 w-full h-11 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
              )}
              {error && <div className="text-[12px] text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md px-3 py-2">{error}</div>}
              {info && <div className="text-[12px] text-[#22C55E] bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-md px-3 py-2">{info}</div>}
              {devLink && (
                <div className="text-[11px] text-[#8A95A5] bg-[#11161D] border border-[#222A35] rounded-md px-3 py-2 break-all">
                  Dev (no email key set): <a href={devLink} className="text-[#FF6B1A] hover:underline">open reset link</a>
                </div>
              )}
              <button
                onClick={mode === "forgot" ? sendReset : submit}
                disabled={loading}
                className="w-full h-11 mt-2 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(255,107,26,0.35)] disabled:opacity-60"
              >
                {loading
                  ? (mode === "signup" ? "Creating account..." : mode === "forgot" ? "Sending..." : "Signing in...")
                  : (mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Enter Workspace")} <ArrowRight className="w-4 h-4" />
              </button>
              {mode === "forgot" && (
                <button onClick={() => { setMode("login"); setError(""); setInfo(""); setDevLink(""); }} className="w-full h-10 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Back to sign in</button>
              )}
              {ALLOW_DEMO && mode !== "forgot" && (
                <button
                  onClick={() => onContinue()}
                  className="w-full h-10 rounded-md border border-[#222A35] text-white text-[12px]"
                >
                  Continue without login (demo)
                </button>
              )}

              {mode !== "forgot" && (
                <>
                  <div className="flex items-center gap-3 my-3">
                    <div className="flex-1 h-px bg-[#222A35]" />
                    <span className="text-[10px] text-[#5B6675] uppercase tracking-wider">or continue with</span>
                    <div className="flex-1 h-px bg-[#222A35]" />
                  </div>
                  <button
                    type="button"
                    onClick={() => { window.location.href = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/auth/google`; }}
                    className="w-full h-10 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white flex items-center justify-center gap-2 hover:border-[#2C3744]"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#FFC107" d="M21.35 11.1H12v2.96h5.35c-.23 1.46-1.6 4.28-5.35 4.28a5.96 5.96 0 0 1 0-11.92c1.7 0 2.84.72 3.5 1.34l2.38-2.3A9.32 9.32 0 0 0 12 2.46a9.54 9.54 0 1 0 0 19.08c5.5 0 9.14-3.87 9.14-9.32 0-.63-.07-1.1-.16-1.58z"/>
                      <path fill="#FF3D00" d="m3.15 7.34 2.43 1.78A5.96 5.96 0 0 1 12 5.42c1.7 0 2.84.72 3.5 1.34l2.38-2.3A9.32 9.32 0 0 0 12 2.46a9.52 9.52 0 0 0-8.85 4.88z"/>
                      <path fill="#4CAF50" d="M12 21.54c2.54 0 4.85-.97 6.5-2.62l-2.3-1.95c-.86.6-2.02 1.02-3.55 1.02-3.74 0-5.11-2.82-5.34-4.28l-2.4 1.85A9.52 9.52 0 0 0 12 21.54z"/>
                      <path fill="#1976D2" d="M21.35 11.1H12v2.96h5.35a4.6 4.6 0 0 1-1.15 2.91l2.3 1.95c.74-.7 2.64-2.71 2.64-6.24 0-.63-.07-1.1-.16-1.58z"/>
                    </svg>
                    Continue with Google
                  </button>
                </>
              )}
            </div>

            {mode === "login" && (
              <p className="mt-6 text-[11px] text-[#5B6675]">Access is invite‑only — ask your workspace admin to invite you.</p>
            )}
            {mode === "signup" && (
              <p className="mt-6 text-[11px] text-[#5B6675]">Already have an account? <span onClick={() => { setMode("login"); setError(""); }} className="text-[#FF6B1A] cursor-pointer hover:underline">Sign in</span></p>
            )}
            {ALLOW_DEMO && <p className="text-[11px] text-[#8A95A5] mt-2">Demo: manager@example.com / password</p>}
          </div>
        </div>

        <div className="text-[10px] text-[#5B6675]">© 2026 ConstructAI · SOC 2 Type II · ISO 27001</div>
      </div>

      {/* Right — Visual */}
      <div className="relative hidden lg:block bg-[#11161D] overflow-hidden border-l border-[#222A35]">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1400&q=80"
          alt="Construction site"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0A0E14] via-[#0A0E14]/40 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,107,26,0.18),_transparent_50%)]" />

        <div className="absolute top-10 right-10 px-3 py-1.5 rounded-full bg-[#0A0E14]/80 backdrop-blur border border-[#222A35] text-[11px] text-white flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B1A] animate-pulse" /> Live: 1,284 active jobsites
        </div>

        <div className="absolute bottom-10 left-10 right-10 space-y-3">
          <div className="text-white text-[26px] tracking-tight leading-[1.15]" style={{ fontWeight: 500 }}>
            Built for the field.<br /> Trusted in the boardroom.
          </div>
          <p className="text-[13px] text-[#8A95A5] max-w-[420px]">
            From a supervisor's pocket to the CFO's quarterly review — every change order, photo, and signature in one source of truth.
          </p>
          <div className="flex gap-2 pt-3">
            <div className="flex-1 p-3 rounded-lg bg-[#0A0E14]/80 backdrop-blur border border-[#222A35]">
              <Zap className="w-4 h-4 text-[#FF6B1A]" />
              <div className="text-[11px] text-white mt-2">AI Drafts</div>
              <div className="text-[10px] text-[#5B6675]">In under 45s</div>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-[#0A0E14]/80 backdrop-blur border border-[#222A35]">
              <Mic className="w-4 h-4 text-[#FF6B1A]" />
              <div className="text-[11px] text-white mt-2">Voice Capture</div>
              <div className="text-[10px] text-[#5B6675]">Hands-free</div>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-[#0A0E14]/80 backdrop-blur border border-[#222A35]">
              <ShieldCheck className="w-4 h-4 text-[#FF6B1A]" />
              <div className="text-[11px] text-white mt-2">Audit Ready</div>
              <div className="text-[10px] text-[#5B6675]">Full trail</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
