import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({
  initDatabase: vi.fn(),
  getPool: vi.fn(async () => ({
    request: () => ({ query: mockQuery }),
  })),
}));

describe('GET /api/network/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exports devices as JSON', async () => {
    mockQuery.mockResolvedValueOnce({
      recordset: [
        { ip: '192.168.2.1', name: 'Server', status: 'Online', latency: 5, is_monitored: true },
      ],
    });

    const { GET } = await import('../../api/network/export/route');
    const request = new Request('http://localhost/api/network/export?format=json');
    const response = await GET(request);
    const data = await response.json();
    expect(data.devices).toHaveLength(1);
    expect(data.exportedAt).toBeDefined();
  });

  it('exports devices as CSV (default)', async () => {
    mockQuery.mockResolvedValueOnce({
      recordset: [
        { ip: '192.168.2.1', name: 'My Server', status: 'Online', latency: 5, mac_address: 'AA:BB:CC:DD:EE:FF', vendor: 'Dell', device_type: 'server', hostname: null, netbios_name: null, domain: null, os_fingerprint: 'Linux', open_ports: '22,80', http_title: 'Welcome', http_server: 'nginx', shared_folders: null, ttl: 64, is_monitored: true, last_seen: '2026-06-16', created_at: '2026-06-01', subnet: '192.168.2' },
      ],
    });

    const { GET } = await import('../../api/network/export/route');
    const request = new Request('http://localhost/api/network/export');
    const response = await GET(request);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain('IP,Name');
    expect(csv).toContain('192.168.2.1');
  });

  it('returns 500 on database error', async () => {
    const { initDatabase } = await import('@/lib/db');
    (initDatabase as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB down'));

    const { GET } = await import('../../api/network/export/route');
    const request = new Request('http://localhost/api/network/export');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
