import { useEffect, useState } from 'react';
import { useGameStore } from './store';
import { connect } from './db';
import { LoginScreen } from './screens/LoginScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';

function LoadingScreen() {
  const [dots, setDots] = useState('');
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Stepped pixel loading bar
    const steps = [8, 20, 35, 50, 65, 78, 88, 95, 100];
    let i = 0;
    const timer = setInterval(() => {
      if (i < steps.length) {
        setBarWidth(steps[i]);
        i++;
      } else {
        clearInterval(timer);
      }
    }, 350);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', position: 'relative', overflow: 'hidden',
        background: '#0a0c14',
      }}
    >
      <div style={{ textAlign: 'center' }} className="anim-fade-up relative z-10">
        <h1 style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: 'clamp(32px, 6vw, 52px)',
          color: '#fff',
          letterSpacing: '0.12em',
          marginBottom: '32px',
          textShadow: '4px 4px 0 #ff6b35, -2px -2px 0 #00e5ff',
        }}>
          BITWARS
        </h1>

        {/* Pixel loading bar */}
        <div style={{
          width: '240px', height: '10px',
          background: '#12161e',
          border: '2px solid #2a2e3e',
          margin: '0 auto 20px',
          overflow: 'hidden',
          padding: '1px',
        }}>
          <div style={{
            width: `${barWidth}%`,
            height: '100%',
            background: '#ff6b35',
            transition: 'width 0.15s steps(4)',
            imageRendering: 'pixelated',
          }} />
        </div>

        <span style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '9px',
          color: '#6b7080',
          letterSpacing: '0.15em',
        }}>
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
        setIdentity(identity);
        setConnection(conn);
        setConnected(true);
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
    <div className="w-full h-full relative">
      <div className="absolute inset-0">
        <GameScreen active={screen === 'game'} />
      </div>
      {screen === 'login' && (
        <div className="absolute inset-0 z-10">
          <LoginScreen />
        </div>
      )}
      {screen === 'lobby' && (
        <div className="absolute inset-0 z-10">
          <LobbyScreen />
        </div>
      )}
    </div>
  );
}

export default App;
