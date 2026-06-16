'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';

export interface NetworkEvent {
  id: string;
  timestamp: string;
  deviceName: string;
  type: 'up' | 'down' | 'warning';
  message: string;
}

interface NetworkCardProps {
  name: string;
  ip: string;
  deviceType: 'server' | 'switch' | 'firewall' | 'router' | 'other';
  interval?: number;
  compact?: boolean;
  onStatusChange?: (ip: string, name: string, status: string) => void;
  onEvent?: (event: NetworkEvent) => void;
}

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  server: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
  switch: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="22" height="12" rx="2" />
      <line x1="6" y1="10" x2="6.01" y2="10" />
      <line x1="10" y1="10" x2="10.01" y2="10" />
      <line x1="14" y1="10" x2="14.01" y2="10" />
      <line x1="18" y1="10" x2="18.01" y2="10" />
      <line x1="6" y1="14" x2="6.01" y2="14" />
      <line x1="10" y1="14" x2="10.01" y2="14" />
      <line x1="14" y1="14" x2="14.01" y2="14" />
      <line x1="18" y1="14" x2="18.01" y2="14" />
    </svg>
  ),
  firewall: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  router: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="14" width="20" height="6" rx="2" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
      <line x1="12" y1="14" x2="12" y2="8" />
      <circle cx="12" cy="6" r="2" />
    </svg>
  ),
  other: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
};

export default function NetworkCard({ name, ip, deviceType, interval = 30000, compact = false, onStatusChange, onEvent }: NetworkCardProps) {
  const [status, setStatus] = useState<'Online' | 'Offline' | 'Loading'>('Loading');
  const [latency, setLatency] = useState(0);
  const [lastChecked, setLastChecked] = useState('—');
  const [uptimeText, setUptimeText] = useState('—');
  const upSinceRef = useRef<Date | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/icmp-ping?host=${encodeURIComponent(ip)}`);
      const result = await res.json();
      const newStatus = result.status === 'Online' ? 'Online' : 'Offline';

      // Track uptime start
      if (newStatus === 'Online' && !upSinceRef.current) {
        upSinceRef.current = new Date();
      }
      if (newStatus === 'Offline') {
        upSinceRef.current = null;
      }

      // Emit events on status changes
      if (prevStatusRef.current !== null && prevStatusRef.current !== newStatus && onEvent) {
        onEvent({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          deviceName: name,
          type: newStatus === 'Online' ? 'up' : 'down',
          message: newStatus === 'Online' ? `${name} came back online` : `${name} went offline`,
        });
      }
      prevStatusRef.current = newStatus;

      setStatus(newStatus as 'Online' | 'Offline');
      setLatency(result.latency || 0);
      setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

      if (onStatusChange) {
        onStatusChange(ip, name, newStatus);
      }
    } catch {
      if (prevStatusRef.current !== 'Offline' && prevStatusRef.current !== null && onEvent) {
        onEvent({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          deviceName: name,
          type: 'down',
          message: `${name} — ping API unreachable`,
        });
      }
      prevStatusRef.current = 'Offline';
      setStatus('Offline');
      upSinceRef.current = null;
    }
  }, [ip, name, onStatusChange, onEvent]);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, interval);
    return () => clearInterval(timer);
  }, [fetchStatus, interval]);

  // Update uptime text every 15 seconds
  useEffect(() => {
    const updateUptime = () => {
      if (!upSinceRef.current) { setUptimeText('—'); return; }
      const diff = Math.floor((Date.now() - upSinceRef.current.getTime()) / 1000);
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      if (d > 0) setUptimeText(`${d}d ${h}h`);
      else if (h > 0) setUptimeText(`${h}h ${m}m`);
      else setUptimeText(`${m}m`);
    };
    updateUptime();
    const timer = setInterval(updateUptime, 15000);
    return () => clearInterval(timer);
  }, [status]); // re-run when status changes

  const statusColor = status === 'Online' ? 'status-online' : status === 'Offline' ? 'status-offline' : 'status-loading';

  return (
    <div className={`net-card ${status === 'Offline' ? 'net-card-down' : ''} ${compact ? 'net-card-compact' : ''}`}>
      <div className="net-card-header">
        <div className="net-card-icon" data-type={deviceType}>
          {DEVICE_ICONS[deviceType] || DEVICE_ICONS.other}
        </div>
        <div className="net-card-info">
          <span className="net-card-name">{name}</span>
          <span className="net-card-ip">{ip}</span>
        </div>
        <span className={`status-dot ${statusColor}`} style={{ width: 10, height: 10, flexShrink: 0 }}></span>
      </div>
      <div className="net-card-stats">
        <div className="net-stat">
          <span className="net-stat-label">Latency</span>
          <span className="net-stat-value">{status === 'Loading' ? '—' : `${latency}ms`}</span>
        </div>
        <div className="net-stat">
          <span className="net-stat-label">Uptime</span>
          <span className="net-stat-value">{uptimeText}</span>
        </div>
        <div className="net-stat">
          <span className="net-stat-label">Checked</span>
          <span className="net-stat-value">{lastChecked}</span>
        </div>
      </div>
    </div>
  );
}
