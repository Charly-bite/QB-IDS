import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GET /api/monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when URL is missing', async () => {
    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns Online for successful response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=192.168.2.1');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Online');
    expect(data.statusCode).toBe(200);
  });

  it('returns Issues Detected for error status codes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=192.168.2.1');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Issues Detected');
    expect(data.statusCode).toBe(500);
    expect(data.errorDetail).toContain('Internal Server Error');
  });

  it('returns Offline on timeout', async () => {
    const err = new Error('timeout');
    err.name = 'TimeoutError';
    mockFetch.mockRejectedValueOnce(err);

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=192.168.2.99');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('timed out');
  });

  it('returns Offline on ECONNREFUSED', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=192.168.2.99');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('Connection refused');
  });

  it('returns Offline on DNS failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND example.invalid'));

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=example.invalid');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('DNS');
  });

  it('returns Offline on SSL error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('SSL certificate problem'));

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=badssl.com');
    const response = await GET(request);
    const data = await response.json();
    expect(data.errorDetail).toContain('SSL');
  });

  it('handles non-Error throws', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const { GET } = await import('../../api/monitor/route');
    const request = new Request('http://localhost/api/monitor?url=192.168.2.1');
    const response = await GET(request);
    const data = await response.json();
    expect(data.status).toBe('Offline');
    expect(data.errorDetail).toContain('Unknown');
  });

  it('uses http:// for private IPs', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const { GET } = await import('../../api/monitor/route');
    await GET(new Request('http://localhost/api/monitor?url=192.168.2.1'));
    expect(mockFetch).toHaveBeenCalledWith('http://192.168.2.1', expect.anything());
  });

  it('uses https:// for public domains', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const { GET } = await import('../../api/monitor/route');
    await GET(new Request('http://localhost/api/monitor?url=google.com'));
    expect(mockFetch).toHaveBeenCalledWith('https://google.com', expect.anything());
  });

  it('preserves existing protocol', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const { GET } = await import('../../api/monitor/route');
    await GET(new Request('http://localhost/api/monitor?url=http://custom:8080'));
    expect(mockFetch).toHaveBeenCalledWith('http://custom:8080', expect.anything());
  });
});
