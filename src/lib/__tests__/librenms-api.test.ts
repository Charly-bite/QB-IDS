import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need env vars set BEFORE module import, so we use dynamic imports
// after manipulating process.env directly
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('librenms-api', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LIBRENMS_API_TOKEN = 'test-token-123';
    process.env.LIBRENMS_API_URL = 'http://test-librenms:8000/api/v0';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('librenmsRequest (tested via exported functions)', () => {
    it('returns error when token is not configured', async () => {
      process.env.LIBRENMS_API_TOKEN = '';
      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.data).toBeNull();
      expect(result.error).toBe('LIBRENMS_API_TOKEN not configured');
    });

    it('returns data on successful response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [{ device_id: 1, hostname: 'test' }] }),
      });

      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ devices: [{ device_id: 1, hostname: 'test' }] });
    });

    it('includes auth header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { getDevices } = await import('../librenms-api');
      await getDevices();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Auth-Token': 'test-token-123',
          }),
        }),
      );
    });

    it('returns error on HTTP error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.data).toBeNull();
      expect(result.error).toContain('HTTP 500');
    });

    it('handles text read failure on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => { throw new Error('read failed'); },
      });

      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.data).toBeNull();
      expect(result.error).toContain('HTTP 404');
    });

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.data).toBeNull();
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('returns error on abort (timeout)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { getDevices } = await import('../librenms-api');
      const result = await getDevices();
      expect(result.data).toBeNull();
      expect(result.error).toBe('Request timed out');
    });

    it('sends Content-Type header when body is provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const { addDevice } = await import('../librenms-api');
      await addDevice('192.168.2.100');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('getDevices', () => {
    it('calls /devices endpoint', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ devices: [] }) });
      const { getDevices } = await import('../librenms-api');
      await getDevices();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices',
        expect.anything(),
      );
    });
  });

  describe('getDevice', () => {
    it('calls /devices/{id} with number', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ devices: [] }) });
      const { getDevice } = await import('../librenms-api');
      await getDevice(5);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/5',
        expect.anything(),
      );
    });

    it('calls /devices/{hostname} with string', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ devices: [] }) });
      const { getDevice } = await import('../librenms-api');
      await getDevice('switch01');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/switch01',
        expect.anything(),
      );
    });
  });

  describe('getAlerts', () => {
    it('calls /alerts?state=1', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ alerts: [] }) });
      const { getAlerts } = await import('../librenms-api');
      await getAlerts();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/alerts?state=1'),
        expect.anything(),
      );
    });
  });

  describe('getAllAlerts', () => {
    it('calls /alerts without state filter', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ alerts: [] }) });
      const { getAllAlerts } = await import('../librenms-api');
      await getAllAlerts();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/alerts',
        expect.anything(),
      );
    });
  });

  describe('getDevicePorts', () => {
    it('calls /devices/{id}/ports', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ports: [] }) });
      const { getDevicePorts } = await import('../librenms-api');
      await getDevicePorts(3);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/3/ports',
        expect.anything(),
      );
    });
  });

  describe('getDeviceGraphs', () => {
    it('calls /devices/{id}/graphs', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ graphs: [] }) });
      const { getDeviceGraphs } = await import('../librenms-api');
      await getDeviceGraphs(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/graphs'),
        expect.anything(),
      );
    });
  });

  describe('getDeviceAvailability', () => {
    it('calls /devices/{id}/availability', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ availability: [] }) });
      const { getDeviceAvailability } = await import('../librenms-api');
      await getDeviceAvailability(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/2/availability'),
        expect.anything(),
      );
    });
  });

  describe('getSystemInfo', () => {
    it('calls /system', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ system_name: 'test' }) });
      const { getSystemInfo } = await import('../librenms-api');
      await getSystemInfo();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/system',
        expect.anything(),
      );
    });
  });

  describe('getDeviceHealthCategories', () => {
    it('calls /devices/{id}/health', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ graphs: [], count: 0 }) });
      const { getDeviceHealthCategories } = await import('../librenms-api');
      await getDeviceHealthCategories(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/health'),
        expect.anything(),
      );
    });
  });

  describe('getDeviceHealth', () => {
    it('calls /devices/{id}/health without sensor type', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const { getDeviceHealth } = await import('../librenms-api');
      await getDeviceHealth(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/1/health',
        expect.anything(),
      );
    });

    it('calls /devices/{id}/health/{type} with sensor type', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const { getDeviceHealth } = await import('../librenms-api');
      await getDeviceHealth(1, 'temperature');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/1/health/temperature',
        expect.anything(),
      );
    });
  });

  describe('getDeviceGraphImage', () => {
    it('returns buffer on success', async () => {
      const mockArrayBuffer = new ArrayBuffer(4);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
        headers: { get: (key: string) => key === 'content-type' ? 'image/png' : null },
      });

      const { getDeviceGraphImage } = await import('../librenms-api');
      const result = await getDeviceGraphImage(1, 'device_processor');
      expect(result.data).not.toBeNull();
      expect(result.error).toBeNull();
      expect(result.contentType).toBe('image/png');
    });

    it('returns error when token is missing', async () => {
      process.env.LIBRENMS_API_TOKEN = '';
      const { getDeviceGraphImage } = await import('../librenms-api');
      const result = await getDeviceGraphImage(1, 'device_processor');
      expect(result.data).toBeNull();
      expect(result.error).toBe('LIBRENMS_API_TOKEN not configured');
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { getDeviceGraphImage } = await import('../librenms-api');
      const result = await getDeviceGraphImage(1, 'device_processor');
      expect(result.data).toBeNull();
      expect(result.error).toContain('HTTP 404');
    });

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { getDeviceGraphImage } = await import('../librenms-api');
      const result = await getDeviceGraphImage(1, 'device_processor');
      expect(result.data).toBeNull();
      expect(result.error).toContain('Network error');
    });

    it('uses default content-type when header missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: { get: () => null },
      });

      const { getDeviceGraphImage } = await import('../librenms-api');
      const result = await getDeviceGraphImage(1, 'device_processor');
      expect(result.contentType).toBe('image/png');
    });
  });

  describe('searchDevices', () => {
    it('encodes query parameter', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ devices: [] }) });
      const { searchDevices } = await import('../librenms-api');
      await searchDevices('my server');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=my%20server'),
        expect.anything(),
      );
    });
  });

  describe('addDevice', () => {
    it('sends POST with device details', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const { addDevice } = await import('../librenms-api');
      await addDevice('192.168.2.100', 'v2c', 'public');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('192.168.2.100'),
        }),
      );
    });
  });

  describe('deleteDevice', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const { deleteDevice } = await import('../librenms-api');
      await deleteDevice(5);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-librenms:8000/api/v0/devices/5',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('testConnection', () => {
    it('returns connected: true on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ system_name: 'librenms' }),
      });

      const { testConnection } = await import('../librenms-api');
      const result = await testConnection();
      expect(result.connected).toBe(true);
    });

    it('returns connected: false on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { testConnection } = await import('../librenms-api');
      const result = await testConnection();
      expect(result.connected).toBe(false);
    });
  });

  describe('getDeviceProcessors', () => {
    it('calls /devices/{id}/processors', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ processors: [] }) });
      const { getDeviceProcessors } = await import('../librenms-api');
      await getDeviceProcessors(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/processors'),
        expect.anything(),
      );
    });
  });

  describe('getDeviceMemory', () => {
    it('calls /devices/{id}/mempools', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ mempools: [] }) });
      const { getDeviceMemory } = await import('../librenms-api');
      await getDeviceMemory(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/mempools'),
        expect.anything(),
      );
    });
  });

  describe('getDeviceStorage', () => {
    it('calls /devices/{id}/storage', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ storage: [] }) });
      const { getDeviceStorage } = await import('../librenms-api');
      await getDeviceStorage(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/storage'),
        expect.anything(),
      );
    });
  });

  describe('getDeviceIpAddresses', () => {
    it('calls /devices/{id}/ip', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ addresses: [] }) });
      const { getDeviceIpAddresses } = await import('../librenms-api');
      await getDeviceIpAddresses(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/ip'),
        expect.anything(),
      );
    });
  });

  describe('getDevicePortsTraffic', () => {
    it('calls /devices/{id}/ports with columns', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ports: [] }) });
      const { getDevicePortsTraffic } = await import('../librenms-api');
      await getDevicePortsTraffic(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/devices/1/ports?columns='),
        expect.anything(),
      );
    });
  });

  describe('getDeviceMetrics', () => {
    it('aggregates all metrics in parallel', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ processors: [{ processor_usage: 50 }, { processor_usage: 70 }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ mempools: [{ mempool_used: 4096, mempool_total: 8192, mempool_perc: 50, mempool_descr: 'RAM' }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ storage: [{ storage_descr: 'C:', storage_size: 1000, storage_used: 500, storage_free: 500, storage_perc: 50, storage_units: 1 }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ports: [{ ifName: 'eth0', ifAlias: '', ifOperStatus: 'up', ifAdminStatus: 'up', ifSpeed: 1000000000, ifInOctets_rate: 1000, ifOutOctets_rate: 2000 }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ availability: [{ duration: 86400, availability_perc: 99.9 }] }) });

      const { getDeviceMetrics } = await import('../librenms-api');
      const metrics = await getDeviceMetrics(1);

      expect(metrics.cpu.average).toBe(60);
      expect(metrics.cpu.processors).toHaveLength(2);
      expect(metrics.memory).not.toBeNull();
      expect(metrics.memory!.percent).toBe(50);
      expect(metrics.storage).toHaveLength(1);
      expect(metrics.ports).toHaveLength(1);
      expect(metrics.ports[0].name).toBe('eth0');
      expect(metrics.uptimePercent).toBe(99.9);
    });

    it('handles empty responses', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const { getDeviceMetrics } = await import('../librenms-api');
      const metrics = await getDeviceMetrics(1);
      expect(metrics.cpu.average).toBeNull();
      expect(metrics.memory).toBeNull();
      expect(metrics.storage).toHaveLength(0);
      expect(metrics.ports).toHaveLength(0);
      expect(metrics.uptimePercent).toBeNull();
    });

    it('filters out down ports', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ports: [
          { ifName: 'eth0', ifOperStatus: 'up', ifSpeed: 1000000000, ifInOctets_rate: 100, ifOutOctets_rate: 200 },
          { ifName: 'eth1', ifOperStatus: 'down', ifSpeed: 0, ifInOctets_rate: 0, ifOutOctets_rate: 0 },
        ] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const { getDeviceMetrics } = await import('../librenms-api');
      const metrics = await getDeviceMetrics(1);
      expect(metrics.ports).toHaveLength(1);
      expect(metrics.ports[0].name).toBe('eth0');
    });
  });

  describe('getGraphConfig', () => {
    it('returns API URL and token', async () => {
      const { getGraphConfig } = await import('../librenms-api');
      const config = getGraphConfig();
      expect(config.apiUrl).toBe('http://test-librenms:8000/api/v0');
      expect(config.token).toBe('test-token-123');
    });
  });

  describe('getAllDevicesStorage', () => {
    it('returns ranked partitions from all online devices', async () => {
      // Call 1: getDevices
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          devices: [
            { device_id: 1, hostname: 'server1', sysName: 'srv1', ip: '192.168.2.1', os: 'linux', status: 1 },
            { device_id: 2, hostname: 'server2', sysName: 'srv2', ip: '192.168.2.2', os: 'linux', status: 0 }, // offline
          ],
        }),
      });
      // Call 2: getDeviceStorage for device 1 (only online)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          storage: [
            { storage_descr: '/root', storage_type: 'ext4', storage_size: 1000, storage_used: 800, storage_free: 200, storage_perc: 80, storage_units: 1 },
          ],
        }),
      });

      const { getAllDevicesStorage } = await import('../librenms-api');
      const result = await getAllDevicesStorage();
      expect(result.error).toBeNull();
      expect(result.partitions).toHaveLength(1);
      expect(result.partitions[0].hostname).toBe('server1');
      expect(result.partitions[0].percent).toBe(80);
    });

    it('returns empty when no devices exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [] }),
      });

      const { getAllDevicesStorage } = await import('../librenms-api');
      const result = await getAllDevicesStorage();
      expect(result.partitions).toHaveLength(0);
    });

    it('handles failed storage queries gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          devices: [{ device_id: 1, hostname: 'server1', status: 1 }],
        }),
      });
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const { getAllDevicesStorage } = await import('../librenms-api');
      const result = await getAllDevicesStorage();
      expect(result.partitions).toHaveLength(0);
    });
  });
});
