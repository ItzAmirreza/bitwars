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
  chatOpen, chatMessages, chatDraft, setChatDraft, sendChatMessage, closeChat,
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

  useEffect(() => {
    if (chatOpen) return;
    const interval = setInterval(() => chatTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [chatOpen]);

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
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '7px',
                  lineHeight: '1.8',
                  opacity,
                  padding: '2px 6px',
                  background: chatOpen ? 'rgba(12,16,24,0.85)' : 'rgba(12,16,24,0.6)',
                  transition: 'opacity 0.4s',
                }}
              >
                {isSystem ? (
                  <span style={{ color: '#ffd600', fontFamily: "'Vazirmatn', var(--font-pixel), sans-serif", fontSize: '8px' }} dir="auto">{msg.text}</span>
                ) : (
                  <>
                    <span style={{ color: '#76ff03' }}>{msg.senderName}</span>
                    <span style={{ color: '#4a4e5e' }}>{': '}</span>
                    <span style={{ color: '#e8e8f0', fontFamily: "'Vazirmatn', var(--font-pixel), sans-serif", fontSize: '8px' }} dir="auto">{msg.text}</span>
                  </>
                )}
              </div>
            );
          })}
      </div>

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
            dir="auto"
            style={{
              width: '100%',
              fontFamily: "'Vazirmatn', var(--font-pixel), sans-serif",
              fontSize: '9px',
              background: 'rgba(12,16,24,0.9)',
              border: 'none',
              borderTop: '2px solid #ff6b35',
              color: '#e8e8f0',
              padding: '6px 6px',
              outline: 'none',
              borderRadius: 0,
              caretColor: '#ff6b35',
              letterSpacing: '0.02em',
            }}
          />
        </div>
      )}
    </div>
  );
}
