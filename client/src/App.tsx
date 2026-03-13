import { useEffect, useState } from 'react';
import { useGameStore } from './store';
import { connect } from './db';
import { LoginScreen } from './screens/LoginScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';

function LoadingScreen() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="scanlines hex-bg flex items-center justify-center h-full relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none anim-breath"
        style={{
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.06) 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      <div className="text-center anim-fade-up relative z-10">
        <h1
          className="title-glow"
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '36px',
            color: 'var(--c-green)',
            letterSpacing: '0.1em',
            marginBottom: '32px',
          }}
        >
          BITWARS
        </h1>

        {/* Loading bar */}
        <div
          style={{
            width: '300px',
            height: '3px',
            background: 'var(--c-border)',
            margin: '0 auto 20px',
            overflow: 'hidden',
            borderRadius: '1px',
          }}
        >
          <div className="loading-bar" />
        </div>

        <div className="flex items-center justify-center gap-2">
          <div className="status-dot" />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--c-muted)',
              letterSpacing: '0.2em',
              minWidth: '200px',
              textAlign: 'left',
            }}
          >
            ESTABLISHING UPLINK{dots}
          </span>
        </div>
      </div>
    </div>
  );
}

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
    return <LoadingScreen />;
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
