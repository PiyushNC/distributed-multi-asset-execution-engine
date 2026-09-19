export type OrderBookLevel = {
  price: number;
  quantity: number;
  orderCount: number;
};

export type OrderBookUpdate = {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
};

export type MarketTrade = {
  pair: string;
  price: number;
  quantity: number;
  timestamp: string;
};

export type UserOrder = {
  _id: string;
  id?: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT';
  price: number;
  quantity: number;
  filledQuantity: number;
  status: 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
  createdAt?: string;
};

export type AccountBalance = {
  assetBalance: Record<string, number>;
  quoteBalance: Record<string, number>;
};
