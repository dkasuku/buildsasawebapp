// The project page's right-hand column: a setup checklist while the project is
// being planned, "Needs your attention" once it is running, and recent activity.
import { Check } from "lucide-react";
import type { ProjectHubDto } from "../../../services/api";
import { fmtDate } from "./shared";

type Go = (tab: any) => void;

export function ReadinessCard({ data, hasClient, onContract, go }: { data: ProjectHubDto; hasClient: boolean; onContract?: () => void; go: Go }) {
  const steps = [
    { label: "Set the contract value", done: data.project.contractSumKES != null, run: onContract },
    { label: "Add start and finish dates", done: !!(data.timeline.startDate && data.timeline.targetEndDate), run: onContract },
    { label: "Invite the client", done: hasClient, run: () => go("client") },
    { label: "Upload the first drawings", done: data.drawings.length > 0, run: () => go("drawings") },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  if (done === steps.length) return null;
  return (
    <section className="ws-card" aria-labelledby="ready-title">
      <div className="ws-card-body">
        <div className="flex items-center justify-between gap-2">
          <h2 id="ready-title" className="ws-h2">Get this project ready</h2>
          <span className="ws-sub">{done} of {steps.length}</span>
        </div>
        <div className="ws-progress mt-2.5" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
          <div style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ol className="mt-3 flex flex-col gap-1">
          {steps.map((s, i) => {
            const isNext = i === next;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  disabled={!s.run || s.done}
                  onClick={s.run}
                  className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left disabled:cursor-default"
                  style={{ background: isNext ? "var(--ws-wash)" : undefined, fontSize: 13.5, color: s.done ? "var(--ws-muted)" : "var(--ws-text)", fontWeight: isNext ? 600 : 500 }}
                >
                  <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0" style={{ border: s.done ? 0 : `1.5px solid ${isNext ? "var(--ws-primary)" : "var(--ws-dashed)"}`, background: s.done ? "var(--ws-green)" : undefined }}>
                    {s.done && <Check className="w-3 h-3" style={{ color: "#fff" }} aria-hidden />}
                  </span>
                  <span style={{ textDecoration: s.done ? "line-through" : undefined }}>{s.label}</span>
                  <span className="sr-only">{s.done ? "(done)" : isNext ? "(next step)" : ""}</span>
                  {isNext && <span className="ml-auto" style={{ color: "var(--ws-primary-text)", fontSize: 12.5 }} aria-hidden>Next →</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export function AttentionCard({ data, showFin, go }: { data: ProjectHubDto; showFin: boolean; go: Go }) {
  const awaitingSheets = data.drawings.filter((s) => /review|await|pending/i.test(s.latest.status || "")).length;
  const certs = data.certificates.filter((c) => ["submitted", "under_review"].includes(c.status)).length;
  const vars = data.variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status)).length;
  const items = [
    awaitingSheets && { label: `${awaitingSheets} sheet${awaitingSheets === 1 ? "" : "s"} awaiting approval`, tab: "drawings" },
    showFin && certs && { label: `${certs} certificate${certs === 1 ? "" : "s"} in review`, tab: "certificates" },
    vars && { label: `${vars} variation${vars === 1 ? "" : "s"} awaiting a decision`, tab: "variations" },
    data.counts.punchOpen && { label: `${data.counts.punchOpen} open defect${data.counts.punchOpen === 1 ? "" : "s"}`, tab: "site" },
    data.progress.overdueItems && { label: `${data.progress.overdueItems} overdue programme item${data.progress.overdueItems === 1 ? "" : "s"}`, tab: "site" },
  ].filter(Boolean) as { label: string; tab: string }[];
  return (
    <section className="ws-card" aria-labelledby="attn-title" style={items.length ? { background: "var(--ws-wash)", borderColor: "var(--ws-wash-border)" } : undefined}>
      <div className="ws-card-body">
        <h2 id="attn-title" className="ws-h2">Needs your attention</h2>
        {items.length === 0 ? <p className="ws-sub mt-1.5">Nothing needs you right now.</p> : (
          <ul className="mt-2 flex flex-col gap-1">
            {items.map((i) => (
              <li key={i.label}><button type="button" className="ws-link text-left" style={{ fontSize: 13.5 }} onClick={() => go(i.tab)}>{i.label} →</button></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Event = { who?: string | null; what: string; at: string };

export function ActivityCard({ data }: { data: ProjectHubDto }) {
  const events: Event[] = [
    ...data.drawings.flatMap((s) => s.versions.map((v) => ({ who: v.uploadedBy, what: `uploaded ${s.number} V${v.rev}`, at: v.createdAt }))),
    ...data.variations.map((v) => ({ who: v.requestedBy, what: `logged variation ${v.number}`, at: v.createdAt })),
    ...data.certificates.filter((c) => c.createdAt).map((c) => ({ who: null, what: `Certificate ${c.number} ${String(c.status).replace(/_/g, " ")}`, at: c.createdAt! })),
    ...data.site.dailyLogs.map((l) => ({ who: null, what: `Daily log for ${fmtDate(l.date, { day: "numeric", month: "short" })}`, at: l.createdAt || l.date })),
    ...data.documents.filter((d) => d.createdAt).map((d) => ({ who: d.uploadedBy, what: `added ${d.name}`, at: d.createdAt! })),
  ]
    .filter((e) => !Number.isNaN(new Date(e.at).getTime()))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 6);
  const initials = (n: string) => n.trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  return (
    <section className="ws-card" aria-labelledby="act-title">
      <div className="ws-card-body">
        <h2 id="act-title" className="ws-h2">Activity</h2>
        {events.length === 0 ? <p className="ws-sub mt-1.5">Nothing has happened on this project yet.</p> : (
          <ul className="mt-3 flex flex-col gap-3">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-2.5" style={{ fontSize: 13 }}>
                <span className="ws-avatar" style={{ width: 24, height: 24, fontSize: 10 }} aria-hidden>{e.who ? initials(e.who) : "·"}</span>
                <span className="min-w-0">
                  <span style={{ color: "var(--ws-text)" }}>{e.who ? <strong style={{ fontWeight: 600 }}>{e.who} </strong> : null}{e.who ? e.what : e.what.charAt(0).toUpperCase() + e.what.slice(1)}</span>
                  <span className="block" style={{ fontSize: 12, color: "var(--ws-muted)" }}>{fmtDate(e.at, { day: "numeric", month: "short" })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
