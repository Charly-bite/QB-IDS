import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_SERVER || '192.168.2.187\\SQLEXPRESS',
  database: process.env.DB_NAME || 'PanelControl',
  authentication: {
    type: 'ntlm',
    options: {
      domain: process.env.DB_DOMAIN || 'QB_WFS_BD_001',
      userName: process.env.DB_USER || 'Administrador',
      password: process.env.DB_PASSWORD || 'Qu1m1c4B055',
    },
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
    instanceName: 'SQLEXPRESS',
  },
  port: undefined, // Let SQL Browser resolve the port for the named instance
  pool: {
    max: 5,
    min: 1,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

// Initialize the database and tables if they don't exist
export async function initDatabase(): Promise<void> {
  try {
    // Connect directly to PanelControl and create tables if needed
    // NOTE: The database must already exist — create it manually in SSMS
    const p = await getPool();
    
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='NetworkDevices' AND xtype='U')
      BEGIN
        CREATE TABLE NetworkDevices (
          id INT IDENTITY(1,1) PRIMARY KEY,
          ip VARCHAR(45) NOT NULL UNIQUE,
          name VARCHAR(100) NOT NULL DEFAULT 'Unknown',
          device_type VARCHAR(20) NOT NULL DEFAULT 'other',
          subnet VARCHAR(20) NOT NULL DEFAULT '',
          last_seen DATETIME NULL,
          status VARCHAR(10) NOT NULL DEFAULT 'Offline',
          latency INT NOT NULL DEFAULT 0,
          is_monitored BIT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT GETDATE(),
          -- Position on the topology map (nullable = auto-layout)
          topo_x FLOAT NULL,
          topo_y FLOAT NULL
        );
      END
    `);

    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ScanHistory' AND xtype='U')
      BEGIN
        CREATE TABLE ScanHistory (
          id INT IDENTITY(1,1) PRIMARY KEY,
          subnet VARCHAR(20) NOT NULL,
          total_hosts INT NOT NULL DEFAULT 0,
          scan_time DATETIME NOT NULL DEFAULT GETDATE()
        );
      END
    `);

    // Migration: add hostname and mac_address columns if missing
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='hostname')
        ALTER TABLE NetworkDevices ADD hostname VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='mac_address')
        ALTER TABLE NetworkDevices ADD mac_address VARCHAR(20) NULL;
    `);

    // Migration v2: add vendor, open_ports, os_fingerprint, ttl columns
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='vendor')
        ALTER TABLE NetworkDevices ADD vendor VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='open_ports')
        ALTER TABLE NetworkDevices ADD open_ports VARCHAR(500) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='os_fingerprint')
        ALTER TABLE NetworkDevices ADD os_fingerprint VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ttl')
        ALTER TABLE NetworkDevices ADD ttl INT NULL;
    `);

    // Migration v3: add NetBIOS, domain, shared folders, HTTP probe columns
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='netbios_name')
        ALTER TABLE NetworkDevices ADD netbios_name VARCHAR(50) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='domain')
        ALTER TABLE NetworkDevices ADD domain VARCHAR(50) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='shared_folders')
        ALTER TABLE NetworkDevices ADD shared_folders NVARCHAR(MAX) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='http_title')
        ALTER TABLE NetworkDevices ADD http_title VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='http_server')
        ALTER TABLE NetworkDevices ADD http_server VARCHAR(100) NULL;
    `);

    // Migration v4: experimental features — banners, SSL, SSDP, mDNS, WMI
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='banners')
        ALTER TABLE NetworkDevices ADD banners NVARCHAR(MAX) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ssl_subject')
        ALTER TABLE NetworkDevices ADD ssl_subject VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ssl_issuer')
        ALTER TABLE NetworkDevices ADD ssl_issuer VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ssl_expiry')
        ALTER TABLE NetworkDevices ADD ssl_expiry DATETIME NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ssl_self_signed')
        ALTER TABLE NetworkDevices ADD ssl_self_signed BIT NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='ssdp_name')
        ALTER TABLE NetworkDevices ADD ssdp_name VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='mdns_services')
        ALTER TABLE NetworkDevices ADD mdns_services NVARCHAR(MAX) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='link_speed')
        ALTER TABLE NetworkDevices ADD link_speed BIGINT NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='wmi_os')
        ALTER TABLE NetworkDevices ADD wmi_os VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='wmi_cpu')
        ALTER TABLE NetworkDevices ADD wmi_cpu VARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='wmi_manufacturer')
        ALTER TABLE NetworkDevices ADD wmi_manufacturer VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='wmi_model')
        ALTER TABLE NetworkDevices ADD wmi_model VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='wmi_user')
        ALTER TABLE NetworkDevices ADD wmi_user VARCHAR(100) NULL;
    `);

    // Migration v5: LibreNMS cross-reference columns
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='librenms_device_id')
        ALTER TABLE NetworkDevices ADD librenms_device_id INT NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='librenms_os')
        ALTER TABLE NetworkDevices ADD librenms_os VARCHAR(50) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='librenms_hardware')
        ALTER TABLE NetworkDevices ADD librenms_hardware VARCHAR(100) NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='librenms_uptime')
        ALTER TABLE NetworkDevices ADD librenms_uptime BIGINT NULL;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NetworkDevices' AND COLUMN_NAME='librenms_last_polled')
        ALTER TABLE NetworkDevices ADD librenms_last_polled DATETIME NULL;
    `);

    // Migration v6: NetworkAlerts table for automated alerting
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='NetworkAlerts' AND xtype='U')
      BEGIN
        CREATE TABLE NetworkAlerts (
          id INT IDENTITY(1,1) PRIMARY KEY,
          alert_type VARCHAR(20) NOT NULL,
          severity VARCHAR(10) NOT NULL,
          ip VARCHAR(45) NOT NULL,
          device_name VARCHAR(100) NULL,
          message NVARCHAR(500) NOT NULL,
          details NVARCHAR(MAX) NULL,
          acknowledged BIT NOT NULL DEFAULT 0,
          acknowledged_by VARCHAR(50) NULL,
          acknowledged_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT GETDATE()
        );
      END
    `);

    console.log('[DB] PanelControl database initialized successfully');
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    throw error;
  }
}

// Upsert a device (insert or update if IP exists)
export async function upsertDevice(
  ip: string,
  status: string,
  latency: number,
  subnet: string,
  hostname?: string | null,
  mac?: string | null,
  vendor?: string | null,
  openPorts?: string | null,
  osFingerprint?: string | null,
  ttl?: number | null,
  classifiedType?: string | null,
  netbiosName?: string | null,
  domain?: string | null,
  sharedFolders?: string | null,
  httpTitle?: string | null,
  httpServer?: string | null,
  banners?: string | null,
  sslSubject?: string | null,
  sslIssuer?: string | null,
  sslExpiry?: string | null,
  sslSelfSigned?: boolean | null,
  ssdpName?: string | null,
  mdnsServices?: string | null
): Promise<void> {
  const p = await getPool();
  const req = p.request()
    .input('ip', sql.VarChar(45), ip)
    .input('status', sql.VarChar(10), status)
    .input('latency', sql.Int, latency)
    .input('subnet', sql.VarChar(20), subnet)
    .input('lastSeen', sql.DateTime, status === 'Online' ? new Date() : null)
    .input('hostname', sql.VarChar(100), hostname || null)
    .input('mac', sql.VarChar(20), mac || null)
    .input('vendor', sql.VarChar(100), vendor || null)
    .input('openPorts', sql.VarChar(500), openPorts || null)
    .input('osFingerprint', sql.VarChar(100), osFingerprint || null)
    .input('ttl', sql.Int, ttl ?? null)
    .input('classifiedType', sql.VarChar(20), classifiedType || null)
    .input('netbiosName', sql.VarChar(50), netbiosName || null)
    .input('domain', sql.VarChar(50), domain || null)
    .input('sharedFolders', sql.NVarChar(sql.MAX), sharedFolders || null)
    .input('httpTitle', sql.VarChar(200), httpTitle || null)
    .input('httpServer', sql.VarChar(100), httpServer || null)
    .input('banners', sql.NVarChar(sql.MAX), banners || null)
    .input('sslSubject', sql.VarChar(200), sslSubject || null)
    .input('sslIssuer', sql.VarChar(200), sslIssuer || null)
    .input('sslExpiry', sql.DateTime, sslExpiry ? new Date(sslExpiry) : null)
    .input('sslSelfSigned', sql.Bit, sslSelfSigned ?? null)
    .input('ssdpName', sql.VarChar(200), ssdpName || null)
    .input('mdnsServices', sql.NVarChar(sql.MAX), mdnsServices || null);
  
  await req.query(`
    MERGE NetworkDevices AS target
    USING (SELECT @ip AS ip) AS source
    ON target.ip = source.ip
    WHEN MATCHED THEN
      UPDATE SET 
        status = @status, 
        latency = @latency,
        last_seen = CASE WHEN @status = 'Online' THEN @lastSeen ELSE target.last_seen END,
        subnet = @subnet,
        hostname = COALESCE(@hostname, target.hostname),
        mac_address = COALESCE(@mac, target.mac_address),
        vendor = COALESCE(@vendor, target.vendor),
        open_ports = COALESCE(@openPorts, target.open_ports),
        os_fingerprint = COALESCE(@osFingerprint, target.os_fingerprint),
        ttl = COALESCE(@ttl, target.ttl),
        netbios_name = COALESCE(@netbiosName, target.netbios_name),
        domain = COALESCE(@domain, target.domain),
        shared_folders = COALESCE(@sharedFolders, target.shared_folders),
        http_title = COALESCE(@httpTitle, target.http_title),
        http_server = COALESCE(@httpServer, target.http_server),
        banners = COALESCE(@banners, target.banners),
        ssl_subject = COALESCE(@sslSubject, target.ssl_subject),
        ssl_issuer = COALESCE(@sslIssuer, target.ssl_issuer),
        ssl_expiry = COALESCE(@sslExpiry, target.ssl_expiry),
        ssl_self_signed = COALESCE(@sslSelfSigned, target.ssl_self_signed),
        ssdp_name = COALESCE(@ssdpName, target.ssdp_name),
        mdns_services = COALESCE(@mdnsServices, target.mdns_services),
        name = CASE 
          WHEN target.name LIKE 'Unknown%' AND @netbiosName IS NOT NULL THEN @netbiosName
          WHEN target.name LIKE 'Unknown%' AND @hostname IS NOT NULL THEN @hostname
          WHEN target.name LIKE 'Unknown%' AND @vendor IS NOT NULL THEN @vendor + ' (' + RIGHT(@ip, LEN(@ip) - LEN(@subnet) - 1) + ')'
          ELSE target.name 
        END,
        device_type = CASE
          WHEN target.device_type = 'other' AND @classifiedType IS NOT NULL AND @classifiedType <> 'other' THEN @classifiedType
          WHEN @classifiedType IS NOT NULL AND @classifiedType <> 'other' AND target.device_type <> @classifiedType THEN @classifiedType
          ELSE target.device_type
        END
    WHEN NOT MATCHED THEN
      INSERT (ip, name, device_type, subnet, last_seen, status, latency, hostname, mac_address, vendor, open_ports, os_fingerprint, ttl, netbios_name, domain, shared_folders, http_title, http_server, banners, ssl_subject, ssl_issuer, ssl_expiry, ssl_self_signed, ssdp_name, mdns_services)
      VALUES (
        @ip, 
        COALESCE(@netbiosName, @hostname, CASE WHEN @vendor IS NOT NULL THEN @vendor + ' (' + RIGHT(@ip, LEN(@ip) - LEN(@subnet) - 1) + ')' ELSE NULL END, 'Unknown (' + RIGHT(@ip, LEN(@ip) - LEN(@subnet) - 1) + ')'),
        COALESCE(@classifiedType, 'other'), @subnet, @lastSeen, @status, @latency, @hostname, @mac, @vendor, @openPorts, @osFingerprint, @ttl, @netbiosName, @domain, @sharedFolders, @httpTitle, @httpServer, @banners, @sslSubject, @sslIssuer, @sslExpiry, @sslSelfSigned, @ssdpName, @mdnsServices
      );
  `);
}

// Get all devices
export async function getAllDevices(): Promise<unknown[]> {
  const p = await getPool();
  const result = await p.request().query(`
    SELECT *, hostname, mac_address FROM NetworkDevices ORDER BY 
      CASE WHEN is_monitored = 1 THEN 0 ELSE 1 END,
      ip
  `);
  return result.recordset;
}

// Update a device's name, type, or monitored status
export async function updateDevice(
  ip: string,
  updates: { name?: string; device_type?: string; is_monitored?: boolean }
): Promise<void> {
  const p = await getPool();
  const setClauses: string[] = [];
  const request = p.request().input('ip', sql.VarChar(45), ip);

  if (updates.name !== undefined) {
    setClauses.push('name = @name');
    request.input('name', sql.VarChar(100), updates.name);
  }
  if (updates.device_type !== undefined) {
    setClauses.push('device_type = @device_type');
    request.input('device_type', sql.VarChar(20), updates.device_type);
  }
  if (updates.is_monitored !== undefined) {
    setClauses.push('is_monitored = @is_monitored');
    request.input('is_monitored', sql.Bit, updates.is_monitored ? 1 : 0);
  }

  if (setClauses.length > 0) {
    await request.query(`UPDATE NetworkDevices SET ${setClauses.join(', ')} WHERE ip = @ip`);
  }
}

// Record a scan in history
export async function recordScan(subnet: string, totalHosts: number): Promise<void> {
  const p = await getPool();
  await p.request()
    .input('subnet', sql.VarChar(20), subnet)
    .input('totalHosts', sql.Int, totalHosts)
    .query('INSERT INTO ScanHistory (subnet, total_hosts) VALUES (@subnet, @totalHosts)');
}

// Seed known devices (only inserts if they don't exist)
export async function seedKnownDevices(devices: { ip: string; name: string; type: string }[]): Promise<void> {
  const p = await getPool();
  for (const dev of devices) {
    await p.request()
      .input('ip', sql.VarChar(45), dev.ip)
      .input('name', sql.VarChar(100), dev.name)
      .input('type', sql.VarChar(20), dev.type)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM NetworkDevices WHERE ip = @ip)
          INSERT INTO NetworkDevices (ip, name, device_type, subnet, is_monitored)
          VALUES (@ip, @name, @type, LEFT(@ip, LEN(@ip) - CHARINDEX('.', REVERSE(@ip))), 1)
        ELSE
          UPDATE NetworkDevices SET name = @name, device_type = @type, is_monitored = 1 WHERE ip = @ip AND name LIKE 'Unknown%'
      `);
  }
}

// ═══════════════════════════════════════════════════════════
// NetworkAlerts CRUD
// ═══════════════════════════════════════════════════════════

export interface AlertRecord {
  alert_type: string;
  severity: string;
  ip: string;
  device_name: string | null;
  message: string;
  details: string | null;
}

// Create a new alert (skips duplicate if same type+ip within last 10 minutes)
export async function createAlert(alert: AlertRecord): Promise<number | null> {
  const p = await getPool();
  
  // Dedup: skip if same alert_type + ip was created within last 10 minutes
  const dup = await p.request()
    .input('alertType', sql.VarChar(20), alert.alert_type)
    .input('ip', sql.VarChar(45), alert.ip)
    .query(`
      SELECT TOP 1 id FROM NetworkAlerts 
      WHERE alert_type = @alertType AND ip = @ip 
        AND created_at > DATEADD(MINUTE, -10, GETDATE())
    `);
  
  if (dup.recordset.length > 0) return null; // Skip duplicate

  const result = await p.request()
    .input('alertType', sql.VarChar(20), alert.alert_type)
    .input('severity', sql.VarChar(10), alert.severity)
    .input('ip', sql.VarChar(45), alert.ip)
    .input('deviceName', sql.VarChar(100), alert.device_name)
    .input('message', sql.NVarChar(500), alert.message)
    .input('details', sql.NVarChar(sql.MAX), alert.details)
    .query(`
      INSERT INTO NetworkAlerts (alert_type, severity, ip, device_name, message, details)
      OUTPUT INSERTED.id
      VALUES (@alertType, @severity, @ip, @deviceName, @message, @details)
    `);
  
  return result.recordset[0]?.id || null;
}

// Get all unacknowledged alerts (most recent first)
export async function getActiveAlerts(): Promise<unknown[]> {
  const p = await getPool();
  const result = await p.request().query(`
    SELECT * FROM NetworkAlerts 
    WHERE acknowledged = 0 
    ORDER BY 
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      created_at DESC
  `);
  return result.recordset;
}

// Get alert history (all alerts, acknowledged or not)
export async function getAlertHistory(limit: number = 100): Promise<unknown[]> {
  const p = await getPool();
  const result = await p.request()
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) * FROM NetworkAlerts 
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

// Acknowledge a single alert
export async function acknowledgeAlert(id: number, acknowledgedBy?: string): Promise<boolean> {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.Int, id)
    .input('acknowledgedBy', sql.VarChar(50), acknowledgedBy || 'admin')
    .query(`
      UPDATE NetworkAlerts 
      SET acknowledged = 1, acknowledged_by = @acknowledgedBy, acknowledged_at = GETDATE()
      WHERE id = @id AND acknowledged = 0
    `);
  return (result.rowsAffected[0] || 0) > 0;
}

// Acknowledge all active alerts
export async function acknowledgeAllAlerts(acknowledgedBy?: string): Promise<number> {
  const p = await getPool();
  const result = await p.request()
    .input('acknowledgedBy', sql.VarChar(50), acknowledgedBy || 'admin')
    .query(`
      UPDATE NetworkAlerts 
      SET acknowledged = 1, acknowledged_by = @acknowledgedBy, acknowledged_at = GETDATE()
      WHERE acknowledged = 0
    `);
  return result.rowsAffected[0] || 0;
}

// Get count of unacknowledged alerts (for badge)
export async function getActiveAlertCount(): Promise<number> {
  const p = await getPool();
  const result = await p.request().query(`
    SELECT COUNT(*) as count FROM NetworkAlerts WHERE acknowledged = 0
  `);
  return result.recordset[0]?.count || 0;
}
