// The client side of Buildsasa: homeowners, landowners and investors (often
// abroad) following their sites. Everything a contractor, an inspector they
// assigned, or Buildsasa's own site reporters share arrives here, and the
// client handles approvals, invoices, jobs and chats from one place.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Bell, Briefcase, ChevronDown, FileSignature, Building2, CalendarDays, Camera, ChevronRight, ClipboardCheck, Eye, Home, Loader2,
  LogOut, MapPin, MessageCircle, Moon, Phone, Search, ShieldCheck, Sun, User, Users, Wallet,
} from "lucide-react";
import { ChatThread, Chip, CommentThread, MediaGrid, MediaPicker, UpdateFeed } from "./ClientParts";
import { PublicQuoteView } from "../PublicQuoteView";
import { PublicPortalView } from "../PublicPortalView";
import { RateDialog, Stars, TrustBadge } from "./Trust";
import { MapPicker } from "../MapPicker";
import { useWelcome, WelcomeModal } from "../Welcome";
import { clientApi, kes, SERVICES, STAGES, stageLabel, toMedia, when, type ClientComment, type ClientHome, type ProjectRequestRow, type ClientQuote, type Company, type Media, type Reporting } from "./clientData";

type View = { name: "home" } | { name: "sites" } | { name: "site"; id: string; tab?: string } | { name: "messages" } | { name: "request" }
  | { name: "reporting" } | { name: "report"; id: string } | { name: "account" } | { name: "quotes" };

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
  // Arrived from an invite or update email: open that site.
  useEffect(() => {
    if (!home) return;
    const q = new URLSearchParams(window.location.search);
    const pid = q.get("project");
    if (q.get("as") || pid) window.history.replaceState({}, "", window.location.pathname);
    if (pid && home.projects.some((p) => p.id === pid)) setView({ name: "site", id: pid });
    else if (pid) toast.error("That project isn't in your account yet. Check you signed in with the email it was shared to.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!home]);
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
    { key: "request", label: "Request a project", icon: Briefcase },
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
              {view.name === "sites" && <SitesView home={home} go={go} reload={reload} />}
              {view.name === "site" && <SiteView id={view.id} initialTab={view.tab} go={go} />}
              {view.name === "messages" && <MessagesView home={home} go={go} />}
              {view.name === "request" && <RequestView home={home} />}
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
            <Action icon={Briefcase} title="Request a project" text="Fencing, a borehole, a house… Buildsasa finds qualified contractors for you." onClick={() => go({ name: "request" })} />
            <Action icon={MessageCircle} title="Talk to Buildsasa" text="Questions about building in Kenya? Our team helps." onClick={() => window.open("https://wa.me/254782223749", "_blank")} />
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
            <Action icon={Briefcase} title="Request a project" text="Need fencing, solar, CCTV or a gate? We find qualified contractors." onClick={() => go({ name: "request" })} />
            <Action icon={MessageCircle} title="Talk to Buildsasa" text="Questions about your site? Our team helps." onClick={() => window.open("https://wa.me/254782223749", "_blank")} />
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
const waLink = (phone?: string | null) => (phone ? `https://wa.me/${String(phone).replace(/\D/g, "").replace(/^0/, "254")}` : null);

function SitesView({ home, go, reload }: { home: ClientHome; go: (v: View) => void; reload: () => void }) {
  const [rate, setRate] = useState<{ id: string; name: string } | null>(null);
  const leave = async (id: string, name: string) => {
    if (!window.confirm(`Stop following ${name}? It disappears from your account. The contractor can invite you again any time.`)) return;
    try { await clientApi.leaveProject(id); toast.success("Removed from your sites."); reload(); } catch (e: any) { toast.error(e?.message || "Couldn't remove it."); }
  };
  if (!home.projects.length) {
    return (
      <div>
        <Title title="My sites" sub="Projects your contractors share with you." />
        <div className={`${card} p-6 text-center`}>
          <Building2 className="w-8 h-8 text-[#2C3744] mx-auto" />
          <div className="text-[14px] mt-2">Nothing here yet</div>
          <p className="text-[12.5px] text-[#8A95A5] mt-1 max-w-md mx-auto">Ask your contractor to invite <b className="text-white">{home.user.email}</b> from their Buildsasa project. Need a contractor? Send us a project request and we'll find qualified ones for you.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <button className={primary} onClick={() => go({ name: "request" })}><Briefcase className="w-4 h-4" /> Request a project</button>
            <button className={ghost} onClick={() => go({ name: "reporting" })}>Buildsasa site reporting</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Title title="My sites" sub="Projects your contractors share with you." />
      {rate && <RateDialog companyId={rate.id} companyName={rate.name} onClose={() => setRate(null)} />}

      <section>
        <div className="text-[13px] font-medium mb-2">Projects shared with you{home.projects.length ? ` · ${home.projects.length}` : ""}</div>
        {home.projects.length === 0 ? <Empty text={`No projects shared yet. Ask your contractor to invite ${home.user.email} from their project's Client tab.`} /> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{home.projects.map((p) => (
            <div key={p.id} className="flex flex-col">
              <SiteCard p={p} onClick={() => go({ name: "site", id: p.id })} />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <button onClick={() => go({ name: "site", id: p.id })} className={`${primary} h-9 px-3 text-[12px] flex-1`}>Open</button>
                <button onClick={() => go({ name: "site", id: p.id, tab: "chat" })} className={`${ghost} h-9 px-3 text-[12px]`} title="Chat with the team"><MessageCircle className="w-4 h-4" /></button>
                {p.company?.phone && <a href={`tel:${p.company.phone}`} className={`${ghost} h-9 px-3 text-[12px]`} title={`Call ${p.company.name}`}><Phone className="w-4 h-4" /></a>}
                <button onClick={() => leave(p.id, p.name)} className={`${ghost} h-9 px-3 text-[12px] hover:text-[#EF4444]`} title="Stop following this project">Remove</button>
              </div>
            </div>
          ))}</div>
        )}
      </section>

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
      {d.companyActive === false && (
        <div className="rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3 mb-4 text-[12.5px] text-[#C2CAD6]">
          <b className="text-[#F59E0B]">{company?.name || "Your contractor"}'s Buildsasa account is paused.</b> Everything already shared stays here for you, and your messages are saved, but they may not see or answer them, or post new updates, until their account is active again. You can call them directly, or ask Buildsasa to report on your site in the meantime.
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
              <div><div className="text-[13.5px]">{i.type} inspection</div><div className="text-[11.5px] text-[#8A95A5]">By {i.inspector} · {(() => { const d = new Date(i.date); return isNaN(+d) ? i.date : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); })()}</div></div>
              <Badge s={i.status === "approved" || i.status === "closed" ? "active" : i.status === "rejected" || i.status === "rework_required" ? "declined" : "requested"} label={(() => { const t = String(i.status).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); })()} />
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

// ───────────── Request a project ─────────────
// The client describes the work; the Buildsasa team finds qualified contractors.
// No marketplace: clients don't browse companies or receive bids here.
const PROJECT_TYPES = ["New house / bungalow", "Maisonette or villa", "Apartments / flats", "Commercial building", "Renovation / remodeling", "Kitchen or bathroom remodel", "Interior design & finishes", "Fencing & gates", "Borehole / water works", "Solar / electrical installation", "CCTV & security", "Landscaping & gardening", "Roads, drainage or civil works", "Land clearing & surveying", "Other"];
const BUDGETS = ["Below KES 1M", "KES 1M – 5M", "KES 5M – 20M", "KES 20M – 50M", "Above KES 50M", "Not sure yet"];
const TIMELINES = ["As soon as possible", "Within 3 months", "In 3 – 6 months", "In 6 – 12 months", "Just planning for now"];
const REQ_STATUS: Record<string, [string, string]> = {
  new: ["requested", "Received"], reviewing: ["approved", "Our team is reviewing it"], matched: ["active", "Contractors found"], closed: ["closed", "Closed"],
};

function RequestView({ home }: { home: ClientHome }) {
  const [rows, setRows] = useState<ProjectRequestRow[] | null>(null);
  const [tab, setTab] = useState<"mine" | "new">("new");
  const blank = { projectType: "", location: "", budget: "", timeline: "", description: "", phone: home.user.phone || "" };
  const [f, setF] = useState(blank);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => clientApi.projectRequests().then((r) => { setRows(r); if (r.length) setTab((t) => (t === "new" && !busy ? "mine" : t)); }).catch(() => setRows([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  const set = (k: keyof typeof blank) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    if (!f.projectType || !f.location.trim() || f.description.trim().length < 20) return toast.error("Choose the type of project, add where it is, and describe the work in a sentence or two.");
    setBusy(true);
    try {
      const location = pin && !/-?\d+\.\d+, ?-?\d+\.\d+/.test(f.location) ? `${f.location} (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})` : f.location;
      await clientApi.requestProject({ ...f, location });
      toast.success("Request sent. Our team will call you within one working day.");
      setF(blank); setPin(null); setTab("mine"); load();
    } catch (e: any) { toast.error(e?.message || "Couldn't send the request."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Title title="Request a project" sub="Tell us what you want done. The Buildsasa team finds qualified, vetted contractors for you, anywhere in Kenya." />
      <div className="flex gap-1.5">
        <button onClick={() => setTab("new")} className={`h-10 px-4 rounded-lg text-[13px] border ${tab === "new" ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] bg-[#11161D] text-[#C2CAD6]"}`}>+ New request</button>
        <button onClick={() => setTab("mine")} className={`h-10 px-4 rounded-lg text-[13px] border inline-flex items-center gap-1.5 ${tab === "mine" ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] bg-[#11161D] text-[#C2CAD6]"}`}>My requests{rows?.length ? <span className={`text-[10.5px] px-1.5 rounded-full ${tab === "mine" ? "bg-white/25" : "bg-[#222A35]"}`}>{rows.length}</span> : null}</button>
      </div>

      {tab === "new" && (
        <section className={`${card} p-4 space-y-3`}>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">What do you want done? *</span>
              <select value={f.projectType} onChange={set("projectType")} className={input}><option value="">Choose the type of project…</option>{PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <div className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Where is the site? * Search, use your location, or pin it on the map</span>
              <MapPicker value={f.location} latLng={pin} onChange={(location) => setF((x) => ({ ...x, location }))} onLatLngChange={setPin} placeholder="e.g. Kitengela, Kajiado" />
            </div>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Budget</span><select value={f.budget} onChange={set("budget")} className={input}><option value="">Select a range…</option>{BUDGETS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">When do you want to start?</span><select value={f.timeline} onChange={set("timeline")} className={input}><option value="">Select…</option>{TIMELINES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Describe the work *</span><textarea rows={4} value={f.description} onChange={set("description")} placeholder="e.g. A 4-bedroom maisonette on a 50×100 plot. I have approved drawings and need a contractor for the full build." className={area} /></label>
            <label className="block sm:col-span-2"><span className="text-[11.5px] text-[#8A95A5]">Phone or WhatsApp, so we can call you *</span><input value={f.phone} onChange={set("phone")} placeholder="e.g. +44 7700 900123 or 0712 345 678" className={input} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={submit} disabled={busy} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send request</button>
            <span className="text-[11.5px] text-[#8A95A5]">Free, with no obligation. We call you within one working day.</span>
          </div>
        </section>
      )}

      {tab === "mine" && (rows === null ? <div className="py-10 text-center text-[13px] text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</div>
        : rows.length === 0 ? <Empty text="No requests yet. Send one and our team will find contractors for you." />
        : <div className="space-y-2">{rows.map((r) => {
            const [tone, label] = REQ_STATUS[r.status] || REQ_STATUS.new;
            return (
              <div key={r.id} className={`${card} p-4`}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="text-[14px]">{r.projectType}</div><div className="text-[11.5px] text-[#8A95A5]">{r.location} · sent {new Date(r.createdAt).toLocaleDateString("en-GB")}{r.budget ? ` · ${r.budget}` : ""}</div></div>
                  <Badge s={tone} label={label} />
                </div>
                <p className="text-[12px] text-[#C2CAD6] mt-2 line-clamp-2">{r.description}</p>
                <p className="text-[11.5px] text-[#8A95A5] mt-2">{r.status === "matched" ? "Our team will introduce you to the contractors. Once you choose one, they can invite you to the project here." : r.status === "reviewing" ? "Our team is looking at your project and will call you." : r.status === "closed" ? "This request is closed." : "Received. Our team will call you within one working day."}</p>
              </div>
            );
          })}</div>)}
    </div>
  );
}

// ───────────── Site reporting ─────────────
// Module scope on purpose: a component declared inside another is a new type on
// every render, so React remounts it and the input being typed in loses focus.
const Step = ({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) => (
  <section className={`${card} p-4`}>
    <div className="flex items-start gap-3">
      <span className="w-7 h-7 rounded-full bg-[#FF6B1A] text-white text-[12.5px] font-semibold flex items-center justify-center shrink-0">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-white">{title}</div>
        {hint && <div className="text-[11.5px] text-[#8A95A5] mt-0.5">{hint}</div>}
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>
  </section>
);

// Site reporting in three tabs: the services you have, a request in four short
// steps, and how the service and the fee work.
function ReportingView({ home, go, reload }: { home: ClientHome; go: (v: View) => void; reload: () => void }) {
  const [tab, setTab] = useState<"mine" | "request" | "how">(home.reporting.length ? "mine" : "how");
  const blank = { siteName: "", location: "", projectCostKES: "", months: "6", projectId: "", notes: "", phone: home.user.phone || "" };
  const [f, setF] = useState(blank);
  const [stages, setStages] = useState<string[]>(["clearing", "fencing", "foundation", "walling", "roofing"]);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const cost = Number(f.projectCostKES) || 0; const months = Math.max(1, parseInt(f.months, 10) || 1);
  const fee = cost * 0.1; const monthly = Math.round(fee / months);
  const set = (k: keyof typeof blank) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  // Picking one of your shared sites fills in its name and place.
  const pickProject = (id: string) => {
    const p = home.projects.find((x) => x.id === id);
    setF((x) => ({ ...x, projectId: id, ...(p ? { siteName: x.siteName || p.name, location: x.location || (p.city !== "—" ? p.city : "") } : {}) }));
  };
  const ready = f.siteName.trim() && f.location.trim() && cost >= 10000 && agree;
  const submit = async () => {
    if (!f.siteName.trim() || !f.location.trim()) return toast.error("Add the site's name and where it is (step 1).");
    if (cost < 10000) return toast.error("Enter what the whole construction will cost (step 3).");
    if (!agree) return toast.error("Tick the box to agree to the 10% reporting fee (step 4).");
    setBusy(true);
    try {
      const r = await clientApi.requestReporting({ ...f, projectCostKES: cost, months, stages, agreeFee: true, lat: pin?.lat ?? null, lng: pin?.lng ?? null });
      toast.success("Request sent. Our team will call you within one working day.");
      setF(blank); setPin(null); setAgree(false); reload(); go({ name: "report", id: r.id });
    } catch (e: any) { toast.error(e?.message || "Couldn't send the request."); }
    finally { setBusy(false); }
  };
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button onClick={() => setTab(k)} className={`shrink-0 h-10 px-4 rounded-lg text-[13px] border inline-flex items-center gap-1.5 ${tab === k ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] bg-[#11161D] text-[#C2CAD6]"}`}>
      {label}{n ? <span className={`text-[10.5px] px-1.5 rounded-full ${tab === k ? "bg-white/25" : "bg-[#222A35]"}`}>{n}</span> : null}
    </button>
  );
  return (
    <div className="space-y-4">
      <Title title="Site reporting" sub="Buildsasa's own reporters visit your site and report honestly on every stage, whoever the contractor is." />
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabBtn("mine", "My services", home.reporting.length)}
        {tabBtn("request", "+ Request")}
        {tabBtn("how", "How it works")}
      </div>

      {tab === "mine" && (home.reporting.length === 0 ? (
        <div className={`${card} p-6 text-center`}>
          <ShieldCheck className="w-8 h-8 text-[#2C3744] mx-auto" />
          <div className="text-[14px] mt-2">No site reporting yet</div>
          <p className="text-[12.5px] text-[#8A95A5] mt-1 max-w-md mx-auto">Ask Buildsasa to visit your site and send you honest photo and video reports of every stage.</p>
          <div className="flex justify-center gap-2 mt-4"><button onClick={() => setTab("request")} className={primary}>Request reporting</button><button onClick={() => setTab("how")} className={ghost}>How it works</button></div>
        </div>
      ) : (
        <div className="space-y-3">{home.reporting.map((r) => {
          const next = r.status === "requested" ? "Our team will call you to confirm the site, visits and how you'll pay."
            : r.status === "approved" ? "Approved. Visits start once your first month's payment is received."
            : r.status === "active" ? `Visits under way. ${r.months - r.paidMonths > 0 ? `${r.months - r.paidMonths} month${r.months - r.paidMonths > 1 ? "s" : ""} left to pay.` : "All months paid."}`
            : r.status === "paused" ? "Paused. Message the team to restart visits." : r.status === "declined" ? "Not taken on. The team has left you a note." : "Service finished.";
          return (
            <div key={r.id} className={`${card} p-4`}>
              <div className="flex flex-wrap items-start gap-2">
                <ShieldCheck className="w-5 h-5 text-[#FF6B1A] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px]">{r.siteName}</div>
                  <div className="text-[11.5px] text-[#8A95A5]">{r.location} · {kes(r.monthlyFeeKES)} a month · {r.months} month{r.months > 1 ? "s" : ""}</div>
                </div>
                <Badge s={r.status} />
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-[#8A95A5] mb-1"><span>Months paid</span><span>{r.paidMonths} of {r.months}</span></div>
                <div className="h-1.5 rounded-full bg-[#222A35]"><div className="h-full rounded-full bg-[#22C55E]" style={{ width: `${Math.min(100, (r.paidMonths / Math.max(1, r.months)) * 100)}%` }} /></div>
              </div>
              <p className="text-[12px] text-[#C2CAD6] mt-2">{next}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <button onClick={() => go({ name: "report", id: r.id })} className={`${primary} h-9 px-3 text-[12px]`}>Open reports</button>
                <button onClick={() => go({ name: "report", id: r.id })} className={`${ghost} h-9 px-3 text-[12px]`}><MessageCircle className="w-4 h-4" /> Message Buildsasa</button>
              </div>
            </div>
          );
        })}
        <button onClick={() => setTab("request")} className={ghost}>+ Request reporting for another site</button>
        </div>
      ))}

      {tab === "request" && (
        <div className="space-y-3">
          <Step n={1} title="Your site" hint="Which plot or building should we visit?">
            {home.projects.length > 0 && (
              <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Is it one of your shared sites?</span>
                <select value={f.projectId} onChange={(e) => pickProject(e.target.value)} className={input}><option value="">No, a different site</option>{home.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Name of the site *</span><input value={f.siteName} onChange={set("siteName")} placeholder="e.g. My plot in Juja Farm" className={input} /></label>
            <div><span className="text-[11.5px] text-[#8A95A5]">Where is it? * Search, use your location, or pin the plot on the map</span>
              <MapPicker value={f.location} latLng={pin} onChange={(location) => setF((x) => ({ ...x, location }))} onLatLngChange={setPin} placeholder="e.g. Juja Farm, Kiambu" />
            </div>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Your phone or WhatsApp, so we can call you</span><input value={f.phone} onChange={set("phone")} placeholder="e.g. +1 202 555 0143" className={input} /></label>
          </Step>

          <Step n={2} title="What should we watch?" hint="Tap the stages you want reports on. You can change this with our team later.">
            <div className="flex flex-wrap gap-1.5">{STAGES.filter((st) => st.key !== "other").map((st) => <Chip key={st.key} on={stages.includes(st.key)} onClick={() => setStages((x) => x.includes(st.key) ? x.filter((k) => k !== st.key) : [...x, st.key])}>{st.label}</Chip>)}</div>
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Anything we should know? (optional)</span><textarea rows={3} value={f.notes} onChange={set("notes")} placeholder="e.g. The contractor says the foundation is done but I haven't seen photos. Please check the beacons too." className={area} /></label>
          </Step>

          <Step n={3} title="The construction cost" hint="Our fee is 10% of what the building work costs, spread over the months we report.">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-[11.5px] text-[#8A95A5]">What will the whole construction cost? (KES) *</span><input type="number" value={f.projectCostKES} onChange={set("projectCostKES")} placeholder="e.g. 4500000" className={input} /><span className="block text-[10.5px] text-[#5B6675] mt-1">What you'll pay your contractor for the work, not what you pay Buildsasa.</span></label>
              <label className="block"><span className="text-[11.5px] text-[#8A95A5]">How many months should we report? *</span><input type="number" min={1} max={60} value={f.months} onChange={set("months")} placeholder="e.g. 6" className={input} /></label>
            </div>
            <div className="rounded-lg border border-[#FF6B1A]/30 bg-[#FF6B1A]/5 p-3 text-[12.5px] space-y-1">
              <div className="flex justify-between gap-3"><span className="text-[#8A95A5]">Construction cost</span><span>{cost ? kes(cost) : "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-[#8A95A5]">Buildsasa reporting fee (10%)</span><span>{cost ? kes(fee) : "—"}</span></div>
              <div className="flex justify-between gap-3 pt-1 border-t border-[#FF6B1A]/20"><span className="text-white">You pay Buildsasa, over {months} month{months > 1 ? "s" : ""}</span><span className="text-[#FF6B1A] font-semibold">{cost ? `${kes(monthly)} / month` : "—"}</span></div>
              <div className="text-[11px] text-[#8A95A5] pt-1">Plus the reporter's transport and lunch on each visit day, agreed with our team first. Nothing is paid in the app.</div>
            </div>
          </Step>

          <Step n={4} title="Agree and send">
            <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-[#222A35] p-3">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#FF6B1A]" />
              <span className="text-[12.5px] text-[#C2CAD6]">I want the Buildsasa team to visit and share my site's progress with me, and I agree to pay Buildsasa a fee of <b className="text-white">10% of my total construction cost</b>{cost > 0 ? <> ({kes(fee)}, about <b className="text-white">{kes(monthly)} a month</b>)</> : null}, plus transport and lunch for each visit.</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={submit} disabled={busy} className={`${primary} ${ready ? "" : "opacity-70"}`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send request</button>
              <span className="text-[11.5px] text-[#8A95A5]">You pay nothing until our team has called you and approved the request.</span>
            </div>
            <p className="text-[11.5px] text-[#5B6675]">Not now? You can keep following your site through your contractor's Buildsasa account at no cost: everything they share stays in <b>My sites</b>.</p>
          </Step>
        </div>
      )}

      {tab === "how" && (
        <div className="space-y-3">
          <section className={`${card} p-4`}>
            <div className="grid sm:grid-cols-3 gap-4 text-[12.5px]">
              <div><Eye className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">Independent eyes on site</div><div className="text-[#8A95A5]">Our reporters work for you, not the contractor. No bias, no cover-ups.</div></div>
              <div><Camera className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">Photos and videos of every stage</div><div className="text-[#8A95A5]">From beaconing and fencing to roofing, landscaping and handover, in your account.</div></div>
              <div><Wallet className="w-5 h-5 text-[#FF6B1A]" /><div className="mt-1.5 text-white">10% of the construction cost</div><div className="text-[#8A95A5]">Spread monthly, paid to Buildsasa after we call you (M-Pesa, bank or international transfer), plus transport and lunch per visit.</div></div>
            </div>
          </section>
          <section className={`${card} p-4`}>
            <div className="text-[13.5px] text-white mb-2">How it works</div>
            <ol className="space-y-2 text-[12.5px] text-[#C2CAD6]">
              {["You send a request with your site and the stages to watch.", "Our team calls you within one working day to agree visits, transport and how you'll pay.", "You pay the first month directly to Buildsasa; visits start.", "After each visit, the report with photos and videos appears here, and you can message the team any time."].map((t, i) => (
                <li key={i} className="flex gap-2.5"><span className="w-5 h-5 rounded-full bg-[#161C24] text-[#FF6B1A] text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>{t}</li>
              ))}
            </ol>
            <button onClick={() => setTab("request")} className={`${primary} mt-4`}>Request reporting</button>
          </section>
        </div>
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
        <Chip on={tab === "reports"} onClick={() => setTab("reports")}>Site reports · {r.updates.length}</Chip>
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
        <a href="#request" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent("client-go", { detail: "request" })); }} className={`${ghost} col-span-2`}><Briefcase className="w-4 h-4" /> Request a project</a>
        <a href="#quotes" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent("client-go", { detail: "quotes" })); }} className={`${ghost} col-span-2`}><FileSignature className="w-4 h-4" /> Quotes & proposals</a>
      </div>
      <button onClick={onSignOut} className={ghost}><LogOut className="w-4 h-4" /> Sign out</button>
    </div>
  );
}
