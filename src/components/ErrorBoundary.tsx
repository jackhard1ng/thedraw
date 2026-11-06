/**
 * A last line of defense against the white screen of death. Any uncaught render
 * error shows a legible message on the draw-sheet paper instead of a blank page.
 */
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Uncaught UI error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
          <h1 className="text-2xl">Something went sideways</h1>
          <p className="mt-2 text-sm text-ink-soft">
            The app hit an unexpected error. Reloading usually clears it.
          </p>
          <button
            className="btn-primary mx-auto mt-6"
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
