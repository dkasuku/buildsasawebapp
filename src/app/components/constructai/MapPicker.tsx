import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, Map as MapIcon, MapPin, Search, X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { currentPosition, placeName, searchPlaces, type PlaceHit } from "../../services/weather";

// Location picker used by projects and daily logs. Three ways to set it, in any
// mix: search a place by name and pick from the suggestions, use the phone's
// GPS, or pin it on a map. The map is OpenStreetMap through Leaflet (no API key).
//
// Two shapes:
//  * Address (projects): the text box IS the location; picking a suggestion fills it.
//  * Site (daily logs, pass onPlaceChange): the text box is a free description such
//    as "Tower core — Level 12" and is never overwritten. The place found by search,
//    GPS or the map is kept separately in `place`.

const NAIROBI = { lat: -1.2921, lng: 36.8219 };
// Leaflet's default marker images resolve relative to its CSS, which a bundler
// breaks. A drawn pin avoids the image files altogether.
const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#FF6B1A;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});
const field = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";
const btn = "h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5 disabled:opacity-60";

export function MapPicker({
  value,
  latLng,
  onChange,
  onLatLngChange,
  placeholder = "Search a place, e.g. Westlands, Nairobi",
  place,
  onPlaceChange,
}: {
  value: string;
  latLng?: { lat: number; lng: number } | null;
  onChange: (text: string) => void;
  onLatLngChange: (latLng: { lat: number; lng: number } | null) => void;
  placeholder?: string;
  /** Site mode: the named place, kept apart from the free-text description. */
  place?: string;
  onPlaceChange?: (place: string) => void;
}) {
  const siteMode = !!onPlaceChange;
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [query, setQuery] = useState(siteMode ? (place || "") : value);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const picked = useRef(false);
  // Latest callbacks for the Leaflet handlers, which are bound once.
  const live = useRef({ onChange, onLatLngChange, onPlaceChange, siteMode });
  live.current = { onChange, onLatLngChange, onPlaceChange, siteMode };

  // Keep the search box in step with outside changes (address mode only).
  useEffect(() => { if (!siteMode) setQuery(value); }, [value]);

  // Debounced place search while typing.
  useEffect(() => {
    if (picked.current) { picked.current = false; return; }
    const q = query.trim();
    if (q.length < 3) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      setHits(await searchPlaces(q, latLng || NAIROBI));
      setSearching(false);
      setOpen(true);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  /** A place name chosen from search, GPS or the map. */
  const applyPlace = (name: string) => {
    if (live.current.siteMode) live.current.onPlaceChange?.(name);
    else live.current.onChange(name);
    picked.current = true;
    setQuery(name);
  };
  const setPoint = async (p: { lat: number; lng: number }, lookUpName: boolean) => {
    live.current.onLatLngChange(p);
    if (lookUpName) {
      const name = await placeName(p.lat, p.lng);
      if (name) applyPlace(name);
    }
  };

  const choose = (h: PlaceHit) => {
    applyPlace(h.label);
    setOpen(false);
    setHits([]);
    live.current.onLatLngChange({ lat: h.lat, lng: h.lng });
  };

  useEffect(() => {
    if (!showMap || !mapEl.current || mapRef.current) return;
    const start = latLng || NAIROBI;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], latLng ? 16 : 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const marker = L.marker([start.lat, start.lng], { draggable: true, icon: pinIcon }).addTo(map);
    marker.on("dragend", () => { const ll = marker.getLatLng(); setPoint({ lat: ll.lat, lng: ll.lng }, true); });
    map.on("click", (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }, true); });
    mapRef.current = map;
    markerRef.current = marker;
    // The map mounts inside a container that may still be animating open.
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [showMap]);

  // Keep the pin in step when the position changes from outside (search, GPS).
  useEffect(() => {
    if (latLng && markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([latLng.lat, latLng.lng]);
      mapRef.current.setView([latLng.lat, latLng.lng], Math.max(mapRef.current.getZoom(), 16));
    }
  }, [latLng?.lat, latLng?.lng]);

  const useGps = async () => {
    setLocating(true); setGpsError("");
    const p = await currentPosition();
    setLocating(false);
    if (!p) { setGpsError("Couldn't get your location. Allow location access in your browser, or search or pin it on the map."); return; }
    await setPoint(p, true);
  };

  const clearPin = () => {
    onLatLngChange(null);
    if (siteMode) { onPlaceChange?.(""); setQuery(""); }
  };

  const searchBox = (
    <div className="relative">
      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675] pointer-events-none" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); if (!siteMode) onChange(e.target.value); }}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={siteMode ? "Search the site's place, e.g. Upper Hill, Nairobi" : placeholder}
        className={`${field} pl-8 pr-8`}
        autoComplete="off"
      />
      {searching && <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />}
      {open && hits.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-[#222A35] bg-[#11161D] shadow-xl py-1">
          {hits.map((h, i) => (
            <button key={`${h.lat},${h.lng},${i}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(h)} className="w-full text-left px-3 py-2 hover:bg-[#161C24] flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-[#FF6B1A] mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="block text-[12px] text-white truncate">{h.name}</span>{h.detail && <span className="block text-[10.5px] text-[#8A95A5] truncate">{h.detail}</span>}</span>
            </button>
          ))}
        </div>
      )}
      {open && !searching && hits.length === 0 && query.trim().length >= 3 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-[#222A35] bg-[#11161D] px-3 py-2 text-[11px] text-[#8A95A5]">No matching places. Try a nearby landmark or town, or pin it on the map.</div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {siteMode && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Area on site, e.g. Tower core, Level 12" className={field} />}
      {searchBox}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={useGps} disabled={locating} className={btn}>
          {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />} Use my location
        </button>
        <button type="button" onClick={() => setShowMap((s) => !s)} className={btn}>
          <MapIcon className="w-3.5 h-3.5" /> {showMap ? "Hide map" : "Pick on map"}
        </button>
        {latLng && (
          <span className="text-[10.5px] text-[#22C55E] flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Pinned
            <button type="button" onClick={clearPin} className="text-[#5B6675] hover:text-red-400" title="Remove pin"><X className="w-3 h-3" /></button>
          </span>
        )}
      </div>
      {gpsError && <div className="text-[11px] text-[#F59E0B]">{gpsError}</div>}
      {showMap && (
        <>
          <div ref={mapEl} className="w-full h-56 rounded-lg border border-[#222A35] overflow-hidden" style={{ zIndex: 0 }} />
          <div className="text-[10.5px] text-[#5B6675]">Tap the map or drag the pin to the exact spot.</div>
        </>
      )}
    </div>
  );
}

export default MapPicker;
