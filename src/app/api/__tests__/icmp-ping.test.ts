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

describe('GET /api/icmp-ping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when host is missing', async () => {
    const { GET } = await import('../../api/icmp-ping/route');
    const request = new Request('http://localhost/api/icmp-ping');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns Online with latency on success', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      cb(null, {
        stdout: 'Reply from 192.168.2.1: bytes=32 time=4ms TTL=128\n\nPing statistics...\n   Packets: Sent = 1, Received = 1, Lost = 0 (0% loss)',
        stderr: '',
      });
    });

    const { GET } = await import('../../api/icmp-ping/route');
    const request = new Request('http://localhost/api/icmp-ping?host=192.168.2.1');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Online');
    expect(data.latency).toBe(4);
    expect(data.statusCode).toBe('PING');
  });

  it('returns Offline on timed out', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      cb(null, {
        stdout: 'Request timed out.\n\nPing statistics...\n   Packets: Sent = 1, Received = 0, Lost = 1 (100% loss)',
        stderr: '',
      });
    });

    const { GET } = await import('../../api/icmp-ping/route');
    const request = new Request('http://localhost/api/icmp-ping?host=192.168.2.99');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.latency).toBe(0);
  });

  it('returns Offline on exec error', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      cb(new Error('timeout'), { stdout: '', stderr: '' });
    });

    const { GET } = await import('../../api/icmp-ping/route');
    const request = new Request('http://localhost/api/icmp-ping?host=192.168.2.99');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.statusCode).toBe('FAIL');
  });

  it('sanitizes host parameter', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as Function;
      // Verify the command doesn't contain special characters
      expect(cmd).not.toContain(';');
      expect(cmd).not.toContain('|');
      cb(null, { stdout: 'Request timed out.\nLost = 1 (100% loss)', stderr: '' });
    });

    const { GET } = await import('../../api/icmp-ping/route');
    const request = new Request('http://localhost/api/icmp-ping?host=192.168.2.1;rm%20-rf');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });
});
