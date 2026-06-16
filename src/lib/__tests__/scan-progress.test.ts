import { describe, it, expect, beforeEach } from 'vitest';
import { getScanProgress, setScanProgress, resetScanProgress } from '../scan-progress';

describe('scan-progress', () => {
  beforeEach(() => {
    resetScanProgress();
  });

  describe('getScanProgress', () => {
    it('returns default state', () => {
      const progress = getScanProgress();
      expect(progress).toEqual({
        phase: '',
        percent: 0,
        detail: '',
        running: false,
      });
    });

    it('returns same object reference on multiple calls', () => {
      const a = getScanProgress();
      const b = getScanProgress();
      expect(a).toBe(b);
    });
  });

  describe('setScanProgress', () => {
    it('updates partial state', () => {
      setScanProgress({ phase: 'Scanning', percent: 50 });
      const progress = getScanProgress();
      expect(progress.phase).toBe('Scanning');
      expect(progress.percent).toBe(50);
      expect(progress.detail).toBe(''); // unchanged
      expect(progress.running).toBe(false); // unchanged
    });

    it('updates running state', () => {
      setScanProgress({ running: true });
      expect(getScanProgress().running).toBe(true);
    });

    it('updates detail', () => {
      setScanProgress({ detail: 'Probing 192.168.2.x' });
      expect(getScanProgress().detail).toBe('Probing 192.168.2.x');
    });

    it('applies multiple updates cumulatively', () => {
      setScanProgress({ phase: 'Phase 1', percent: 25 });
      setScanProgress({ phase: 'Phase 2', percent: 75, running: true });
      const progress = getScanProgress();
      expect(progress.phase).toBe('Phase 2');
      expect(progress.percent).toBe(75);
      expect(progress.running).toBe(true);
    });
  });

  describe('resetScanProgress', () => {
    it('resets all fields to defaults', () => {
      setScanProgress({ phase: 'Done', percent: 100, detail: 'Complete', running: true });
      resetScanProgress();
      const progress = getScanProgress();
      expect(progress.phase).toBe('');
      expect(progress.percent).toBe(0);
      expect(progress.detail).toBe('');
      expect(progress.running).toBe(false);
    });
  });
});
