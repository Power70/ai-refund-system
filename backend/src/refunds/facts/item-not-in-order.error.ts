/** A requested item doesn't belong to the order (or the order isn't the customer's). */
export class ItemNotInOrderError extends Error {
  constructor(readonly orderItemIds: string[]) {
    super(`Items not found in this order: ${orderItemIds.join(', ')}`);
    this.name = 'ItemNotInOrderError';
  }
}
