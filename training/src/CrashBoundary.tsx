import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  renderError: string | null;
  asyncError: string | null;
};

export default class CrashBoundary extends React.Component<Props, State> {
  state: State = {
    renderError: null,
    asyncError: null,
  };

  private onWindowError = (event: ErrorEvent) => {
    const message =
      event.error instanceof Error
        ? event.error.stack || event.error.message
        : event.message || 'Unknown window error';
    this.setState({ asyncError: truncate(message) });
  };

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.stack || reason.message
        : typeof reason === 'string'
          ? reason
          : safeStringify(reason);
    this.setState({ asyncError: truncate(message || 'Unhandled promise rejection') });
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      renderError: truncate(error.stack || error.message || 'Unknown render error'),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('CrashBoundary caught renderer error', error, info);
  }

  componentDidMount() {
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  render() {
    const error = this.state.renderError || this.state.asyncError;
    if (error) {
      return (
        <div style={shellStyle}>
          <div style={panelStyle}>
            <div style={titleStyle}>Renderer Error</div>
            <div style={subtitleStyle}>
              The UI hit a runtime error. The app stayed alive so you can recover without a blank screen.
            </div>
            <pre style={errorStyle}>{error}</pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => this.setState({ renderError: null, asyncError: null })}
                style={secondaryButtonStyle}
              >
                TRY AGAIN
              </button>
              <button
                onClick={() => window.location.reload()}
                style={primaryButtonStyle}
              >
                RELOAD UI
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function truncate(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeStringify(value: unknown) {
  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0a0a0a',
  padding: 24,
};

const panelStyle: React.CSSProperties = {
  width: 'min(920px, 100%)',
  background: '#15191d',
  border: '3px solid #ff6666',
  padding: 20,
  color: '#e6eef3',
  boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-pixel)',
  fontSize: 12,
  color: '#ff6666',
  marginBottom: 10,
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: '#9fb0bc',
  marginBottom: 12,
};

const errorStyle: React.CSSProperties = {
  background: '#0d1115',
  border: '2px solid #303b44',
  padding: 12,
  color: '#ffb1b1',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  marginBottom: 14,
  maxHeight: '50vh',
};

const primaryButtonStyle: React.CSSProperties = {
  background: '#00ff88',
  color: '#0a0a0a',
  border: '2px solid #00ff88',
  padding: '8px 16px',
  fontFamily: 'var(--font-pixel)',
  fontSize: 9,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: '#20282e',
  color: '#9eaab4',
  border: '2px solid #344048',
  padding: '8px 16px',
  fontFamily: 'var(--font-pixel)',
  fontSize: 9,
  cursor: 'pointer',
};
