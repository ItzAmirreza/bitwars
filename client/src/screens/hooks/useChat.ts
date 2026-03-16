import { useEffect, useRef, useState, useCallback } from 'react';
import type { DbConnection } from '../../module_bindings';

interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

const MAX_CHAT_MESSAGES = 80;

function getMessageTimestamp(sentAt: { toMillis?: () => bigint } | null | undefined): number {
  if (sentAt && typeof sentAt.toMillis === 'function') {
    return Number(sentAt.toMillis());
  }
  return Date.now();
}

function toDisplayMessage(msg: any): DisplayMessage {
  return {
    id: Number(msg.id),
    senderName: String(msg.senderName),
    text: String(msg.text),
    sentAt: getMessageTimestamp(msg.sentAt),
  };
}

function mergeMessages(prev: DisplayMessage[], next: DisplayMessage[]): DisplayMessage[] {
  const merged = new Map<number, DisplayMessage>();

  for (const message of prev) merged.set(message.id, message);
  for (const message of next) merged.set(message.id, message);

  return Array.from(merged.values())
    .sort((a, b) => (a.sentAt === b.sentAt ? a.id - b.id : a.sentAt - b.sentAt))
    .slice(-MAX_CHAT_MESSAGES);
}

/** Check whether a raw ChatMessage row should be shown to this client. */
function isVisibleMessage(msg: any, localIdentity: string | null): boolean {
  // "[ADMIN]" messages are private admin command feedback — only the
  // admin who ran the command should see them.
  if (String(msg.senderName) === '[ADMIN]') {
    if (!localIdentity) return false;
    const senderHex: string | undefined = msg.sender?.toHexString?.();
    return senderHex === localIdentity;
  }
  return true;
}

export function useChat(connection: DbConnection | null, localIdentity: string | null) {
  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const localChatIdRef = useRef(-1);

  const pushLocalSystemMessage = useCallback((text: string) => {
    const nextId = localChatIdRef.current;
    localChatIdRef.current -= 1;

    setChatMessages((prev) =>
      mergeMessages(prev, [
        {
          id: nextId,
          senderName: '[SERVER]',
          text,
          sentAt: Date.now(),
        },
      ]),
    );
  }, []);

  const sendChatMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!connection || !text.trim()) return false;
      const trimmed = text.trim();

      try {
        await connection.reducers.sendChat({ text: trimmed });
        return true;
      } catch (error) {
        pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to send chat message');
        return false;
      }
    },
    [connection, pushLocalSystemMessage],
  );

  // Load chat messages from DB + subscribe to new ones
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.chat_message) return;

    const initial = Array.from(db.chat_message.iter())
      .filter((msg: any) => isVisibleMessage(msg, localIdentity))
      .map((msg: any) => toDisplayMessage(msg));
    setChatMessages(mergeMessages([], initial));

    const handleInsert = (_ctx: unknown, msg: any) => {
      if (!isVisibleMessage(msg, localIdentity)) return;
      setChatMessages((prev) => mergeMessages(prev, [toDisplayMessage(msg)]));
    };

    db.chat_message.onInsert(handleInsert);

    return () => {
      if (typeof db.chat_message.removeOnInsert === 'function') {
        db.chat_message.removeOnInsert(handleInsert);
      }
    };
  }, [connection, localIdentity]);

  return {
    chatMessages,
    chatDraft,
    setChatDraft,
    sendChatMessage,
    pushLocalSystemMessage,
  };
}
