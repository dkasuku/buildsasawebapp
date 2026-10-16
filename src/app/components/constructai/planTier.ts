// The company's plan tier, set by App from /api/billing/subscription. Starter
// leaves out the Business features below; the server refuses them too.
export type PlanTier = "starter" | "business";
export const BUSINESS_VIEWS = ["financials", "commitments", "equipment", "subcontractors", "reports"];
let current: PlanTier = "business";
export const setPlanTier = (t: PlanTier) => { current = t; };
export const getPlanTier = () => current;
export const isStarter = () => current === "starter";
