import { describe, it, expect } from 'vitest';
import { classifyDevice, type DeviceType } from '../device-classifier';

describe('device-classifier', () => {
  describe('classifyDevice', () => {
    // --- Priority 0: Vendor-based overrides ---
    it('classifies Grandstream as voip-phone (vendor override)', () => {
      const result = classifyDevice({ openPorts: [], ttl: 64, vendor: 'Grandstream', hostname: null });
      expect(result.deviceType).toBe('voip-phone');
      expect(result.confidence).toBe('high');
      expect(result.osFingerprint).toBe('VoIP Firmware');
    });

    it('classifies Yealink as voip-phone', () => {
      const result = classifyDevice({ openPorts: [], ttl: 64, vendor: 'Yealink', hostname: null });
      expect(result.deviceType).toBe('voip-phone');
      expect(result.confidence).toBe('high');
    });

    // --- Priority 1: Port-based classification ---
    it('classifies printer by JetDirect port 9100', () => {
      const result = classifyDevice({ openPorts: [9100], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('printer');
      expect(result.confidence).toBe('high');
    });

    it('classifies printer by LPR port 515', () => {
      const result = classifyDevice({ openPorts: [515], ttl: null, vendor: null, hostname: null });
      expect(result.deviceType).toBe('printer');
    });

    it('classifies camera by RTSP port 554', () => {
      const result = classifyDevice({ openPorts: [554], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('camera');
      expect(result.confidence).toBe('high');
    });

    it('classifies NAS by Synology DSM port 5000', () => {
      const result = classifyDevice({ openPorts: [5000], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('nas');
      expect(result.confidence).toBe('high');
    });

    it('classifies NAS by Synology HTTPS port 5001', () => {
      const result = classifyDevice({ openPorts: [5001], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('nas');
    });

    it('classifies camera vendor with NAS port as camera', () => {
      const result = classifyDevice({ openPorts: [5000], ttl: 64, vendor: 'Hikvision', hostname: null });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies domain controller by LDAP + Windows ports', () => {
      const result = classifyDevice({ openPorts: [389, 135, 445], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
      expect(result.osFingerprint).toContain('Domain Controller');
    });

    it('classifies domain controller by LDAPS + Windows ports', () => {
      const result = classifyDevice({ openPorts: [636, 445], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
    });

    it('classifies database server by MSSQL port 1433', () => {
      const result = classifyDevice({ openPorts: [1433], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('database');
      expect(result.confidence).toBe('high');
    });

    it('classifies database server by MySQL port 3306', () => {
      const result = classifyDevice({ openPorts: [3306], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('database');
    });

    it('classifies database server by PostgreSQL port 5432', () => {
      const result = classifyDevice({ openPorts: [5432], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('database');
    });

    // --- Priority 2: Vendor-based hints ---
    it('classifies camera vendor hint', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: 'Hikvision', hostname: null });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies printer vendor hint', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: 'Brother', hostname: null });
      expect(result.deviceType).toBe('printer');
    });

    it('classifies NAS vendor hint', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: 'Synology', hostname: null });
      expect(result.deviceType).toBe('nas');
      expect(result.confidence).toBe('medium');
    });

    it('classifies firewall vendor hint', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: 'Fortinet', hostname: null });
      expect(result.deviceType).toBe('firewall');
      expect(result.osFingerprint).toBe('FortiOS');
    });

    it('classifies UPS vendor hint', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: 'APC/Schneider', hostname: null });
      expect(result.deviceType).toBe('ups');
    });

    it('classifies phone vendor hint', () => {
      const result = classifyDevice({ openPorts: [], ttl: 64, vendor: 'Apple', hostname: null });
      expect(result.deviceType).toBe('phone');
    });

    it('classifies network vendor with SSH + high TTL as switch', () => {
      const result = classifyDevice({ openPorts: [22], ttl: 255, vendor: 'Cisco', hostname: null });
      expect(result.deviceType).toBe('switch');
    });

    it('classifies network vendor without SSH as access-point', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: 'Ubiquiti', hostname: null });
      expect(result.deviceType).toBe('access-point');
    });

    it('classifies network vendor with SSH but null TTL as switch', () => {
      const result = classifyDevice({ openPorts: [22], ttl: null, vendor: 'Cisco', hostname: null });
      expect(result.deviceType).toBe('switch');
    });

    // --- Priority 3: Windows Server vs Workstation ---
    it('classifies Windows Server with RDP + web', () => {
      const result = classifyDevice({ openPorts: [135, 445, 3389, 80], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
      expect(result.osFingerprint).toBe('Windows Server');
    });

    it('classifies Windows Workstation with RDP only', () => {
      const result = classifyDevice({ openPorts: [135, 445, 3389], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('workstation');
      expect(result.confidence).toBe('medium');
    });

    it('classifies Windows Workstation without RDP (low confidence)', () => {
      const result = classifyDevice({ openPorts: [135, 445], ttl: 128, vendor: null, hostname: null });
      expect(result.deviceType).toBe('workstation');
      expect(result.confidence).toBe('low');
    });

    // --- Priority 4: Linux server ---
    it('classifies Linux server with SSH + HTTP', () => {
      const result = classifyDevice({ openPorts: [22, 80], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
      expect(result.osFingerprint).toBe('Linux');
      expect(result.confidence).toBe('medium');
    });

    it('classifies Linux server with SSH + HTTPS', () => {
      const result = classifyDevice({ openPorts: [22, 443], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
    });

    it('classifies Ubiquiti AP with just SSH', () => {
      // Ubiquiti vendor triggers Priority 2 (network hint). TTL 64 ≠ null/≥250,
      // so it falls to access-point with detectOS(64,[22]) → 'Linux'
      const result = classifyDevice({ openPorts: [22], ttl: 64, vendor: 'Ubiquiti', hostname: null });
      expect(result.deviceType).toBe('access-point');
      expect(result.osFingerprint).toContain('Linux');
      expect(result.confidence).toBe('medium');
    });

    it('classifies SSH-only host as Linux server (low confidence)', () => {
      const result = classifyDevice({ openPorts: [22], ttl: 64, vendor: null, hostname: null });
      expect(result.deviceType).toBe('server');
      expect(result.confidence).toBe('low');
    });

    // --- Priority 5: HTTP title-based hints ---
    it('classifies camera by HTTP title', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: null, hostname: null, httpTitle: 'Hikvision Web Interface' });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies NVR by HTTP title', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: null, hostname: null, httpTitle: 'DVR Login Page' });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies printer by HTTP title', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 128, vendor: null, hostname: null, httpTitle: 'HP LaserJet Pro' });
      expect(result.deviceType).toBe('printer');
    });

    it('classifies firewall by HTTP title', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 64, vendor: null, hostname: null, httpTitle: 'FortiGate Login' });
      expect(result.deviceType).toBe('firewall');
    });

    // --- Priority 6: Hostname-based hints ---
    it('classifies printer by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'npi1234AB' });
      expect(result.deviceType).toBe('printer');
    });

    it('classifies camera by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'cam-lobby-01' });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies camera by ipc hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'IPC-192' });
      expect(result.deviceType).toBe('camera');
    });

    it('classifies phone by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'iPhone-Carlos' });
      expect(result.deviceType).toBe('phone');
    });

    it('classifies Android phone by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'android-abc123' });
      expect(result.deviceType).toBe('phone');
    });

    it('classifies Galaxy phone by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'Galaxy-S24' });
      expect(result.deviceType).toBe('phone');
    });

    it('classifies access-point by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'UAP-AC-Pro' });
      expect(result.deviceType).toBe('access-point');
    });

    it('classifies WAP by hostname', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: 'wap-floor2' });
      expect(result.deviceType).toBe('access-point');
    });

    // --- Priority 7: Randomized MAC ---
    it('classifies randomized MAC with no ports as phone', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: null, mac: '02:11:22:33:44:55' });
      expect(result.deviceType).toBe('phone');
      expect(result.confidence).toBe('medium');
    });

    // --- Priority 8: TTL + vendor fallback ---
    it('classifies Apple device with Linux TTL as phone', () => {
      const result = classifyDevice({ openPorts: [], ttl: 64, vendor: 'Apple', hostname: null });
      expect(result.deviceType).toBe('phone');
    });

    it('classifies Samsung device with Linux TTL as phone', () => {
      const result = classifyDevice({ openPorts: [], ttl: 64, vendor: 'Samsung', hostname: null });
      expect(result.deviceType).toBe('phone');
    });

    // --- Fallbacks ---
    it('classifies web-only server as other', () => {
      const result = classifyDevice({ openPorts: [80], ttl: null, vendor: null, hostname: null });
      expect(result.deviceType).toBe('other');
      expect(result.confidence).toBe('low');
    });

    it('classifies device with HTTPS only as other', () => {
      const result = classifyDevice({ openPorts: [443], ttl: null, vendor: null, hostname: null });
      expect(result.deviceType).toBe('other');
    });

    it('classifies no-info randomized MAC as phone (medium confidence via Priority 7)', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: null, mac: '06:AA:BB:CC:DD:EE' });
      expect(result.deviceType).toBe('phone');
      expect(result.confidence).toBe('medium');
    });

    it('classifies completely unknown device as other', () => {
      const result = classifyDevice({ openPorts: [], ttl: null, vendor: null, hostname: null });
      expect(result.deviceType).toBe('other');
      expect(result.confidence).toBe('low');
    });

    // --- OS fingerprinting ---
    it('detects Windows OS from TTL 128', () => {
      const result = classifyDevice({ openPorts: [135, 445], ttl: 128, vendor: null, hostname: null });
      expect(result.osFingerprint).toBe('Windows');
    });

    it('detects Windows Server (SQL Server) from TTL + port 1433', () => {
      const result = classifyDevice({ openPorts: [1433], ttl: 128, vendor: null, hostname: null });
      expect(result.osFingerprint).toContain('Windows');
    });

    it('detects Linux from TTL 64 + SSH', () => {
      const result = classifyDevice({ openPorts: [22, 80], ttl: 64, vendor: null, hostname: null });
      expect(result.osFingerprint).toBe('Linux');
    });

    it('detects Network Equipment from TTL 255', () => {
      const result = classifyDevice({ openPorts: [80], ttl: 255, vendor: null, hostname: null });
      expect(result.osFingerprint).toContain('Network Equipment');
    });
  });
});
