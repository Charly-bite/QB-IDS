import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/arp-watch', () => ({
  runARPWatch: vi.fn(),
}));

import { GET } from '../../api/network/arp-watch/route';
import { runARPWatch } from '@/lib/arp-watch';

const mockRunARPWatch = vi.mocked(runARPWatch);

describe('GET /api/network/arp-watch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns ARP watch results', async () => {
    mockRunARPWatch.mockResolvedValueOnce({
      currentEntries: 15,
      alerts: [{ type: 'new_device', ip: '192.168.2.100', mac: 'AA:BB:CC:DD:EE:FF' }],
    } as never);

    const response = await GET();
    const data = await response.json();
    expect(data.entries).toBe(15);
    expect(data.alerts).toHaveLength(1);
    expect(data.timestamp).toBeDefined();
  });

  it('returns 500 on error', async () => {
    mockRunARPWatch.mockRejectedValueOnce(new Error('exec failed'));
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
