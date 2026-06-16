'use client';

import { useEffect, useState } from 'react';

interface Note {
  id: string;
  text: string;
  timestamp: string;
  done: boolean;
}

function getStorageKey(url: string) {
  return `qb-notes-${url}`;
}

export default function DevNotes({ url }: { url: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getStorageKey(url));
      if (saved) {
        setNotes(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
    setIsLoaded(true);
  }, [url]);

  // Persist
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(getStorageKey(url), JSON.stringify(notes));
    }
  }, [notes, url, isLoaded]);

  const addNote = () => {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    const now = new Date();
    const note: Note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: trimmed,
      timestamp: now.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      done: false,
    };
    setNotes((prev) => [note, ...prev]);
    setNewNote('');
  };

  const toggleDone = (id: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, done: !n.done } : n)));
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addNote();
    }
  };

  const pendingCount = notes.filter((n) => !n.done).length;

  return (
    <div className="dev-notes">
      <button className="dev-notes-toggle" onClick={() => setIsOpen(!isOpen)}>
        <div className="dev-notes-toggle-left">
          <svg className={`dev-notes-chevron ${isOpen ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="dev-notes-label">Bugs &amp; To-Do</span>
        </div>
        {pendingCount > 0 && (
          <span className="dev-notes-badge">{pendingCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="dev-notes-body">
          <div className="dev-notes-input-area">
            <textarea
              className="dev-notes-textarea"
              placeholder="Log a bug, task, or reminder… (Enter to save)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
            />
            <button className="action-btn dev-notes-add-btn" onClick={addNote} disabled={!newNote.trim()}>
              Add
            </button>
          </div>

          {notes.length === 0 ? (
            <div className="dev-notes-empty">
              <p>No bugs or tasks logged yet.</p>
            </div>
          ) : (
            <ul className="dev-notes-list">
              {notes.map((note) => (
                <li key={note.id} className={`dev-note-item ${note.done ? 'done' : ''}`}>
                  <button
                    className="dev-note-check"
                    onClick={() => toggleDone(note.id)}
                    aria-label={note.done ? 'Mark as pending' : 'Mark as done'}
                  >
                    {note.done ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    )}
                  </button>
                  <div className="dev-note-content">
                    <p className="dev-note-text">{note.text}</p>
                    <span className="dev-note-timestamp">{note.timestamp}</span>
                  </div>
                  <button
                    className="dev-note-delete"
                    onClick={() => deleteNote(note.id)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
