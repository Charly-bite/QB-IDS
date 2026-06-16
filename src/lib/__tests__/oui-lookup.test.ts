import { describe, it, expect } from 'vitest';
import { lookupVendor, isRandomizedMAC, vendorToTypeHint } from '../oui-lookup';

describe('oui-lookup', () => {
  describe('lookupVendor', () => {
    it('returns vendor for known OUI with colon separator', () => {
      expect(lookupVendor('AC:DE:48:11:22:33')).toBe('Apple');
    });

    it('returns vendor for known OUI with dash separator', () => {
      expect(lookupVendor('AC-DE-48-11-22-33')).toBe('Apple');
    });

    it('is case-insensitive', () => {
      expect(lookupVendor('ac:de:48:11:22:33')).toBe('Apple');
    });

    it('returns null for unknown OUI', () => {
      expect(lookupVendor('AA:BB:CC:DD:EE:FF')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(lookupVendor('')).toBeNull();
    });

    it('returns null for null-like input', () => {
      expect(lookupVendor(null as unknown as string)).toBeNull();
    });

    it('returns null for locally administered (randomized) MAC', () => {
      // Bit 1 of first octet is set → locally administered
      expect(lookupVendor('02:00:00:11:22:33')).toBeNull();
    });

    it('returns vendor for Samsung OUI', () => {
      expect(lookupVendor('00:21:19:AA:BB:CC')).toBe('Samsung');
    });

    it('returns vendor for Dell OUI', () => {
      expect(lookupVendor('5C:BA:2C:11:22:33')).toBe('Dell');
    });

    it('returns vendor for Cisco OUI', () => {
      expect(lookupVendor('00:1B:54:11:22:33')).toBe('Cisco');
    });

    it('returns vendor for Fortinet OUI', () => {
      expect(lookupVendor('00:09:0F:11:22:33')).toBe('Fortinet');
    });

    it('returns vendor for Hikvision OUI', () => {
      expect(lookupVendor('44:19:B6:11:22:33')).toBe('Hikvision');
    });

    it('returns vendor for VMware OUI', () => {
      expect(lookupVendor('00:50:56:11:22:33')).toBe('VMware');
    });

    it('returns vendor for Grandstream OUI', () => {
      expect(lookupVendor('C0:74:AD:11:22:33')).toBe('Grandstream');
    });

    it('returns vendor for Microsoft Hyper-V OUI', () => {
      expect(lookupVendor('00:15:5D:11:22:33')).toBe('Microsoft (Hyper-V)');
    });

    it('returns vendor for APC/Schneider OUI', () => {
      expect(lookupVendor('00:C0:B7:11:22:33')).toBe('APC/Schneider');
    });

    it('returns vendor for Raspberry Pi OUI', () => {
      expect(lookupVendor('B8:27:EB:11:22:33')).toBe('Raspberry Pi');
    });
  });

  describe('isRandomizedMAC', () => {
    it('returns true for locally administered MAC (bit 1 set)', () => {
      expect(isRandomizedMAC('02:11:22:33:44:55')).toBe(true);
      expect(isRandomizedMAC('06:11:22:33:44:55')).toBe(true);
      expect(isRandomizedMAC('0A:11:22:33:44:55')).toBe(true);
      expect(isRandomizedMAC('0E:11:22:33:44:55')).toBe(true);
    });

    it('returns false for globally unique MAC (bit 1 clear)', () => {
      expect(isRandomizedMAC('00:11:22:33:44:55')).toBe(false);
      expect(isRandomizedMAC('AC:DE:48:11:22:33')).toBe(false);
    });

    it('handles dash separator', () => {
      expect(isRandomizedMAC('02-11-22-33-44-55')).toBe(true);
    });

    it('returns false for empty input', () => {
      expect(isRandomizedMAC('')).toBe(false);
    });

    it('returns false for null-like input', () => {
      expect(isRandomizedMAC(null as unknown as string)).toBe(false);
    });
  });

  describe('vendorToTypeHint', () => {
    it('returns null for null vendor', () => {
      expect(vendorToTypeHint(null)).toBeNull();
    });

    it('identifies camera vendors', () => {
      expect(vendorToTypeHint('Hikvision')).toBe('camera');
      expect(vendorToTypeHint('Dahua')).toBe('camera');
      expect(vendorToTypeHint('Axis')).toBe('camera');
    });

    it('identifies printer vendors', () => {
      expect(vendorToTypeHint('Brother')).toBe('printer');
      expect(vendorToTypeHint('Epson')).toBe('printer');
      expect(vendorToTypeHint('Canon')).toBe('printer');
      expect(vendorToTypeHint('Ricoh')).toBe('printer');
      expect(vendorToTypeHint('Konica Minolta')).toBe('printer');
      expect(vendorToTypeHint('Zebra')).toBe('printer');
    });

    it('identifies NAS vendors', () => {
      expect(vendorToTypeHint('Synology')).toBe('nas');
      expect(vendorToTypeHint('QNAP')).toBe('nas');
    });

    it('identifies VoIP phone vendors', () => {
      expect(vendorToTypeHint('Yealink')).toBe('voip-phone');
      expect(vendorToTypeHint('Polycom')).toBe('voip-phone');
      expect(vendorToTypeHint('Avaya')).toBe('voip-phone');
      expect(vendorToTypeHint('Grandstream')).toBe('voip-phone');
    });

    it('identifies firewall vendors', () => {
      expect(vendorToTypeHint('Fortinet')).toBe('firewall');
    });

    it('identifies network equipment vendors', () => {
      expect(vendorToTypeHint('Cisco')).toBe('network');
      expect(vendorToTypeHint('MikroTik')).toBe('network');
      expect(vendorToTypeHint('Ubiquiti')).toBe('network');
      expect(vendorToTypeHint('Netgear')).toBe('network');
      expect(vendorToTypeHint('D-Link')).toBe('network');
      expect(vendorToTypeHint('Juniper')).toBe('network');
      expect(vendorToTypeHint('Aruba')).toBe('network');
      expect(vendorToTypeHint('Ruckus')).toBe('network');
    });

    it('identifies UPS vendors', () => {
      expect(vendorToTypeHint('APC')).toBe('ups');
      expect(vendorToTypeHint('Eaton')).toBe('ups');
      expect(vendorToTypeHint('Schneider')).toBe('ups');
    });

    it('identifies VM host vendors', () => {
      expect(vendorToTypeHint('VMware')).toBe('vm-host');
      expect(vendorToTypeHint('Microsoft (Hyper-V)')).toBe('vm-host');
    });

    it('identifies IoT vendors', () => {
      expect(vendorToTypeHint('Sonos')).toBe('iot');
      expect(vendorToTypeHint('Roku')).toBe('iot');
      expect(vendorToTypeHint('Ring')).toBe('iot');
      expect(vendorToTypeHint('Nest')).toBe('iot');
      expect(vendorToTypeHint('Google')).toBe('iot');
      expect(vendorToTypeHint('Amazon')).toBe('iot');
    });

    it('identifies SBC vendors', () => {
      expect(vendorToTypeHint('Raspberry Pi')).toBe('sbc');
    });

    it('identifies phone vendors', () => {
      expect(vendorToTypeHint('Samsung')).toBe('phone');
      expect(vendorToTypeHint('Apple')).toBe('phone');
      expect(vendorToTypeHint('Xiaomi')).toBe('phone');
      expect(vendorToTypeHint('Huawei')).toBe('phone');
      expect(vendorToTypeHint('Oppo')).toBe('phone');
      expect(vendorToTypeHint('Motorola')).toBe('phone');
      expect(vendorToTypeHint('LG')).toBe('phone');
    });

    it('returns null for unknown vendor', () => {
      expect(vendorToTypeHint('CustomCorp')).toBeNull();
      expect(vendorToTypeHint('Intel')).toBeNull();
    });
  });
});
