import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps one broken view from blanking the whole app. Everything is saved as you go, so a reload loses nothing. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lectern view crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="not-found" role="alert">
        <h1 className="display">This view stopped working</h1>
        <p className="muted">Your work is saved. Reload to pick up where you were.</p>
        <p className="faint" style={{ fontSize: 13, maxWidth: 520 }}>{this.state.error.message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
          <a className="btn btn-secondary" href="/">Go to Home</a>
        </div>
      </div>
    );
  }
}
