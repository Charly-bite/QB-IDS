import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('wmi-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
      const cb = typeof _opts === 'function' ? _opts : _cb;
      if (cb) (cb as Function)(null, { stdout: '', stderr: '' });
    });
  });

  describe('queryWMI', () => {
    it('parses full WMI profile successfully', async () => {
      const csvOutputs = [
        'Node,Caption,FreePhysicalMemory,OSArchitecture,TotalVisibleMemorySize,Version\r\nPC1,Windows 10 Pro,4000000,64-bit,8000000,10.0.19045\r\n',
        'Node,Name,NumberOfCores,NumberOfLogicalProcessors\r\nPC1,Intel Core i7-12700,8,16\r\n',
        'Node,Domain,Manufacturer,Model,SystemType,UserName\r\nPC1,QBOSS,Dell,OptiPlex,x64-based PC,Carlos\r\n',
        'Node,FileSystem,FreeSpace,Name,Size\r\nPC1,NTFS,500000000000,C:,1000000000000\r\n',
        'Node,MACAddress,Name,Speed\r\nPC1,AA:BB:CC:DD:EE:FF,Intel Ethernet,1000000000\r\n',
        'Node,Manufacturer,SMBIOSBIOSVersion,SerialNumber\r\nPC1,Dell Inc.,1.5.0,ABC123\r\n',
      ];

      let callCount = 0;
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(null, { stdout: csvOutputs[callCount++] || '', stderr: '' });
      });

      const { queryWMI } = await import('../wmi-probe');
      const result = await queryWMI('192.168.2.10');
      expect(result.accessible).toBe(true);
      expect(result.error).toBeNull();
      expect(result.os?.caption).toBe('Windows 10 Pro');
      expect(result.os?.version).toBe('10.0.19045');
      expect(result.cpu?.name).toBe('Intel Core i7-12700');
      expect(result.cpu?.cores).toBe(8);
      expect(result.system?.manufacturer).toBe('Dell');
      expect(result.system?.model).toBe('OptiPlex');
      expect(result.disks).toHaveLength(1);
      expect(result.nics).toHaveLength(1);
      expect(result.bios?.manufacturer).toBe('Dell Inc.');
    });

    it('returns error when no data returned', async () => {
      const { queryWMI } = await import('../wmi-probe');
      const result = await queryWMI('192.168.2.10');
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('No data returned');
    });

    it('handles access denied error (caught by wmicQuery, returns no data)', async () => {
      // wmicQuery catches exec errors and returns [] — so queryWMI sees empty rows
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(new Error('Acceso denegado'), { stdout: '', stderr: '' });
      });

      const { queryWMI } = await import('../wmi-probe');
      const result = await queryWMI('192.168.2.10');
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('No data returned');
    });

    it('handles RPC error (caught by wmicQuery, returns no data)', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(new Error('RPC server is unavailable'), { stdout: '', stderr: '' });
      });

      const { queryWMI } = await import('../wmi-probe');
      const result = await queryWMI('192.168.2.10');
      expect(result.error).toContain('No data returned');
    });

    it('handles unknown error (caught by wmicQuery, returns no data)', async () => {
      execMock.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
        const cb = typeof _opts === 'function' ? _opts : _cb;
        (cb as Function)(new Error('Something went wrong'), { stdout: '', stderr: '' });
      });

      const { queryWMI } = await import('../wmi-probe');
      const result = await queryWMI('192.168.2.10');
      expect(result.error).toContain('No data returned');
    });
  });

  describe('queryWMIBatch', () => {
    it('queries multiple hosts in batches with progress', async () => {
      const { queryWMIBatch } = await import('../wmi-probe');
      const progress = vi.fn();
      const results = await queryWMIBatch(['192.168.2.1', '192.168.2.2', '192.168.2.3'], 2, progress);
      expect(results).toHaveLength(3);
      expect(progress).toHaveBeenCalled();
    });
  });
});
