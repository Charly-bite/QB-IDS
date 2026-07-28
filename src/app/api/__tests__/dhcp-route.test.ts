import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../network/dhcp/route';


// Mock lookupVendor
vi.mock('@/lib/oui-lookup', () => ({
  lookupVendor: vi.fn((mac: string) => {
    if (mac.startsWith('C0:74:AD')) return 'TP-Link';
    if (mac.startsWith('00:0B:82')) return 'Grandstream';
    if (mac.startsWith('C0:56:E3')) return 'HikVision';
    return null;
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DHCP Leases API Route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns simulated fallback leases when FORTIGATE env variables are not configured', async () => {
    delete process.env.FORTIGATE_API_URL;
    delete process.env.FORTIGATE_API_TOKEN;

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.configured).toBe(false);
    expect(data.simulated).toBe(true);
    expect(data.leases).toBeInstanceOf(Array);
    expect(data.leases.length).toBeGreaterThan(0);
    
    // Check fields and vendor mappings
    const tpLinkLease = data.leases.find((l: any) => l.mac === 'C0:74:AD:12:34:56');
    expect(tpLinkLease).toBeDefined();
    expect(tpLinkLease.vendor).toBe('TP-Link');
  });

  it('queries FortiGate monitor endpoint when FORTIGATE env variables are configured', async () => {
    process.env.FORTIGATE_API_URL = 'https://192.168.2.1/api/v2';
    process.env.FORTIGATE_API_TOKEN = 'mock-token-1234';

    // Mock successful FortiGate response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              ip: '192.168.2.100',
              mac: 'c0:56:e3:11:22:33',
              hostname: 'IP-Camera-New',
              type: 'dynamic',
              expire: 3600,
              interface: 'vlan10',
            },
          ],
        }),
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.configured).toBe(true);
    expect(data.simulated).toBe(false);
    expect(data.leases).toHaveLength(1);
    expect(data.leases[0].ip).toBe('192.168.2.100');
    expect(data.leases[0].mac).toBe('C0:56:E3:11:22:33');
    expect(data.leases[0].vendor).toBe('HikVision');
    expect(data.leases[0].interface).toBe('vlan10');
    expect(data.leases[0].expire).not.toBe('Never');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://192.168.2.1/api/v2/monitor/system/dhcp/select?access_token=mock-token-1234',
      expect.any(Object)
    );
  });

  it('returns 500 error when fetch call fails', async () => {
    process.env.FORTIGATE_API_URL = 'https://192.168.2.1/api/v2';
    process.env.FORTIGATE_API_TOKEN = 'mock-token-1234';

    mockFetch.mockRejectedValueOnce(new Error('Connection timed out'));

    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();

    expect(data.configured).toBe(true);
    expect(data.leases).toHaveLength(0);
    expect(data.error).toBe('Connection timed out');
  });
});
