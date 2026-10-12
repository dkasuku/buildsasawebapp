// Site weather card: today's conditions and the next three days for each active
// project that has a pinned location, with a plain warning when rain, wind or
// heat should change the day's plan. Projects without a pin fall back to the
// device's own location, so the card is useful from the first login.

import { useEffect, useState } from "react";
import { CloudRain, CloudSun, Loader2, MapPin, Sun, Cloud, CloudLightning, Wind, AlertTriangle } from "lucide-react";
import { useProjects } from "./useProjects";
import { currentPosition, describeWeather, getForecast, siteAdvice, type Forecast } from "../../services/weather";

type Site = { name: string; lat: number; lng: number; forecast?: Forecast; error?: boolean };

const icon = (code: number) => {
  const d = describeWeather(code);
  if (d === "Thunderstorm") return CloudLightning;
  if (d.includes("rain") || d === "Rain" || d === "Drizzle") return CloudRain;
  if (d === "Clear") return Sun;
  if (d === "Partly cloudy") return CloudSun;
  return Cloud;
};

export function SiteWeather({ projectId, compact }: { projectId?: string; compact?: boolean }) {
  const { projects, loading } = useProjects();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    (async () => {
      let list: Site[] = projects
        .filter((p) => (projectId ? p.id === projectId : !/complete|closed|cancel/i.test(p.status || "")))
        .filter((p) => p.lat != null && p.lng != null)
        .slice(0, compact ? 1 : 3)
        .map((p) => ({ name: p.name, lat: p.lat as number, lng: p.lng as number }));
      if (!list.length) {
        const here = await currentPosition();
        if (!here) { if (alive) setSites([]); return; }
        list = [{ name: "Your location", ...here }];
        if (alive) setFallback(true);
      }
      const done = await Promise.all(list.map(async (s) => {
        try { return { ...s, forecast: await getForecast(s.lat, s.lng) }; } catch { return { ...s, error: true }; }
      }));
      if (alive) setSites(done);
    })();
    return () => { alive = false; };
  }, [loading, projects.length, projectId]);

  if (sites === null) return <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 text-[12px] text-[#5B6675] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking site weather…</div>;
  if (!sites.length) return null;

  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#222A35] flex items-center justify-between gap-2">
        <div className="text-[12.5px] text-white font-display flex items-center gap-1.5"><CloudSun className="w-4 h-4 text-[#FF6B1A]" /> Site weather</div>
        {fallback && <div className="text-[10.5px] text-[#5B6675]">Pin your project locations to see weather per site</div>}
      </div>
      <div className={`grid ${sites.length > 1 ? "md:grid-cols-2 xl:grid-cols-3" : ""} divide-y md:divide-y-0 md:divide-x divide-[#222A35]`}>
        {sites.map((s) => {
          if (s.error || !s.forecast) return <div key={s.name} className="p-4 text-[12px] text-[#5B6675]">{s.name}: weather unavailable</div>;
          const f = s.forecast;
          const Now = icon(f.code);
          const advice = siteAdvice(f.days);
          return (
            <div key={s.name} className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Now className="w-9 h-9 text-[#FBBF24] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] text-[#8A95A5] flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{s.name}</div>
                  <div className="text-[20px] text-white font-display leading-tight">{f.tempC}°C <span className="text-[12px] text-[#C2CAD6] font-sans">{describeWeather(f.code)}</span></div>
                  <div className="text-[11px] text-[#5B6675] flex items-center gap-1"><Wind className="w-3 h-3" />{Math.round(f.windKmh)} km/h</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {f.days.slice(1, 4).map((d) => {
                  const I = icon(d.code);
                  return (
                    <div key={d.date} className="rounded-lg bg-[#0A0E14] border border-[#222A35] px-2 py-1.5 text-center">
                      <div className="text-[10px] text-[#8A95A5]">{new Date(d.date).toLocaleDateString("en-GB", { weekday: "short" })}</div>
                      <I className="w-4 h-4 mx-auto my-0.5 text-[#C2CAD6]" />
                      <div className="text-[11px] text-white">{Math.round(d.max)}° <span className="text-[#5B6675]">{Math.round(d.min)}°</span></div>
                      <div className={`text-[10px] ${d.rainChance >= 60 ? "text-[#60A5FA]" : "text-[#5B6675]"}`}>{d.rainChance}% rain</div>
                    </div>
                  );
                })}
              </div>
              {advice && <div className="text-[11.5px] text-[#FBBF24] bg-[#FBBF24]/10 border border-[#FBBF24]/25 rounded-lg px-2.5 py-2 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{advice}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
