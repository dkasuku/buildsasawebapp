// ============================================================================
// Project report — the whole project on one page, and out the door as a PDF or
// spreadsheet.
//
// A shortcut, not a second reporting engine: the workspace-wide Reports module
// still owns cross-project analysis (by region, leaderboards, scheduled sends).
// This answers the narrower question people actually ask on site — "how is THIS
// job doing, and can I send that to the client?" — and it needs no request of
// its own, because every figure already arrived with the hub payload.
//
// Every number here is derived from the same rows the other folders show, so a
// report can never disagree with the page it was generated from.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { jsPDF, lastTableEnd } from "../../../services/pdf";
import * as XLSX from "xlsx";
import {
  AlertTriangle, BarChart3, CheckCircle2, Clock, Download, FileSpreadsheet,
  FileText, HardHat, Loader2, Receipt, ShieldAlert, TrendingDown, TrendingUp, Wrench,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectHubDto } from "../../../services/api";
import type { View } from "../Sidebar";
import { Bar as MiniBar, Empty, Kpi, Panel, Pill, btnGhost, btnPrimary, fmtDate, statusLabel, useMoney } from "./shared";

const PIE_COLORS = ["#FF6B1A", "#3B82F6", "#22C55E", "#F5A623", "#8B5CF6", "#EF4444", "#5B6675"];

export function ReportFolder({ data, setView }: { data: ProjectHubDto; setView: (v: View) => void }) {
  const money = useMoney();
  const { fmt, compact, signed, amount, code: currencyCode } = money;
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const { project, timeline, progress, costs, counts, site, variations, certificates, boq, drawings, documents, commitments } = data;

  // ── Everything the report states, computed once and shared by the page, the
  // PDF and the spreadsheet — so all three always agree. ────────────────────
  const r = useMemo(() => {
    const effectiveProgress = progress.schedule ?? progress.reported;
    const openDefects = site.punchItems.filter((p) => !["closed", "resolved"].includes(String(p.status).toLowerCase()));
    const openIncidents = site.safetyIncidents.filter((i) => i.status !== "closed");
    const approvedVars = variations.filter((v) => v.status === "approved");
    const pendingVars = variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status));
    // Behind/ahead measured as work done against calendar elapsed — the single
    // most asked question about a running job.
    const scheduleGap = timeline.elapsedPct == null ? null : effectiveProgress - timeline.elapsedPct;
    const margin = costs.revisedContractSum != null ? costs.revisedContractSum - costs.forecastFinalCost : null;
    const marginPct = costs.revisedContractSum ? Math.round(((margin ?? 0) / costs.revisedContractSum) * 1000) / 10 : null;

    // Variations grouped by cause: where the extra money actually came from.
    const byCause: Record<string, { cause: string; count: number; amount: number }> = {};
    for (const v of approvedVars) {
      const key = v.trigger || "Unstated";
      if (!byCause[key]) byCause[key] = { cause: key, count: 0, amount: 0 };
      byCause[key].count += 1;
      byCause[key].amount += v.amountKES;
    }
    const causes = Object.values(byCause).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    // Certificates as a monthly bar — the cash story of the job so far.
    const certSeries = certificates.map((c) => ({
      label: c.period || (c.periodEnd ? fmtDate(c.periodEnd, { month: "short", year: "2-digit" }) : c.number),
      thisPeriod: Number(c.requestedAmount) || 0,
      cumulative: c.cumulative,
    }));

    const defectsByPriority = ["high", "medium", "low"].map((p) => ({
      name: statusLabel(p),
      value: openDefects.filter((d) => (d.priority || "medium") === p).length,
    })).filter((d) => d.value > 0);

    return {
      effectiveProgress, openDefects, openIncidents, approvedVars, pendingVars,
      scheduleGap, margin, marginPct, causes, certSeries, defectsByPriority,
      pendingValue: pendingVars.reduce((s, v) => s + v.amountKES, 0),
      diaryEntries: site.dailyLogs.length,
      lastDiary: site.dailyLogs[0]?.date ?? null,
      labourDays: site.dailyLogs.reduce((s, l) => s + (Number(l.headcount) || 0), 0),
      budgetPct: costs.revisedBudget > 0 ? Math.round((costs.actual / costs.revisedBudget) * 100) : null,
      certifiedPct: costs.revisedContractSum ? Math.round((costs.certifiedToDate / costs.revisedContractSum) * 1000) / 10 : null,
    };
  }, [progress, site, variations, certificates, costs, timeline]);

  // Rows shared by both exports, so the PDF and the spreadsheet carry identical
  // figures — in whichever currency the viewer is reading the page in.
  const summaryRows = useMemo(() => {
    const rows: [string, string][] = [
      ["Project", `${project.name} (${project.code})`],
      ["Location", project.city || "—"],
      ["Status", project.status],
      ["Report date", new Date().toLocaleDateString()],
      ["Currency", currencyCode],
      ["", ""],
      ["Contract sum (original)", costs.contractSum != null ? fmt(costs.contractSum) : "not set"],
      ["Approved variations", costs.approvedVariations ? signed(costs.approvedVariations) : "none"],
      ["Revised contract sum", costs.revisedContractSum != null ? fmt(costs.revisedContractSum) : "—"],
      ["Variations pending decision", r.pendingVars.length ? `${r.pendingVars.length} · ${signed(r.pendingValue)}` : "none"],
      ["", ""],
      ["Certified to date", fmt(costs.certifiedToDate)],
      ["Paid to date", fmt(costs.paidToDate)],
      ["Retention held", fmt(costs.retentionHeld)],
      ["", ""],
      ["Budget (revised)", costs.originalBudget ? fmt(costs.revisedBudget) : "not set"],
      ["Actual spend", fmt(costs.actual)],
      ["Cost to complete", fmt(costs.costToComplete)],
      ["Forecast final cost", fmt(costs.forecastFinalCost)],
      ["Forecast margin", r.margin != null ? `${fmt(r.margin)}${r.marginPct != null ? ` (${r.marginPct}%)` : ""}` : "—"],
      ["", ""],
      ["Start date", fmtDate(timeline.startDate)],
      ["Contract completion", fmtDate(timeline.targetEndDate)],
      ["Time elapsed", timeline.elapsedPct != null ? `${timeline.elapsedPct}%` : "—"],
      ["Work complete", `${r.effectiveProgress}%${progress.schedule != null ? " (from programme)" : " (reported)"}`],
      ["Against programme", r.scheduleGap == null ? "—" : r.scheduleGap >= 0 ? `${r.scheduleGap} pts ahead` : `${Math.abs(r.scheduleGap)} pts behind`],
      ["Milestones reached", `${progress.milestonesDone} of ${progress.milestonesTotal}`],
      ["Overdue programme items", String(progress.overdueItems)],
      ["", ""],
      ["Open defects", `${r.openDefects.length} of ${counts.punchTotal} logged`],
      ["Open H&S incidents", `${r.openIncidents.length} of ${site.safetyIncidents.length} logged`],
      ["Site diary entries", String(r.diaryEntries)],
      ["Drawings (sheets / versions)", `${drawings.length} / ${counts.drawings}`],
      ["Documents on file", String(documents.length)],
      ["Subcontracts", String(commitments.length)],
      ["Bill of quantities", boq.itemCount ? `${fmt(boq.total)} · ${boq.itemCount} items` : "not priced"],
    ];
    return rows;
  }, [project, costs, r, timeline, progress, counts, site, drawings, documents, commitments, boq, fmt, signed, currencyCode]);

  const stamp = `${project.code}-report-${new Date().toISOString().slice(0, 10)}`;

  const exportPdf = () => {
    setExporting("pdf");
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`${project.name} — project report`, 14, 18);
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`${project.code} · ${project.city || "—"} · generated ${new Date().toLocaleDateString()} · all figures in ${currencyCode}`, 14, 25);
      doc.setTextColor(0);

      const table = (head: string[][], body: (string | number)[][], startY: number, title?: string) => {
        if (title) {
          doc.setFontSize(11);
          doc.text(title, 14, startY - 4);
        }
        // @ts-ignore — autoTable is attached to the prototype by the plugin.
        doc.autoTable({
          startY, head, body,
          styles: { fontSize: 8.5, cellPadding: 2 },
          headStyles: { fillColor: [255, 107, 26] },
          // Spacer rows in the summary read as section breaks rather than data.
          didParseCell: (d: any) => { if (d.row.raw?.[0] === "" && d.row.raw?.[1] === "") d.cell.styles.minCellHeight = 3; },
        });
        return lastTableEnd(doc, startY);
      };

      let y = table([["Measure", "Value"]], summaryRows, 34, "Summary");

      if (variations.length) {
        y = table(
          [["No.", "Variation", "Cause", "Status", `Amount (${currencyCode})`]],
          variations.map((v) => [v.number, v.title, v.trigger || "—", statusLabel(v.status), signed(v.amountKES)]),
          y + 14, "Variations",
        );
      }
      if (certificates.length) {
        y = table(
          [["Cert.", "Period", "This period", "Certified to date", "% of contract", "Status"]],
          certificates.map((c) => [
            c.number, c.period || "—", fmt(c.requestedAmount), fmt(c.cumulative),
            c.pctOfContract != null ? `${c.pctOfContract}%` : "—", statusLabel(c.status),
          ]),
          y + 14, "Payment certificates",
        );
      }
      if (r.openDefects.length) {
        y = table(
          [["Code", "Defect", "Area", "Priority", "Status"]],
          r.openDefects.slice(0, 40).map((d: any) => [d.code || "—", d.title || d.desc || "—", d.area || "—", statusLabel(d.priority || "medium"), statusLabel(d.status)]),
          y + 14, "Open defects",
        );
      }
      if (r.openIncidents.length) {
        table(
          [["Date", "Type", "Severity", "Status", "Description"]],
          r.openIncidents.map((i) => [fmtDate(i.date), statusLabel(i.incidentType), statusLabel(i.severity), statusLabel(i.status), (i.description || "").slice(0, 60)]),
          y + 14, "Open health & safety incidents",
        );
      }

      doc.save(`${stamp}.pdf`);
      toast.success("Report exported as PDF");
    } catch (e: any) {
      toast.error(e?.message || "Could not build the PDF");
    } finally {
      setExporting(null);
    }
  };

  const exportXlsx = () => {
    setExporting("xlsx");
    try {
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: (string | number)[][], widths: number[]) => {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = widths.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      add("Summary", [["Measure", "Value"], ...summaryRows], [34, 40]);
      if (variations.length) {
        add("Variations", [
          ["No.", "Variation", "Cause", "Status", `Amount (${currencyCode})`, "Raised"],
          ...variations.map((v) => [v.number, v.title, v.trigger || "", statusLabel(v.status), amount(v.amountKES), fmtDate(v.submittedDate || v.createdAt)]),
        ], [10, 46, 26, 18, 16, 14]);
      }
      if (certificates.length) {
        add("Certificates", [
          ["Cert.", "Period", "This period", "Certified to date", "% of contract", "Retention", "Net payable", "Status"],
          ...certificates.map((c) => [
            c.number, c.period || "", amount(c.requestedAmount), amount(c.cumulative),
            c.pctOfContract ?? "", amount(c.retentionAmount), amount(c.netPayable), statusLabel(c.status),
          ]),
        ], [10, 14, 14, 18, 14, 12, 14, 12]);
      }
      if (site.punchItems.length) {
        add("Defects", [
          ["Code", "Defect", "Area", "Priority", "Status", "Logged"],
          ...site.punchItems.map((d: any) => [d.code || "", d.title || d.desc || "", d.area || "", statusLabel(d.priority || "medium"), statusLabel(d.status), fmtDate(d.createdAt)]),
        ], [10, 46, 20, 12, 16, 14]);
      }
      if (site.safetyIncidents.length) {
        add("H&S", [
          ["Date", "Type", "Severity", "Status", "Reporter", "Description", "Corrective action"],
          ...site.safetyIncidents.map((i) => [fmtDate(i.date), statusLabel(i.incidentType), statusLabel(i.severity), statusLabel(i.status), i.reporter || "", i.description || "", i.correctiveAction || ""]),
        ], [14, 18, 12, 14, 18, 50, 40]);
      }
      if (site.dailyLogs.length) {
        add("Site diary", [
          ["Date", "Crew", "Headcount", "Weather", "Labour", "Plant", "Materials", "Notes"],
          ...site.dailyLogs.map((l) => [fmtDate(l.date), l.crew, l.headcount, l.weather || "", l.labour || "", l.plant || "", l.materials || "", l.notes || ""]),
        ], [14, 18, 10, 12, 26, 26, 26, 50]);
      }
      XLSX.writeFile(wb, `${stamp}.xlsx`);
      toast.success("Report exported as a spreadsheet");
    } catch (e: any) {
      toast.error(e?.message || "Could not build the spreadsheet");
    } finally {
      setExporting(null);
    }
  };

  const gapTone = r.scheduleGap == null ? undefined : r.scheduleGap >= 0 ? "good" : r.scheduleGap >= -10 ? "warn" : "bad";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-white font-display">{project.name} — project report</div>
          <div className="text-[11px] text-[#8A95A5]">
            Everything on this page, as of today, in {currencyCode}. For cross-project analysis, regions and scheduled sends, use the{" "}
            <button onClick={() => setView("reports")} className="text-[#FF6B1A] hover:underline">Reports module</button>.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportXlsx} disabled={!!exporting} className={btnGhost}>
            {exporting === "xlsx" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />} Spreadsheet
          </button>
          <button onClick={exportPdf} disabled={!!exporting} className={btnPrimary}>
            {exporting === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export PDF
          </button>
        </div>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Work complete"
          value={`${r.effectiveProgress}%`}
          tone={gapTone as any}
          sub={r.scheduleGap == null ? (progress.schedule != null ? "from the programme" : "reported") : r.scheduleGap >= 0 ? `${r.scheduleGap} pts ahead of the calendar` : `${Math.abs(r.scheduleGap)} pts behind the calendar`}
        />
        <Kpi
          label="Revised contract sum"
          value={costs.revisedContractSum != null ? fmt(costs.revisedContractSum) : "—"}
          tone="brand"
          sub={costs.approvedVariations ? `${signed(costs.approvedVariations)} in approved variations` : "no approved variations"}
        />
        <Kpi
          label="Certified to date"
          value={fmt(costs.certifiedToDate)}
          sub={r.certifiedPct != null ? `${r.certifiedPct}% of the contract · ${fmt(costs.paidToDate)} paid` : `${fmt(costs.paidToDate)} paid`}
        />
        <Kpi
          label="Forecast margin"
          value={r.margin != null ? fmt(r.margin) : "—"}
          tone={r.margin == null ? undefined : r.margin >= 0 ? "good" : "bad"}
          sub={r.marginPct != null ? `${r.marginPct}% of the revised contract sum` : "needs a contract sum and budget"}
        />
      </div>

      {/* What needs attention — the part a PM reads first */}
      <Panel title="Needs attention" subtitle="Everything open on this project today">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#222A35]">
          <Attention icon={Wrench} label="Variations awaiting a decision" value={r.pendingVars.length} detail={r.pendingVars.length ? signed(r.pendingValue) : "none pending"} bad={r.pendingVars.length > 0} />
          <Attention icon={CheckCircle2} label="Open defects" value={r.openDefects.length} detail={`${counts.punchTotal} logged in total`} bad={r.openDefects.length > 0} />
          <Attention icon={ShieldAlert} label="Open H&S incidents" value={r.openIncidents.length} detail={`${site.safetyIncidents.length} logged in total`} bad={r.openIncidents.length > 0} />
          <Attention icon={Clock} label="Overdue programme items" value={progress.overdueItems} detail={`${progress.blockedItems} blocked`} bad={progress.overdueItems > 0} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Money */}
        <Panel title="Financial position" subtitle="Income against forecast cost">
          <div className="p-4 space-y-3">
            <Line label="Original contract sum" value={costs.contractSum != null ? fmt(costs.contractSum) : "not set"} />
            <Line label="Approved variations" value={costs.approvedVariations ? signed(costs.approvedVariations) : "—"} tone={costs.approvedVariations > 0 ? "warn" : undefined} />
            <Line label="Revised contract sum" value={costs.revisedContractSum != null ? fmt(costs.revisedContractSum) : "—"} strong />
            <div className="pt-3 border-t border-[#222A35] space-y-3">
              <Line label="Actual spend" value={fmt(costs.actual)} />
              <Line label="Cost to complete" value={fmt(costs.costToComplete)} />
              <Line label="Forecast final cost" value={fmt(costs.forecastFinalCost)} strong />
              <Line
                label="Forecast margin"
                value={r.margin != null ? `${fmt(r.margin)}${r.marginPct != null ? ` · ${r.marginPct}%` : ""}` : "—"}
                tone={r.margin == null ? undefined : r.margin >= 0 ? "good" : "bad"}
                strong
              />
            </div>
            {r.budgetPct != null && (
              <div className="pt-3 border-t border-[#222A35]">
                <div className="flex items-center justify-between text-[11.5px] mb-1.5">
                  <span className="text-[#C2CAD6]">Budget used</span>
                  <span className={r.budgetPct > 100 ? "text-[#EF4444]" : "text-white"}>{r.budgetPct}%</span>
                </div>
                <MiniBar pct={Math.min(100, r.budgetPct)} tone={r.budgetPct > 100 ? "bad" : r.budgetPct > 85 ? "warn" : "good"} />
              </div>
            )}
          </div>
        </Panel>

        {/* Certification history */}
        <Panel title="Certification to date" subtitle={certificates.length ? `${certificates.length} certificate${certificates.length === 1 ? "" : "s"}` : undefined}>
          {certificates.length === 0 ? (
            <Empty icon={Receipt} title="Nothing certified yet" hint="Record interim certificates and the valuation history appears here." />
          ) : (
            <div className="p-3">
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={r.certSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#222A35" vertical={false} />
                    <XAxis dataKey="label" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => compact(Number(v))} width={64} />
                    <Tooltip
                      contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: any, n: any) => [fmt(Number(v)), n === "thisPeriod" ? "This period" : "Certified to date"]}
                    />
                    <Bar dataKey="thisPeriod" name="This period" fill="#FF6B1A" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Panel>

        {/* Where the extra money came from */}
        <Panel title="Variations by cause" subtitle="Approved variations only — what actually moved the contract sum">
          {r.causes.length === 0 ? (
            <Empty icon={Wrench} title="No approved variations" hint="Once variations are approved, this shows which causes are driving the extra cost." />
          ) : (
            <div className="divide-y divide-[#222A35]">
              {r.causes.map((c) => {
                const share = costs.approvedVariations ? Math.round((Math.abs(c.amount) / Math.abs(costs.approvedVariations)) * 100) : 0;
                return (
                  <div key={c.cause} className="px-4 py-2.5">
                    <div className="flex items-center justify-between text-[12px] gap-3">
                      <span className="text-white truncate">{c.cause}</span>
                      <span className={`tabular-nums shrink-0 ${c.amount < 0 ? "text-[#22C55E]" : "text-[#C2CAD6]"}`}>{signed(c.amount)} · {c.count}</span>
                    </div>
                    <div className="mt-1.5"><MiniBar pct={share} tone="warn" /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Site health */}
        <Panel title="Site record" subtitle="Quality, safety and the diary">
          <div className="p-4 grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <Line label="Diary entries" value={String(r.diaryEntries)} />
              <Line label="Last entry" value={r.lastDiary ? fmtDate(r.lastDiary) : "none"} />
              <Line label="Labour-days recorded" value={String(r.labourDays)} />
              <Line label="Inspections" value={String(site.inspections.length)} />
            </div>
            {r.defectsByPriority.length > 0 ? (
              <div className="h-[150px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={r.defectsByPriority} dataKey="value" nameKey="name" innerRadius={34} outerRadius={58} paddingAngle={2}>
                      {r.defectsByPriority.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} formatter={(v: any, n: any) => [`${v} open`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-[10px] text-[#5B6675] text-center -mt-2">Open defects by priority</div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center gap-1.5">
                <CheckCircle2 className="w-6 h-6 text-[#22C55E]" />
                <div className="text-[11.5px] text-[#8A95A5]">No open defects</div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Records on file — proof the paperwork exists */}
      <Panel title="Records on file" subtitle="What this project has behind it">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-[#222A35]">
          <Count icon={FileText} label="Documents" value={documents.length} />
          <Count icon={HardHat} label="Drawing sheets" value={drawings.length} sub={`${counts.drawings} versions`} />
          <Count icon={BarChart3} label="BOQ items" value={boq.itemCount} sub={boq.itemCount ? compact(boq.total) : undefined} />
          <Count icon={Wrench} label="Variations" value={variations.length} sub={`${r.approvedVars.length} approved`} />
          <Count icon={Receipt} label="Certificates" value={certificates.length} />
          <Count icon={HardHat} label="Subcontracts" value={commitments.length} />
        </div>
      </Panel>

      <div className="rounded-xl border border-[#222A35] bg-[#0A0E14] px-4 py-3 text-[11px] text-[#8A95A5] leading-relaxed">
        Every figure above is read from this project's own records — the same rows the other folders show — so the report
        cannot disagree with the page it came from. The PDF carries the summary plus variations, certificates, open defects
        and open incidents; the spreadsheet adds the full defect list, H&S log and site diary, one sheet each.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Attention({ icon: Icon, label, value, detail, bad }: { icon: any; label: string; value: number; detail: string; bad: boolean }) {
  return (
    <div className="p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-[#8A95A5]"><Icon className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{label}</span></div>
      <div className={`text-[20px] font-display mt-1 ${bad ? "text-[#F5A623]" : "text-[#22C55E]"}`}>{value}</div>
      <div className="text-[10.5px] text-[#5B6675] truncate">{detail}</div>
    </div>
  );
}

function Count({ icon: Icon, label, value, sub }: { icon: any; label: string; value: number; sub?: string }) {
  return (
    <div className="p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-[#8A95A5]"><Icon className="w-3.5 h-3.5 text-[#FF6B1A] shrink-0" /> <span className="truncate">{label}</span></div>
      <div className="text-[18px] text-white font-display mt-1">{value}</div>
      {sub && <div className="text-[10.5px] text-[#5B6675] truncate">{sub}</div>}
    </div>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: "good" | "bad" | "warn"; strong?: boolean }) {
  const color = tone === "good" ? "text-[#22C55E]" : tone === "bad" ? "text-[#EF4444]" : tone === "warn" ? "text-[#F5A623]" : strong ? "text-white" : "text-[#C2CAD6]";
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className={strong ? "text-white" : "text-[#8A95A5]"}>{label}</span>
      <span className={`tabular-nums shrink-0 ${color} ${strong ? "font-display text-[13px]" : ""}`}>{value}</span>
    </div>
  );
}
