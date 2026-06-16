'use client';

import { type NetworkEvent } from './NetworkCard';

interface EventLogProps {
  events: NetworkEvent[];
}

export default function EventLog({ events }: EventLogProps) {
  if (events.length === 0) {
    return (
      <div className="event-log">
        <div className="event-log-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span>Event Log</span>
        </div>
        <div className="event-log-empty">No events recorded yet. Monitoring…</div>
      </div>
    );
  }

  return (
    <div className="event-log">
      <div className="event-log-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span>Event Log</span>
        <span className="event-log-count">{events.length}</span>
      </div>
      <div className="event-log-body">
        {events.map((event) => (
          <div key={event.id} className={`event-item event-${event.type}`}>
            <span className="event-time">{event.timestamp}</span>
            <span className={`event-dot event-dot-${event.type}`}></span>
            <span className="event-message">{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
