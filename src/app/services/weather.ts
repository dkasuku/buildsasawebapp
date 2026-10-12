// Site weather from Open-Meteo: free, no API key, and it allows browser
// requests, so no server round trip is needed. Used to warn contractors about
// rain before they plan a pour, and to fill in the weather on a daily log.

export type DayForecast = { date: string; code: number; max: number; min: number; rainChance: number; rainMm: number; windKmh: number };
export type Forecast = { tempC: number; code: number; windKmh: number; days: DayForecast[] };

// WMO weather codes → plain words. The daily log's own options are a subset.
export function describeWeather(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code === 61 || code === 80) return "Light rain";
  if (code === 63 || code === 81) return "Rain";
  if (code === 65 || code === 82 || code === 66 || code === 67) return "Heavy rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 95) return "Thunderstorm";
  return "Cloudy";
}

/** What the daily log records, picked from today's actual conditions. */
export function logWeatherFor(f: Forecast): string {
  const d = describeWeather(f.code);
  if (d === "Thunderstorm" || d === "Heavy rain") return "Heavy rain";
  if (d === "Rain" || d === "Light rain" || d === "Drizzle") return "Light rain";
  if (f.windKmh >= 35) return "Windy";
  if (f.tempC >= 30) return "Hot";
  if (f.tempC <= 10) return "Cold";
  if (d === "Clear" || d === "Partly cloudy") return "Clear";
  return "Cloudy";
}

/** One line a site manager acts on, or null when the next days look fine. */
export function siteAdvice(days: DayForecast[]): string | null {
  const wet = days.slice(0, 3).find((d) => d.rainChance >= 60 || d.rainMm >= 5);
  if (wet) {
    const when = isToday(wet.date) ? "today" : new Date(wet.date).toLocaleDateString("en-GB", { weekday: "long" });
    return `Rain likely ${when} (${wet.rainChance}% chance). Plan concrete pours, roofing and earthworks around it.`;
  }
  const windy = days.slice(0, 3).find((d) => d.windKmh >= 40);
  if (windy) return `Strong wind expected (${Math.round(windy.windKmh)} km/h). Take care with cranes, scaffolding and work at height.`;
  const hot = days.slice(0, 3).find((d) => d.max >= 33);
  if (hot) return `Very hot (${Math.round(hot.max)}°C). Keep crews hydrated and cure concrete properly.`;
  return null;
}

const isToday = (iso: string) => iso === new Date().toISOString().slice(0, 10);

const cache = new Map<string, { at: number; data: Forecast }>();

export async function getForecast(lat: number, lng: number): Promise<Forecast> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + "&current=temperature_2m,weather_code,wind_speed_10m"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max"
    + "&timezone=auto&forecast_days=4";
  const r = await fetch(url);
  if (!r.ok) throw new Error("Weather service unavailable");
  const j = await r.json();
  const d = j.daily || {};
  const data: Forecast = {
    tempC: Math.round(j.current?.temperature_2m ?? 0),
    code: j.current?.weather_code ?? 3,
    windKmh: j.current?.wind_speed_10m ?? 0,
    days: (d.time || []).map((t: string, i: number) => ({
      date: t, code: d.weather_code?.[i] ?? 3, max: d.temperature_2m_max?.[i] ?? 0, min: d.temperature_2m_min?.[i] ?? 0,
      rainChance: d.precipitation_probability_max?.[i] ?? 0, rainMm: d.precipitation_sum?.[i] ?? 0, windKmh: d.wind_speed_10m_max?.[i] ?? 0,
    })),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** The device's position, or null if the user declines or it isn't available. */
export function currentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** A readable place name for a pin, from OpenStreetMap. Best effort. */
export async function placeName(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address || {};
    const parts = [a.road || a.neighbourhood, a.suburb || a.village || a.town, a.city || a.county].filter(Boolean);
    return parts.length ? [...new Set(parts)].join(", ") : (j.display_name || null);
  } catch { return null; }
}

export type PlaceHit = { name: string; detail: string; label: string; lat: number; lng: number };

/** Place suggestions while typing, from Photon (OpenStreetMap data, free, no
 *  key), ranked towards `near` so Kenyan places come first. */
export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<PlaceHit[]> {
  try {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`);
    if (!r.ok) return [];
    const j = await r.json();
    const seen = new Set<string>();
    return (j.features || []).map((f: any) => {
      const p = f.properties || {};
      const name = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city || "Unnamed place";
      const detail = [p.district || p.locality, p.city !== name ? p.city : "", p.county || p.state, p.country].filter(Boolean).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).join(", ");
      const [lng, lat] = f.geometry?.coordinates || [0, 0];
      return { name, detail, label: [name, detail.split(", ").slice(0, 2).join(", ")].filter(Boolean).join(", "), lat, lng };
    }).filter((h: PlaceHit) => { const k = h.label; if (seen.has(k)) return false; seen.add(k); return true; });
  } catch { return []; }
}

export type WorkVerdict = { level: "good" | "caution" | "poor"; title: string; detail: string };

/** Is today a good day to build? A plain verdict for the site team. */
export function workVerdict(f: Forecast): WorkVerdict {
  const today = f.days[0];
  const d = describeWeather(f.code);
  const rain = today ? Math.max(today.rainChance, 0) : 0;
  const mm = today?.rainMm ?? 0;
  const wind = Math.max(f.windKmh, today?.windKmh ?? 0);
  const hot = Math.max(f.tempC, today?.max ?? 0);
  if (d === "Thunderstorm" || mm >= 10 || (rain >= 80 && mm >= 5)) {
    return { level: "poor", title: "Not a good day for outdoor work", detail: "Heavy rain or storms expected. Avoid concrete pours, roofing, earthworks and work at height. Plan indoor work instead." };
  }
  if (wind >= 50) {
    return { level: "poor", title: "Too windy for lifting and work at height", detail: `Gusts around ${Math.round(wind)} km/h. Stop crane lifts and secure scaffolding and loose materials.` };
  }
  if (rain >= 50 || mm >= 3) {
    return { level: "caution", title: "Workable, but rain is likely", detail: `${rain}% chance of rain. Pour concrete early or have covers ready, and protect materials.` };
  }
  if (wind >= 35) return { level: "caution", title: "Workable, but windy", detail: `Wind around ${Math.round(wind)} km/h. Take care with cranes, scaffolding and work at height.` };
  if (hot >= 33) return { level: "caution", title: "Workable, but very hot", detail: `Up to ${Math.round(hot)}°C. Keep crews hydrated, work early, and cure concrete properly.` };
  return { level: "good", title: "Good day for construction", detail: "Dry with light wind. Suitable for concrete, roofing, earthworks and outdoor work." };
}
