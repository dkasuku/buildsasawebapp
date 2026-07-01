// ============================================================================
// Reset password screen — reached via the emailed link /?reset=TOKEN
// Verifies the token server-side and sets a new password, then returns to login.
// ============================================================================

import { useState } from "react";
import { ArrowRight, Sun, Moon, Check, ShieldCheck } from "lucide-react";
import api from "../../services/api";

export function ResetPassword({ token, theme, setTheme }: { token: string; theme?: "dark" | "light"; setTheme?: (t: "dark" | "light") => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const backToLogin = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState({}, "", url.toString());
    } catch { /* noop */ }
    window.location.reload();
  };

  const submit = async () => {
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true); setError("");
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "This reset link is invalid or has expired");
    } finally { setLoading(false); }
  };

  return (
    <div className="h-screen w-full bg-[#0A0E14] flex flex-col px-6 lg:px-16 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center">
            <img src="/Buildsasa.png" alt="Buildsasa" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="text-[14px] text-white tracking-tight">Buildsasa</div>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Account recovery</div>
          </div>
        </div>
        {setTheme && (
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="h-9 w-9 rounded-md bg-[#11161D] border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-[400px]">
          {done ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-[#22C55E]" />
              </div>
              <h1 className="text-[24px] text-white tracking-tight mt-4" style={{ fontWeight: 500 }}>Password updated</h1>
              <p className="text-[13px] text-[#8A95A5] mt-2">You can now sign in with your new password.</p>
              <button onClick={backToLogin} className="w-full h-11 mt-6 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2">
                Go to sign in <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#222A35] bg-[#11161D] text-[10px] text-[#8A95A5] uppercase tracking-wider mb-5">
                <ShieldCheck className="w-3 h-3 text-[#22C55E]" /> Secure reset
              </div>
              <h1 className="text-[28px] text-white tracking-tight leading-[1.1]" style={{ fontWeight: 500 }}>Set a new password</h1>
              <p className="text-[13px] text-[#8A95A5] mt-3">Choose a strong password you don't use anywhere else.</p>

              <div className="mt-7 space-y-3">
                <div>
                  <label className="text-[11px] text-[#8A95A5] uppercase tracking-wider">New password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full h-11 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" placeholder="At least 6 characters" />
                </div>
                <div>
                  <label className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Confirm password</label>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="mt-1.5 w-full h-11 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" placeholder="Re-enter password" />
                </div>
                {error && <div className="text-[12px] text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md px-3 py-2">{error}</div>}
                <button onClick={submit} disabled={loading} className="w-full h-11 mt-2 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
                  {loading ? "Updating…" : "Update password"} <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={backToLogin} className="w-full h-10 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Back to sign in</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="text-[10px] text-[#5B6675]">© 2026 Buildsasa</div>
    </div>
  );
}

export default ResetPassword;
