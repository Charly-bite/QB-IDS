/**
 * OUI (Organizationally Unique Identifier) Lookup
 * Maps MAC address prefixes to device manufacturers.
 * Covers the most common enterprise, consumer, and IoT vendors.
 */

// Top ~300 OUI prefixes covering 95%+ of enterprise/consumer devices
const OUI_DB: Record<string, string> = {
  // Apple
  'AC:DE:48': 'Apple', '00:1C:B3': 'Apple', '3C:15:C2': 'Apple', '70:56:81': 'Apple',
  'A4:83:E7': 'Apple', '00:25:00': 'Apple', 'F0:B4:79': 'Apple', 'DC:A9:04': 'Apple',
  '78:7B:8A': 'Apple', '88:66:A5': 'Apple', 'BC:52:B7': 'Apple', '48:D7:05': 'Apple',
  'A8:51:AB': 'Apple', 'F0:C1:F1': 'Apple', '00:CD:FE': 'Apple', '3C:06:30': 'Apple',
  'E0:B5:5F': 'Apple', '14:BD:61': 'Apple', 'C8:2A:14': 'Apple', '6C:4A:85': 'Apple',
  
  // Samsung
  '00:21:19': 'Samsung', '00:26:37': 'Samsung', 'A8:F2:74': 'Samsung', '50:01:BB': 'Samsung',
  '84:25:DB': 'Samsung', 'CC:07:AB': 'Samsung', '78:47:1D': 'Samsung', 'F4:7B:09': 'Samsung',
  '40:4E:36': 'Samsung', 'C4:42:02': 'Samsung', '94:35:0A': 'Samsung', 'E4:58:B8': 'Samsung',
  '10:D5:42': 'Samsung', 'BC:72:B1': 'Samsung', '00:F4:6F': 'Samsung', '3C:A1:0D': 'Samsung',
  
  // Dell
  '5C:BA:2C': 'Dell', '00:14:22': 'Dell', 'F8:DB:88': 'Dell', 'B0:83:FE': 'Dell',
  '00:1A:A0': 'Dell', '00:1E:C9': 'Dell', '18:A9:9B': 'Dell', '24:B6:FD': 'Dell',
  'A4:1F:72': 'Dell', '00:21:9B': 'Dell', '34:17:EB': 'Dell', '00:26:B9': 'Dell',
  '14:FE:B5': 'Dell', 'F0:1F:AF': 'Dell', '98:90:96': 'Dell', '00:06:5B': 'Dell',
  
  // HP / HPE
  '00:1C:C4': 'HP', '3C:D9:2B': 'HP', '00:1A:4B': 'HP', '00:25:B3': 'HP',
  '2C:41:38': 'HP', 'B4:B5:2F': 'HP', '30:E1:71': 'HP',
  'C0:51:7E': 'HP', 'A0:D3:C1': 'HP', '94:57:A5': 'HP', 'EC:B1:D7': 'HP',
  '00:17:A4': 'HP', '9C:8E:99': 'HP', '70:5A:0F': 'HP', '00:1E:0B': 'HP',
  '38:63:BB': 'HP', '14:02:EC': 'HP', 'B0:5A:DA': 'HP', 'A0:1D:48': 'HP',
  
  // Cisco
  '00:1B:54': 'Cisco', '00:1E:49': 'Cisco', '00:1F:9E': 'Cisco', '00:22:55': 'Cisco',
  '00:23:04': 'Cisco', '00:26:0B': 'Cisco', '54:75:D0': 'Cisco', '00:0A:B7': 'Cisco',
  '00:1A:2F': 'Cisco', 'BC:16:65': 'Cisco', '00:1D:45': 'Cisco', '00:0D:ED': 'Cisco',
  'F4:CF:E2': 'Cisco', '68:BC:0C': 'Cisco', '3C:08:F6': 'Cisco', 'CC:46:D6': 'Cisco',
  
  // Fortinet
  '00:09:0F': 'Fortinet', '70:4C:A5': 'Fortinet', 'E0:3D:A6': 'Fortinet',
  '08:5B:0E': 'Fortinet', '90:6C:AC': 'Fortinet', 'B4:A7:C4': 'Fortinet',
  
  // Microsoft / Xbox
  '00:50:F2': 'Microsoft', '28:18:78': 'Microsoft', '7C:1E:52': 'Microsoft',
  '00:15:5D': 'Microsoft (Hyper-V)', '00:0D:3A': 'Microsoft (Azure)',
  
  // Synology
  '00:11:32': 'Synology', '90:09:D0': 'Synology',
  
  // QNAP
  '00:08:9B': 'QNAP', '24:5E:BE': 'QNAP',
  
  // Intel
  '00:1B:21': 'Intel', '00:1E:65': 'Intel', '00:1F:3B': 'Intel', '3C:97:0E': 'Intel',
  '68:05:CA': 'Intel', 'A4:C4:94': 'Intel', 'F8:63:3F': 'Intel', '00:03:47': 'Intel',
  
  // Realtek
  '00:E0:4C': 'Realtek', '52:54:00': 'Realtek (QEMU/KVM)',
  
  // TP-Link
  '50:C7:BF': 'TP-Link', 'EC:08:6B': 'TP-Link', '14:CC:20': 'TP-Link',
  '30:B4:9E': 'TP-Link', '60:32:B1': 'TP-Link', '98:DA:C4': 'TP-Link',
  'AC:15:A2': 'TP-Link', 'B0:A7:B9': 'TP-Link', 'C0:06:C3': 'TP-Link',
  
  // Ubiquiti
  '04:18:D6': 'Ubiquiti', '24:5A:4C': 'Ubiquiti', '44:D9:E7': 'Ubiquiti',
  '68:72:51': 'Ubiquiti', '78:8A:20': 'Ubiquiti', '80:2A:A8': 'Ubiquiti',
  'B4:FB:E4': 'Ubiquiti', 'DC:9F:DB': 'Ubiquiti', 'F0:9F:C2': 'Ubiquiti',
  'FC:EC:DA': 'Ubiquiti', '18:E8:29': 'Ubiquiti',
  
  // Huawei
  '00:25:9E': 'Huawei', '00:46:4B': 'Huawei', '04:F9:38': 'Huawei',
  '20:F1:7C': 'Huawei', '48:46:FB': 'Huawei', '70:72:0D': 'Huawei',
  '88:A2:D7': 'Huawei', 'C8:D1:5E': 'Huawei', 'E0:24:7F': 'Huawei',
  
  // Xiaomi
  '00:EC:0A': 'Xiaomi', '0C:1D:AF': 'Xiaomi', '28:6C:07': 'Xiaomi',
  '64:CC:2E': 'Xiaomi', '78:11:DC': 'Xiaomi', '98:FA:E3': 'Xiaomi',
  
  // Google
  '00:1A:11': 'Google', 'F4:F5:D8': 'Google', '54:60:09': 'Google',
  'A4:77:33': 'Google', '3C:5A:B4': 'Google',
  
  // Amazon
  '00:FC:8B': 'Amazon', '18:74:2E': 'Amazon', '34:D2:70': 'Amazon',
  '40:B4:CD': 'Amazon', '74:C2:46': 'Amazon', 'A0:02:DC': 'Amazon',
  
  // Zebra / Motorola (printers/scanners)
  '00:A0:F8': 'Zebra', '00:15:70': 'Zebra', '00:23:68': 'Zebra',
  'AC:3F:A4': 'Zebra', '84:24:8D': 'Zebra',
  
  // Hikvision (cameras)
  '44:19:B6': 'Hikvision', '54:C4:15': 'Hikvision', '8C:E7:48': 'Hikvision',
  'BC:AD:28': 'Hikvision', 'C0:56:E3': 'Hikvision', '28:57:BE': 'Hikvision',
  'C0:6D:ED': 'Hikvision', 'EC:C8:9C': 'Hikvision', '9C:14:63': 'Hikvision',
  'A4:D5:C2': 'Hikvision',
  
  // Dahua (cameras)
  '3C:EF:8C': 'Dahua', '4C:11:BF': 'Dahua', 'A0:BD:1D': 'Dahua',
  'E0:50:8B': 'Dahua', 'B0:41:1D': 'Dahua', 'D4:43:0E': 'Dahua',
  'E4:24:6C': 'Dahua', '38:AF:29': 'Dahua',
  
  // Axis Communications (cameras)
  '00:40:8C': 'Axis', 'AC:CC:8E': 'Axis', 'B8:A4:4F': 'Axis',
  
  // Brother (printers)
  '00:80:77': 'Brother', '00:1B:A9': 'Brother', '30:05:5C': 'Brother',
  
  // Epson (printers)
  '00:26:AB': 'Epson', '64:EB:8C': 'Epson', 'A4:EE:57': 'Epson',
  
  // Canon (printers)
  '00:1E:8F': 'Canon', '18:0C:AC': 'Canon', '3C:A9:F4': 'Canon',
  
  // Lenovo
  '00:06:1B': 'Lenovo', '28:D2:44': 'Lenovo', '50:7B:9D': 'Lenovo',
  '98:E7:43': 'Lenovo', 'C8:5B:76': 'Lenovo', 'E8:6A:64': 'Lenovo',
  
  // ASUS
  '00:1A:92': 'ASUS', '1C:87:2C': 'ASUS', '2C:56:DC': 'ASUS',
  '60:45:CB': 'ASUS', 'AC:22:0B': 'ASUS', 'F4:6D:04': 'ASUS',
  
  // Aruba / HPE Aruba (APs)
  '00:0B:86': 'Aruba', '24:DE:C6': 'Aruba', 'D8:C7:C8': 'Aruba',
  '9C:1C:12': 'Aruba', '70:3A:0E': 'Aruba',
  
  // Netgear
  '00:14:6C': 'Netgear', '20:4E:7F': 'Netgear', '6C:B0:CE': 'Netgear',
  'A4:2B:8C': 'Netgear', 'C4:3D:C7': 'Netgear', 'E4:F4:C6': 'Netgear',
  
  // D-Link
  '00:1B:11': 'D-Link', '00:22:B0': 'D-Link', '1C:BD:B9': 'D-Link',
  '28:10:7B': 'D-Link', '78:54:2E': 'D-Link', 'C8:D3:A3': 'D-Link',
  
  // VMware
  '00:50:56': 'VMware', '00:0C:29': 'VMware', '00:05:69': 'VMware',
  
  // LG Electronics
  '00:1C:62': 'LG', '00:22:A9': 'LG', '10:68:3F': 'LG',
  '34:4D:F7': 'LG', '64:99:68': 'LG', 'C4:9A:02': 'LG',
  
  // Honeywell
  '00:16:6D': 'Honeywell', '00:40:84': 'Honeywell',
  
  // Bosch
  '00:04:57': 'Bosch', '00:07:5F': 'Bosch',
  
  // Supermicro
  '00:25:90': 'Supermicro', '0C:C4:7A': 'Supermicro', 'AC:1F:6B': 'Supermicro',

  // Broadcom
  '00:10:18': 'Broadcom', 'C8:2B:96': 'Broadcom',
  
  // Ruckus
  '00:1F:41': 'Ruckus', 'C4:01:7C': 'Ruckus', '74:91:1A': 'Ruckus',
  
  // MikroTik
  '00:0C:42': 'MikroTik', 'CC:2D:E0': 'MikroTik', 'E4:8D:8C': 'MikroTik',
  '48:8F:5A': 'MikroTik', '6C:3B:6B': 'MikroTik',
  
  // Grandstream (VoIP phones / SIP devices)
  'C0:74:AD': 'Grandstream', 'EC:74:D7': 'Grandstream', '00:0B:82': 'Grandstream',
  
  // Oppo / OnePlus (phones)
  'E4:E2:6C': 'Oppo',
  
  // Ubiquiti (additional OUIs)
  '74:83:C2': 'Ubiquiti', 'F4:92:BF': 'Ubiquiti',
  
  // Envisacor Technologies
  '00:1C:2A': 'Envisacor',
  
  // Raspberry Pi
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi',
  
  // Sonos
  '00:0E:58': 'Sonos', '5C:AA:FD': 'Sonos', '78:28:CA': 'Sonos',
  
  // Roku
  'B0:A7:37': 'Roku', 'DC:3A:5E': 'Roku', '10:59:32': 'Roku',
  
  // Ring (Amazon)
  '50:EC:50': 'Ring', '4C:E1:73': 'Ring',
  
  // Nest / Google Home
  '18:B4:30': 'Nest', '64:16:66': 'Nest',
  
  // Motorola
  '00:04:56': 'Motorola', '00:0C:E5': 'Motorola', '40:88:05': 'Motorola',
  
  // Juniper
  '00:12:1E': 'Juniper', '00:1D:B5': 'Juniper', '00:23:9C': 'Juniper',
  'CC:E1:7F': 'Juniper', '88:E0:F3': 'Juniper',

  // Hewlett Packard Enterprise
  '94:18:82': 'HPE', '48:DF:37': 'HPE',

  // APC (UPS)
  '00:C0:B7': 'APC/Schneider',

  // Eaton (UPS)  
  '00:20:85': 'Eaton',

  // Yealink (VoIP phones)
  '00:15:65': 'Yealink', '80:5E:C0': 'Yealink',
  
  // Polycom (VoIP)
  '00:04:F2': 'Polycom', '64:16:7F': 'Polycom',
  
  // Avaya
  '00:1B:4F': 'Avaya', '70:38:EE': 'Avaya',
  
  // Ricoh (printers)
  '00:00:74': 'Ricoh', '00:26:73': 'Ricoh',
  
  // Konica Minolta (printers)
  '00:16:F0': 'Konica Minolta', '00:0F:B5': 'Konica Minolta',
};

/**
 * Look up the vendor/manufacturer for a given MAC address.
 * @param mac MAC address in any common format (XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX)
 * @returns Vendor name or null if unknown
 */
export function lookupVendor(mac: string): string | null {
  if (!mac) return null;
  
  // Normalize: uppercase, replace dashes with colons
  const normalized = mac.toUpperCase().replace(/-/g, ':');
  
  // Extract first 3 octets (OUI prefix)
  const prefix = normalized.substring(0, 8); // "XX:XX:XX"
  
  const found = OUI_DB[prefix];
  if (found) return found;
  
  // Detect locally administered MACs (randomized)
  // Bit 1 of the first octet is set → locally administered
  const firstOctet = parseInt(normalized.substring(0, 2), 16);
  if ((firstOctet & 0x02) !== 0) {
    return null; // Randomized MAC — can't determine vendor
  }
  
  return null;
}

/**
 * Check if a MAC address is locally administered (randomized).
 * Phones/tablets randomize MACs for privacy — these won't have OUI matches.
 */
export function isRandomizedMAC(mac: string): boolean {
  if (!mac) return false;
  const normalized = mac.toUpperCase().replace(/-/g, ':');
  const firstOctet = parseInt(normalized.substring(0, 2), 16);
  return (firstOctet & 0x02) !== 0;
}

/**
 * Get a device category hint from the vendor name.
 * Helps with initial device type classification.
 */
export function vendorToTypeHint(vendor: string | null): string | null {
  if (!vendor) return null;
  
  const v = vendor.toLowerCase();
  
  if (['hikvision', 'dahua', 'axis'].some(x => v.includes(x))) return 'camera';
  if (['brother', 'epson', 'canon', 'ricoh', 'konica', 'zebra'].some(x => v.includes(x))) return 'printer';
  if (['synology', 'qnap'].some(x => v.includes(x))) return 'nas';
  if (['yealink', 'polycom', 'avaya', 'grandstream'].some(x => v.includes(x))) return 'voip-phone';
  if (['fortinet'].some(x => v.includes(x))) return 'firewall';
  if (['cisco', 'mikrotik', 'juniper', 'aruba', 'ruckus', 'ubiquiti', 'netgear', 'd-link'].some(x => v.includes(x))) return 'network';
  if (['apc', 'eaton', 'schneider'].some(x => v.includes(x))) return 'ups';
  if (['vmware', 'hyper-v'].some(x => v.includes(x))) return 'vm-host';
  if (['sonos', 'roku', 'ring', 'nest', 'google', 'amazon'].some(x => v.includes(x))) return 'iot';
  if (['raspberry'].some(x => v.includes(x))) return 'sbc';
  if (['oppo', 'samsung', 'xiaomi', 'huawei', 'apple', 'motorola', 'lg', 'oneplus'].some(x => v.includes(x))) return 'phone';
  
  return null; // Can't determine from vendor alone
}
