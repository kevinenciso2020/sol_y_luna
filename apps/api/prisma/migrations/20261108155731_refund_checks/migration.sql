-- Refund integrity: amounts are positive, a refund never exceeds what was paid and the
-- reversed commission never exceeds the commission charged.
ALTER TABLE "OrderRefund"
  ADD CONSTRAINT "OrderRefund_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "OrderRefund_commissionReversed_check" CHECK ("commissionReversed" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_refundedAmount_check" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "total"),
  ADD CONSTRAINT "Order_commissionRefunded_check" CHECK (
    "commissionRefunded" >= 0 AND "commissionRefunded" <= COALESCE("commissionAmount", 0)
  );
