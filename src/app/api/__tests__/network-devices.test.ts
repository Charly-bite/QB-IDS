import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db
vi.mock('@/lib/db', () => ({
  getAllDevices: vi.fn(),
  initDatabase: vi.fn(),
  seedKnownDevices: vi.fn(),
}));

import { GET } from '../../api/network/devices/route';
import { getAllDevices, initDatabase, seedKnownDevices } from '@/lib/db';

const mockGetAllDevices = vi.mocked(getAllDevices);
const mockInitDatabase = vi.mocked(initDatabase);
const mockSeedKnownDevices = vi.mocked(seedKnownDevices);

describe('GET /api/network/devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level `initialized` flag by resetting the module
  });

  it('returns devices from database', async () => {
    const devices = [
      { ip: '192.168.2.1', name: 'Server', status: 'Online' },
      { ip: '192.168.2.2', name: 'Switch', status: 'Online' },
    ];
    mockInitDatabase.mockResolvedValueOnce(undefined);
    mockSeedKnownDevices.mockResolvedValueOnce(undefined);
    mockGetAllDevices.mockResolvedValueOnce(devices);

    const response = await GET();
    const data = await response.json();
    expect(data.devices).toEqual(devices);
  });

  it('returns 500 on database error', async () => {
    mockInitDatabase.mockRejectedValueOnce(new Error('Connection refused'));

    // Need to reset module state for the initialized flag
    vi.resetModules();
    const { GET: freshGET } = await import('../../api/network/devices/route');

    const response = await freshGET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('Connection refused');
    expect(data.devices).toEqual([]);
  });
});
