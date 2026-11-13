// Indicative construction cost rates for Kenya, for Buildsasa AI. The same
// numbers as the console's Cost estimate (src/app/components/constructai/costEstimate.ts)
// and the buildsasa.com calculator: change all three together. KES, October 2026.

const COST_RATES_TEXT = `BUILDING COST RATES (Buildsasa's indicative Kenyan rates, reviewed October 2026; use them for "how much to build" questions):
- Base building cost per m² of built-up area (all floors): Basic finish KES 50,000-65,000 (typical 57,500); Standard KES 65,000-90,000 (typical 75,000); Premium KES 90,000-120,000 (typical 105,000).
- Multiply by building type: residential house 1.00, rental units 0.95, apartment block 1.08, commercial 1.12, office 1.15, warehouse 0.70.
- Multiply by region: Nairobi 1.10, Central 1.00, Coast 1.05, Rift Valley 0.97, Western 0.95, Nyanza 0.95, Eastern 0.96, North Eastern 1.15.
- Multiply by site: normal 1.00, sloped 1.08, difficult access 1.12. Extra floors: +3% per storey above ground (max +30%).
- Then add professional fees 12% and approvals/permits 2.5% of the building cost, and a contingency of 5-15% (10% is usual) on the total.
- Typical built-up area if only bedrooms are given: 1 bed 50 m², 2 bed 80 m², 3 bed 120 m², 4 bed 180 m², 5 bed 250 m².
- Split of the building cost by stage: substructure 15%, superstructure 30%, roofing 12%, doors/windows/joinery 10%, finishes 15%, plumbing & electrical 12%, external works 6%.
HOW TO ANSWER A COST QUESTION: state your assumptions in one line (size, finish, region), give the likely total and a low-high range, a short table by stage plus fees, permits and contingency, and say it is indicative. Then offer the next step: a detailed quote from their own rates (save:quote with a priced table) and the Cost estimate page [[open:cost-estimate]]. If THEIR PAST RATES differ, say so and prefer theirs for the quote.`;

module.exports = { COST_RATES_TEXT };
