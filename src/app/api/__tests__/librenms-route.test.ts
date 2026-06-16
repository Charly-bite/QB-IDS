import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('@/lib/librenms-api', () => ({
  getDevices: vi.fn(),
  getAlerts: vi.fn(),
  getDevice: vi.fn(),
  getDevicePorts: vi.fn(),
  getDeviceAvailability: vi.fn(),
  getDeviceHealth: vi.fn(),
  getDeviceHealthCategories: vi.fn(),
  getDeviceGraphImage: vi.fn(),
  getDeviceMetrics: vi.fn(),
  testConnection: vi.fn(),
  getGraphConfig: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getAllDevices: vi.fn(),
}));

vi.mock('@/lib/librenms-sync', () => ({
  maybeSyncLibreNMS: vi.fn(),
}));

import { GET } from '../../api/librenms/route';
import * as api from '@/lib/librenms-api';
import { getAllDevices } from '@/lib/db';

const mockGetDevices = vi.mocked(api.getDevices);
const mockGetAlerts = vi.mocked(api.getAlerts);
const mockGetDevice = vi.mocked(api.getDevice);
const mockGetDevicePorts = vi.mocked(api.getDevicePorts);
const mockGetDeviceAvailability = vi.mocked(api.getDeviceAvailability);
const mockGetDeviceHealthCategories = vi.mocked(api.getDeviceHealthCategories);
const mockGetDeviceHealth = vi.mocked(api.getDeviceHealth);
const mockGetDeviceGraphImage = vi.mocked(api.getDeviceGraphImage);
const mockGetDeviceMetrics = vi.mocked(api.getDeviceMetrics);
const mockTestConnection = vi.mocked(api.testConnection);
const mockGetAllDevices = vi.mocked(getAllDevices);

function makeRequest(action: string, params: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/librenms');
  url.searchParams.set('action', action);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }
  return new Request(url.toString());
}

describe('GET /api/librenms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('action=test', () => {
    it('returns connectivity test result', async () => {
      mockTestConnection.mockResolvedValueOnce({ connected: true, version: '24.1.0' } as never);
      const response = await GET(makeRequest('test'));
      const data = await response.json();
      expect(data.connected).toBe(true);
    });
  });

  describe('action=devices', () => {
    it('returns devices list', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: { devices: [{ device_id: 1, hostname: 'switch01' }] },
        error: null,
      });

      const response = await GET(makeRequest('devices'));
      const data = await response.json();
      expect(data.devices).toHaveLength(1);
      expect(data.devices[0].hostname).toBe('switch01');
    });

    it('returns 502 on API error', async () => {
      mockGetDevices.mockResolvedValueOnce({ data: null, error: 'Connection refused' });

      const response = await GET(makeRequest('devices'));
      expect(response.status).toBe(502);
      const data = await response.json();
      expect(data.error).toBe('Connection refused');
    });
  });

  describe('action=alerts', () => {
    it('returns active alerts', async () => {
      mockGetAlerts.mockResolvedValueOnce({
        data: { alerts: [{ id: 1, hostname: 'switch01', rule: 'Device Down' }] },
        error: null,
      });

      const response = await GET(makeRequest('alerts'));
      const data = await response.json();
      expect(data.alerts).toHaveLength(1);
    });

    it('returns 502 on alert API error', async () => {
      mockGetAlerts.mockResolvedValueOnce({ data: null, error: 'Timeout' });
      const response = await GET(makeRequest('alerts'));
      expect(response.status).toBe(502);
    });
  });

  describe('action=device', () => {
    it('returns 400 without id', async () => {
      const response = await GET(makeRequest('device'));
      expect(response.status).toBe(400);
    });

    it('returns device detail with ports and availability', async () => {
      mockGetDevice.mockResolvedValueOnce({ data: { devices: [{ device_id: 1 }] }, error: null });
      mockGetDevicePorts.mockResolvedValueOnce({ data: { ports: [] }, error: null });
      mockGetDeviceAvailability.mockResolvedValueOnce({ data: { availability: [] }, error: null });
      mockGetDeviceHealthCategories.mockResolvedValueOnce({ data: { graphs: [] }, error: null });

      const response = await GET(makeRequest('device', { id: '1' }));
      const data = await response.json();
      expect(data.device).toBeDefined();
      expect(data.ports).toBeDefined();
      expect(data.availability).toBeDefined();
      expect(data.healthCategories).toBeDefined();
    });
  });

  describe('action=device-by-ip', () => {
    it('returns 400 without ip', async () => {
      const response = await GET(makeRequest('device-by-ip'));
      expect(response.status).toBe(400);
    });

    it('returns found=false when device not found', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: { devices: [{ device_id: 1, hostname: '192.168.2.1', ip: '192.168.2.1' }] },
        error: null,
      });

      const response = await GET(makeRequest('device-by-ip', { ip: '10.0.0.1' }));
      const data = await response.json();
      expect(data.found).toBe(false);
    });

    it('returns device when found by IP', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: { devices: [{ device_id: 1, hostname: 'switch01', ip: '192.168.2.100', status: 1, os: 'ios' }] },
        error: null,
      });
      mockGetDeviceAvailability.mockResolvedValueOnce({ data: { availability: [] }, error: null });
      mockGetDeviceHealthCategories.mockResolvedValueOnce({ data: { graphs: [] }, error: null });

      // Need a fresh module to clear the devicesCache
      const { GET: freshGET } = await import('../../api/librenms/route');
      const response = await freshGET(makeRequest('device-by-ip', { ip: '192.168.2.100' }));
      const data = await response.json();
      expect(data.found).toBe(true);
      expect(data.device.device_id).toBe(1);
    });
  });

  describe('action=graph', () => {
    it('returns 400 without id', async () => {
      const response = await GET(makeRequest('graph'));
      expect(response.status).toBe(400);
    });

    it('returns 502 on graph error', async () => {
      mockGetDeviceGraphImage.mockResolvedValueOnce({
        data: null,
        error: 'Not found',
        contentType: 'image/png',
      });

      const response = await GET(makeRequest('graph', { id: '1', type: 'device_processor' }));
      expect(response.status).toBe(502);
    });

    it('returns graph image binary', async () => {
      const buf = new ArrayBuffer(8);
      mockGetDeviceGraphImage.mockResolvedValueOnce({
        data: buf,
        error: null,
        contentType: 'image/png',
      });

      const response = await GET(makeRequest('graph', { id: '1', type: 'device_processor' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
    });
  });

  describe('action=health', () => {
    it('returns 400 without id', async () => {
      const response = await GET(makeRequest('health'));
      expect(response.status).toBe(400);
    });

    it('returns health data', async () => {
      mockGetDeviceHealth.mockResolvedValueOnce({ data: { sensors: [] }, error: null });
      const response = await GET(makeRequest('health', { id: '1' }));
      const data = await response.json();
      expect(data.sensors).toBeDefined();
    });
  });

  describe('action=device-metrics', () => {
    it('returns 400 without id', async () => {
      const response = await GET(makeRequest('device-metrics'));
      expect(response.status).toBe(400);
    });

    it('returns aggregated metrics', async () => {
      mockGetDeviceMetrics.mockResolvedValueOnce({
        cpu: { average: 42, processors: [] },
        memory: null,
        storage: [],
        ports: [],
        uptimePercent: 99.9,
      });

      const response = await GET(makeRequest('device-metrics', { id: '1' }));
      const data = await response.json();
      expect(data.cpu.average).toBe(42);
      expect(data.uptimePercent).toBe(99.9);
    });
  });

  describe('action=overview (default)', () => {
    it('returns dashboard overview', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: { devices: [
          { device_id: 1, hostname: 'sw01', status: 1, os: 'linux' },
          { device_id: 2, hostname: 'sw02', status: 0, os: 'linux' },
        ] },
        error: null,
      });
      mockGetAlerts.mockResolvedValueOnce({
        data: { alerts: [{ id: 1, hostname: 'sw02', rule: 'Down' }] },
        error: null,
      });

      const { GET: freshGET } = await import('../../api/librenms/route');
      const response = await freshGET(makeRequest('overview'));
      const data = await response.json();
      expect(data.summary.totalDevices).toBe(2);
      expect(data.summary.devicesUp).toBe(1);
      expect(data.summary.devicesDown).toBe(1);
      expect(data.summary.activeAlerts).toBe(1);
      expect(data.summary.osCounts.linux).toBe(2);
    });
  });

  describe('action=overview-enriched', () => {
    it('enriches LibreNMS devices with Panel Control data', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: { devices: [
          { device_id: 1, hostname: 'switch01', ip: '192.168.2.10', status: 1, os: 'ios' },
        ] },
        error: null,
      });
      mockGetAlerts.mockResolvedValueOnce({ data: { alerts: [] }, error: null });
      mockGetAllDevices.mockResolvedValueOnce([
        { ip: '192.168.2.10', name: 'Main Switch', device_type: 'switch', status: 'Online', latency: 5, is_monitored: true },
      ] as never);

      const { GET: freshGET } = await import('../../api/librenms/route');
      const response = await freshGET(makeRequest('overview-enriched'));
      const data = await response.json();
      expect(data.summary.crossLinked).toBe(1);
      expect(data.devices[0].panelControl.name).toBe('Main Switch');
    });
  });

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockTestConnection.mockRejectedValueOnce(new Error('Fatal'));
      const response = await GET(makeRequest('test'));
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Internal server error');
    });
  });
});
