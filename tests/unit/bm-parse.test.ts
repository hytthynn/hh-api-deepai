import { describe, expect, it } from 'vitest';
import { BmError, mapBmMessage, parseLogins, unwrap } from '@/src/adapters/bm/client';

describe('bm.parse: login lines', () => {
  it('parses email|password and email:password', () => {
    const { parsed, invalid } = parseLogins([
      'one@example.test|Passw0rd!',
      'two@example.test:An0ther',
      '   three@example.test|  spaced  ',
    ]);
    expect(invalid).toEqual([]);
    expect(parsed).toEqual([
      { email: 'one@example.test', password: 'Passw0rd!' },
      { email: 'two@example.test', password: 'An0ther' },
      { email: 'three@example.test', password: 'spaced' },
    ]);
  });

  it('prefers | over : so passwords may contain colons', () => {
    const { parsed, invalid } = parseLogins(['user@example.test|pa:ss:word']);
    expect(invalid).toEqual([]);
    expect(parsed[0]).toEqual({ email: 'user@example.test', password: 'pa:ss:word' });

    const colonOnly = parseLogins(['user@example.test:pa:ss']);
    expect(colonOnly.parsed[0]).toEqual({ email: 'user@example.test', password: 'pa:ss' });
  });

  it('drops garbage, empty lines and entries without credentials', () => {
    const { parsed, invalid } = parseLogins([
      '',
      '   ',
      'no-separator',
      '|leading',
      'trailing|',
      'not-an-email|password',
      'user@example.test|',
      'user@example.test|ok',
    ]);
    expect(parsed).toEqual([{ email: 'user@example.test', password: 'ok' }]);
    expect(invalid).toEqual([
      'no-separator',
      '|leading',
      'trailing|',
      'not-an-email|password',
      'user@example.test|',
    ]);
  });

  it('deduplicates case-insensitively and keeps the first password', () => {
    const { parsed, invalid } = parseLogins([
      'Dup@Example.test|first',
      'dup@example.test|second',
      'DUP@EXAMPLE.TEST|third',
      'other@example.test|fourth',
    ]);
    expect(invalid).toEqual([]);
    expect(parsed).toEqual([
      { email: 'Dup@Example.test', password: 'first' },
      { email: 'other@example.test', password: 'fourth' },
    ]);
  });

  it('caps invalid lines at 120 chars', () => {
    const long = `garbage-${'x'.repeat(300)}`;
    const { invalid } = parseLogins([long]);
    expect(invalid[0]).toHaveLength(120);
  });
});

describe('bm: error mapping', () => {
  it('maps provider error strings to typed codes', () => {
    expect(mapBmMessage('INSUFFICIENT_BALANCE', 400).code).toBe('bm_insufficient_balance');
    expect(mapBmMessage('insufficient_stock', null).code).toBe('bm_insufficient_stock');
    expect(mapBmMessage('OUT_OF_STOCK', null).code).toBe('bm_insufficient_stock');
    expect(mapBmMessage('PRODUCT_NOT_FOUND', null).code).toBe('bm_invalid_product');
    expect(mapBmMessage('anything', 401).code).toBe('bm_unauthorized');
    expect(mapBmMessage('anything', 403).code).toBe('bm_unauthorized');
    const generic = mapBmMessage('weird failure', 500);
    expect(generic).toBeInstanceOf(BmError);
    expect(generic.code).toBe('bm_http_error');
    expect(generic.status).toBe(500);
    expect(generic.message.length).toBeLessThanOrEqual(300);
  });

  it('unwraps success envelopes and throws on success:false', () => {
    expect(unwrap({ success: true, data: { balance: 12.5 } })).toEqual({ balance: 12.5 });
    expect(unwrap({ success: true, other: 1 })).toEqual({ success: true, other: 1 });
    expect(unwrap({ plain: 'value' })).toEqual({ plain: 'value' });

    expect(() => unwrap({ success: false, error: 'INSUFFICIENT_BALANCE' })).toThrow(BmError);
    try {
      unwrap({ success: false, error: 'INSUFFICIENT_STOCK' });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as BmError).code).toBe('bm_insufficient_stock');
    }
    expect(() => unwrap({ success: false })).toThrow(/unknown BM error/);
  });
});