/**
 * LibreNMS ↔ Panel Control Database Sync Service
 * 
 * Periodically fetches all devices from the LibreNMS REST API and
 * cross-references them with the Panel Control MSSQL `NetworkDevices` table
 * by matching on IP address. When a match is found, it updates the MSSQL
 * record with LibreNMS metadata (device_id, OS, hardware, uptime, last polled).
 */

import { getDevices, type LibreNMSDevice } from './librenms-api';
import { getPool } from './db';
import sql from 'mssql';

/** Run a single sync cycle */
export async function syncLibreNMSDevices(): Promise<{
  synced: number;
  total: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;

  try {
    // 1. Fetch all devices from LibreNMS
    const result = await getDevices();
    if (result.error) {
      return { synced: 0, total: 0, errors: [`LibreNMS API error: ${result.error}`] };
    }

    const lnmsDevices = (result.data as { devices?: LibreNMSDevice[] })?.devices || [];
    if (lnmsDevices.length === 0) {
      return { synced: 0, total: 0, errors: [] };
    }

    // 2. Get MSSQL pool
    const pool = await getPool();

    // 3. For each LibreNMS device, try to match by IP in MSSQL and update
    for (const dev of lnmsDevices) {
      const matchIp = dev.ip || dev.hostname;
      if (!matchIp) continue;

      try {
        await pool.request()
          .input('ip', sql.VarChar(45), matchIp)
          .input('hostname', sql.VarChar(100), dev.hostname)
          .input('librenms_device_id', sql.Int, dev.device_id)
          .input('librenms_os', sql.VarChar(50), dev.os || null)
          .input('librenms_hardware', sql.VarChar(100), dev.hardware || null)
          .input('librenms_uptime', sql.BigInt, dev.uptime || null)
          .input('librenms_last_polled', sql.DateTime, dev.last_polled ? new Date(dev.last_polled) : null)
          .query(`
            UPDATE NetworkDevices SET
              librenms_device_id = @librenms_device_id,
              librenms_os = @librenms_os,
              librenms_hardware = @librenms_hardware,
              librenms_uptime = @librenms_uptime,
              librenms_last_polled = @librenms_last_polled
            WHERE ip = @ip OR ip = @hostname
          `);
        synced++;
      } catch (e) {
        errors.push(`Failed to sync ${matchIp}: ${String(e)}`);
      }
    }

    return { synced, total: lnmsDevices.length, errors };
  } catch (e) {
    return { synced: 0, total: 0, errors: [`Sync failed: ${String(e)}`] };
  }
}

/** 
 * In-memory sync state — tracks when the last sync ran.
 * Prevents redundant syncs within the TTL window.
 */
let lastSyncTime = 0;
const SYNC_TTL = 5 * 60 * 1000; // 5 minutes

/** 
 * Run sync if enough time has passed since the last one.
 * Call this from API routes to lazily trigger background syncs.
 */
export async function maybeSyncLibreNMS(): Promise<void> {
  if (Date.now() - lastSyncTime < SYNC_TTL) return;
  lastSyncTime = Date.now();

  // Run in the background — don't block the caller
  syncLibreNMSDevices()
    .then(result => {
      console.log(`[LibreNMS Sync] Synced ${result.synced}/${result.total} devices`);
      if (result.errors.length > 0) {
        console.warn(`[LibreNMS Sync] Errors:`, result.errors);
      }
    })
    .catch(err => {
      console.error('[LibreNMS Sync] Failed:', err);
    });
}
