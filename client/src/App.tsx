import { useEffect } from 'react';
import { useGameStore } from './store';
import { connect } from './db';
import { LoginScreen } from './screens/LoginScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';

function App() {
  const { screen, connected, setConnected, setIdentity, setConnection, setError } = useGameStore();

  useEffect(() => {
    if (connected) return;

    connect(
      (conn, identity, _token) => {
        setConnected(true);
        setIdentity(identity);
        setConnection(conn);
      },
      (error) => {
        setError(error.message);
        console.error('[BitWars] Connection error:', error);
      },
    );
  }, [connected, setConnected, setIdentity, setConnection, setError]);

  if (!connected) {
    return (
      <div className="scanlines grid-bg flex items-center justify-center h-full">
        <div className="text-center anim-fade-up">
          <h1
            className="glow-green"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '28px',
              color: 'var(--c-green)',
              letterSpacing: '0.05em',
              marginBottom: '24px',
            }}
          >
            BITWARS
          </h1>
          <div className="flex items-center justify-center gap-2">
            <div className="status-dot" />
            <span
              className="cursor-blink"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--c-muted)',
                letterSpacing: '0.2em',
              }}
            >
              ESTABLISHING UPLINK
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      {screen === 'login' && <LoginScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'game' && <GameScreen />}
    </div>
  );
}

export default App;
