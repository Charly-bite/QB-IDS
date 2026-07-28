import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the netbox-api helpers
vi.mock('@/lib/netbox-api', () => ({
  getDevices: vi.fn(),
  getDevice: vi.fn(),
  searchDevices: vi.fn(),
  getIPAddresses: vi.fn(),
  getPrefixes: vi.fn(),
  getVLANs: vi.fn(),
  getDeviceRoles: vi.fn(),
  getSites: vi.fn(),
  getOverview: vi.fn(),
  testConnection: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}));

// Mock ensureNetBoxSetup from sync/route
vi.mock('../netbox/sync/route', () => ({
  ensureNetBoxSetup: vi.fn().mockResolvedValue({
    siteId: 1,
    defaultTypeId: 2,
    roles: [
      { id: 10, name: 'Server', slug: 'server' },
      { id: 20, name: 'Network', slug: 'network' },
      { id: 99, name: 'Unknown', slug: 'unknown' },
    ],
  }),
}));

import { GET, POST } from '../netbox/route';
import {
  getOverview,
  getDevices,
  testConnection,
  createDevice,
} from '@/lib/netbox-api';

const mockGetOverview = vi.mocked(getOverview);
const mockGetDevices = vi.mocked(getDevices);
const mockTestConnection = vi.mocked(testConnection);
const mockCreateDevice = vi.mocked(createDevice);

// Mock global fetch
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ id: 100 }),
});
vi.stubGlobal('fetch', mockFetch);

describe('NetBox API Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/netbox', () => {
    it('returns overview counts by default', async () => {
      mockGetOverview.mockResolvedValueOnce({
        devices: 10,
        ipAddresses: 15,
        prefixes: 2,
        vlans: 5,
        error: null,
      });

      const response = await GET(new Request('http://localhost/api/netbox'));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.devices).toBe(10);
      expect(data.ipAddresses).toBe(15);
      expect(mockGetOverview).toHaveBeenCalled();
    });

    it('returns test connection status', async () => {
      mockTestConnection.mockResolvedValueOnce({
        ok: true,
        version: '3.5.0',
      });

      const response = await GET(new Request('http://localhost/api/netbox?action=test'));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.version).toBe('3.5.0');
      expect(mockTestConnection).toHaveBeenCalled();
    });
  });

  describe('POST /api/netbox', () => {
    it('creates device via action=create', async () => {
      mockCreateDevice.mockResolvedValueOnce({
        data: { id: 45, name: 'test-device' },
        error: null,
      });

      const response = await POST(
        new Request('http://localhost/api/netbox?action=create', {
          method: 'POST',
          body: JSON.stringify({ name: 'test-device', device_type: 2 }),
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBe(45);
      expect(mockCreateDevice).toHaveBeenCalledWith({ name: 'test-device', device_type: 2 });
    });

    it('returns duplicate check success if device already exists by IP', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: {
          count: 1,
          results: [
            {
              id: 99,
              name: 'existing-device',
              primary_ip4: { address: '192.168.2.55/24' },
            },
          ],
        },
        error: null,
      });

      const response = await POST(
        new Request('http://localhost/api/netbox?action=sync-device', {
          method: 'POST',
          body: JSON.stringify({ ip: '192.168.2.55', name: 'new-name' }),
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.alreadyExists).toBe(true);
      expect(data.id).toBe(99);
      expect(mockCreateDevice).not.toHaveBeenCalled();
    });

    it('syncs single device successfully if it does not exist', async () => {
      // No duplicates
      mockGetDevices.mockResolvedValueOnce({
        data: { count: 0, results: [] },
        error: null,
      });

      mockCreateDevice.mockResolvedValueOnce({
        data: { id: 77, name: 'new-device' },
        error: null,
      });

      const response = await POST(
        new Request('http://localhost/api/netbox?action=sync-device', {
          method: 'POST',
          body: JSON.stringify({
            ip: '192.168.2.77',
            name: 'new-device',
            deviceType: 'server',
            vendor: 'Dell',
          }),
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.created).toBe(true);
      expect(data.id).toBe(77);

      expect(mockCreateDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'new-device',
          role: 10, // Server role maps to id 10
        })
      );
    });

    it('syncs single device with custom roleId and siteId overrides', async () => {
      // No duplicates
      mockGetDevices.mockResolvedValueOnce({
        data: { count: 0, results: [] },
        error: null,
      });

      mockCreateDevice.mockResolvedValueOnce({
        data: { id: 88, name: 'custom-device' },
        error: null,
      });

      const response = await POST(
        new Request('http://localhost/api/netbox?action=sync-device', {
          method: 'POST',
          body: JSON.stringify({
            ip: '192.168.2.88',
            name: 'custom-device',
            roleId: '20',
            siteId: '5',
          }),
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.created).toBe(true);
      expect(data.id).toBe(88);

      expect(mockCreateDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-device',
          role: 20,
          site: 5,
        })
      );
    });
  });
});
