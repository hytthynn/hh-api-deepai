export type BmConfig = {
  apiKey: string;
  verifyTls: boolean;
  productId: number;
};

export type BmWallet = { balance: number; currency: string };

export type BmProduct = {
  id: number;
  name: string;
  price: number;
  currency: string;
  allowedQuantities: number[];
  inStock: boolean;
};

export type BmOrder = {
  id: number;
  status: 'pending' | 'completed' | 'cancelled' | 'refunded' | string;
  quantity: number;
  totalAmount: number;
  items: string[];
};

export type BmPort = {
  wallet(): Promise<BmWallet>;
  product(id: number): Promise<BmProduct>;
  createOrder(productId: number, quantity: number): Promise<BmOrder>;
  getOrder(id: number): Promise<BmOrder>;
  purchases(orderId: number): Promise<string[]>;
};

export type ParsedLogin = { email: string; password: string };

export type BmErrorCode =
  | 'bm_not_configured'
  | 'bm_unauthorized'
  | 'bm_insufficient_balance'
  | 'bm_insufficient_stock'
  | 'bm_invalid_product'
  | 'bm_http_error'
  | 'bm_timeout'
  | 'bm_bad_response';