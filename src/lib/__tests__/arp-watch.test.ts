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

import { compareARPTables, setARPBaseline, getARPBaseline, getCurrentARPTable, runARPWatch, type ARPEntry, type ARPAlert } from '../arp-watch';

describe('arp-watch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const key = '__panelcontrol_arp_baseline__';
    delete (globalThis as Record<string, unknown>)[key];
  });

  describe('compareARPTables', () => {
    it('detects new device (IP not in baseline)', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.100', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'TestVendor' },
      ];
      const baseline: ARPEntry[] = [];

      const alerts = compareARPTables(current, baseline);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('new_device');
      expect(alerts[0].severity).toBe('info');
      expect(alerts[0].ip).toBe('192.168.2.100');
      expect(alerts[0].mac).toBe('AA:BB:CC:DD:EE:FF');
      expect(alerts[0].vendor).toBe('TestVendor');
      expect(alerts[0].message).toContain('New device detected');
    });

    it('detects new device with null vendor', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.100', mac: 'AA:BB:CC:DD:EE:FF', vendor: null },
      ];
      const baseline: ARPEntry[] = [];

      const alerts = compareARPTables(current, baseline);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].details).toContain('Unknown vendor');
    });

    it('detects MAC change (potential ARP spoofing)', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Evil' },
      ];
      const baseline: ARPEntry[] = [
        { ip: '192.168.2.1', mac: '11:22:33:44:55:66', vendor: 'Good' },
      ];

      const alerts = compareARPTables(current, baseline);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('mac_change');
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].details).toContain('ARP spoofing');
    });

    it('does not alert when MAC is unchanged', () => {
      const entry: ARPEntry = { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Same' };
      const alerts = compareARPTables([entry], [entry]);
      expect(alerts).toHaveLength(0);
    });

    it('detects duplicate IPs (multiple MACs for same IP)', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Vendor1' },
        { ip: '192.168.2.1', mac: '11:22:33:44:55:66', vendor: 'Vendor2' },
      ];
      const baseline: ARPEntry[] = [
        { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Vendor1' },
      ];

      const alerts = compareARPTables(current, baseline);
      const duplicateAlert = alerts.find(a => a.type === 'duplicate_ip');
      expect(duplicateAlert).toBeDefined();
      expect(duplicateAlert!.severity).toBe('critical');
      expect(duplicateAlert!.details).toContain('Multiple MACs');
    });

    it('handles empty current table', () => {
      const baseline: ARPEntry[] = [
        { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: null },
      ];
      const alerts = compareARPTables([], baseline);
      expect(alerts).toHaveLength(0);
    });

    it('handles multiple new devices', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.10', mac: 'AA:BB:CC:DD:EE:01', vendor: null },
        { ip: '192.168.2.11', mac: 'AA:BB:CC:DD:EE:02', vendor: null },
        { ip: '192.168.2.12', mac: 'AA:BB:CC:DD:EE:03', vendor: null },
      ];

      const alerts = compareARPTables(current, []);
      expect(alerts).toHaveLength(3);
      expect(alerts.every(a => a.type === 'new_device')).toBe(true);
    });

    it('sets timestamp on all alerts', () => {
      const current: ARPEntry[] = [
        { ip: '192.168.2.100', mac: 'AA:BB:CC:DD:EE:FF', vendor: null },
      ];
      const alerts = compareARPTables(current, []);
      expect(alerts[0].timestamp).toBeDefined();
      expect(new Date(alerts[0].timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('setARPBaseline / getARPBaseline', () => {
    it('returns empty array when no baseline is set', () => {
      expect(getARPBaseline()).toEqual([]);
    });

    it('stores and retrieves baseline', () => {
      const entries: ARPEntry[] = [
        { ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Test' },
      ];
      setARPBaseline(entries);
      expect(getARPBaseline()).toEqual(entries);
    });

    it('overwrites previous baseline', () => {
      setARPBaseline([{ ip: '192.168.2.1', mac: 'AA:BB:CC:DD:EE:FF', vendor: null }]);
      setARPBaseline([{ ip: '192.168.2.2', mac: '11:22:33:44:55:66', vendor: null }]);
      const baseline = getARPBaseline();
      expect(baseline).toHaveLength(1);
      expect(baseline[0].ip).toBe('192.168.2.2');
    });
  });

  describe('getCurrentARPTable', () => {
    it('parses ARP table output', async () => {
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, {
          stdout: `Interface: 192.168.2.134 --- 0x9
  192.168.2.1           5c-ba-2c-16-a8-d8     dynamic
  192.168.2.10          aa-bb-cc-dd-ee-ff     dynamic
  192.168.2.255         ff-ff-ff-ff-ff-ff     static
`,
          stderr: '',
        });
      });

      const entries = await getCurrentARPTable();
      // Should skip the broadcast MAC (ff-ff-ff-ff-ff-ff)
      expect(entries).toHaveLength(2);
      expect(entries[0].ip).toBe('192.168.2.1');
      expect(entries[0].mac).toBe('5C-BA-2C-16-A8-D8');
      expect(entries[1].ip).toBe('192.168.2.10');
    });

    it('skips multicast MACs', async () => {
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, {
          stdout: '  224.0.0.251         01-00-5e-00-00-fb     static\n',
          stderr: '',
        });
      });

      const entries = await getCurrentARPTable();
      expect(entries).toHaveLength(0);
    });

    it('returns empty on exec error', async () => {
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(new Error('command failed'), { stdout: '', stderr: '' });
      });

      const entries = await getCurrentARPTable();
      expect(entries).toEqual([]);
    });
  });

  describe('runARPWatch', () => {
    it('returns entries count and empty alerts on first run', async () => {
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, {
          stdout: '  192.168.2.1    aa-bb-cc-dd-ee-ff     dynamic\n',
          stderr: '',
        });
      });

      const result = await runARPWatch();
      expect(result.currentEntries).toBe(1);
      expect(result.alerts).toHaveLength(0); // No baseline yet
    });

    it('detects changes on second run', async () => {
      // First run: set baseline
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, {
          stdout: '  192.168.2.1    aa-bb-cc-dd-ee-ff     dynamic\n',
          stderr: '',
        });
      });
      await runARPWatch();

      // Second run: new device appears
      execMock.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, {
          stdout: '  192.168.2.1    aa-bb-cc-dd-ee-ff     dynamic\n  192.168.2.99   11-22-33-44-55-66     dynamic\n',
          stderr: '',
        });
      });

      const result = await runARPWatch();
      expect(result.currentEntries).toBe(2);
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.alerts[0].type).toBe('new_device');
    });
  });
});
