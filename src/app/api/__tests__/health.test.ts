import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when target is missing', async () => {
    const { GET } = await import('../../api/health/route');
    const request = new Request('http://localhost/api/health');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns health data on success', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'healthy', uptime: 12345 }),
    });

    const { GET } = await import('../../api/health/route');
    const request = new Request('http://localhost/api/health?target=192.168.2.10:555');
    const response = await GET(request);
    const data = await response.json();
    expect(data.reachable).toBe(true);
    expect(data.status).toBe('healthy');
  });

  it('returns reachable=false on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { GET } = await import('../../api/health/route');
    const request = new Request('http://localhost/api/health?target=192.168.2.99');
    const response = await GET(request);
    const data = await response.json();
    expect(data.reachable).toBe(false);
    expect(data.error).toContain('Could not reach');
  });

  it('prepends http:// when target has no protocol', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'ok' }),
    });

    const { GET } = await import('../../api/health/route');
    const request = new Request('http://localhost/api/health?target=myserver');
    await GET(request);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://myserver/api/monitor/health',
      expect.anything(),
    );
  });
});
