// Environment for the whole suite. Runs before any module that reads `env` (vitest setupFiles).
import { resetGlobalState } from '@/src/lib/global-state';
import { setLogLevel } from '@/src/lib/logger';

process.env.HH_DB_PATH = ':memory:';
process.env.HH_SECRET = 'test-secret-0123456789-abcdefghijkl';
process.env.HH_ADMIN_PASSWORD = 'test-admin-password';
process.env.HH_LOG_LEVEL = 'error';
process.env.HH_SLOT_WAIT_MS = '1500';
process.env.HH_UPSTREAM_TIMEOUT_MS = '4000';
process.env.HH_MEASURE_THEOS = '0';
process.env.HH_DEBUG_BODY = '0';
process.env.HH_TEST_MODE = '1';

resetGlobalState();
setLogLevel('error');