BEGIN;

-- Binary placement: one LEFT and one RIGHT child per parent at most.
CREATE UNIQUE INDEX "User_parentId_position_key" ON "User"("parentId", "position");

-- Structural and accounting invariants enforced below the application layer.
ALTER TABLE "User"
  ADD CONSTRAINT "User_binary_placement_check"
  CHECK (
    ("parentId" IS NULL AND "position" IS NULL)
    OR ("parentId" IS NOT NULL AND "position" IN ('LEFT', 'RIGHT'))
  ),
  ADD CONSTRAINT "User_no_self_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id"),
  ADD CONSTRAINT "User_ep_balance_check"
  CHECK ("epBalance" >= 0 AND "epBalance" <= 1000000000000000);

ALTER TABLE "LegBalance"
  ADD CONSTRAINT "LegBalance_nonnegative_check"
  CHECK (
    "leftPV" BETWEEN 0 AND 1000000000000000
    AND "rightPV" BETWEEN 0 AND 1000000000000000
    AND "leftBV" BETWEEN 0 AND 1000000000000000
    AND "rightBV" BETWEEN 0 AND 1000000000000000
  );

ALTER TABLE "TokenQuota"
  ADD CONSTRAINT "TokenQuota_bounds_check"
  CHECK ("allocated" >= 0 AND "consumed" >= 0 AND "consumed" <= "allocated");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_matching_bonus_check"
  CHECK (
    "txType" <> 'BONUS_MATCHING'
    OR (
      "amount" > 0
      AND "amount" <= 1000
      AND "pvGenerated" >= 0
      AND "bvGenerated" >= 0
      AND "amount" <= "pvGenerated" * 0.1 + 0.0000001
      AND "amount" <= "bvGenerated" + 0.0000001
    )
  );

COMMIT;
