import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, Map as MapIcon, MapPin, X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { currentPosition, placeName } from "../../services/weather";

// Location picker used by projects and daily logs. The location is typed by hand,
// taken from the phone's GPS, or pinned on a map — any mix of the three. The map
// is OpenStreetMap through Leaflet, which needs no API key. (The previous Google
// Maps version showed nothing at all until a key was configured, which it never
// was, so no project or log ever had coordinates.)

const NAIROBI = { lat: -1.2921, lng: 36.8219 };
// Leaflet's default marker images resolve relative to its CSS, which a bundler
// breaks. A drawn pin avoids the image files altogether.
const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#FF6B1A;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

export function MapPicker({
  value,
  latLng,
  onChange,
  onLatLngChange,
  placeholder = "e.g. Mombasa Road, Nairobi, Kenya",
}: {
  value: string;
  latLng?: { lat: number; lng: number } | null;
  onChange: (address: string) => void;
  onLatLngChange: (latLng: { lat: number; lng: number } | null) => void;
  placeholder?: string;
}) {
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Latest callbacks/values for the Leaflet handlers, which are bound once.
  const live = useRef({ value, onChange, onLatLngChange });
  live.current = { value, onChange, onLatLngChange };

  const setPoint = async (p: { lat: number; lng: number }, fillName: boolean) => {
    live.current.onLatLngChange(p);
    if (fillName) {
      const name = await placeName(p.lat, p.lng);
      if (name) live.current.onChange(name);
    }
  };

  useEffect(() => {
    if (!showMap || !mapEl.current || mapRef.current) return;
    const start = latLng || NAIROBI;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], latLng ? 16 : 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const marker = L.marker([start.lat, start.lng], { draggable: true, icon: pinIcon }).addTo(map);
    marker.on("dragend", () => { const ll = marker.getLatLng(); setPoint({ lat: ll.lat, lng: ll.lng }, !live.current.value); });
    map.on("click", (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }, !live.current.value); });
    mapRef.current = map;
    markerRef.current = marker;
    if (!latLng) setPoint(start, false);
    // The map mounts inside a container that may still be animating open.
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [showMap]);

  // Keep the pin in step when the position changes from outside (GPS button).
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
    if (!p) { setGpsError("Couldn't get your location. Allow location access, or pin it on the map."); return; }
    await setPoint(p, !value);
  };

  const btn = "h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5";
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
      />
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
            <button type="button" onClick={() => onLatLngChange(null)} className="text-[#5B6675] hover:text-red-400" title="Remove pin"><X className="w-3 h-3" /></button>
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
