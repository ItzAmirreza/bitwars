import { useRef, useEffect, useCallback, useState } from 'react';

interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

export type { DisplayMessage };

export interface ChatOverlayProps {
  chatOpen: boolean;
  chatMessages: DisplayMessage[];
  chatDraft: string;
  setChatDraft: (v: string) => void;
  sendChatMessage: (text: string) => Promise<void>;
  closeChat: () => void;
}

export function ChatOverlay({
  chatOpen,
  chatMessages,
  chatDraft,
  setChatDraft,
  sendChatMessage,
  closeChat,
}: ChatOverlayProps) {
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const [, chatTick] = useState(0);

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

  // Auto-scroll to bottom
  useEffect(() => {
    if (!chatOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const list = chatListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatOpen]);

  return (
    <div
      className="absolute z-20"
      style={{
        left: '2px',
        bottom: '50%',
        transform: 'translateY(50%)',
        width: 'min(420px, 40vw)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      {/* Message list — stacks upward from bottom */}
      <div
        ref={chatListRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: chatOpen ? '45vh' : '180px',
          overflowY: chatOpen ? 'auto' : 'hidden',
          padding: '0 4px 2px 4px',
          overscrollBehavior: 'contain',
          pointerEvents: chatOpen ? 'auto' : 'none',
          maskImage: chatOpen ? 'none' : 'linear-gradient(to bottom, transparent 0%, black 15%)',
          WebkitMaskImage: chatOpen ? 'none' : 'linear-gradient(to bottom, transparent 0%, black 15%)',
        }}
      >
        {chatMessages
          .filter((m) => chatOpen || getMessageOpacity(m.sentAt) > 0.01)
          .slice(chatOpen ? -50 : -10)
          .map((msg) => {
            const isSystem = msg.senderName === '[SERVER]';
            const opacity = chatOpen ? 1 : getMessageOpacity(msg.sentAt);
            return (
              <div
                key={msg.id}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: '1.3',
                  opacity,
                  padding: '1px 4px',
                  background: chatOpen ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)',
                  transition: 'opacity 0.4s',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                }}
              >
                {isSystem ? (
                  <span style={{ color: '#ffaa00' }}>{msg.text}</span>
                ) : (
                  <>
                    <span style={{ color: '#e0e0e0', fontWeight: 400 }}>{'<'}</span>
                    <span style={{ color: '#55ff55', fontWeight: 400 }}>{msg.senderName}</span>
                    <span style={{ color: '#e0e0e0', fontWeight: 400 }}>{'> '}</span>
                    <span style={{ color: '#ffffff' }}>{msg.text}</span>
                  </>
                )}
              </div>
            );
          })}
      </div>

      {/* Chat input — full-width bar at the very bottom */}
      {chatOpen && (
        <div style={{ pointerEvents: 'auto' }}>
          <input
            ref={chatInputRef}
            autoFocus
            maxLength={200}
            value={chatDraft}
            placeholder=""
            onChange={(e) => setChatDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                if (chatDraft.trim()) void sendChatMessage(chatDraft);
                closeChat();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                closeChat();
              }
            }}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              color: '#ffffff',
              padding: '6px 4px',
              outline: 'none',
              borderRadius: 0,
              caretColor: '#55ff55',
              textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
            }}
          />
        </div>
      )}
    </div>
  );
}
