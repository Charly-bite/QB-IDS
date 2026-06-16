import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies
vi.mock('../librenms-api', () => ({
  getDevices: vi.fn(),
}));

vi.mock('../db', () => ({
  getPool: vi.fn(),
}));

import { syncLibreNMSDevices, maybeSyncLibreNMS } from '../librenms-sync';
import { getDevices } from '../librenms-api';
import { getPool } from '../db';

const mockGetDevices = vi.mocked(getDevices);
const mockGetPool = vi.mocked(getPool);

describe('librenms-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncLibreNMSDevices', () => {
    it('returns error when LibreNMS API fails', async () => {
      mockGetDevices.mockResolvedValueOnce({ data: null, error: 'API timeout' });

      const result = await syncLibreNMSDevices();
      expect(result.synced).toBe(0);
      expect(result.total).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('API timeout');
    });

    it('returns zero synced for empty device list', async () => {
      mockGetDevices.mockResolvedValueOnce({ data: { devices: [] }, error: null });

      const result = await syncLibreNMSDevices();
      expect(result.synced).toBe(0);
      expect(result.total).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('syncs devices successfully', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: {
          devices: [
            { device_id: 1, hostname: '192.168.2.1', ip: '192.168.2.1', os: 'linux', hardware: 'x86_64', uptime: 86400, last_polled: '2025-01-01' },
            { device_id: 2, hostname: '192.168.2.2', ip: '192.168.2.2', os: 'windows', hardware: 'Dell', uptime: 3600, last_polled: '2025-01-01' },
          ],
        },
        error: null,
      });

      const mockRequest = {
        input: vi.fn().mockReturnThis(),
        query: vi.fn().mockResolvedValue({}),
      };
      mockGetPool.mockResolvedValueOnce({
        request: vi.fn(() => mockRequest),
      } as unknown as ReturnType<typeof getPool> extends Promise<infer T> ? T : never);

      const result = await syncLibreNMSDevices();
      expect(result.synced).toBe(2);
      expect(result.total).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('skips devices without IP or hostname', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: {
          devices: [
            { device_id: 1, hostname: '', ip: '', os: 'linux' },
          ],
        },
        error: null,
      });

      const mockRequest = {
        input: vi.fn().mockReturnThis(),
        query: vi.fn().mockResolvedValue({}),
      };
      mockGetPool.mockResolvedValueOnce({
        request: vi.fn(() => mockRequest),
      } as unknown as ReturnType<typeof getPool> extends Promise<infer T> ? T : never);

      const result = await syncLibreNMSDevices();
      // Device with empty IP/hostname is skipped
      expect(result.total).toBe(1);
    });

    it('records per-device errors', async () => {
      mockGetDevices.mockResolvedValueOnce({
        data: {
          devices: [
            { device_id: 1, hostname: '192.168.2.1', ip: '192.168.2.1', os: 'linux' },
          ],
        },
        error: null,
      });

      const mockRequest = {
        input: vi.fn().mockReturnThis(),
        query: vi.fn().mockRejectedValue(new Error('SQL error')),
      };
      mockGetPool.mockResolvedValueOnce({
        request: vi.fn(() => mockRequest),
      } as unknown as ReturnType<typeof getPool> extends Promise<infer T> ? T : never);

      const result = await syncLibreNMSDevices();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('SQL error');
    });

    it('handles unexpected top-level error', async () => {
      mockGetDevices.mockRejectedValueOnce(new Error('Network down'));

      const result = await syncLibreNMSDevices();
      expect(result.synced).toBe(0);
      expect(result.errors[0]).toContain('Sync failed');
    });
  });

  describe('maybeSyncLibreNMS', () => {
    it('does not throw', async () => {
      mockGetDevices.mockResolvedValue({ data: { devices: [] }, error: null });
      await expect(maybeSyncLibreNMS()).resolves.not.toThrow();
    });
  });
});
