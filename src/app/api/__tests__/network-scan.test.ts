import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted exec mock
const { execMock } = vi.hoisted(() => {
  const execMock = vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as Function;
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
  });
  return { execMock };
});

vi.mock('child_process', () => ({
  default: { exec: execMock },
  exec: execMock,
}));

vi.mock('@/lib/db', () => ({
  initDatabase: vi.fn(),
  upsertDevice: vi.fn(),
  recordScan: vi.fn(),
}));

vi.mock('@/lib/oui-lookup', () => ({
  lookupVendor: vi.fn(() => 'TestVendor'),
}));

vi.mock('@/lib/port-scan', () => ({
  scanHosts: vi.fn(async (ips: string[], _batch: number, onProgress?: Function) => {
    onProgress?.(ips.length, ips.length);
    return ips.map(ip => ({ ip, openPorts: [22, 80], services: { 22: 'ssh', 80: 'http' } }));
  }),
}));

vi.mock('@/lib/device-classifier', () => ({
  classifyDevice: vi.fn(() => ({ deviceType: 'server', osFingerprint: 'Linux', confidence: 'high' })),
}));

vi.mock('@/lib/netbios-scan', () => ({
  queryNetBIOSBatch: vi.fn(async (ips: string[], _batch: number, onProgress?: Function) => {
    onProgress?.(ips.length, ips.length);
    return ips.map(ip => ({ ip, computerName: null, domain: null, isFileServer: false, mac: null }));
  }),
}));

vi.mock('@/lib/smb-scan', () => ({
  enumSharesBatch: vi.fn(async (ips: string[], _batch: number, onProgress?: Function) => {
    onProgress?.(ips.length, ips.length);
    return ips.map(ip => ({ ip, accessible: false, shares: [], error: null }));
  }),
}));

vi.mock('@/lib/http-probe', () => ({
  probeHTTPBatch: vi.fn(async (hosts: { ip: string }[], _batch: number, onProgress?: Function) => {
    onProgress?.(hosts.length, hosts.length);
    return hosts.map(h => ({ ip: h.ip, httpTitle: null, httpServer: null }));
  }),
}));

vi.mock('@/lib/banner-grab', () => ({
  grabBannersBatch: vi.fn(async (_hosts: unknown[], _batch: number, onProgress?: Function) => {
    onProgress?.(0, 0);
    return {};
  }),
}));

vi.mock('@/lib/ssl-probe', () => ({
  probeSSLBatch: vi.fn(async (_hosts: unknown[], _batch: number, onProgress?: Function) => {
    onProgress?.(0, 0);
    return [];
  }),
}));

vi.mock('@/lib/ssdp-discovery', () => ({
  discoverSSDP: vi.fn(async () => []),
  groupSSDPByHost: vi.fn(() => ({})),
}));

vi.mock('@/lib/mdns-discovery', () => ({
  discoverMDNS: vi.fn(async () => []),
  groupMDNSByHost: vi.fn(() => ({})),
}));

vi.mock('@/lib/scan-progress', () => ({
  setScanProgress: vi.fn(),
}));

function makePostRequest(subnet: string, deep: boolean = true): Request {
  const url = new URL('http://localhost/api/network/scan');
  url.searchParams.set('subnet', subnet);
  url.searchParams.set('deep', deep.toString());
  return new Request(url.toString(), { method: 'POST' });
}

describe('POST /api/network/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 for invalid subnet', async () => {
    const { POST } = await import('../../api/network/scan/route');
    const response = await POST(makePostRequest('not-a-subnet'));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid subnet');
  });

  it('returns 400 for missing subnet', async () => {
    const { POST } = await import('../../api/network/scan/route');
    const request = new Request('http://localhost/api/network/scan', { method: 'POST' });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('runs a full deep scan successfully', async () => {
    // Simulate ping: only .1 and .2 respond as online
    execMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as Function;

      if (cmd.includes('ping')) {
        // Extract the last octet to match precisely
        const ipMatch = cmd.match(/(\d+\.\d+\.\d+\.(\d+))/);
        const lastOctet = ipMatch ? parseInt(ipMatch[2]) : 0;
        if (lastOctet === 1 || lastOctet === 2) {
          cb(null, {
            stdout: `Pinging ${ipMatch![1]} with 32 bytes of data:\nReply from ${ipMatch![1]}: bytes=32 time=1ms TTL=128\n\nPackets: Sent = 1, Received = 1, Lost = 0`,
            stderr: '',
          });
        } else {
          cb(null, { stdout: 'Request timed out.', stderr: '' });
        }
      } else if (cmd.includes('arp')) {
        cb(null, {
          stdout: '  192.168.2.1    AA-BB-CC-DD-EE-01     dynamic\n  192.168.2.2    AA-BB-CC-DD-EE-02     dynamic\n',
          stderr: '',
        });
      } else if (cmd.includes('nslookup')) {
        cb(null, { stdout: '', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { POST } = await import('../../api/network/scan/route');
    const response = await POST(makePostRequest('192.168.2'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.subnet).toBe('192.168.2.0/24');
    expect(data.scanned).toBe(254);
    expect(data.activeCount).toBe(2);
    expect(data.portsScanned).toBe(true);
    expect(data.activeHosts).toHaveLength(2);
  }, 30000);

  it('runs a shallow scan (deep=false)', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as Function;
      if (cmd.includes('ping')) {
        const ipMatch = cmd.match(/(\d+\.\d+\.\d+\.(\d+))/);
        const lastOctet = ipMatch ? parseInt(ipMatch[2]) : 0;
        if (lastOctet === 1) {
          cb(null, { stdout: `Reply from 192.168.2.1: bytes=32 time=1ms TTL=64\nPackets: Sent = 1, Received = 1, Lost = 0`, stderr: '' });
        } else {
          cb(null, { stdout: 'Request timed out.', stderr: '' });
        }
      } else if (cmd.includes('arp')) {
        cb(null, { stdout: '  192.168.2.1    11-22-33-44-55-66     dynamic\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { POST } = await import('../../api/network/scan/route');
    const response = await POST(makePostRequest('192.168.2', false));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.portsScanned).toBe(false);
    expect(data.activeCount).toBe(1);
  }, 30000);

  it('handles DB init failure gracefully', async () => {
    const { initDatabase } = await import('@/lib/db');
    (initDatabase as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB connection lost'));

    const { POST } = await import('../../api/network/scan/route');
    const response = await POST(makePostRequest('192.168.2'));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('DB connection lost');
  });
});
