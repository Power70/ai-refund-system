import { resolutionCustomerMessage } from './resolution-customer-message.js';

const items = [
  { itemName: 'Linen shirt, blue', approve: true },
  { itemName: 'Linen shirt, white', approve: false },
];

describe('resolutionCustomerMessage', () => {
  it('states the approved total', () => {
    expect(resolutionCustomerMessage('APPROVED', items.map((i) => ({ ...i, approve: true })), 14000, 'USD')).toBe(
      'Our support team reviewed your request and approved your refund of $140.00.',
    );
  });

  it('names what was and was not approved', () => {
    expect(resolutionCustomerMessage('PARTIALLY_APPROVED', items, 8000, 'USD')).toBe(
      "Our support team reviewed your request and approved a refund of $80.00 for: Linen shirt, blue. We couldn't approve a refund for: Linen shirt, white.",
    );
  });

  it('declines without an amount', () => {
    expect(resolutionCustomerMessage('DENIED', items, 0, 'USD')).toBe("Our support team reviewed your request and wasn't able to approve a refund.");
  });
});
