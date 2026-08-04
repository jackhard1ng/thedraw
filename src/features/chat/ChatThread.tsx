/**
 * Chat thread — threads/{threadId}/messages. Append-only (firestore.rules).
 * threadId === postId for a round post. Messages are the coordination surface
 * once players have joined a round.
 */
import { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui';
import type { ChatMessage } from '@/types/models';

export function ChatThread({ threadId }: { threadId: string }) {
  const { fbUser, profile } = useAuth();
  const [messages, setMessages] = useState<(ChatMessage & { id: string })[]>([]);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'threads', threadId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ChatMessage) })));
    });
  }, [threadId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || !fbUser) return;
    setText('');
    await addDoc(collection(db, 'threads', threadId, 'messages'), {
      authorId: fbUser.uid,
      authorName: profile?.displayName ?? 'Player',
      text: body,
      createdAt: serverTimestamp(),
    });
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-80 space-y-2 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Coordinate the tee time here once you've joined.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.authorId === fbUser?.uid;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-sm px-3 py-2 text-sm ${
                  mine ? 'bg-ink text-paper' : 'bg-paper-sunken text-ink'
                }`}
              >
                {!mine && (
                  <p className="mb-0.5 text-xs font-display uppercase tracking-wide text-ink-faint">
                    {m.authorName}
                  </p>
                )}
                {m.text}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="field-input"
          placeholder="Message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="primary" onClick={send} disabled={!text.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
