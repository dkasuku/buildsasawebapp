// The project's Analytics tab: the figures that used to sit in a strip across
// the top of every project tab, gathered on one page.
import type { ProjectHubDto } from "../../../services/api";
import { fmtDate } from "./shared";

type Fmt = (n: number | null | undefined) => string;

const awaiting = (status?: string) => /review|await|pending|submitted/i.test(status || "");

export function ProjectAnalytics({ data, fmt, showFin, onExport, go }: {
  data: ProjectHubDto; fmt: Fmt; showFin: boolean; onExport?: () => void; go: (tab: any) => void;
}) {
  const { costs, timeline, progress, drawings, documents, counts, schedule, variations, certificates, site } = data;
  const contract = costs.revisedContractSum ?? costs.contractSum;
  const pct = (n: number) => (contract && contract > 0 ? Math.round((n / contract) * 100) : null);
  const outstanding = Math.max(0, costs.certifiedToDate - costs.paidToDate);
  const work = progress.schedule ?? progress.reported;
  const elapsed = timeline.elapsedPct;
  const verdict = elapsed == null
    ? "Add start and finish dates to compare progress against time."
    : work >= elapsed - 5 ? "Work is keeping pace with the calendar."
    : `Work is ${elapsed - work} points behind the calendar.`;
  const milestones = schedule
    .filter((s) => s.type === "milestone" && s.status !== "done")
    .sort((a, b) => +new Date(a.endDate) - +new Date(b.endDate))
    .slice(0, 3);
  const pendingVars = variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status));
  const certsInReview = certificates.filter((c) => ["submitted", "under_review"].includes(c.status));
  const sheetsAwaiting = drawings.filter((s) => awaiting(s.latest.status));
  const lastCert = certificates[certificates.length - 1];
  const openHs = site.safetyIncidents.filter((s) => s.status !== "closed").length;

  const openItems = [
    ...pendingVars.map((v) => ({ label: `Variation ${v.number}: ${v.title}`, pill: "Awaiting decision", tone: "ws-pill-amber", tab: "variations" })),
    ...certsInReview.map((c) => ({ label: `Certificate ${c.number}`, pill: "In review", tone: "ws-pill-amber", tab: "certificates" })),
    ...sheetsAwaiting.map((s) => ({ label: `${s.number} ${s.title}`, pill: "Awaiting approval", tone: "ws-pill-amber", tab: "drawings" })),
    ...(counts.punchOpen ? [{ label: `${counts.punchOpen} open defect${counts.punchOpen === 1 ? "" : "s"}`, pill: "Open", tone: "ws-pill-blue", tab: "site" }] : []),
    ...(progress.blockedItems ? [{ label: `${progress.blockedItems} blocked programme item${progress.blockedItems === 1 ? "" : "s"}`, pill: "Blocked", tone: "ws-pill-red", tab: "site" }] : []),
    ...(openHs ? [{ label: `${openHs} open H&S incident${openHs === 1 ? "" : "s"}`, pill: "Open", tone: "ws-pill-red", tab: "site" }] : []),
  ].filter((i) => showFin || i.tab !== "certificates");

  return (
    <div className="flex flex-col gap-4">
      <div className="ws-page-head">
        <div>
          <h2 className="ws-h1" style={{ fontSize: 16 }}>Project analytics</h2>
          <div className="ws-sub">Money, programme and documents for the whole project, as of today.</div>
        </div>
        {onExport && <button type="button" className="ws-btn" onClick={onExport}>Export report</button>}
      </div>

      <div className="ws-grid-4">
        <Kpi label="Contract value" value={showFin ? fmt(costs.contractSum) : "Hidden"} sub={showFin ? (costs.approvedVariations ? `+${fmt(costs.approvedVariations)} approved variations` : "No approved variations") : "Not shown for your role"} />
        <Kpi label="Certified to date" value={showFin ? fmt(costs.certifiedToDate) : "Hidden"} sub={showFin ? (pct(costs.certifiedToDate) != null ? `${pct(costs.certifiedToDate)}% of contract` : "Set the contract value to see %") : ""} />
        <Kpi label="Paid to date" value={showFin ? fmt(costs.paidToDate) : "Hidden"} sub={showFin ? <><span style={{ color: outstanding ? "var(--ws-primary-text)" : undefined, fontWeight: outstanding ? 600 : undefined }}>{fmt(outstanding)}</span> outstanding</> : ""} />
        <Kpi label="Days remaining" value={timeline.remainingDays == null ? "No end date" : timeline.remainingDays >= 0 ? String(timeline.remainingDays) : `${-timeline.remainingDays} over`} sub={timeline.durationDays != null ? `of ${timeline.durationDays} · finish ${fmtDate(timeline.targetEndDate)}` : "Add start and finish dates"} />
      </div>

      <div className="ws-grid-2">
        {showFin && (
          <section className="ws-card" aria-label="Money">
            <div className="ws-card-head"><h3 className="ws-h2">Money</h3><span className="ws-sub">Relative to the contract</span></div>
            <div className="ws-card-body flex flex-col gap-3">
              <MoneyBar label="Contract sum" value={fmt(contract)} pct={contract ? 100 : 0} />
              <MoneyBar label="Certified" value={fmt(costs.certifiedToDate)} pct={pct(costs.certifiedToDate)} />
              <MoneyBar label="Paid" value={fmt(costs.paidToDate)} pct={pct(costs.paidToDate)} />
              <MoneyBar label="Committed" value={fmt(costs.committed)} pct={pct(costs.committed)} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 px-[18px] py-3" style={{ borderTop: "1px solid var(--ws-divider)", fontSize: 12.5, color: "var(--ws-muted)" }}>
              <span>Retention held <strong style={{ color: "var(--ws-text)" }}>{fmt(costs.retentionHeld)}</strong></span>
              <span>Variations pending <strong style={{ color: "var(--ws-text)" }}>{fmt(costs.pendingVariations)}</strong></span>
              <span>Last certificate <strong style={{ color: "var(--ws-text)" }}>{lastCert ? `${lastCert.number}` : "none yet"}</strong></span>
            </div>
          </section>
        )}
        <section className="ws-card" aria-label="Programme">
          <div className="ws-card-head"><h3 className="ws-h2">Programme</h3><span className="ws-sub">{fmtDate(timeline.startDate)} → {fmtDate(timeline.targetEndDate)}</span></div>
          <div className="ws-card-body flex flex-col gap-3">
            <MoneyBar label="Work complete" value={`${work}%`} pct={work} />
            <MoneyBar label="Calendar elapsed" value={elapsed == null ? "—" : `${elapsed}%`} pct={elapsed} ink />
            <div className="ws-sub">{verdict}</div>
            <div>
              <div style={{ fontSize: 12.5, color: "var(--ws-muted)", marginBottom: 6 }}>Next milestones</div>
              {milestones.length === 0 ? <div className="ws-sub">No upcoming milestones on the schedule.</div> : (
                <ul className="flex flex-col gap-1.5">
                  {milestones.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3" style={{ fontSize: 13.5 }}>
                      <span className="truncate">{m.name}</span>
                      <span style={{ color: "var(--ws-muted)", whiteSpace: "nowrap" }}>{fmtDate(m.endDate, { day: "numeric", month: "short" })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="ws-grid-2">
        <section className="ws-card" aria-label="Documents">
          <div className="ws-card-head"><h3 className="ws-h2">Documents</h3></div>
          <div className="ws-card-body grid grid-cols-2 gap-3">
            <Count label="Drawing sheets" n={drawings.length} onClick={() => go("drawings")} />
            <Count label="Versions" n={counts.drawings ?? 0} onClick={() => go("drawings")} />
            <Count label="Design documents" n={documents.filter((d) => d.category === "drawing").length} onClick={() => go("drawings")} />
            <Count label="Awaiting approval" n={sheetsAwaiting.length} onClick={() => go("drawings")} />
          </div>
        </section>
        <section className="ws-card" aria-label="Open items">
          <div className="ws-card-head"><h3 className="ws-h2">Open items</h3><span className="ws-count">{openItems.length}</span></div>
          {openItems.length === 0 ? <div className="ws-card-body ws-sub">Nothing open. Good.</div> : (
            <ul>
              {openItems.slice(0, 8).map((i, k) => (
                <li key={k}>
                  <button type="button" onClick={() => go(i.tab)} className="w-full flex items-center justify-between gap-3 px-[18px] py-2.5 text-left hover:bg-[var(--ws-subtle)]" style={{ borderBottom: "1px solid var(--ws-divider)", fontSize: 13.5, color: "var(--ws-text)" }}>
                    <span className="truncate">{i.label}</span>
                    <span className={`ws-pill ${i.tone}`}>{i.pill}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="ws-card ws-kpi">
      <div className="ws-kpi-label">{label}</div>
      <div className="ws-kpi-value">{value}</div>
      {sub && <div className="ws-kpi-sub">{sub}</div>}
    </div>
  );
}

function MoneyBar({ label, value, pct, ink }: { label: string; value: string; pct: number | null; ink?: boolean }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between gap-3" style={{ fontSize: 13.5 }}>
        <span style={{ color: "var(--ws-text-2)" }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}</span>
      </div>
      <div className="ws-progress mt-1.5" role="img" aria-label={`${label}: ${pct ?? 0}%`}>
        <div style={{ width: `${w}%`, background: ink ? "var(--ws-ink)" : undefined }} />
      </div>
    </div>
  );
}

function Count({ label, n, onClick }: { label: string; n: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left rounded-[10px] p-3 hover:bg-[var(--ws-subtle)]" style={{ border: "1px solid var(--ws-border)" }}>
      <div className="ws-kpi-value" style={{ marginTop: 0 }}>{n}</div>
      <div className="ws-kpi-sub" style={{ marginTop: 2 }}>{label}</div>
    </button>
  );
}
