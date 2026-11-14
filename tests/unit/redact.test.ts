import { describe, expect, it } from 'vitest';
import { redact, redactJson, redactString } from '@/src/lib/redact';

describe('redact: secret-shaped strings', () => {
  it('masks hh-api keys, sk_live keys and bearer tokens', () => {
    expect(redactString('ключ hh-api-AbCdEf0123456789abcdefghijklmnopqrstuvwxyz012345')).toBe(
      'ключ hh-api-«redacted»',
    );
    expect(redactString('sk_live_51H8xYzAbC')).toBe('sk_live_«redacted»');
    expect(redactString('Authorization: Bearer abc.def-123_~+/=')).toBe(
      'Authorization: Bearer «redacted»',
    );
    expect(redactString('bearer TOPsecretValue')).toBe('bearer «redacted»');
  });

  it('masks cookie pairs wherever they appear in a header dump', () => {
    expect(redactString('sessionid=abc123; csrftoken=XYZ; other=1')).toBe(
      'sessionid=«redacted»; csrftoken=«redacted»; other=1',
    );
    expect(redactString('{"sessionid":"abc"} sessionid=qwerty,')).toBe(
      '{"sessionid":"abc"} sessionid=«redacted»,',
    );
    expect(redactString('nothing secret here')).toBe('nothing secret here');
  });
});

describe('redact: structured values', () => {
  it('replaces values under secret key names at any depth', () => {
    const input = {
      level1: {
        password: 'p@ssw0rd',
        nested: {
          cookies: [{ name: 'sessionid', value: 'abc' }],
          deeper: { Authorization: 'Bearer top', api_key: 'sk_live_1', keep: 'visible' },
        },
      },
      hh_secret: 'R8+Y5cX3',
      token: 'abc',
      name: 'account',
    };
    const output = redact(input) as Record<string, unknown>;
    const level1 = output.level1 as Record<string, unknown>;
    const nested = level1.nested as Record<string, unknown>;
    const deeper = nested.deeper as Record<string, unknown>;
    expect(level1.password).toBe('«redacted»');
    expect(nested.cookies).toBe('«redacted»');
    expect(deeper.Authorization).toBe('«redacted»');
    expect(deeper.api_key).toBe('«redacted»');
    expect(deeper.keep).toBe('visible');
    expect(output.hh_secret).toBe('«redacted»');
    expect(output.token).toBe('«redacted»');
    expect(output.name).toBe('account');
    expect(JSON.stringify(output)).not.toContain('p@ssw0rd');
    expect(JSON.stringify(output)).not.toContain('Bearer top');
  });

  it('scrubs secrets that hide inside string values at any depth', () => {
    const output = redact({
      a: { b: { c: { d: ['x hh-api-ABCDEFGH12345678', 'sessionid=zzz'] } } },
    }) as Record<string, unknown>;
    const text = JSON.stringify(output);
    expect(text).not.toContain('ABCDEFGH12345678');
    expect(text).not.toContain('zzz');
    expect(text).toContain('hh-api-«redacted»');
  });

  it('keeps primitives, null and arrays order intact', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(['a', 1, { password: 'x' }])).toEqual(['a', 1, { password: '«redacted»' }]);
  });

  it('redacts Error messages and collapses deep nesting', () => {
    const error = new Error('failed with Bearer abc123');
    expect(redact(error)).toEqual({ name: 'Error', message: 'failed with Bearer «redacted»' });

    let deep: Record<string, unknown> = { password: 'top' };
    for (let i = 0; i < 8; i += 1) deep = { [`l${i}`]: deep };
    const text = JSON.stringify(redact(deep));
    expect(text).toContain('«deep»');
    expect(text).not.toContain('top');
  });
});

describe('redact: JSON serialisation', () => {
  it('truncates long payloads with an explicit marker', () => {
    const short = redactJson({ ok: true });
    expect(JSON.parse(short)).toEqual({ ok: true });

    const long = redactJson({ data: 'x'.repeat(5_000) }, 256);
    expect(long.length).toBeLessThanOrEqual(256);
    expect(long.endsWith('…«trunc»')).toBe(true);
  });

  it('never leaks a secret even when truncating', () => {
    const long = redactJson({ pad: 'y'.repeat(3_000), password: 'hunter2', key: 'hh-api-SECRETSECRET1234' }, 512);
    expect(long).not.toContain('hunter2');
    expect(long).not.toContain('SECRETSECRET1234');
  });
});