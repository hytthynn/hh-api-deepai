import { api, ApiError, jsonBody } from '@/src/server/api';
import { BmClient, BmError, bmConfigFromSettings } from '@/src/adapters/bm/client';
import { getSetting } from '@/src/adapters/db/repositories/settings';
import { resetWalletCache } from '@/src/server/bm-wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(
  async () => {
    const config = bmConfigFromSettings(getSetting);
    if (!config) throw new ApiError('bm_not_configured', 400, 'API-ключ BM не задан');
    const client = new BmClient(config);
    try {
      const [wallet, product] = await Promise.all([client.wallet(), client.product(config.productId)]);
      resetWalletCache();
      return jsonBody({
        ok: true,
        wallet: { balance: wallet.balance, currency: wallet.currency },
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          currency: product.currency,
          allowed_quantities: product.allowedQuantities,
          in_stock: product.inStock,
        },
      });
    } catch (error) {
      if (error instanceof BmError) {
        return jsonBody({ ok: false, code: error.code, error: error.message }, 400);
      }
      throw error;
    }
  },
  { mutation: true },
);