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
    <div
      className="flex items-center justify-center h-full relative overflow-hidden"
      style={{ background: 'var(--c-bg)' }}
    >
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.05) 0%, transparent 65%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          animation: 'breath 6s ease-in-out infinite',
        }}
      />

      <div className="text-center anim-fade-up relative z-10">
        <h1
          className="title-glow"
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: 'clamp(36px, 6vw, 56px)',
            color: 'var(--c-green)',
            letterSpacing: '0.12em',
            marginBottom: '36px',
          }}
        >
          BITWARS
        </h1>

        {/* Loading bar */}
        <div
          style={{
            width: '280px',
            height: '3px',
            background: 'var(--c-border)',
            margin: '0 auto 24px',
            overflow: 'hidden',
            borderRadius: '1px',
          }}
        >
          <div className="loading-bar" />
        </div>

        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '15px',
            fontWeight: 600,
            color: '#8888a0',
            letterSpacing: '0.15em',
          }}
        >
          CONNECTING{dots}
        </span>
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
