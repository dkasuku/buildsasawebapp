-- Ledger amounts need sub-dollar precision.
--
-- amountUSD was an integer. Amounts are entered in the workspace currency and
-- stored in USD, so in a shilling-denominated product the smallest representable
-- entry was $1 — roughly KSh 130. Every line rounded to the nearest ~130
-- shillings, and anything below that could not be recorded at all.
--
-- Widening an integer column to double precision is loss-free: existing values
-- are preserved exactly.
ALTER TABLE "LedgerEntry" ALTER COLUMN "amountUSD" TYPE DOUBLE PRECISION;
