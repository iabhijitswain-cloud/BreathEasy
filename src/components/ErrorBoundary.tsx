import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected rendering error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F2] text-[#1A2423] dark:bg-[#0E1514] dark:text-[#F1F5F4]"
        >
          <div className="max-w-md w-full rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 space-y-4 text-center shadow-sm">
            <AlertTriangle className="w-10 h-10 text-[#C2410C] mx-auto" />
            <h1 className="font-display text-xl font-bold">Something paused unexpectedly</h1>
            <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F766E] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /> Recover View
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
