/**
 * Shared scan progress state — singleton module.
 * Both scan/route.ts and scan-progress/route.ts import from here
 * to ensure they share the same object reference.
 */

interface ScanProgress {
  phase: string;
  percent: number;
  detail: string;
  running: boolean;
}

// Use globalThis to survive module re-evaluation in dev mode
const globalKey = '__panelcontrol_scan_progress__';

function getGlobalProgress(): ScanProgress {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = {
      phase: '',
      percent: 0,
      detail: '',
      running: false,
    };
  }
  return (globalThis as Record<string, unknown>)[globalKey] as ScanProgress;
}

export function getScanProgress(): ScanProgress {
  return getGlobalProgress();
}

export function setScanProgress(update: Partial<ScanProgress>): void {
  const progress = getGlobalProgress();
  Object.assign(progress, update);
}

export function resetScanProgress(): void {
  const progress = getGlobalProgress();
  progress.phase = '';
  progress.percent = 0;
  progress.detail = '';
  progress.running = false;
}
