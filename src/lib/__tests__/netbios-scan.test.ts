import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting — needed to share mock refs
const { execMock } = vi.hoisted(() => {
  const execMock = vi.fn((_cmd: string, _opts: unknown, _cb?: Function) => {
    const cb = typeof _opts === 'function' ? _opts : _cb;
    if (cb) (cb as Function)(null, { stdout: '', stderr: '' });
  });
  return { execMock };
});

vi.mock('child_process', () => ({
  default: { exec: execMock },
  exec: execMock,
}));

import { queryNetBIOS, queryNetBIOSBatch } from '../netbios-scan';

describe('netbios-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
      const cb = typeof _opts === 'function' ? _opts : _cb;
      if (cb) (cb as Function)(null, { stdout: '', stderr: '' });
    });
  });

  describe('queryNetBIOS', () => {
    it('parses computer name (Spanish nbtstat output)', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(null, {
          stdout: `
    QB_WFS_002     <00>  Único       Registrado
    QBOSS          <00>  Grupo       Registrado
    QB_WFS_002     <20>  Único       Registrado

    Dirección MAC = 00-1A-A0-12-34-56
`,
          stderr: '',
        });
      });

      const result = await queryNetBIOS('192.168.2.10');
      expect(result.computerName).toBe('QB_WFS_002');
      expect(result.domain).toBe('QBOSS');
      expect(result.isFileServer).toBe(true);
      expect(result.mac).toBe('00-1A-A0-12-34-56');
    });

    it('parses English nbtstat output', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(null, {
          stdout: `
    WORKSTATION1   <00>  Unique      Registered
    DOMAIN         <00>  Group       Registered
    WORKSTATION1   <20>  Unique      Registered

    MAC Address = AA-BB-CC-DD-EE-FF
`,
          stderr: '',
        });
      });

      const result = await queryNetBIOS('192.168.2.10');
      expect(result.computerName).toBe('WORKSTATION1');
      expect(result.domain).toBe('DOMAIN');
      expect(result.isFileServer).toBe(true);
      expect(result.mac).toBe('AA-BB-CC-DD-EE-FF');
    });

    it('returns empty result on error', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(new Error('timeout'), { stdout: '', stderr: '' });
      });

      const result = await queryNetBIOS('192.168.2.10');
      expect(result.computerName).toBeNull();
      expect(result.domain).toBeNull();
      expect(result.isFileServer).toBe(false);
      expect(result.mac).toBeNull();
    });

    it('handles host without file server (<20>) service', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(null, {
          stdout: `
    MYPC           <00>  Único       Registrado
    WORKGROUP      <00>  Grupo       Registrado

    Dirección MAC = 11-22-33-44-55-66
`,
          stderr: '',
        });
      });

      const result = await queryNetBIOS('192.168.2.10');
      expect(result.computerName).toBe('MYPC');
      expect(result.domain).toBe('WORKGROUP');
      expect(result.isFileServer).toBe(false);
    });

    it('sets ip from input parameter', async () => {
      const result = await queryNetBIOS('10.0.0.5');
      expect(result.ip).toBe('10.0.0.5');
    });
  });

  describe('queryNetBIOSBatch', () => {
    it('queries multiple hosts in batches', async () => {
      const progress = vi.fn();
      const results = await queryNetBIOSBatch(
        ['192.168.2.1', '192.168.2.2', '192.168.2.3'],
        2,
        progress
      );
      expect(results).toHaveLength(3);
      expect(progress).toHaveBeenCalled();
    });
  });
});
