import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('UI CRASH DETECTED:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] text-white p-8 overflow-hidden w-full h-full">
          <AlertCircle className="w-12 h-12 text-blue-500 mb-4" />
          <h1 className="text-xl font-bold mb-2">Engine Interface Error</h1>
          <p className="text-white/40 text-sm mb-6 max-w-md text-center">
            The dashboard encountered a rendering issue while processing the last results. This is often caused by very complex data structures.
          </p>
          <pre className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg text-xs font-mono text-blue-400 mb-6 max-w-full overflow-auto">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-all"
          >
            Reconnect Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
