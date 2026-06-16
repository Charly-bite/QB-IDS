import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('@/lib/db', () => ({
  updateDevice: vi.fn(),
}));

import { PATCH } from '../../api/network/update/route';
import { updateDevice } from '@/lib/db';

const mockUpdateDevice = vi.mocked(updateDevice);

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/network/update', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PATCH /api/network/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when IP is missing', async () => {
    const response = await PATCH(makeRequest({ name: 'Test' }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('IP');
  });

  it('updates device successfully', async () => {
    mockUpdateDevice.mockResolvedValueOnce(undefined);

    const response = await PATCH(makeRequest({ ip: '192.168.2.1', name: 'New Name' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(mockUpdateDevice).toHaveBeenCalledWith('192.168.2.1', expect.objectContaining({ name: 'New Name' }));
  });

  it('returns 500 on database error', async () => {
    mockUpdateDevice.mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await PATCH(makeRequest({ ip: '192.168.2.1', name: 'Test' }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('DB connection failed');
  });
});
