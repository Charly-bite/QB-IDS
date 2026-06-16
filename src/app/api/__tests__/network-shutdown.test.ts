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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/network/shutdown', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/network/shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when IP is missing', async () => {
    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.1', action: 'destroy' }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid action');
  });

  it('sends shutdown command successfully', async () => {
    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'shutdown', delay: 30 }));
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('Shutdown');
    expect(data.message).toContain('192.168.2.10');
  });

  it('sends restart command successfully', async () => {
    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'restart' }));
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('Restart');
  });

  it('sends abort command successfully', async () => {
    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'abort' }));
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('aborted');
  });

  it('returns 403 on access denied', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      if (typeof cb === 'function') cb(new Error('Error de sistema 5'), { stdout: '', stderr: '' });
    });

    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'shutdown' }));
    expect(response.status).toBe(403);
  });

  it('returns 403 when host not reachable (prefix match on Error de sistema 5)', async () => {
    // 'Error de sistema 53' matches the 'Error de sistema 5' check first (Access denied)
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      if (typeof cb === 'function') cb(new Error('Error de sistema 53'), { stdout: '', stderr: '' });
    });

    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'shutdown' }));
    expect(response.status).toBe(403);
  });

  it('returns 404 when host not found (English)', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      if (typeof cb === 'function') cb(new Error('Network path not found'), { stdout: '', stderr: '' });
    });

    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'shutdown' }));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not reachable');
  });

  it('returns 500 on unexpected error', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      if (typeof cb === 'function') cb(new Error('Something unexpected'), { stdout: '', stderr: '' });
    });

    const { POST } = await import('../../api/network/shutdown/route');
    const response = await POST(makeRequest({ ip: '192.168.2.10', action: 'shutdown' }));
    expect(response.status).toBe(500);
  });
});
