export interface DemoItem {
  sku: string;
  name: string;
  category: string;
  unitPricePaidMinor: number;
  quantity: number;
  finalSale?: boolean;
}

export interface DemoOrder {
  orderNumber: string;
  /** Whole days since delivery at seed time; null = not delivered yet. */
  deliveredDaysAgo: number | null;
  items: DemoItem[];
}

export interface DemoCustomer {
  name: string;
  email: string;
  /** Which demo scenario this customer exists for (documentation only, not stored). */
  scenario: string;
  orders: DemoOrder[];
}
