// ============================================================================
// PDF setup — import jsPDF from here, never from "jspdf" directly.
//
// jspdf-autotable v5 stopped patching jsPDF.prototype on a bare
// `import "jspdf-autotable"`, so every `doc.autoTable(...)` in the app threw
// "doc.autoTable is not a function" and the export button only produced a toast
// with that message. Reports, Financials and the per-project report were all
// affected. applyPlugin() restores the prototype method, so the existing call
// style keeps working — it just has to run once, before any document is built.
// ============================================================================

import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";

applyPlugin(jsPDF);

export { jsPDF };

/** Where the table just drawn ended, for stacking the next one under it. */
export function lastTableEnd(doc: jsPDF, fallback: number): number {
  const y = (doc as any).lastAutoTable?.finalY;
  return typeof y === "number" ? y : fallback;
}
