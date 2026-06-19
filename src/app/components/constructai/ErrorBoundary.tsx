// ============================================================================
// ErrorBoundary — catches render-time crashes in a module so one broken screen
// never blanks the whole app. Shows a friendly recovery panel instead.
// ============================================================================

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { children: ReactNode; onReset?: () => void; resetKey?: string | number };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surfaces in the browser console for debugging.
    console.error("[ErrorBoundary] A screen crashed:", error, info);
  }

  componentDidUpdate(prev: Props) {
    // Auto-clear the error when the user navigates to a different screen.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-20 px-6">
          <div className="w-14 h-14 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-[#EF4444]" />
          </div>
          <div className="text-[15px] text-white font-display">This screen ran into a problem</div>
          <p className="mt-2 text-[12.5px] text-[#8A95A5] max-w-sm leading-relaxed">
            Something on this page failed to load. The rest of the app is fine — you can retry or switch to another section.
          </p>
          <pre className="mt-3 max-w-md overflow-x-auto text-[10.5px] text-[#5B6675] bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-left">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
            className="mt-5 h-10 px-5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12.5px] flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
