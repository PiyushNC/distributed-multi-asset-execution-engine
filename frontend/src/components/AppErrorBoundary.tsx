import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message?: string };

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dashboard rendering error:', error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-state">
          <div>
            <span className="eyebrow">Interface recovery</span>
            <h1>The trading terminal hit an unexpected error.</h1>
            {this.state.message ? <code className="error-detail">{this.state.message}</code> : null}
            <p>Reload the page to reconnect to the execution engine.</p>
            <button type="button" onClick={() => window.location.reload()}>Reload terminal</button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
