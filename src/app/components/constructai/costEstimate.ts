// Indicative construction cost rates for Kenya. The same numbers as the free
// calculator on buildsasa.com (Buildsasaweb/buildsasa-next/lib/construction-cost-data.js)
// and the AI's BUILDING COST RATES (backend/src/cost-rates.js): change all three
// together. All figures are INDICATIVE, in KES, reviewed October 2026.

export const RATES_UPDATED = "October 2026";

export const FINISH_RATES = {
  basic: { label: "Basic", low: 50000, mid: 57500, high: 65000, suits: "Budget homes, simple rental units, rural builds" },
  standard: { label: "Standard", low: 65000, mid: 75000, high: 90000, suits: "Most family homes and mid-market apartments" },
  premium: { label: "Premium", low: 90000, mid: 105000, high: 120000, suits: "High-end homes and premium finishes" },
} as const;

export const BUILDING_TYPES = {
  residential: { label: "Residential house", factor: 1.0 },
  rental: { label: "Rental units", factor: 0.95 },
  apartment: { label: "Apartment block", factor: 1.08 },
  commercial: { label: "Commercial space", factor: 1.12 },
  office: { label: "Office block", factor: 1.15 },
  warehouse: { label: "Warehouse", factor: 0.7 },
} as const;

export const LOCATIONS = {
  nairobi: { label: "Nairobi", factor: 1.1 },
  central: { label: "Central Kenya", factor: 1.0 },
  coast: { label: "Coast", factor: 1.05 },
  rift: { label: "Rift Valley", factor: 0.97 },
  western: { label: "Western Kenya", factor: 0.95 },
  nyanza: { label: "Nyanza", factor: 0.95 },
  eastern: { label: "Eastern Kenya", factor: 0.96 },
  northeastern: { label: "North Eastern Kenya", factor: 1.15 },
} as const;

export const SITE_CONDITIONS = {
  normal: { label: "Normal", factor: 1.0 },
  sloped: { label: "Sloped", factor: 1.08 },
  difficult: { label: "Difficult access", factor: 1.12 },
} as const;

export const floorsFactor = (floors: number) => 1 + Math.min(0.3, Math.max(0, floors - 1) * 0.03);
export const PROFESSIONAL_FEES = 0.12;
export const PERMITS = 0.025;
export const CONTINGENCIES = [0, 0.05, 0.1, 0.15];

/** Typical share of the building cost by stage (Kenyan elemental split), for planning payments and a programme. */
export const STAGES: { stage: string; share: number }[] = [
  { stage: "Substructure (excavation, foundations, ground slab)", share: 0.15 },
  { stage: "Superstructure (walling, columns, beams, upper slabs)", share: 0.3 },
  { stage: "Roofing", share: 0.12 },
  { stage: "Doors, windows and joinery", share: 0.1 },
  { stage: "Finishes (plaster, tiles, paint, ceilings)", share: 0.15 },
  { stage: "Plumbing and electrical", share: 0.12 },
  { stage: "External works (drainage, paving, fence)", share: 0.06 },
];

export const DISCLAIMER = "Indicative only. Real costs depend on the design, structure, site, material prices, labour and approvals. Price the actual job before you commit.";

export type FinishKey = keyof typeof FINISH_RATES;
export type BuildingKey = keyof typeof BUILDING_TYPES;
export type LocationKey = keyof typeof LOCATIONS;
export type SiteKey = keyof typeof SITE_CONDITIONS;
export type CostInput = { buildingType: BuildingKey; location: LocationKey; finish: FinishKey; areaSqm: number; floors: number; site: SiteKey; fees: boolean; permits: boolean; contingency: number };

export function estimateCost(i: CostInput) {
  const r = FINISH_RATES[i.finish];
  const mult = BUILDING_TYPES[i.buildingType].factor * LOCATIONS[i.location].factor * SITE_CONDITIONS[i.site].factor * floorsFactor(i.floors);
  const total = (rate: number) => {
    const base = i.areaSqm * rate * mult;
    const fees = i.fees ? base * PROFESSIONAL_FEES : 0;
    const permits = i.permits ? base * PERMITS : 0;
    const contingency = (base + fees + permits) * i.contingency;
    return { base, fees, permits, contingency, total: base + fees + permits + contingency };
  };
  const low = total(r.low), mid = total(r.mid), high = total(r.high);
  return { low: low.total, mid: mid.total, high: high.total, perSqm: i.areaSqm ? mid.total / i.areaSqm : 0, breakdown: mid,
    stages: STAGES.map((s) => ({ ...s, amount: mid.base * s.share })) };
}
