export interface ItemQuantities {
  purchased: number;
  refunded: number;
  /** Awaiting a reviewer or still being processed: reserved, so it can't be requested twice. */
  pending: number;
  refundable: number;
}
