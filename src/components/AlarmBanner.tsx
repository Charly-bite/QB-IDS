'use client';

import { useEffect, useRef, useState } from 'react';

interface ServerAlert {
  name: string;
  url: string;
  status: string;
  errorDetail?: string;
}

interface LibreNMSAlertItem {
  id: number;
  hostname: string;
  rule: string;
  severity: string;
  timestamp: string;
}

interface AlarmBannerProps {
  alerts: ServerAlert[];
  librenmsAlerts?: LibreNMSAlertItem[];
  onDismiss: () => void;
  onMute: () => void;
  isMuted: boolean;
}

export default function AlarmBanner({ alerts, librenmsAlerts = [], onDismiss, onMute, isMuted }: AlarmBannerProps) {
  const totalAlerts = alerts.length + librenmsAlerts.length;
  if (totalAlerts === 0) return null;

  const criticalLnms = librenmsAlerts.filter(a => a.severity === 'critical');
  const warningLnms = librenmsAlerts.filter(a => a.severity !== 'critical');

  return (
    <div className="alarm-banner" role="alert">
      <div className="alarm-icon-pulse">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>

      <div className="alarm-content">
        <strong className="alarm-title">
          {alerts.length === 1
            ? `${alerts[0].name} is ${alerts[0].status}`
            : `${alerts.length} servers have issues`}
        </strong>
        <div className="alarm-details">
          {alerts.map((a) => (
            <span key={a.url} className="alarm-server">
              <span className="alarm-server-dot"></span>
              {a.name}
              {a.errorDetail && <span className="alarm-error-hint"> — {a.errorDetail}</span>}
            </span>
          ))}
          {criticalLnms.length > 0 && (
            <span style={{ fontSize: '11px', color: '#f87171', display: 'block', marginTop: '4px' }}>
              🔴 {criticalLnms.length} critical LibreNMS alert{criticalLnms.length > 1 ? 's' : ''}: {criticalLnms.map(a => `${a.hostname} (${a.rule})`).join(', ')}
            </span>
          )}
          {warningLnms.length > 0 && (
            <span style={{ fontSize: '11px', color: '#fbbf24', display: 'block', marginTop: '2px' }}>
              🟡 {warningLnms.length} warning{warningLnms.length > 1 ? 's' : ''}: {warningLnms.map(a => a.hostname).join(', ')}
            </span>
          )}
        </div>
      </div>

      <div className="alarm-actions">
        <button className="alarm-btn" onClick={onMute} title={isMuted ? 'Unmute alarm' : 'Mute alarm'}>
          {isMuted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
        <button className="alarm-btn" onClick={onDismiss} title="Dismiss">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ===== Alarm Sound Hook =====
export function useAlarmSound() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMutedRef = useRef(false);

  const playBeep = () => {
    if (isMutedRef.current) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;

      // --- Intense multi-tone siren ---
      const playTone = (freq: number, startTime: number, duration: number, type: OscillatorType = 'square') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.45, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;

      // Three rapid ascending beeps: BEE-BEE-BEEEEP
      playTone(880, now, 0.12, 'square');         // Short low
      playTone(1100, now + 0.15, 0.12, 'square'); // Short mid
      playTone(1320, now + 0.30, 0.35, 'sawtooth'); // Long high (harsh)

      // Rising sweep on the long tone for urgency
      const sweepOsc = ctx.createOscillator();
      const sweepGain = ctx.createGain();
      sweepOsc.connect(sweepGain);
      sweepGain.connect(ctx.destination);
      sweepOsc.type = 'sine';
      sweepOsc.frequency.setValueAtTime(800, now + 0.30);
      sweepOsc.frequency.linearRampToValueAtTime(1600, now + 0.65);
      sweepGain.gain.setValueAtTime(0.2, now + 0.30);
      sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      sweepOsc.start(now + 0.30);
      sweepOsc.stop(now + 0.65);
    } catch {
      // Audio not supported
    }
  };

  const startAlarm = () => {
    if (intervalRef.current) return;
    playBeep(); // Play immediately
    intervalRef.current = setInterval(playBeep, 2500); // Every 2.5s — more urgent
  };

  const stopAlarm = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const setMuted = (muted: boolean) => {
    isMutedRef.current = muted;
    if (muted) stopAlarm();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      stopAlarm();
      audioCtxRef.current?.close();
    };
  }, []);

  return { startAlarm, stopAlarm, setMuted, playBeep };
}

// ===== Browser Notification =====
export function sendNotification(title: string, body: string) {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'server-alarm', // Prevents duplicate notifications
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico', tag: 'server-alarm' });
      }
    });
  }
}
