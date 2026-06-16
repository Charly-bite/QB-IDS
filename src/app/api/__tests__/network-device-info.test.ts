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

describe('GET /api/network/device-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 for invalid IP', async () => {
    const { GET } = await import('../../api/network/device-info/route');
    const request = new Request('http://localhost/api/network/device-info?ip=not-an-ip');
    const response = await GET(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid IP');
  });

  it('returns 400 when IP is missing', async () => {
    const { GET } = await import('../../api/network/device-info/route');
    const request = new Request('http://localhost/api/network/device-info');
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns device info with hostname and MAC', async () => {
    let callCount = 0;
    execMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as Function;
      if (cmd.includes('nbtstat')) {
        cb(null, {
          stdout: '    MYSERVER       <00>  Único       Registrado\n    Dirección MAC = AA-BB-CC-DD-EE-FF\n',
          stderr: '',
        });
      } else if (cmd.includes('arp')) {
        cb(null, { stdout: '  192.168.2.10    AA-BB-CC-DD-EE-FF     dynamic\n', stderr: '' });
      }
      callCount++;
    });

    const { GET } = await import('../../api/network/device-info/route');
    const request = new Request('http://localhost/api/network/device-info?ip=192.168.2.10');
    const response = await GET(request);
    const data = await response.json();
    expect(data.ip).toBe('192.168.2.10');
    expect(data.hostname).toBe('MYSERVER');
    expect(data.mac).toBe('AA-BB-CC-DD-EE-FF');
  });

  it('returns null values when commands fail', async () => {
    execMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      cb(new Error('timeout'), { stdout: '', stderr: '' });
    });

    const { GET } = await import('../../api/network/device-info/route');
    const request = new Request('http://localhost/api/network/device-info?ip=192.168.2.10');
    const response = await GET(request);
    const data = await response.json();
    expect(data.ip).toBe('192.168.2.10');
    expect(data.hostname).toBeNull();
    expect(data.mac).toBeNull();
  });
});
