import { describe, it, expect, vi, beforeEach } from 'vitest';

// Socket factory mock
const { config, createMockSocket } = vi.hoisted(() => {
  const config = { behavior: 'connect' as 'connect' | 'timeout' | 'error' };

  const createMockSocket = () => {
    const handlers: Record<string, Function[]> = {};
    const socket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return socket;
      }),
      connect: vi.fn((_port: number, _host: string) => {
        setTimeout(() => {
          if (config.behavior === 'connect') {
            handlers['connect']?.forEach(h => h());
          } else if (config.behavior === 'timeout') {
            handlers['timeout']?.forEach(h => h());
          } else {
            handlers['error']?.forEach(h => h(new Error('ECONNREFUSED')));
          }
        }, 0);
      }),
      destroy: vi.fn(),
    };
    return socket;
  };

  return { config, createMockSocket };
});

vi.mock('net', () => {
  function MockSocket() { return createMockSocket(); }
  return {
    Socket: MockSocket,
    default: { Socket: MockSocket },
  };
});

describe('GET /api/tcp-ping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    config.behavior = 'connect';
  });

  it('returns 400 when host is missing', async () => {
    const { GET } = await import('../../api/tcp-ping/route');
    const request = new Request('http://localhost/api/tcp-ping');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns Online on successful connection', async () => {
    config.behavior = 'connect';
    const { GET } = await import('../../api/tcp-ping/route');
    const request = new Request('http://localhost/api/tcp-ping?host=192.168.2.1&port=1433');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Online');
    expect(data.host).toBe('192.168.2.1');
    expect(data.port).toBe(1433);
  });

  it('returns Offline on timeout', async () => {
    config.behavior = 'timeout';
    const { GET } = await import('../../api/tcp-ping/route');
    const request = new Request('http://localhost/api/tcp-ping?host=192.168.2.99&port=80');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('timed out');
  });

  it('returns Offline on connection error', async () => {
    config.behavior = 'error';
    const { GET } = await import('../../api/tcp-ping/route');
    const request = new Request('http://localhost/api/tcp-ping?host=192.168.2.99&port=3389');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('ECONNREFUSED');
  });

  it('defaults to port 1433 when port is not specified', async () => {
    config.behavior = 'connect';
    const { GET } = await import('../../api/tcp-ping/route');
    const request = new Request('http://localhost/api/tcp-ping?host=192.168.2.1');
    const response = await GET(request);
    const data = await response.json();
    expect(data.port).toBe(1433);
  });
});
