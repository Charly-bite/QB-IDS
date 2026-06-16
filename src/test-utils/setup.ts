/**
 * Global test setup for Vitest.
 * Provides mock factories for Node.js modules used by the lib layer.
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom';

// ── Mock mssql globally ──────────────────────────────────────
vi.mock('mssql', () => {
  const mockRequest = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: [] }),
  };
  const mockPool = {
    connected: true,
    request: vi.fn(() => ({ ...mockRequest, input: vi.fn().mockReturnThis(), query: vi.fn().mockResolvedValue({ recordset: [] }) })),
    close: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockPool),
      VarChar: vi.fn((n: number) => `VarChar(${n})`),
      Int: 'Int',
      DateTime: 'DateTime',
      Bit: 'Bit',
      BigInt: 'BigInt',
      NVarChar: vi.fn((n: unknown) => `NVarChar(${n})`),
      MAX: 'MAX',
    },
  };
});

// Note: child_process is mocked per-test-file (not globally) because
// different modules use exec with different callback signatures,
// and the promisify wrapper needs the real module structure.
