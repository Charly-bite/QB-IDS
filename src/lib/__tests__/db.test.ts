import { describe, it, expect, vi, beforeEach } from 'vitest';
import sql from 'mssql';

const mockSql = vi.mocked(sql);

describe('db', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('getPool', () => {
    it('creates new connection on first call', async () => {
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: vi.fn().mockResolvedValue({ recordset: [] }) })),
      };
      mockSql.connect.mockResolvedValueOnce(mockPool as unknown as sql.ConnectionPool);

      const { getPool } = await import('../db');
      const pool = await getPool();
      expect(pool).toBeDefined();
      expect(mockSql.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('initDatabase', () => {
    it('creates tables and runs migrations', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ recordset: [] });
      const mockRequest = vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery }));
      const mockPool = {
        connected: true,
        request: mockRequest,
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { initDatabase } = await import('../db');
      await initDatabase();

      // Should run table creation + all migration queries
      expect(mockQuery).toHaveBeenCalled();
      const queryCount = mockQuery.mock.calls.length;
      // Table creation (2) + migrations v1-v5 (5) = at least 7 queries
      expect(queryCount).toBeGreaterThanOrEqual(7);
    });

    it('throws on database error', async () => {
      const mockQuery = vi.fn().mockRejectedValue(new Error('DB connection failed'));
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { initDatabase } = await import('../db');
      await expect(initDatabase()).rejects.toThrow('DB connection failed');
    });
  });

  describe('getAllDevices', () => {
    it('returns devices from database', async () => {
      const devices = [
        { ip: '192.168.2.1', name: 'Server', status: 'Online' },
        { ip: '192.168.2.2', name: 'Switch', status: 'Online' },
      ];
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn().mockResolvedValue({ recordset: devices }),
        })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { getAllDevices } = await import('../db');
      const result = await getAllDevices();
      expect(result).toEqual(devices);
    });
  });

  describe('upsertDevice', () => {
    it('executes MERGE query with all parameters', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockInput = vi.fn().mockReturnThis();
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: mockInput, query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { upsertDevice } = await import('../db');
      await upsertDevice(
        '192.168.2.100', 'Online', 5, '192.168.2',
        'host1', 'AA:BB:CC:DD:EE:FF', 'Dell',
        '22,80', 'Windows', 128, 'workstation',
        'HOST1', 'DOMAIN', '["Share1"]',
        'Login Page', 'IIS/10.0',
        '{"22":"SSH-2.0-OpenSSH"}',
        'example.com', 'DigiCert', '2025-12-31', false,
        'NAS Device', '["_http._tcp"]'
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockInput).toHaveBeenCalled();
    });

    it('handles null optional parameters', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { upsertDevice } = await import('../db');
      await upsertDevice('192.168.2.100', 'Offline', 0, '192.168.2');
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('updateDevice', () => {
    it('updates name only', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockInput = vi.fn().mockReturnThis();
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: mockInput, query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { updateDevice } = await import('../db');
      await updateDevice('192.168.2.1', { name: 'New Name' });
      expect(mockQuery).toHaveBeenCalled();
    });

    it('updates device_type', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { updateDevice } = await import('../db');
      await updateDevice('192.168.2.1', { device_type: 'server' });
      expect(mockQuery).toHaveBeenCalled();
    });

    it('updates is_monitored', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { updateDevice } = await import('../db');
      await updateDevice('192.168.2.1', { is_monitored: true });
      expect(mockQuery).toHaveBeenCalled();
    });

    it('does nothing with empty updates', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { updateDevice } = await import('../db');
      await updateDevice('192.168.2.1', {});
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('recordScan', () => {
    it('inserts scan record', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { recordScan } = await import('../db');
      await recordScan('192.168.2', 45);
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('seedKnownDevices', () => {
    it('seeds multiple devices', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { seedKnownDevices } = await import('../db');
      await seedKnownDevices([
        { ip: '192.168.2.1', name: 'Server1', type: 'server' },
        { ip: '192.168.2.2', name: 'Switch1', type: 'switch' },
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('handles empty array', async () => {
      const mockQuery = vi.fn().mockResolvedValue({});
      const mockPool = {
        connected: true,
        request: vi.fn(() => ({ input: vi.fn().mockReturnThis(), query: mockQuery })),
      };
      mockSql.connect.mockResolvedValue(mockPool as unknown as sql.ConnectionPool);

      const { seedKnownDevices } = await import('../db');
      await seedKnownDevices([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
