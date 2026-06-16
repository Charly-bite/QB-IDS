/**
 * Device Classifier — auto-detects device type from ports, TTL, vendor, and hostname.
 * Uses a heuristic scoring system for best-guess classification.
 */

import { vendorToTypeHint, isRandomizedMAC } from './oui-lookup';

export type DeviceType =
  | 'server'
  | 'workstation'
  | 'printer'
  | 'camera'
  | 'phone'
  | 'nas'
  | 'switch'
  | 'router'
  | 'firewall'
  | 'database'
  | 'access-point'
  | 'ups'
  | 'voip-phone'
  | 'iot'
  | 'other';

export interface ClassificationResult {
  deviceType: DeviceType;
  osFingerprint: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface ClassificationInput {
  openPorts: number[];
  ttl: number | null;
  vendor: string | null;
  hostname: string | null;
  mac?: string | null;
  httpTitle?: string | null;
  httpServer?: string | null;
}

/**
 * Detect OS family from TTL value.
 */
function detectOS(ttl: number | null, openPorts: number[]): string | null {
  if (ttl === null) return null;

  const hasWindowsPorts = openPorts.some(p => [135, 139, 445].includes(p));
  const hasSSH = openPorts.includes(22);
  const hasRDP = openPorts.includes(3389);

  if (ttl >= 120 && ttl <= 128) {
    if (openPorts.includes(389) || openPorts.includes(636)) return 'Windows Server (Domain Controller)';
    if (openPorts.includes(1433)) return 'Windows Server (SQL Server)';
    if (hasRDP && openPorts.includes(80)) return 'Windows Server';
    if (hasRDP) return 'Windows (Desktop/Server)';
    if (hasWindowsPorts) return 'Windows';
    return 'Windows';
  }

  if (ttl >= 60 && ttl <= 64) {
    if (hasSSH && !hasWindowsPorts) return 'Linux';
    if (openPorts.includes(5000) || openPorts.includes(5001)) return 'Linux (Synology DSM)';
    if (openPorts.includes(554)) return 'Linux (IP Camera)';
    return 'Linux/macOS/Android';
  }

  if (ttl >= 250 && ttl <= 255) {
    return 'Network Equipment (IOS/Firmware)';
  }

  return null;
}

/**
 * Classify device type from all available intelligence.
 */
export function classifyDevice(input: ClassificationInput): ClassificationResult {
  const { openPorts, ttl, vendor, hostname, mac, httpTitle } = input;
  const ports = new Set(openPorts);

  // --- Priority 0: Vendor-based overrides for very specific devices ---
  const vendorHint = vendorToTypeHint(vendor);
  
  // Grandstream = VoIP phone (28 devices on this network!)
  if (vendorHint === 'voip-phone') {
    return { deviceType: 'voip-phone', osFingerprint: 'VoIP Firmware', confidence: 'high' };
  }

  // --- Priority 1: Port-based classification (highest confidence) ---

  // Printers (JetDirect or LPR)
  if (ports.has(9100) || ports.has(515)) {
    return { deviceType: 'printer', osFingerprint: detectOS(ttl, openPorts), confidence: 'high' };
  }

  // IP Cameras (RTSP)
  if (ports.has(554)) {
    return { deviceType: 'camera', osFingerprint: detectOS(ttl, openPorts) || 'Camera Firmware', confidence: 'high' };
  }

  // NAS (Synology DSM) — but check if vendor says camera first
  if (ports.has(5000) || ports.has(5001)) {
    if (vendorHint === 'camera') {
      return { deviceType: 'camera', osFingerprint: 'Camera Firmware', confidence: 'high' };
    }
    return { deviceType: 'nas', osFingerprint: detectOS(ttl, openPorts) || 'Linux (Synology DSM)', confidence: 'high' };
  }

  // Domain Controller
  if (ports.has(389) || ports.has(636)) {
    if (ports.has(135) || ports.has(445)) {
      return { deviceType: 'server', osFingerprint: 'Windows Server (Domain Controller)', confidence: 'high' };
    }
  }

  // Database Server
  if (ports.has(1433) || ports.has(3306) || ports.has(5432)) {
    return { deviceType: 'database', osFingerprint: detectOS(ttl, openPorts), confidence: 'high' };
  }

  // --- Priority 2: Vendor-based hints ---
  if (vendorHint) {
    if (vendorHint === 'camera') return { deviceType: 'camera', osFingerprint: detectOS(ttl, openPorts) || 'Camera Firmware', confidence: 'high' };
    if (vendorHint === 'printer') return { deviceType: 'printer', osFingerprint: detectOS(ttl, openPorts), confidence: 'high' };
    if (vendorHint === 'nas') return { deviceType: 'nas', osFingerprint: detectOS(ttl, openPorts), confidence: 'medium' };
    if (vendorHint === 'firewall') return { deviceType: 'firewall', osFingerprint: 'FortiOS', confidence: 'high' };
    if (vendorHint === 'ups') return { deviceType: 'ups', osFingerprint: null, confidence: 'high' };
    if (vendorHint === 'phone') return { deviceType: 'phone', osFingerprint: 'Android/iOS', confidence: 'high' };
    if (vendorHint === 'network') {
      if (ports.has(22) && (ttl === null || ttl >= 250)) {
        return { deviceType: 'switch', osFingerprint: 'Network Equipment (IOS/Firmware)', confidence: 'medium' };
      }
      return { deviceType: 'access-point', osFingerprint: detectOS(ttl, openPorts) || 'UniFi Firmware', confidence: 'medium' };
    }
  }

  // --- Priority 3: Windows Server vs Workstation ---
  if (ports.has(135) && ports.has(445)) {
    if (ports.has(3389) && (ports.has(80) || ports.has(443) || ports.has(8080))) {
      return { deviceType: 'server', osFingerprint: 'Windows Server', confidence: 'medium' };
    }
    if (ports.has(3389)) {
      return { deviceType: 'workstation', osFingerprint: 'Windows', confidence: 'medium' };
    }
    return { deviceType: 'workstation', osFingerprint: 'Windows', confidence: 'low' };
  }

  // --- Priority 4: Linux server ---
  if (ports.has(22) && (ports.has(80) || ports.has(443) || ports.has(8080))) {
    return { deviceType: 'server', osFingerprint: 'Linux', confidence: 'medium' };
  }
  if (ports.has(22)) {
    // Ubiquiti AP with just SSH
    if (vendor && vendor.toLowerCase().includes('ubiquiti')) {
      return { deviceType: 'access-point', osFingerprint: 'UniFi Firmware', confidence: 'high' };
    }
    return { deviceType: 'server', osFingerprint: 'Linux', confidence: 'low' };
  }

  // --- Priority 5: HTTP title-based hints ---
  if (httpTitle) {
    const t = httpTitle.toLowerCase();
    if (t.includes('camera') || t.includes('nvr') || t.includes('dvr') || t.includes('hikvision') || t.includes('dahua')) {
      return { deviceType: 'camera', osFingerprint: 'Camera Firmware', confidence: 'high' };
    }
    if (t.includes('printer') || t.includes('laserjet') || t.includes('jetdirect')) {
      return { deviceType: 'printer', osFingerprint: null, confidence: 'medium' };
    }
    if (t.includes('fortigate') || t.includes('fortios')) {
      return { deviceType: 'firewall', osFingerprint: 'FortiOS', confidence: 'high' };
    }
  }

  // --- Priority 6: Hostname-based hints ---
  if (hostname) {
    const h = hostname.toLowerCase();
    if (h.includes('printer') || h.includes('npi')) return { deviceType: 'printer', osFingerprint: null, confidence: 'medium' };
    if (h.includes('cam') || h.includes('ipc') || h.includes('nvr') || h.includes('dvr')) return { deviceType: 'camera', osFingerprint: null, confidence: 'medium' };
    if (h.includes('phone') || h.includes('iphone') || h.includes('android') || h.includes('galaxy')) {
      return { deviceType: 'phone', osFingerprint: null, confidence: 'medium' };
    }
    if (h.includes('ap-') || h.includes('uap-') || h.includes('wap')) return { deviceType: 'access-point', osFingerprint: null, confidence: 'medium' };
  }

  // --- Priority 7: Randomized MAC = phone/tablet ---
  if (mac && isRandomizedMAC(mac) && openPorts.length === 0) {
    return { deviceType: 'phone', osFingerprint: 'Mobile Device (Randomized MAC)', confidence: 'medium' };
  }

  // --- Priority 8: TTL + vendor fallback ---
  if (ttl !== null && ttl >= 60 && ttl <= 64) {
    if (vendor && ['apple', 'samsung', 'xiaomi', 'huawei', 'motorola', 'lg', 'oppo'].some(v => vendor.toLowerCase().includes(v))) {
      return { deviceType: 'phone', osFingerprint: 'Android/iOS', confidence: 'medium' };
    }
  }

  // Web server only
  if (ports.has(80) || ports.has(443)) {
    return { deviceType: 'other', osFingerprint: detectOS(ttl, openPorts), confidence: 'low' };
  }

  // No ports, no vendor, randomized MAC = most likely a phone/tablet
  if (openPorts.length === 0 && mac && isRandomizedMAC(mac)) {
    return { deviceType: 'phone', osFingerprint: 'Mobile Device', confidence: 'low' };
  }

  return { deviceType: 'other', osFingerprint: detectOS(ttl, openPorts), confidence: 'low' };
}
