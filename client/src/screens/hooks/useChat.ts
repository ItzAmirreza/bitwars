import { useEffect, useRef, useState, useCallback } from 'react';
import type { DbConnection } from '../../module_bindings';

interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

const MAX_CHAT_MESSAGES = 80;
// Keep these values aligned with server/spacetimedb/src/chat.rs.
const CHAT_SEND_COOLDOWN_MS = 1_200;
const CHAT_BURST_WINDOW_MS = 10_000;
const CHAT_BURST_LIMIT = 5;
const CHAT_BURST_LOCK_MS = 15_000;

type ChatBlockMode = 'cooldown' | 'burst' | null;

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

function formatCooldownLabel(ms: number): string {
  return `${(Math.max(ms, 100) / 1000).toFixed(1)}s`;
}

function parseServerCooldownMs(message: string): { durationMs: number; mode: ChatBlockMode } | null {
  const match = message.match(/(\d+(?:\.\d+)?)s/i);
  if (!match) return null;

  const durationMs = Math.ceil(Number(match[1]) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  return {
    durationMs,
    mode: /locked/i.test(message) ? 'burst' : 'cooldown',
  };
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
  const [chatDraft, setChatDraftState] = useState('');
  const [chatBlockedUntil, setChatBlockedUntil] = useState(0);
  const [chatBlockMode, setChatBlockMode] = useState<ChatBlockMode>(null);
  const [chatFeedbackText, setChatFeedbackText] = useState('');
  const localChatIdRef = useRef(-1);
  const recentSendTimesRef = useRef<number[]>([]);
  const [, setChatCooldownTick] = useState(0);

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

  const setChatDraft = useCallback(
    (value: string) => {
      setChatDraftState(value);
      if (chatBlockedUntil <= Date.now()) {
        setChatFeedbackText('');
      }
    },
    [chatBlockedUntil],
  );

  useEffect(() => {
    if (chatBlockedUntil <= Date.now()) return;

    const interval = window.setInterval(() => {
      setChatCooldownTick((tick) => tick + 1);
    }, 100);

    return () => window.clearInterval(interval);
  }, [chatBlockedUntil]);

  useEffect(() => {
    recentSendTimesRef.current = [];
    setChatBlockedUntil(0);
    setChatBlockMode(null);
    setChatFeedbackText('');
  }, [connection, localIdentity]);

  const chatCooldownRemainingMs = Math.max(0, chatBlockedUntil - Date.now());
  const chatStatusText = chatCooldownRemainingMs > 0
    ? chatBlockMode === 'burst'
      ? `Chat locked ${formatCooldownLabel(chatCooldownRemainingMs)}`
      : `Slow mode ${formatCooldownLabel(chatCooldownRemainingMs)}`
    : chatFeedbackText;

  const sendChatMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!connection || !text.trim()) return false;
      const trimmed = text.trim();
      const localRemainingMs = Math.max(0, chatBlockedUntil - Date.now());

      if (localRemainingMs > 0) {
        setChatFeedbackText(
          chatBlockMode === 'burst'
            ? `Chat locked for ${formatCooldownLabel(localRemainingMs)}.`
            : `Slow mode: wait ${formatCooldownLabel(localRemainingMs)}.`,
        );
        return false;
      }

      try {
        await connection.reducers.sendChat({ text: trimmed });
        const sentAt = Date.now();
        const recent = recentSendTimesRef.current.filter((ts) => sentAt - ts < CHAT_BURST_WINDOW_MS);
        recent.push(sentAt);
        recentSendTimesRef.current = recent;

        const hitBurstLimit = recent.length >= CHAT_BURST_LIMIT;
        setChatBlockedUntil(sentAt + (hitBurstLimit ? CHAT_BURST_LOCK_MS : CHAT_SEND_COOLDOWN_MS));
        setChatBlockMode(hitBurstLimit ? 'burst' : 'cooldown');
        setChatFeedbackText('');
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send chat message';
        const parsedCooldown = parseServerCooldownMs(message);

        if (parsedCooldown) {
          setChatBlockedUntil((prev) => Math.max(prev, Date.now() + parsedCooldown.durationMs));
          setChatBlockMode(parsedCooldown.mode);
        }

        setChatFeedbackText(message);
        pushLocalSystemMessage(message);
        return false;
      }
    },
    [chatBlockMode, chatBlockedUntil, connection, pushLocalSystemMessage],
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
    chatCooldownRemainingMs,
    chatStatusText,
  };
}
