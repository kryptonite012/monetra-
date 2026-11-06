import { describe, expect, it } from 'vitest';
import { config, corsOrigins } from '../../src/config/env';

describe('environment configuration', () => {
  it('applies safe defaults for local development', () => {
    expect(config.PORT).toBeGreaterThan(0);
    expect(config.MAX_FAILED_LOGINS).toBeGreaterThan(0);
    expect(Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(corsOrigins.length).toBeGreaterThan(0);
  });
});
