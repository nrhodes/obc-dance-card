/**
 * Top-level React error boundary (plan §1 "forgiving" + Phase 7b task
 * deliverable D). Catches any render error anywhere below it and shows a
 * plain-language message with a "Reload" button — never a stack trace or
 * the raw error message, which would mean nothing to an elderly member and
 * could leak implementation detail.
 *
 * The error itself is logged via `console.error` only (ids/component stack,
 * per plan §3 rule 7 "never log PII" — a render error's message could in
 * principle interpolate a value, so nothing from `error.message` is ever
 * put in front of the user).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render_error', error.name, info.componentStack?.split('\n')[1]?.trim());
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="card" role="alert">
          <h1>Something went wrong</h1>
          <p>Sorry — this page hit a problem. Your dance card is safe; try reloading.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
