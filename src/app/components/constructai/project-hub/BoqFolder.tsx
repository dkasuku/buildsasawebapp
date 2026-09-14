// ============================================================================
// Bills of Quantities & Quotations.
//
//   * The working bill, edited in place (BoqEditor).
//   * Import from a spreadsheet — the current bill is frozen as a revision first
//     so a revised BOQ never overwrites the one that was tendered on.
//   * Revisions: V1, V2… each viewable and restorable.
//   * Rate library: fair rates to check quotes against, pickable into the editor.
//   * A folder for the priced documents received from others (tender BOQ,
//     supplier and subcontractor quotations).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Download, History, Loader2, RotateCcw, Save, Upload, Eye, AlertTriangle, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import api, { type BoqRevisionDto, type DocumentDto } from "../../../services/api";
import { BoqEditor, type RatePick } from "../BoqEditor";
import { pickFiles } from "../useFileUpload";
import { DocumentFolder } from "./DocumentFolder";
import { RateLibraryDrawer } from "./RateLibrary";
import { parseBoqFile, type ImportResult } from "./boqImport";
import { Empty, Field, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, useMoney } from "./shared";

export function BoqFolder({
  projectId, summary, docs, canEdit, onChanged,
}: {
  projectId: string;
  summary: { total: number; itemCount: number; sections: number; revisions: BoqRevisionDto[] };
  docs: DocumentDto[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { fmt } = useMoney();
  const [refreshKey, setRefreshKey] = useState(0);
  const [importing, setImporting] = useState<{ file: File; result: ImportResult } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [viewing, setViewing] = useState<BoqRevisionDto | null>(null);
  const [saveRev, setSaveRev] = useState(false);
  const [library, setLibrary] = useState<{ apply?: (r: RatePick) => void } | null>(null);
  // The picker callback comes from inside BoqEditor; kept in a ref so the drawer
  // does not re-render the editor when it opens.
  const applyRef = useRef<((r: RatePick) => void) | null>(null);

  const bump = useCallback(async () => { setRefreshKey((k) => k + 1); await onChanged(); }, [onChanged]);

  const startImport = async () => {
    const [file] = await pickFiles({ accept: ".xlsx,.xls,.csv" });
    if (!file) return;
    setParsing(true);
    try { setImporting({ file, result: await parseBoqFile(file) }); }
    catch (e: any) { toast.error(`Could not read ${file.name} — ${e?.message || "is it a spreadsheet?"}`); }
    finally { setParsing(false); }
  };

  const exportXlsx = async () => {
    try {
      const boq = await api.getBoq(projectId);
      const rows: (string | number)[][] = [["Ref", "Description", "Unit", "Qty", "Rate", "Amount"]];
      for (const s of boq.sections) {
        rows.push([s.code || "", s.title, "", "", "", ""]);
        for (const i of s.items) rows.push([i.code || "", i.description, i.unit, i.quantity, i.rate, i.amount]);
        rows.push(["", `Total — ${s.title}`, "", "", "", s.total]);
      }
      rows.push(["", "BILL TOTAL", "", "", "", boq.total]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 8 }, { wch: 60 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "BOQ");
      XLSX.writeFile(wb, `BOQ-${projectId.slice(0, 6)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) { toast.error(e?.message || "Could not export"); }
  };

  const openLibraryFor = useCallback((apply: (r: RatePick) => void) => { applyRef.current = apply; setLibrary({ apply }); }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[#8A95A5]">Working bill</div>
          <div className="text-[22px] text-white font-display">{summary.itemCount ? fmt(summary.total) : "—"}</div>
          <div className="text-[11px] text-[#5B6675]">{summary.sections} section{summary.sections === 1 ? "" : "s"} · {summary.itemCount} item{summary.itemCount === 1 ? "" : "s"} · {summary.revisions.length} saved revision{summary.revisions.length === 1 ? "" : "s"}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setLibrary({})} className={btnGhost}><BookOpen className="w-3.5 h-3.5" /> Rate library</button>
          {summary.itemCount > 0 && <button onClick={exportXlsx} className={btnGhost}><Download className="w-3.5 h-3.5" /> Export</button>}
          {canEdit && summary.itemCount > 0 && <button onClick={() => setSaveRev(true)} className={btnGhost}><Save className="w-3.5 h-3.5" /> Save revision</button>}
          {canEdit && <button onClick={startImport} disabled={parsing} className={btnPrimary}>{parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import BOQ</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="min-w-0">
          <BoqEditor projectId={projectId} canEdit={canEdit} refreshKey={refreshKey} onPickRate={canEdit ? openLibraryFor : undefined} onChanged={onChanged} />
        </div>
        <div className="space-y-4">
          <Panel title="Revisions" subtitle="Frozen copies of the bill. Nothing here is ever overwritten.">
            {summary.revisions.length === 0 ? (
              <Empty icon={History} title="No revisions yet" hint="Save one before you change a priced bill — or import a file, which saves one for you." />
            ) : (
              <div className="divide-y divide-[#222A35]">
                {summary.revisions.map((r) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                    <Pill tone="brand">V{r.version}</Pill>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-white truncate">{r.label || "Revision"}</div>
                      <div className="text-[10.5px] text-[#5B6675] truncate">{fmt(r.total)} · {r.itemCount} items · {fmtDate(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ""}</div>
                    </div>
                    <button onClick={() => setViewing(r)} title="View" className="w-7 h-7 rounded flex items-center justify-center text-[#8A95A5] hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <DocumentFolder projectId={projectId} category="boq" docs={docs} onChanged={onChanged} canEdit={canEdit} title="Quotations & priced documents" blurb="Tender BOQ, supplier and subcontractor quotes." />
        </div>
      </div>

      {importing && (
        <ImportPreview
          projectId={projectId} file={importing.file} result={importing.result} hasExisting={summary.itemCount > 0}
          onClose={() => setImporting(null)}
          onDone={async () => { setImporting(null); await bump(); }}
        />
      )}
      {viewing && (
        <RevisionViewer revision={viewing} canEdit={canEdit} onClose={() => setViewing(null)} onRestored={async () => { setViewing(null); await bump(); }} />
      )}
      {saveRev && (
        <SaveRevisionModal projectId={projectId} onClose={() => setSaveRev(false)} onDone={async () => { setSaveRev(false); await onChanged(); }} />
      )}
      {library && (
        <RateLibraryDrawer canEdit={canEdit} onClose={() => { setLibrary(null); applyRef.current = null; }} onPick={library.apply ? (r) => applyRef.current?.(r) : undefined} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function ImportPreview({ projectId, file, result, hasExisting, onClose, onDone }: { projectId: string; file: File; result: ImportResult; hasExisting: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { fmt } = useMoney();
  const [mode, setMode] = useState<"replace" | "append">(hasExisting ? "replace" : "replace");
  const [label, setLabel] = useState(hasExisting ? "Before import" : "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });

  const run = async () => {
    if (!result.itemCount) return;
    setBusy(true);
    try {
      const r = await api.importBoq(projectId, { sections: result.sections, mode, label: label || undefined });
      toast.success(`${r.items} items imported into ${r.sections} section${r.sections === 1 ? "" : "s"}${r.snapshotVersion ? ` · previous bill saved as V${r.snapshotVersion}` : ""}`);
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Import ${file.name}`} subtitle={`Read from sheet “${result.sheetName}” — ${result.itemCount} items in ${result.sections.length} sections, ${fmt(result.total)}`} onClose={onClose} wide>
      <div className="space-y-4">
        {result.warnings.map((w, i) => (
          <div key={i} className="rounded-lg border border-[#F5A623]/40 bg-[#F5A623]/10 px-3 py-2 text-[12px] text-[#E6EAF0] flex gap-2"><AlertTriangle className="w-4 h-4 text-[#F5A623] shrink-0 mt-0.5" />{w}</div>
        ))}
        {result.itemCount > 0 && (
          <div className="rounded-lg border border-[#222A35] max-h-[40vh] overflow-y-auto">
            {result.sections.map((s, si) => (
              <div key={si} className="border-b border-[#222A35] last:border-0">
                <button onClick={() => setOpen((o) => ({ ...o, [si]: !o[si] }))} className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[#161C24]/60">
                  {s.code && <span className="font-mono text-[11px] text-[#5B6675]">{s.code}</span>}
                  <span className="text-[12.5px] text-white flex-1 truncate">{s.title}</span>
                  <span className="text-[11px] text-[#8A95A5]">{s.items.length} items · {fmt(s.items.reduce((a, i) => a + (i.quantity || 0) * (i.rate || 0), 0))}</span>
                </button>
                {open[si] && (
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {s.items.slice(0, 200).map((i, ii) => (
                        <tr key={ii} className="border-t border-[#222A35]/60">
                          <td className="px-3 py-1.5 font-mono text-[#5B6675] w-16">{i.code || ""}</td>
                          <td className="px-2 py-1.5 text-[#C2CAD6]">{i.description}</td>
                          <td className="px-2 py-1.5 text-[#8A95A5] w-12">{i.unit || "—"}</td>
                          <td className="px-2 py-1.5 text-right text-[#C2CAD6] w-16 tabular-nums">{i.quantity}</td>
                          <td className={`px-2 py-1.5 text-right w-24 tabular-nums ${i.rate ? "text-[#C2CAD6]" : "text-[#F5A623]"}`}>{i.rate ? fmt(i.rate) : "unpriced"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
        {result.itemCount > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="How to import">
              <select value={mode} onChange={(e) => setMode(e.target.value as any)} className={input}>
                <option value="replace">{hasExisting ? "Replace the working bill (current one is saved as a revision)" : "Create the working bill"}</option>
                {hasExisting && <option value="append">Add these sections to the existing bill</option>}
              </select>
            </Field>
            {hasExisting && mode === "replace" && (
              <Field label="Label for the saved revision"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tender BOQ" className={input} /></Field>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={run} disabled={busy || !result.itemCount} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />} Import {result.itemCount} items</button>
        </div>
      </div>
    </Modal>
  );
}

function RevisionViewer({ revision, canEdit, onClose, onRestored }: { revision: BoqRevisionDto; canEdit: boolean; onClose: () => void; onRestored: () => Promise<void> }) {
  const { fmt } = useMoney();
  const [full, setFull] = useState<Awaited<ReturnType<typeof api.getBoqRevision>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getBoqRevision(revision.id).then(setFull).catch((e) => toast.error(e?.message || "Could not load the revision")); }, [revision.id]);

  const restore = async () => {
    if (!confirm(`Restore V${revision.version} as the working bill? The current bill is saved as a new revision first.`)) return;
    setBusy(true);
    try { await api.restoreBoqRevision(revision.id); toast.success(`V${revision.version} is now the working bill`); await onRestored(); }
    catch (e: any) { toast.error(e?.message || "Could not restore"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`V${revision.version}${revision.label ? ` — ${revision.label}` : ""}`} subtitle={`${fmt(revision.total)} · ${revision.itemCount} items · saved ${fmtDate(revision.createdAt)}${revision.createdBy ? ` by ${revision.createdBy}` : ""}`} onClose={onClose} wide>
      {!full ? <div className="py-10 flex justify-center text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
        <div className="space-y-3">
          <div className="rounded-lg border border-[#222A35] max-h-[55vh] overflow-y-auto">
            {full.snapshot.map((s, si) => (
              <div key={si} className="border-b border-[#222A35] last:border-0">
                <div className="px-3 py-2 flex items-center gap-2 bg-[#0A0E14]/60">
                  {s.code && <span className="font-mono text-[11px] text-[#5B6675]">{s.code}</span>}
                  <span className="text-[12.5px] text-white flex-1">{s.title}</span>
                  <span className="text-[11px] text-[#8A95A5]">{fmt(s.items.reduce((a, i) => a + (i.amount || 0), 0))}</span>
                </div>
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {s.items.map((i, ii) => (
                      <tr key={ii} className="border-t border-[#222A35]/60">
                        <td className="px-3 py-1.5 font-mono text-[#5B6675] w-16">{i.code || ""}</td>
                        <td className="px-2 py-1.5 text-[#C2CAD6]">{i.description}</td>
                        <td className="px-2 py-1.5 text-[#8A95A5] w-12">{i.unit}</td>
                        <td className="px-2 py-1.5 text-right text-[#C2CAD6] w-16 tabular-nums">{i.quantity}</td>
                        <td className="px-2 py-1.5 text-right text-[#C2CAD6] w-24 tabular-nums">{fmt(i.rate)}</td>
                        <td className="px-2 py-1.5 text-right text-white w-28 tabular-nums">{fmt(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={btnGhost}>Close</button>
            {canEdit && <button onClick={restore} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Restore as working bill</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SaveRevisionModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.saveBoqRevision(projectId, { label: label || undefined, note: note || undefined }); toast.success(`Saved as V${r.version}`); await onDone(); }
    catch (e: any) { toast.error(e?.message || "Could not save the revision"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Save a revision" subtitle="Freezes the bill exactly as it is now. Keep editing afterwards — this copy will not change." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Label"><input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tender BOQ, Post-VE, Agreed with client" className={input} /></Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed, and why" className={input} /></Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save revision</button>
        </div>
      </div>
    </Modal>
  );
}
