import { useEffect, useRef, useState } from "react";
import { MapPin, Type, X } from "lucide-react";

type Mode = "map" | "text" | "none";

// Google Maps is OPTIONAL. Until a key is set, location is entered manually and
// no map UI (or error) is shown. Add REACT_APP_GOOGLE_MAPS_API_KEY to the
// frontend .env later to re-enable the "Pick on map" option automatically.
const GOOGLE_MAPS_KEY = (() => {
  const k = import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY || "";
  return k && k !== "your-google-maps-api-key-here" ? k : "";
})();

function loadGoogleMaps(apiKey: string): Promise<void> {
  if ((window as any).google?.maps) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
}

export function MapPicker({
  value,
  latLng,
  onChange,
  onLatLngChange,
}: {
  value: string;
  latLng?: { lat: number; lng: number } | null;
  onChange: (address: string) => void;
  onLatLngChange: (latLng: { lat: number; lng: number } | null) => void;
}) {
  const hasMaps = !!GOOGLE_MAPS_KEY;
  const mapRef = useRef<HTMLDivElement>(null);
  // Default to manual text entry — works with or without a maps key.
  const [mode, setMode] = useState<Mode>("text");
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState("");
  const markerRef = useRef<any>(null);

  useEffect(() => {
    if (mode !== "map" || !mapRef.current || !hasMaps) return;
    let cancelled = false;
    loadGoogleMaps(GOOGLE_MAPS_KEY)
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const google = (window as any).google;
        const center = latLng || { lat: -1.2921, lng: 36.8219 };
        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: latLng ? 16 : 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        const marker = new google.maps.Marker({ position: center, map, draggable: true });
        markerRef.current = marker;

        const updateAddress = (lat: number, lng: number) => {
          onLatLngChange({ lat, lng });
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: { lat, lng } }, (results: any, status: any) => {
            if (status === "OK" && results?.[0]) onChange(results[0].formatted_address);
          });
        };

        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) updateAddress(pos.lat(), pos.lng());
        });
        map.addListener("click", (e: any) => {
          marker.setPosition(e.latLng);
          updateAddress(e.latLng.lat(), e.latLng.lng());
        });

        setMapReady(true);
      })
      .catch(() => setError("Could not load Google Maps"));

    return () => { cancelled = true; };
  }, [mode, hasMaps]);

  if (mode === "none") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {hasMaps && <button type="button" onClick={() => setMode("map")} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Pick on map</button>}
          <button type="button" onClick={() => setMode("text")} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Type location</button>
        </div>
        <div className="text-[11px] text-[#5B6675]">No location set</div>
      </div>
    );
  }

  if (mode === "text") {
    return (
      <div className="space-y-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Mombasa Road, Nairobi, Kenya"
          className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
        />
        <div className="flex items-center gap-2">
          {hasMaps && <button type="button" onClick={() => setMode("map")} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Pick on map</button>}
          {value && <button type="button" onClick={() => { onChange(""); onLatLngChange(null); }} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Clear</button>}
        </div>
      </div>
    );
  }

  // map mode (only reachable when a key is configured)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMode("text")} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Type location</button>
        <button type="button" onClick={() => { setMode("none"); onChange(""); onLatLngChange(null); }} className="h-8 px-3 rounded-md text-[11px] border border-[#222A35] text-[#EF4444] hover:text-white flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> No location</button>
      </div>
      {error ? (
        <div className="text-[11px] text-[#EF4444]">{error}</div>
      ) : (
        <>
          <div ref={mapRef} className="w-full h-48 rounded-lg border border-[#222A35] bg-[#0A0E14]" />
          {!mapReady && <div className="text-[11px] text-[#5B6675]">Loading map…</div>}
          {value && <div className="text-[11px] text-[#8A95A5] flex items-center gap-1"><MapPin className="w-3 h-3" /> {value}</div>}
        </>
      )}
    </div>
  );
}

export default MapPicker;
