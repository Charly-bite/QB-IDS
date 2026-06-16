import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dgram
vi.mock('dgram', () => ({
  createSocket: vi.fn(),
}));

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/network/wol', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/network/wol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when MAC is missing', async () => {
    const { POST } = await import('../../api/network/wol/route');
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('MAC');
  });

  it('returns 400 when MAC is not a string', async () => {
    const { POST } = await import('../../api/network/wol/route');
    const response = await POST(makeRequest({ mac: 123 }));
    expect(response.status).toBe(400);
  });

  it('sends magic packet successfully', async () => {
    const dgram = await import('dgram');
    const mockSocket = {
      once: vi.fn(),
      bind: vi.fn((cb: Function) => cb()),
      setBroadcast: vi.fn(),
      send: vi.fn((_buf: Buffer, _off: number, _len: number, _port: number, _addr: string, cb: Function) => cb(null)),
      close: vi.fn(),
    };
    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);

    const { POST } = await import('../../api/network/wol/route');
    const response = await POST(makeRequest({ mac: 'AA:BB:CC:DD:EE:FF', deviceName: 'TestPC' }));
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('AA:BB:CC:DD:EE:FF');
  });

  it('returns 500 on send error', async () => {
    const dgram = await import('dgram');
    const mockSocket = {
      once: vi.fn(),
      bind: vi.fn((cb: Function) => cb()),
      setBroadcast: vi.fn(),
      send: vi.fn((_buf: Buffer, _off: number, _len: number, _port: number, _addr: string, cb: Function) => cb(new Error('send failed'))),
      close: vi.fn(),
    };
    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);

    const { POST } = await import('../../api/network/wol/route');
    const response = await POST(makeRequest({ mac: 'AA:BB:CC:DD:EE:FF' }));
    expect(response.status).toBe(500);
  });
});
