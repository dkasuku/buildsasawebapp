// The client side of Buildsasa: homeowners, landowners and investors (often
// abroad) following their sites. Everything a contractor, an inspector they
// assigned, or Buildsasa's own site reporters share arrives here, and the
// client handles approvals, invoices, jobs and chats from one place.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Bell, Briefcase, FileSignature, Building2, CalendarDays, Camera, ChevronRight, ClipboardCheck, Eye, Home, Loader2,
  LogOut, MapPin, MessageCircle, Moon, Phone, Search, ShieldCheck, Sun, User, Users, Wallet,
} from "lucide-react";
import { ChatThread, Chip, CommentThread, MediaGrid, MediaPicker, UpdateFeed } from "./ClientParts";
import { PublicQuoteView } from "../PublicQuoteView";
import { PublicPortalView } from "../PublicPortalView";
import { RateDialog, Stars, TrustBadge } from "./Trust";
import { MapPicker } from "../MapPicker";
import { useWelcome, WelcomeModal } from "../Welcome";
import { clientApi, kes, SERVICES, STAGES, stageLabel, toMedia, when, type ClientComment, type ClientHome, type ClientQuote, type Company, type Media, type Reporting } from "./clientData";

type View = { name: "home" } | { name: "sites" } | { name: "site"; id: string; tab?: string } | { name: "messages" } | { name: "companies" }
  | { name: "jobs"; company?: Company } | { name: "reporting" } | { name: "report"; id: string } | { name: "account" } | { name: "quotes" };

const input = "w-full h-10 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";
const area = "w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";
const primary = "h-10 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] inline-flex items-center justify-center gap-1.5 disabled:opacity-60";
const ghost = "h-10 px-4 rounded-md border border-[#222A35] text-[#C2CAD6] hover:text-white text-[13px] inline-flex items-center justify-center gap-1.5";
const card = "rounded-xl border border-[#222A35] bg-[#11161D]";

const STATUS_TONE: Record<string, string> = {
  requested: "bg-[#F59E0B]/10 text-[#F59E0B]", approved: "bg-[#3B82F6]/10 text-[#3B82F6]", active: "bg-[#22C55E]/10 text-[#22C55E]",
  paused: "bg-[#8A95A5]/10 text-[#8A95A5]", ended: "bg-[#8A95A5]/10 text-[#8A95A5]", declined: "bg-[#EF4444]/10 text-[#EF4444]",
  pending: "bg-[#F59E0B]/10 text-[#F59E0B]", rejected: "bg-[#EF4444]/10 text-[#EF4444]", open: "bg-[#22C55E]/10 text-[#22C55E]", awarded: "bg-[#3B82F6]/10 text-[#3B82F6]", closed: "bg-[#8A95A5]/10 text-[#8A95A5]",
};
const STATUS_LABEL: Record<string, string> = { requested: "Waiting for Buildsasa", approved: "Approved, pay to start", active: "Active", paused: "Paused", ended: "Ended", declined: "Declined", pending: "Waiting for approval", rejected: "Not approved" };
const Badge = ({ s, label }: { s: string; label?: string }) => <span className={`text-[10.5px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_TONE[s] || STATUS_TONE.closed}`}>{label || STATUS_LABEL[s] || s}</span>;

export function ClientApp({ theme, setTheme, onSignOut }: { theme: "dark" | "light"; setTheme: (t: "dark" | "light") => void; onSignOut: () => void }) {
  const [view, setView] = useState<View>({ name: "home" });
  const [home, setHome] = useState<ClientHome | null>(null);
  const reload = () => clientApi.home().then(setHome).catch((e) => toast.error(e?.message || "Couldn't load your account."));
  useEffect(() => { reload(); }, []);
  const welcome = useWelcome("client", home?.user.email, !!home);

  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }); };
  // The phone menu has five slots; Account links to the rest through this event.
  useEffect(() => {
    const on = (e: Event) => go({ name: (e as CustomEvent).detail } as View);
    document.addEventListener("client-go", on);
    return () => document.removeEventListener("client-go", on);
  }, []);
  const nav: { key: View["name"]; label: string; icon: any; badge?: number }[] = [
    { key: "home", label: "Home", icon: Home, badge: home?.todo.length || 0 },
    { key: "sites", label: "My sites", icon: Building2 },
    { key: "messages", label: "Messages", icon: MessageCircle },
    { key: "quotes", label: "Quotes & proposals", icon: FileSignature },
    { key: "reporting", label: "Site reporting", icon: ShieldCheck },
    { key: "companies", label: "Companies", icon: Users },
    { key: "jobs", label: "Post a job", icon: Briefcase },
    { key: "account", label: "Account", icon: User },
  ];
  const activeKey = view.name === "site" ? "sites" : view.name === "report" ? "reporting" : view.name;

  return (
    <div className="min-h-screen bg-[#0A0E14] text-white">
      <header className="sticky top-0 z-30 h-14 border-b border-[#222A35] bg-[#0A0E14]/95 backdrop-blur flex items-center px-4 gap-3">
        <img src="/Buildsasa.png" alt="Buildsasa" className="w-8 h-8 rounded-lg" />
        <div className="min-w-0">
          <div className="text-[13.5px] leading-tight">Buildsasa</div>
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Client account</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => go({ name: "home" })} className="relative h-9 w-9 rounded-md border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white" title="Things waiting for you">
            <Bell className="w-4 h-4" />
            {!!home?.todo.length && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#FF6B1A] text-[9px] text-white flex items-center justify-center">{home.todo.length}</span>}
          </button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="h-9 w-9 rounded-md border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white" title="Switch theme">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={onSignOut} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white hidden sm:flex items-center gap-1.5"><LogOut className="w-4 h-4" /> Sign out</button>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden lg:block w-60 shrink-0 border-r border-[#222A35] min-h-[calc(100vh-56px)] p-3 sticky top-14 self-start">
          {nav.map((n) => (
            <button key={n.key} onClick={() => go({ name: n.key } as View)} className={`w-full h-10 px-3 rounded-lg text-[13px] flex items-center gap-2.5 mb-0.5 ${activeKey === n.key ? "bg-[#FF6B1A] text-white" : "text-[#C2CAD6] hover:bg-[#161C24] hover:text-white"}`}>
              <n.icon className="w-4 h-4" /> {n.label}
              {!!n.badge && <span className={`ml-auto text-[10px] px-1.5 rounded-full ${activeKey === n.key ? "bg-white/25" : "bg-[#FF6B1A] text-white"}`}>{n.badge}</span>}
            </button>
          ))}
          <button onClick={onSignOut} className="w-full h-10 px-3 rounded-lg text-[13px] flex items-center gap-2.5 text-[#8A95A5] hover:text-white mt-4"><LogOut className="w-4 h-4" /> Sign out</button>
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-5 pb-24 lg:pb-8 max-w-5xl">
          {!home ? <div className="py-20 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading your account…</div> : (
            <>
              {view.name === "home" && <HomeView home={home} go={go} />}
              {view.name === "sites" && <SitesView home={home} go={go} />}
              {view.name === "site" && <SiteView id={view.id} initialTab={view.tab} go={go} />}
              {view.name === "messages" && <MessagesView home={home} go={go} />}
              {view.name === "companies" && <CompaniesView go={go} />}
              {view.name === "jobs" && <JobsView home={home} company={view.company} reload={reload} />}
              {view.name === "reporting" && <ReportingView home={home} go={go} reload={reload} />}
              {view.name === "report" && <ReportView id={view.id} go={go} reload={reload} />}
              {view.name === "account" && <AccountView home={home} reload={reload} onSignOut={onSignOut} />}
              {view.name === "quotes" && <QuotesView />}
            </>
          )}
        </main>
      </div>

      {welcome.show && home && <WelcomeModal kind="client" name={home.user.name} onClose={welcome.close} />}

      {/* Phone navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#222A35] bg-[#0A0E14]/95 backdrop-blur grid grid-cols-5">
        {nav.filter((n) => ["home", "sites", "messages", "reporting", "account"].includes(n.key)).map((n) => (
          <button key={n.key} onClick={() => go({ name: n.key } as View)} className={`h-16 flex flex-col items-center justify-center gap-1 text-[10px] relative ${activeKey === n.key ? "text-[#FF6B1A]" : "text-[#8A95A5]"}`}>
            <n.icon className="w-5 h-5" /> {n.key === "reporting" ? "Reporting" : n.key === "account" ? "More" : n.label}
            {!!n.badge && <span className="absolute top-2 right-[28%] min-w-4 h-4 px-1 rounded-full bg-[#FF6B1A] text-[9px] text-white flex items-center justify-center">{n.badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Title({ title, sub, back }: { title: string; sub?: string; back?: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-2">
      {back && <button onClick={back} className="h-9 w-9 shrink-0 rounded-md border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>}
      <div className="min-w-0">
        <h1 className="text-[19px] font-display leading-tight">{title}</h1>
        {sub && <p className="text-[12.5px] text-[#8A95A5] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ───────────── Home ─────────────
function HomeView({ home, go }: { home: ClientHome; go: (v: View) => void }) {
  const first = home.user.name.split(" ")[0];
  const noSites = !home.projects.length && !home.reporting.length;
  return (
    <div className="space-y-5">
      <Title title={`Hello, ${first}`} sub="Everything happening on your sites, shared by your contractor, their inspectors and Buildsasa." />

      {home.todo.length > 0 && (
        <section className={`${card} p-4`}>
          <div className="text-[13px] font-medium mb-2">Waiting for you ({home.todo.length})</div>
          <div className="divide-y divide-[#222A35]">
            {home.todo.map((t, i) => (
              <button key={i} onClick={() => t.projectId ? go({ name: "site", id: t.projectId, tab: "approvals" }) : t.reportingId && go({ name: "report", id: t.reportingId })} className="w-full py-2.5 flex items-center gap-2 text-left text-[12.5px] text-[#C2CAD6] hover:text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B1A] shrink-0" /> <span className="flex-1">{t.label}</span> <ChevronRight className="w-4 h-4 text-[#5B6675]" />
              </button>
            ))}
          </div>
        </section>
      )}

      {noSites ? (
        <section className={`${card} p-5`}>
          <div className="text-[15px] font-display">Let's get your site on Buildsasa</div>
          <p className="text-[12.5px] text-[#8A95A5] mt-1">If a contractor is already working for you, ask them to invite <b className="text-white">{home.user.email}</b> to the project, and it will appear here. Otherwise:</p>
          <div className="grid sm:grid-cols-3 gap-2 mt-4">
            <Action icon={Users} title="Find a company" text="Browse contractors and service providers subscribed to Buildsasa." onClick={() => go({ name: "companies" })} />
            <Action icon={Briefcase} title="Post a job" text="Fencing, a borehole, a house… Contractors send you bids." onClick={() => go({ name: "jobs" })} />
            <Action icon={ShieldCheck} title="Ask Buildsasa to report" text="Neutral visits and honest photo reports of every stage." onClick={() => go({ name: "reporting" })} />
          </div>
        </section>
      ) : (
        <>
          {home.projects.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2"><div className="text-[13px] font-medium">Your sites</div><button onClick={() => go({ name: "sites" })} className="text-[12px] text-[#FF6B1A]">See all</button></div>
              <div className="grid sm:grid-cols-2 gap-3">{home.projects.slice(0, 4).map((p) => <SiteCard key={p.id} p={p} onClick={() => go({ name: "site", id: p.id })} />)}</div>
            </section>
          )}
          {home.reporting.length > 0 && (
            <section>
              <div className="text-[13px] font-medium mb-2">Buildsasa site reporting</div>
              <div className="space-y-2">{home.reporting.map((r) => <ReportingRow key={r.id} r={r} onClick={() => go({ name: "report", id: r.id })} />)}</div>
            </section>
          )}
          <div className="grid sm:grid-cols-3 gap-2">
            <Action icon={ShieldCheck} title="Neutral site reporting" text="Buildsasa visits and reports honestly, whoever builds." onClick={() => go({ name: "reporting" })} />
            <Action icon={Briefcase} title="Post a job" text="Need fencing, solar, CCTV or a gate? Get bids." onClick={() => go({ name: "jobs" })} />
            <Action icon={Users} title="Find a company" text="Contractors and service providers on Buildsasa." onClick={() => go({ name: "companies" })} />
          </div>
        </>
      )}
    </div>
  );
}

function Action({ icon: Icon, title, text, onClick }: { icon: any; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${card} p-4 text-left hover:border-[#FF6B1A]/50 transition`}>
      <Icon className="w-5 h-5 text-[#FF6B1A]" />
      <div className="text-[13px] mt-2">{title}</div>
      <div className="text-[11.5px] text-[#8A95A5] mt-0.5">{text}</div>
    </button>
  );
}

function SiteCard({ p, onClick }: { p: ClientHome["projects"][number]; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${card} overflow-hidden text-left hover:border-[#FF6B1A]/50 transition`}>
      <div className="h-28 bg-[#161C24] relative">
        {p.cover ? <img src={p.cover} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-8 h-8 text-[#2C3744] absolute inset-0 m-auto" />}
        <span className="absolute top-2 left-2 text-[10.5px] px-2 py-0.5 rounded-full bg-black/60 text-white">{p.status}</span>
      </div>
      <div className="p-3">
        <div className="text-[14px] truncate">{p.name}</div>
        <div className="text-[11.5px] text-[#8A95A5] truncate">{[p.company?.name, p.city !== "—" ? p.city : ""].filter(Boolean).join(" · ")}</div>
        <div className="mt-2 h-1.5 rounded-full bg-[#222A35]"><div className="h-full rounded-full bg-[#FF6B1A]" style={{ width: `${Math.max(0, Math.min(100, p.progress || 0))}%` }} /></div>
        <div className="flex justify-between text-[10.5px] text-[#5B6675] mt-1"><span>{p.progress || 0}% complete</span>{p.lastUpdate && <span className="truncate ml-2">Latest: {stageLabel(p.lastUpdate.stage)}</span>}</div>
      </div>
    </button>
  );
}

function ReportingRow({ r, onClick }: { r: Reporting; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${card} w-full p-3 flex items-center gap-3 text-left hover:border-[#FF6B1A]/50`}>
      <ShieldCheck className="w-5 h-5 text-[#FF6B1A] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] truncate">{r.siteName}</div>
        <div className="text-[11.5px] text-[#8A95A5] truncate">{r.location} · {kes(r.monthlyFeeKES)}/month · {r.paidMonths}/{r.months} months paid</div>
      </div>
      <Badge s={r.status} />
    </button>
  );
}

// ───────────── Sites ─────────────
function SitesView({ home, go }: { home: ClientHome; go: (v: View) => void }) {
  return (
    <div>
      <Title title="My sites" sub="Projects your contractors have shared with you." />
      {home.projects.length === 0 ? (
        <div className={`${card} p-6 text-center`}>
          <Building2 className="w-8 h-8 text-[#2C3744] mx-auto" />
          <div className="text-[14px] mt-2">No sites shared with you yet</div>
          <p className="text-[12.5px] text-[#8A95A5] mt-1 max-w-md mx-auto">Ask your contractor to invite <b className="text-white">{home.user.email}</b> from their Buildsasa project. Not working with one yet? Find a company, or ask Buildsasa to report on your site.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-4"><button className={primary} onClick={() => go({ name: "companies" })}>Find a company</button><button className={ghost} onClick={() => go({ name: "reporting" })}>Buildsasa site reporting</button></div>
        </div>
      ) : <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{home.projects.map((p) => <SiteCard key={p.id} p={p} onClick={() => go({ name: "site", id: p.id })} />)}</div>}
    </div>
  );
}

function SiteView({ id, initialTab, go }: { id: string; initialTab?: string; go: (v: View) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab || "progress");
  const [rating, setRating] = useState(false);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [threads, setThreads] = useState<{ userId: string; name: string; role?: string | null }[]>([]);
  const [thread, setThread] = useState<string>("group");
  useEffect(() => {
    clientApi.siteComments(id).then(setComments).catch(() => {});
    clientApi.siteThreads(id).then(setThreads).catch(() => {});
  }, [id]);
  const thr = (type: string, tid: string) => (
    <CommentThread mineType="client" comments={comments.filter((c) => c.targetType === type && c.targetId === tid)}
      onSend={async (b, m) => { const c = await clientApi.commentOnSite(id, type, tid, b, m); setComments((x) => [...x, c]); }} />
  );
  useEffect(() => { clientApi.site(id).then(setD).catch((e) => setErr(e?.message || "Couldn't open this site.")); }, [id]);
  if (err) return <div><Title title="Site" back={() => go({ name: "sites" })} /><div className={`${card} p-6 text-[13px] text-[#8A95A5]`}>{err}</div></div>;
  if (!d) return <div className="py-20 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Opening site…</div>;
  const pending = (d.changeOrders || []).filter((c: any) => c.status === "owner_approval").length + (d.selections || []).filter((s: any) => s.status === "awaiting_client").length;
  const tabs = [
    { key: "progress", label: "Progress", icon: Camera, n: d.updates.length },
    { key: "logs", label: "Daily logs", icon: CalendarDays, n: d.dailyLogs.length },
    { key: "inspections", label: "Inspections", icon: ClipboardCheck, n: d.inspections.length },
    { key: "approvals", label: "Approvals & invoices", icon: Wallet, n: pending, alert: pending > 0 },
    { key: "chat", label: "Chat", icon: MessageCircle },
  ];
  const company = d.company;
  return (
    <div>
      <Title title={d.project.name} sub={[company?.name, d.project.city !== "—" ? d.project.city : "", `${d.project.progress || 0}% complete`].filter(Boolean).join(" · ")} back={() => go({ name: "sites" })} />
      {company && (company.phone || company.email) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {company.phone && <a href={`tel:${company.phone}`} className={ghost}><Phone className="w-4 h-4" /> Call {company.name}</a>}
          <button onClick={() => setRating(true)} className={ghost}>★ Rate {company.name}</button>
          {company.phone && <a href={`https://wa.me/${String(company.phone).replace(/\D/g, "").replace(/^0/, "254")}`} target="_blank" rel="noreferrer" className={ghost}><MessageCircle className="w-4 h-4" /> WhatsApp</a>}
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`shrink-0 h-9 px-3 rounded-lg text-[12.5px] inline-flex items-center gap-1.5 border ${tab === t.key ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] bg-[#11161D] text-[#C2CAD6]"}`}>
            <t.icon className="w-4 h-4" /> {t.label}{!!t.n && <span className={`text-[10px] px-1.5 rounded-full ${t.alert ? "bg-[#EF4444] text-white" : tab === t.key ? "bg-white/25" : "bg-[#222A35]"}`}>{t.n}</span>}
          </button>
        ))}
      </div>
      {tab === "progress" && (
        <>
          <StageStrip updates={d.updates} />
          <UpdateFeed updates={d.updates} renderComments={(u) => thr("update", u.id)} empty="Your contractor hasn't shared progress updates yet. Photos and videos of each stage will appear here. You can ask for them in the Chat tab." />
          {d.photos?.length > 0 && <div className="mt-5"><div className="text-[13px] font-medium mb-2">Site photos from daily logs</div><MediaGrid media={d.photos.flatMap((l: any) => [...toMedia(l.photos), ...l.videos.map((u: string) => ({ url: u, type: "video" as const }))])} max={16} /></div>}
        </>
      )}
      {tab === "logs" && (d.dailyLogs.length === 0 ? <Empty text="No daily logs shared yet. When the site team records a day's work, it shows here with photos, weather and how many people were on site." /> : (
        <div className="space-y-3">{d.dailyLogs.map((l: any) => (
          <div key={l.id} className={`${card} p-4`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-white font-medium">{new Date(l.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
              {l.weather && <span className="text-[#8A95A5]">{l.weather}</span>}
              {l.workers != null && <span className="text-[#8A95A5]">{l.workers} people on site</span>}
              {l.location && <span className="text-[#8A95A5] inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{l.location}</span>}
            </div>
            {(l.photos.length > 0 || l.videos.length > 0) && <div className="mt-3"><MediaGrid media={[...toMedia(l.photos), ...l.videos.map((u: string) => ({ url: u, type: "video" as const }))]} /></div>}
            {thr("dailylog", l.id)}
          </div>
        ))}</div>
      ))}
      {tab === "inspections" && (d.inspections.length === 0 ? <Empty text="No inspections shared yet. When your contractor or an inspector they appoint checks the work, the result and photos appear here." /> : (
        <div className="space-y-3">{d.inspections.map((i: any) => (
          <div key={i.id} className={`${card} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-[13.5px]">{i.type}</div><div className="text-[11.5px] text-[#8A95A5]">By {i.inspector} · {i.date}</div></div>
              <Badge s={i.status === "approved" || i.status === "closed" ? "active" : i.status === "rejected" || i.status === "rework_required" ? "declined" : "requested"} label={String(i.status).replace(/_/g, " ")} />
            </div>
            {i.notes && <p className="text-[12.5px] text-[#C2CAD6] mt-2 whitespace-pre-wrap">{i.notes}</p>}
            {Array.isArray(i.checklist) && i.checklist.length > 0 && (
              <ul className="mt-2 space-y-1">{i.checklist.slice(0, 20).map((c: any, k: number) => <li key={k} className="text-[12px] text-[#C2CAD6] flex gap-2"><span className={c.checked || c.done || c.passed ? "text-[#22C55E]" : "text-[#5B6675]"}>{c.checked || c.done || c.passed ? "✓" : "•"}</span>{c.label || c.item || c.text || String(c)}</li>)}</ul>
            )}
            {(i.photos.length > 0 || i.videos.length > 0) && <div className="mt-3"><MediaGrid media={[...toMedia(i.photos), ...i.videos.map((u: string) => ({ url: u, type: "video" as const }))]} /></div>}
            {thr("inspection", i.id)}
          </div>
        ))}</div>
      ))}
      {tab === "approvals" && (
        <>
          <PublicPortalView token={d.portalToken} embedded />
          {/* Change orders, selections and invoices can be discussed here too, with photos. */}
          {[...(d.changeOrders || []).map((c: any) => ({ type: "changeorder", id: c.id, label: `Change order ${c.number || ""}: ${c.title}` })),
            ...(d.selections || []).map((s: any) => ({ type: "selection", id: s.id, label: `Selection: ${s.name}${s.room ? ` (${s.room})` : ""}` }))].length > 0 && (
            <section className={`${card} p-4 mt-4`}>
              <div className="text-[13px]">Ask for a change or improvement</div>
              <p className="text-[11.5px] text-[#8A95A5]">Comment on any change order or finish, with photos, and your contractor replies here.</p>
              {[...(d.changeOrders || []).map((c: any) => ({ type: "changeorder", id: c.id, label: `Change order ${c.number || ""}: ${c.title}` })),
                ...(d.selections || []).map((s: any) => ({ type: "selection", id: s.id, label: `Selection: ${s.name}${s.room ? ` (${s.room})` : ""}` }))].map((t) => (
                <div key={t.type + t.id} className="mt-3"><div className="text-[12.5px] text-white">{t.label}</div>{thr(t.type, t.id)}</div>
              ))}
            </section>
          )}
        </>
      )}
      {rating && company && <RateDialog companyId={d.companyId} companyName={company.name} onClose={() => setRating(false)} />}
      {tab === "chat" && (
        <>
          {threads.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-2">
              <Chip on={thread === "group"} onClick={() => setThread("group")}>Whole team</Chip>
              {threads.map((t) => <Chip key={t.userId} on={thread === t.userId} onClick={() => setThread(t.userId)}>Private · {t.name}</Chip>)}
            </div>
          )}
          <p className="text-[11.5px] text-[#8A95A5] mb-2">{thread === "group" ? `Everyone on ${company?.name || "your contractor"}'s project team can read this chat.` : "A private chat: only you and this person can read it."}</p>
          <ChatThread key={thread} load={() => clientApi.siteMessages(id, thread === "group" ? undefined : thread)} send={(b, m) => clientApi.sendSiteMessage(id, b, m, thread === "group" ? undefined : thread)} mine={(m) => m.senderType === "client"} placeholder={`Message ${company?.name || "your contractor"}…`} />
        </>
      )}
    </div>
  );
}

/** Which stages have evidence so far, at a glance. */
function StageStrip({ updates }: { updates: { stage: string }[] }) {
  const seen = new Set(updates.map((u) => u.stage));
  if (!seen.size) return null;
  return (
    <div className={`${card} p-3 mb-3`}>
      <div className="text-[11.5px] text-[#8A95A5] mb-2">Stages with photo evidence</div>
      <div className="flex flex-wrap gap-1.5">{STAGES.filter((s) => s.key !== "other").map((s) => (
        <span key={s.key} className={`text-[10.5px] px-2 py-1 rounded-full border ${seen.has(s.key) ? "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#22C55E]" : "border-[#222A35] text-[#5B6675]"}`}>{seen.has(s.key) ? "✓ " : ""}{s.label}</span>
      ))}</div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center text-[12.5px] text-[#8A95A5]">{text}</div>;

// ───────────── Messages ─────────────
function MessagesView({ home, go }: { home: ClientHome; go: (v: View) => void }) {
  const threads = [
    ...home.projects.map((p) => ({ key: "p" + p.id, title: p.name, sub: p.company?.name ? `Chat with ${p.company.name}` : "Chat with your contractor", open: () => go({ name: "site", id: p.id, tab: "chat" }) })),
    ...home.reporting.map((r) => ({ key: "r" + r.id, title: r.siteName, sub: "Chat with the Buildsasa reporting team", open: () => go({ name: "report", id: r.id }) })),
  ];
  return (
    <div>
      <Title title="Messages" sub="Talk to your contractors and the Buildsasa team. Send photos and short videos in any chat." />
      {threads.length === 0 ? <Empty text="No chats yet. A chat opens for each site a contractor shares with you, and for each Buildsasa site-reporting service." /> : (
        <div className="space-y-2">{threads.map((t) => (
          <button key={t.key} onClick={t.open} className={`${card} w-full p-3 flex items-center gap-3 text-left hover:border-[#FF6B1A]/50`}>
            <span className="w-9 h-9 rounded-full bg-[#FF6B1A]/10 text-[#FF6B1A] flex items-center justify-center"><MessageCircle className="w-4 h-4" /></span>
            <div className="min-w-0 flex-1"><div className="text-[13px] truncate">{t.title}</div><div className="text-[11.5px] text-[#8A95A5] truncate">{t.sub}</div></div>
            <ChevronRight className="w-4 h-4 text-[#5B6675]" />
          </button>
        ))}</div>
      )}
    </div>
  );
}

// ───────────── Companies ─────────────
function CompaniesView({ go }: { go: (v: View) => void }) {
  const [rows, setRows] = useState<Company[] | null>(null);
  const [q, setQ] = useState("");
  const [svc, setSvc] = useState("All");
  useEffect(() => { clientApi.companies().then(setRows).catch(() => setRows([])); }, []);
  const list = (rows || []).filter((c) => (svc === "All" || c.services.includes(svc)) && (!q || `${c.name} ${c.address || ""} ${c.about || ""} ${c.services.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const used = useMemo(() => SERVICES.filter((s) => (rows || []).some((c) => c.services.includes(s))), [rows]);
  return (
    <div>
      <Title title="Companies on Buildsasa" sub="Contractors and service providers with an active Buildsasa subscription, most trusted first. Trust comes from how often they log site work, the projects they've handed over, and ratings from their clients." />
      <div className="relative mb-3"><Search className="w-4 h-4 text-[#5B6675] absolute left-3 top-1/2 -translate-y-1/2" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, place or service, e.g. fencing Kitengela" className={`${input} pl-9`} /></div>
      {used.length > 0 && <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2"><Chip on={svc === "All"} onClick={() => setSvc("All")}>All</Chip>{used.map((s) => <Chip key={s} on={svc === s} onClick={() => setSvc(s)}>{s}</Chip>)}</div>}
      {rows === null ? <div className="py-12 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading companies…</div>
        : list.length === 0 ? <Empty text={rows.length ? "No company matches that search." : "No companies are listed yet. Post your job and Buildsasa will find contractors for you."} />
        : (
          <div className="grid sm:grid-cols-2 gap-3">{list.map((c) => (
            <div key={c.id} className={`${card} p-4 flex flex-col`}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">{c.logoUrl ? <img src={c.logoUrl} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 className="w-5 h-5 text-[#8A95A5]" />}</div>
                <div className="min-w-0"><div className="text-[14px] truncate">{c.name}</div><div className="text-[11.5px] text-[#8A95A5] truncate">{c.address || "Kenya"}{c.projects ? ` · ${c.projects} project${c.projects > 1 ? "s" : ""} on Buildsasa` : ""}</div></div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2"><TrustBadge t={c.trust} detail />{c.trust?.ratingAvg != null && <span className="inline-flex items-center gap-1 text-[11px] text-[#8A95A5]"><Stars value={Math.round(c.trust.ratingAvg)} size={3} /> {c.trust.ratingAvg} ({c.trust.ratingCount})</span>}</div>
              {c.about && <p className="text-[12px] text-[#C2CAD6] mt-2 line-clamp-3">{c.about}</p>}
              {c.services.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{c.services.slice(0, 6).map((s) => <span key={s} className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#161C24] text-[#C2CAD6]">{s}</span>)}</div>}
              <div className="flex gap-2 mt-auto pt-3">
                <button onClick={() => go({ name: "jobs", company: c })} className={`${primary} flex-1`}><Briefcase className="w-4 h-4" /> Send a job</button>
                {c.phone && <a href={`tel:${c.phone}`} className={ghost} aria-label="Call"><Phone className="w-4 h-4" /></a>}
              </div>
            </div>
          ))}</div>
        )}
    </div>
  );
}

// ───────────── Jobs ─────────────
function JobsView({ home, company, reload }: { home: ClientHome; company?: Company; reload: () => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const blank = { title: "", category: SERVICES[0], location: "", budgetKES: "", deadline: "", description: "", phone: home.user.phone || "", targetWorkspaceId: company?.id || "" };
  const [f, setF] = useState(blank);
  const [media, setMedia] = useState<Media[]>([]);
  const [jobPin, setJobPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bids, setBids] = useState<{ jobId: string; rows: any[] } | null>(null);
  const [rate, setRate] = useState<{ id: string; name: string } | null>(null);
  const award = async (jobId: string, b: any) => {
    if (!window.confirm(`Award this job to ${b.companyName} for ${kes(b.amountKES)}? Other bids will be declined and ${b.companyName} gets your contact details.`)) return;
    try { await clientApi.awardBid(jobId, b.id); toast.success(`Awarded to ${b.companyName}. They'll contact you.`); reload(); setBids({ jobId, rows: await clientApi.jobBids(jobId) }); }
    catch (e: any) { toast.error(e?.message || "Couldn't award the job."); }
  };
  useEffect(() => { clientApi.companies().then(setCompanies).catch(() => {}); }, []);
  const set = (k: keyof typeof blank) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    if (!f.title.trim() || !f.description.trim()) return toast.error("Add a title and describe the work.");
    setBusy(true);
    try {
      // The pin travels with the place name so contractors can find the plot.
      const location = jobPin && f.location && !/-?\d+\.\d+, ?-?\d+\.\d+/.test(f.location) ? `${f.location} (${jobPin.lat.toFixed(5)}, ${jobPin.lng.toFixed(5)})` : f.location;
      await clientApi.postJob({ ...f, location, budgetKES: Number(f.budgetKES) || null, media });
      toast.success("Job sent. Buildsasa will review it, usually within one working day, then contractors can bid.");
      setF({ ...blank, targetWorkspaceId: "" }); setMedia([]); setJobPin(null); reload();
    } catch (e: any) { toast.error(e?.message || "Couldn't post the job."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <Title title="Post a job" sub="Anything from land clearing, fencing, a borehole, solar, CCTV, a gate or garbage collection to a full house. Buildsasa checks every job before contractors see it." />
      <section className={`${card} p-4 space-y-3`}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">What do you need done? *</span><input value={f.title} onChange={set("title")} placeholder="e.g. Chain-link fence and gate for a 1/4 acre plot" className={input} /></label>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Type of work *</span><select value={f.category} onChange={set("category")} className={input}>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <div className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Where is the site? Search, use your location, or pin it on the map</span>
            <MapPicker value={f.location} latLng={jobPin} onChange={(location) => setF((x) => ({ ...x, location }))} onLatLngChange={setJobPin} placeholder="e.g. Kitengela, Kajiado" />
          </div>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Budget in KES (optional)</span><input type="number" value={f.budgetKES} onChange={set("budgetKES")} placeholder="e.g. 350000" className={input} /></label>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Bids close on (optional)</span><input type="date" value={f.deadline} onChange={set("deadline")} className={input} /></label>
          <label className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Describe the work *</span><textarea rows={4} value={f.description} onChange={set("description")} placeholder="e.g. 4-strand barbed wire on concrete posts, about 200 m, plus a 12 ft steel gate. Plot is cleared." className={area} /></label>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Send it to</span>
            <select value={f.targetWorkspaceId} onChange={set("targetWorkspaceId")} className={input}>
              <option value="">All contractors on Buildsasa</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select>
          </label>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Your phone (only Buildsasa sees it)</span><input value={f.phone} onChange={set("phone")} placeholder="e.g. +44 7700 900123 or 0712 345 678" className={input} /></label>
        </div>
        <div><div className="text-[11.5px] text-[#8A95A5] mb-1">Photos or short videos of the site (optional)</div><MediaPicker value={media} onChange={setMedia} /></div>
        <button onClick={submit} disabled={busy} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send job for approval</button>
      </section>

      {rate && <RateDialog companyId={rate.id} companyName={rate.name} onClose={() => setRate(null)} />}
      <section>
        <div className="text-[13px] font-medium mb-2">Your jobs</div>
        {home.jobs.length === 0 ? <Empty text="Jobs you post appear here with their approval status and the bids contractors send." /> : (
          <div className="space-y-2">{home.jobs.map((j) => (
            <div key={j.id} className={`${card} p-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1"><div className="text-[13px] truncate">{j.title}</div><div className="text-[11.5px] text-[#8A95A5]">{j.category}{j.location ? ` · ${j.location}` : ""} · {new Date(j.createdAt).toLocaleDateString("en-GB")}</div></div>
                <Badge s={j.approval === "approved" ? j.status : j.approval} label={j.approval === "approved" ? (j.status === "open" ? "Live, taking bids" : j.status) : undefined} />
                {j.bidCount > 0 && <button onClick={async () => setBids({ jobId: j.id, rows: await clientApi.jobBids(j.id) })} className="text-[12px] text-[#FF6B1A]">{j.bidCount} bid{j.bidCount > 1 ? "s" : ""}</button>}
              </div>
              {bids?.jobId === j.id && (
                <div className="mt-3 divide-y divide-[#222A35] border-t border-[#222A35]">{bids.rows.map((b) => (
                  <div key={b.id} className="py-2.5 text-[12.5px]">
                    <div className="flex justify-between gap-2"><span className="text-white">{b.companyName}</span><span className="text-[#FF6B1A]">{kes(b.amountKES)}</span></div>
                    <div className="text-[11.5px] text-[#8A95A5]">{b.timelineDays ? `${b.timelineDays} days · ` : ""}{b.contactName}{b.phone ? ` · ${b.phone}` : ""}</div>
                    <div className="mt-1"><TrustBadge t={b.trust} /></div>
                    {b.message && <p className="text-[12px] text-[#C2CAD6] mt-1">{b.message}</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {b.status === "awarded" ? <><Badge s="active" label="Awarded" /><button onClick={() => setRate({ id: b.workspaceId, name: b.companyName })} className="text-[12px] text-[#FF6B1A]">★ Rate {b.companyName}</button></>
                        : b.status === "rejected" ? <Badge s="closed" label="Declined" />
                        : j.status !== "awarded" && (b.canAward
                          ? <button onClick={() => award(j.id, b)} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px]">Award job</button>
                          : <span className="text-[11px] text-[#F59E0B]">Subscription not active, can't be awarded</span>)}
                    </div>
                  </div>
                ))}<p className="text-[11px] text-[#5B6675] pt-2">You can award a job to any bidder whose Buildsasa subscription is active. Want independent eyes on the work? Ask Buildsasa for site reporting.</p></div>
              )}
            </div>
          ))}</div>
        )}
      </section>
    </div>
  );
}

// ───────────── Site reporting ─────────────
function ReportingView({ home, go, reload }: { home: ClientHome; go: (v: View) => void; reload: () => void }) {
  const [open, setOpen] = useState(!home.reporting.length);
  const blank = { siteName: "", location: "", projectCostKES: "", months: "6", projectId: "", notes: "", phone: home.user.phone || "" };
  const [f, setF] = useState(blank);
  const [stages, setStages] = useState<string[]>(["clearing", "fencing", "foundation", "walling", "roofing"]);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const cost = Number(f.projectCostKES) || 0; const months = Math.max(1, parseInt(f.months, 10) || 1);
  const fee = cost * 0.1; const monthly = Math.round(fee / months);
  const set = (k: keyof typeof blank) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    try {
      if (!agree) { setBusy(false); return toast.error("Please tick the box to agree to the 10% reporting fee."); }
      const r = await clientApi.requestReporting({ ...f, projectCostKES: cost, months, stages, agreeFee: true, lat: pin?.lat ?? null, lng: pin?.lng ?? null });
      toast.success("Request sent. Our team will call you within one working day.");
      setF(blank); setPin(null); setOpen(false); reload(); go({ name: "report", id: r.id });
    } catch (e: any) { toast.error(e?.message || "Couldn't send the request."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <Title title="Buildsasa neutral site reporting" sub="Building from abroad, or far from your site? Buildsasa visits for you and reports honestly on every stage, whoever the contractor is." />
      <section className={`${card} p-4`}>
        <div className="grid sm:grid-cols-3 gap-3 text-[12.5px]">
          <div><Eye className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">Independent eyes on site</div><div className="text-[#8A95A5]">Our reporters work for you, not the contractor. No bias, no cover-ups.</div></div>
          <div><Camera className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">Photos and videos of every stage</div><div className="text-[#8A95A5]">From beaconing and fencing to roofing, landscaping and handover, all in your account.</div></div>
          <div><Wallet className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">10% of what your building work costs, paid monthly</div><div className="text-[#8A95A5]">Spread over the months we report and paid directly to Buildsasa after we call you (M-Pesa, bank or international transfer). Transport and lunch for each visit are paid separately.</div></div>
        </div>
      </section>

      {home.reporting.length > 0 && <section className="space-y-2">{home.reporting.map((r) => <ReportingRow key={r.id} r={r} onClick={() => go({ name: "report", id: r.id })} />)}</section>}

      {!open ? <button onClick={() => setOpen(true)} className={primary}><ShieldCheck className="w-4 h-4" /> Request reporting for another site</button> : (
        <section className={`${card} p-4 space-y-3`}>
          <div className="text-[14px] font-display">Request site reporting</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Name of the site *</span><input value={f.siteName} onChange={set("siteName")} placeholder="e.g. My plot in Juja Farm" className={input} /></label>
            <div className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Where is it? * Search, use your location, or pin the plot on the map</span>
              <MapPicker value={f.location} latLng={pin} onChange={(location) => setF((x) => ({ ...x, location }))} onLatLngChange={setPin} placeholder="e.g. Juja Farm, Kiambu" />
            </div>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">What will the whole construction cost? (KES) *</span><span className="block text-[10.5px] text-[#5B6675]">The total you expect to pay your contractor for the work, e.g. building the house. This is not what you pay Buildsasa; our fee is 10% of this.</span><input type="number" value={f.projectCostKES} onChange={set("projectCostKES")} placeholder="e.g. 4500000" className={input} /></label>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">How many months should we report? *</span><input type="number" min={1} max={60} value={f.months} onChange={set("months")} placeholder="e.g. 6" className={input} /></label>
            {home.projects.length > 0 && (
              <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Is it one of your shared sites?</span>
                <select value={f.projectId} onChange={set("projectId")} className={input}><option value="">No, a different site</option>{home.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Phone or WhatsApp</span><input value={f.phone} onChange={set("phone")} placeholder="e.g. +1 202 555 0143" className={input} /></label>
          </div>
          <div>
            <div className="text-[11.5px] text-[#8A95A5] mb-1.5">Which stages should we watch?</div>
            <div className="flex flex-wrap gap-1.5">{STAGES.filter((s) => s.key !== "other").map((s) => <Chip key={s.key} on={stages.includes(s.key)} onClick={() => setStages((x) => x.includes(s.key) ? x.filter((k) => k !== s.key) : [...x, s.key])}>{s.label}</Chip>)}</div>
          </div>
          <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Anything we should know?</span><textarea rows={3} value={f.notes} onChange={set("notes")} placeholder="e.g. The contractor says the foundation is done but I haven't seen photos. Please check the beacons too." className={area} /></label>
          {cost > 0 && (
            <div className="rounded-lg border border-[#FF6B1A]/30 bg-[#FF6B1A]/5 p-3 text-[12.5px]">
              <div className="flex justify-between"><span className="text-[#8A95A5]">Buildsasa reporting fee (10% of your {kes(cost)} construction cost)</span><span>{kes(fee)}</span></div>
              <div className="flex justify-between mt-1"><span className="text-[#8A95A5]">You pay Buildsasa monthly over {months} month{months > 1 ? "s" : ""}</span><span className="text-[#FF6B1A] font-medium">{kes(monthly)} / month</span></div>
              <div className="text-[11px] text-[#8A95A5] mt-2">Plus transport and lunch for the reporter on each visit day, agreed with our team before the first visit. Nothing is paid in the app: our team calls you first and agrees how you'll pay.</div>
            </div>
          )}
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-[#222A35] p-3">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#FF6B1A]" />
            <span className="text-[12.5px] text-[#C2CAD6]">I want the Buildsasa team to visit and share my site's progress with me, and I agree to pay Buildsasa a fee of <b className="text-white">10% of my total construction cost</b>{cost > 0 ? <> ({kes(fee)}, about <b className="text-white">{kes(monthly)} a month</b>)</> : null}, paid monthly, plus transport and lunch for each visit.</span>
          </label>
          <p className="text-[11.5px] text-[#8A95A5]">Not now? That's fine. You can keep following your site through your contractor's Buildsasa account at no cost to you: progress updates, daily logs, inspections and chat all stay in <b>My sites</b>.</p>
          <div className="flex gap-2"><button onClick={submit} disabled={busy || !agree} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send request</button>{home.reporting.length > 0 && <button onClick={() => setOpen(false)} className={ghost}>Cancel</button>}</div>
        </section>
      )}
    </div>
  );
}

function ReportView({ id, go, reload }: { id: string; go: (v: View) => void; reload: () => void }) {
  const [r, setR] = useState<any>(null);
  const [tab, setTab] = useState("reports");
  useEffect(() => { clientApi.reporting(id).then(setR).catch((e) => toast.error(e?.message || "Couldn't open this service.")); }, [id]);
  if (!r) return <div className="py-20 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>;
  const left = Math.max(0, r.months - r.paidMonths);
  return (
    <div>
      <Title title={r.siteName} sub={`${r.location} · Buildsasa site reporting`} back={() => { reload(); go({ name: "reporting" }); }} />
      <section className={`${card} p-4 mb-4`}>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <Badge s={r.status} />
          <div className="text-[12px] text-[#8A95A5]">{r.paidMonths} of {r.months} months paid · {kes(r.monthlyFeeKES)} / month</div>
        </div>
        {r.lat != null && r.lng != null && <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[#FF6B1A] mt-2"><MapPin className="w-3.5 h-3.5" /> Open the site on the map</a>}
        {r.inspectorName && <div className="text-[12.5px] mt-2">Your site reporter: <span className="text-white">{r.inspectorName}</span></div>}
        {r.adminNote && <p className="text-[12.5px] text-[#C2CAD6] mt-2 whitespace-pre-wrap">{r.adminNote}</p>}
        {r.status === "requested" && <p className="text-[12.5px] text-[#8A95A5] mt-2">Thank you. Our team will call you to confirm the site, the visit schedule and transport, and agree how you'll pay. Nothing is paid in the app.</p>}
        {r.status === "approved" && <p className="text-[12.5px] text-[#C2CAD6] mt-2">Approved. Our team will contact you on {r.clientPhone || "your phone"} or by email with how to pay the first month ({kes(r.monthlyFeeKES)}). Visits start once it's received, and every payment shows under Payments.</p>}
        {["active", "paused"].includes(r.status) && left > 0 && <p className="text-[12px] text-[#8A95A5] mt-2">{left} month{left > 1 ? "s" : ""} left to pay ({kes(r.monthlyFeeKES)} each). Our team will remind you; pay the way you agreed with them.</p>}
        <div className="text-[11px] text-[#5B6675] mt-2">Transport and lunch for each visit are paid separately, as agreed with our team.</div>
      </section>
      <div className="flex gap-1.5 mb-4">
        <Chip on={tab === "reports"} onClick={() => setTab("reports")}>Reports · {r.updates.length}</Chip>
        <Chip on={tab === "chat"} onClick={() => setTab("chat")}>Chat with Buildsasa</Chip>
        <Chip on={tab === "payments"} onClick={() => setTab("payments")}>Payments · {r.payments.length}</Chip>
      </div>
      {tab === "reports" && <><StageStrip updates={r.updates} /><UpdateFeed updates={r.updates} empty="Reports from each site visit, with photos and videos, will appear here once the service starts." /></>}
      {tab === "chat" && <ChatThread load={() => clientApi.reportingMessages(id)} send={(b, m) => clientApi.sendReportingMessage(id, b, m)} mine={(m) => m.senderType === "client"} placeholder="Ask the Buildsasa team anything about your site…" />}
      {tab === "payments" && (r.payments.length === 0 ? <Empty text="No payments yet." /> : (
        <div className={`${card} divide-y divide-[#222A35]`}>{r.payments.map((p: any) => (
          <div key={p.id} className="p-3 flex justify-between text-[12.5px]"><span>{p.months} month{p.months > 1 ? "s" : ""} · {p.method} · {p.paidAt ? when(p.paidAt) : ""}</span><span className="text-[#22C55E]">{kes(p.amountKES)}</span></div>
        ))}</div>
      ))}
    </div>
  );
}

// ───────────── Quotes & proposals ─────────────
function QuotesView() {
  const [rows, setRows] = useState<ClientQuote[] | null>(null);
  const [open, setOpen] = useState<ClientQuote | null>(null);
  const load = () => clientApi.quotes().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (open) {
    return (
      <div>
        <Title title={`${open.quoteNumber}: ${open.title}`} sub={`From ${open.company}`} back={() => { setOpen(null); load(); }} />
        <PublicQuoteView token={open.token} embedded />
        <section className={`${card} p-4 mt-4`}>
          <div className="text-[13px]">Questions or changes?</div>
          <p className="text-[11.5px] text-[#8A95A5]">Ask {open.company} to change anything before you accept, with photos if it helps. They reply here.</p>
          <CommentThread mineType="client" comments={open.comments} prompt="e.g. Can you price ceramic tiles instead of porcelain in the bathrooms?"
            onSend={async (b, m) => { const c = await clientApi.commentOnQuote(open.id, b, m); setOpen({ ...open, comments: [...open.comments, c] }); }} />
        </section>
      </div>
    );
  }
  return (
    <div>
      <Title title="Quotes & proposals" sub="Quotes companies have sent to your email. Read, ask for changes, then accept or decline." />
      {rows === null ? <div className="py-12 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading…</div>
        : rows.length === 0 ? <Empty text="No quotes yet. When a contractor sends a quote to your email address, it appears here." />
        : <div className="space-y-2">{rows.map((q) => (
          <button key={q.id} onClick={() => setOpen(q)} className={`${card} w-full p-3 flex items-center gap-3 text-left hover:border-[#FF6B1A]/50`}>
            <FileSignature className="w-5 h-5 text-[#FF6B1A] shrink-0" />
            <div className="min-w-0 flex-1"><div className="text-[13px] truncate">{q.quoteNumber} · {q.title}</div><div className="text-[11.5px] text-[#8A95A5] truncate">{q.company} · {kes(q.total)}{q.validUntil ? ` · valid until ${q.validUntil}` : ""}{q.comments.length ? ` · ${q.comments.length} comment${q.comments.length > 1 ? "s" : ""}` : ""}</div></div>
            <Badge s={q.status === "accepted" ? "active" : q.status === "declined" ? "declined" : "requested"} label={q.status === "sent" ? "Waiting for you" : q.status} />
          </button>
        ))}</div>}
    </div>
  );
}

// ───────────── Account ─────────────
function AccountView({ home, reload, onSignOut }: { home: ClientHome; reload: () => void; onSignOut: () => void }) {
  const [f, setF] = useState({ name: home.user.name, phone: home.user.phone || "", country: home.user.country || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await clientApi.updateMe(f); toast.success("Saved"); reload(); } catch (e: any) { toast.error(e?.message || "Couldn't save."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 max-w-lg">
      <Title title="Account" sub={home.user.email} />
      <div className={`${card} p-4 space-y-3`}>
        <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Full name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mary Wanjiru" className={input} /></label>
        <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Phone or WhatsApp</span><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="e.g. +971 50 123 4567" className={input} /></label>
        <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Country you live in</span><input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="e.g. United Kingdom" className={input} /></label>
        <button onClick={save} disabled={busy} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
      </div>
      <div className="lg:hidden grid grid-cols-2 gap-2">
        {/* Phone users reach the rest of the menu from here. */}
        <a href="#companies" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent("client-go", { detail: "companies" })); }} className={ghost}><Users className="w-4 h-4" /> Companies</a>
        <a href="#jobs" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent("client-go", { detail: "jobs" })); }} className={ghost}><Briefcase className="w-4 h-4" /> Post a job</a>
        <a href="#quotes" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent("client-go", { detail: "quotes" })); }} className={`${ghost} col-span-2`}><FileSignature className="w-4 h-4" /> Quotes & proposals</a>
      </div>
      <button onClick={onSignOut} className={ghost}><LogOut className="w-4 h-4" /> Sign out</button>
    </div>
  );
}
