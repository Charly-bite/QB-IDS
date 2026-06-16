import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wmi-probe', () => ({
  queryWMI: vi.fn(),
}));

import { POST } from '../../api/network/wmi/route';
import { queryWMI } from '@/lib/wmi-probe';

const mockQueryWMI = vi.mocked(queryWMI);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/network/wmi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/network/wmi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when IP is missing', async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('IP');
  });

  it('returns 400 when IP is not a string', async () => {
    const response = await POST(makeRequest({ ip: 123 }));
    expect(response.status).toBe(400);
  });

  it('returns WMI profile successfully', async () => {
    const profile = {
      ip: '192.168.2.10',
      accessible: true,
      error: null,
      os: { caption: 'Windows 10', version: '10.0' },
    };
    mockQueryWMI.mockResolvedValueOnce(profile as ReturnType<typeof queryWMI> extends Promise<infer T> ? T : never);

    const response = await POST(makeRequest({ ip: '192.168.2.10' }));
    const data = await response.json();
    expect(data.accessible).toBe(true);
    expect(data.os.caption).toBe('Windows 10');
  });

  it('returns 500 on unexpected error', async () => {
    mockQueryWMI.mockRejectedValueOnce(new Error('Unexpected error'));

    const response = await POST(makeRequest({ ip: '192.168.2.10' }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('Unexpected error');
  });
});
