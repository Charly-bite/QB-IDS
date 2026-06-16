import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('GET /api/network-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 for invalid subnet', async () => {
    const { GET } = await import('../../api/network-scan/route');
    const request = new Request('http://localhost/api/network-scan?subnet=bad');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for missing subnet', async () => {
    const { GET } = await import('../../api/network-scan/route');
    const request = new Request('http://localhost/api/network-scan');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('scans subnet and returns results', async () => {
    // Only .1 responds
    execMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as Function;
      const ipMatch = cmd.match(/(\d+\.\d+\.\d+\.(\d+))/);
      const lastOctet = ipMatch ? parseInt(ipMatch[2]) : 0;
      if (lastOctet === 1) {
        cb(null, { stdout: 'Reply from 192.168.2.1: bytes=32 time=1ms TTL=128', stderr: '' });
      } else {
        cb(null, { stdout: 'Request timed out.', stderr: '' });
      }
    });

    const { GET } = await import('../../api/network-scan/route');
    const request = new Request('http://localhost/api/network-scan?subnet=192.168.2');
    const response = await GET(request);
    const data = await response.json();
    expect(data.subnet).toBe('192.168.2.0/24');
    expect(data.scanned).toBe(254);
    expect(data.activeCount).toBe(1);
    expect(data.activeHosts).toContain('192.168.2.1');
  }, 30000);
});
