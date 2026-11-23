import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || '未知執行錯誤',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-lg space-y-4">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-50">
              圖台初始化發生異常
            </h1>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              目前瀏覽器環境載入時發生錯誤，請重新整理頁面。若使用無痕模式或受限瀏覽器，請改用標準模式開啟。
            </p>
            {this.state.message && (
              <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-mono-tabular text-slate-700 dark:text-slate-300 break-words">
                {this.state.message}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors"
            >
              重新載入圖台
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
