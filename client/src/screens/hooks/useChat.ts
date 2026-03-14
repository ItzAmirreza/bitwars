import { useEffect, useRef, useState, useCallback } from 'react';
import type { DisplayMessage } from '../hud/weaponData';
import { toDisplayMessage, mergeMessages } from '../hud/weaponData';
import type { DbConnection } from '../../module_bindings';
import type { Engine } from '../../game/Engine';

export function useChat(
  connection: DbConnection | null,
  engineRef: React.RefObject<Engine | null>,
) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [, chatTick] = useState(0);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
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

  // Load chat messages from DB + subscribe to new ones
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.chat_message) return;

    const initial = Array.from(db.chat_message.iter(), (msg: any) => toDisplayMessage(msg));
    setChatMessages(mergeMessages([], initial));

    const handleInsert = (_ctx: unknown, msg: any) => {
      setChatMessages((prev) => mergeMessages(prev, [toDisplayMessage(msg)]));
    };

    db.chat_message.onInsert(handleInsert);

    return () => {
      if (typeof db.chat_message.removeOnInsert === 'function') {
        db.chat_message.removeOnInsert(handleInsert);
      }
    };
  }, [connection]);

  // Periodic tick for message fading (when chat is closed)
  useEffect(() => {
    if (chatOpen) return;
    const interval = setInterval(() => chatTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [chatOpen]);

  // Focus chat input when opened
  useEffect(() => {
    if (chatOpen) {
      const timer = window.setTimeout(() => {
        const input = chatInputRef.current;
        if (!input) return;

        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const list = chatListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatOpen]);

  const openChat = useCallback((initialText = '') => {
    setChatDraft(initialText);
    setChatOpen(true);
    engineRef.current?.setChatOpen(true);
  }, [engineRef]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatDraft('');
    engineRef.current?.setChatOpen(false);
  }, [engineRef]);

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!connection || !text.trim()) return;
      const trimmed = text.trim();

      try {
        await connection.reducers.sendChat({ text: trimmed });
        if (trimmed.toLowerCase() === '/fly') {
          engineRef.current?.toggleFly();
        }
      } catch (error) {
        pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to send chat message');
      }
    },
    [connection, pushLocalSystemMessage, engineRef],
  );

  const getMessageOpacity = useCallback(
    (sentAt: number): number => {
      if (chatOpen) return 1;
      const age = (Date.now() - sentAt) / 1000;
      if (age < 6) return 0.9;
      if (age < 10) return 0.9 * (1 - (age - 6) / 4);
      return 0;
    },
    [chatOpen],
  );

  return {
    chatOpen,
    setChatOpen,
    chatMessages,
    chatDraft,
    setChatDraft,
    chatInputRef,
    chatListRef,
    openChat,
    closeChat,
    sendChatMessage,
    getMessageOpacity,
    pushLocalSystemMessage,
  };
}
