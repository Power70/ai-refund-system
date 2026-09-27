/** Formats integer minor units (cents) for people, e.g. 12050 USD → "$120.50". */
export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
}
