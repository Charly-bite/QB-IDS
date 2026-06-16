import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the scan-progress module
vi.mock('@/lib/scan-progress', () => ({
  getScanProgress: vi.fn(() => ({
    phase: 'Scanning',
    percent: 42,
    detail: 'Probing subnet',
    running: true,
  })),
}));

import { GET } from '../../api/network/scan-progress/route';

describe('GET /api/network/scan-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current scan progress', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.phase).toBe('Scanning');
    expect(data.percent).toBe(42);
    expect(data.detail).toBe('Probing subnet');
    expect(data.running).toBe(true);
  });
});
