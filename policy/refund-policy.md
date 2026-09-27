<!-- GENERATED from refund-policy.yaml by `npm run policy:docs` (in backend/). Do not edit by hand. -->

# Refund Policy

Version **2026.09-1** · effective 1 September 2026 · amounts in USD

## How decisions are made

- A customer can give one of these reasons: Damaged, Wrong item, Not as described, Changed mind, Other.
- Each item in a request is checked against every item rule below.
- If more than one rule applies to an item, the outcome is chosen in this order: Denied, then Needs review, then Approved.
- If no rule applies to an item, it is **Needs review**: "A team member will review this request."
- If every item is denied, the request is denied. Otherwise the whole-request rules are checked too.
- If any item or whole-request rule needs review, a member of the team decides the whole request.
- Requests that need review are answered within 2 business days.

## Item rules

| Rule | Applies when | Outcome | What the customer is told |
| --- | --- | --- | --- |
| `NOT_DELIVERED` | the item has not been delivered | Needs review | We need to confirm delivery details before processing this item. |
| `WINDOW_EXPIRED` | days since delivery is more than 30 | Denied | Refunds are available within 30 days of delivery. |
| `FINAL_SALE` | the item is final sale and the reason is none of "Damaged", "Wrong item" | Denied | Final-sale items are not eligible for a refund. |
| `FINAL_SALE_DEFECT_CONFLICT` | the item is final sale and the reason is one of "Damaged", "Wrong item" | Needs review | A team member will review this final-sale item. |
| `PRIOR_DENIED_RESUBMISSION` | an earlier request for this item was denied | Needs review | This item has a previous request, so a team member will review it. |
| `DEFECT_ELIGIBLE` | the reason is one of "Damaged", "Wrong item", "Not as described" and days since delivery is at most 30 | Approved | Damaged, incorrect or not-as-described items within 30 days qualify for a refund. |
| `CHANGE_OF_MIND_ELIGIBLE` | the reason is "Changed mind" and the item is not final sale and days since delivery is at most 30 | Approved | Items returned within 30 days qualify for a refund. |

## Whole-request rules

| Rule | Applies when | Outcome | What the customer is told |
| --- | --- | --- | --- |
| `HIGH_VALUE` | the order's total refunds (including this request) is more than $500.00 | Needs review | Refunds over $500 are reviewed by our team. |
| `HIGH_FREQUENCY` | the number of the customer's refund requests in the last 30 days is more than 3 | Needs review | A team member will review this request. |
