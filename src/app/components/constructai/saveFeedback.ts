// Report a background save that failed.
//
// Modules across this app follow an optimistic-update pattern: change local
// state, show a success toast, then fire the API call and `.catch(() => {})`.
// The swallow is the problem — when the write fails the screen still shows the
// change and still claims success, so the user only discovers the truth on the
// next reload, when their edit is gone. That single pattern is behind most
// "I saved it and it disappeared" reports.
//
// This does not attempt to roll back (the previous value usually isn't
// available at the call site). It makes the failure visible and names what was
// lost, so the user can retry deliberately instead of trusting a lie.
import { toast } from "sonner";

/**
 * A `.catch()` handler for a background write.
 *
 *   api.updateCrew(id, patch).catch(warnSaveFailed("crew update"));
 *
 * @param what Human description of the change, e.g. "crew update".
 */
export function warnSaveFailed(what: string) {
  return (e: any) => {
    const reason = e?.message || "the server did not respond";
    toast.error(`Your ${what} was not saved — ${reason}. Reload to see the stored version.`, {
      duration: 10000,
    });
    // Also log it: the toast is transient, and a support conversation benefits
    // from the original error being recoverable from the console.
    console.error(`[save failed] ${what}:`, e);
  };
}

export default warnSaveFailed;
