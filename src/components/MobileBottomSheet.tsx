import { Calculator, ChevronDown, ChevronUp, Compass, FolderOpen, Layers, MapPin } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SidebarTab } from '../types/cadastral';

interface MobileBottomSheetProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  children: ReactNode;
}

const TABS: { id: SidebarTab; label: string; icon: typeof FolderOpen }[] = [
  { id: 'dataset', label: '地段', icon: FolderOpen },
  { id: 'layers', label: '圖層', icon: Layers },
  { id: 'cogo', label: '測量', icon: Compass },
  { id: 'points', label: '實測點', icon: MapPin },
  { id: 'measure', label: '圖面計算', icon: Calculator },
];

export function MobileBottomSheet({
  activeTab,
  onSelectTab,
  open,
  onToggleOpen,
  children,
}: MobileBottomSheetProps) {
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef<number>(0);
  const prevTabRef = useRef<SidebarTab>(activeTab);

  useEffect(() => {
    const el = scrollBodyRef.current;
    if (!el) return;
    if (prevTabRef.current !== activeTab) {
      prevTabRef.current = activeTab;
      savedScrollTopRef.current = 0;
      el.scrollTop = 0;
      return;
    }
    if (open) {
      el.scrollTop = savedScrollTopRef.current;
    }
  }, [activeTab, open]);

  return (
    <div
      className={`md:hidden fixed bottom-0 left-0 right-0 z-[1000] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl transition-[height] duration-200 ease-out flex flex-col pb-safe ${
        open ? 'h-[35vh]' : 'h-[54px]'
      }`}
    >
      {/* Compact Handle + 5 Thumb Tabs */}
      <div
        onTouchStart={(e) => setTouchStartY(e.touches[0].clientY)}
        onTouchEnd={(e) => {
          if (touchStartY === null) return;
          const delta = e.changedTouches[0].clientY - touchStartY;
          if (delta < -28) onToggleOpen(true);
          else if (delta > 28) onToggleOpen(false);
          setTouchStartY(null);
        }}
        className="shrink-0 select-none"
      >
        <div className="grid grid-cols-[1fr_auto] items-center border-b border-slate-200 dark:border-slate-800 px-1">
          <div className="grid grid-cols-5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id && open;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (open && activeTab === t.id) {
                      onToggleOpen(false);
                    } else {
                      onSelectTab(t.id);
                      onToggleOpen(true);
                    }
                  }}
                  className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                    active
                      ? 'text-sky-700 dark:text-sky-400'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">{t.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label={open ? '收合面板' : '展開面板'}
            onClick={() => onToggleOpen(!open)}
            className="min-w-[40px] min-h-[48px] flex items-center justify-center text-slate-500 dark:text-slate-400"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Scrollable Body confined within Bottom 1/3 (35vh) — stays mounted when collapsed */}
      <div
        ref={scrollBodyRef}
        onScroll={(e) => {
          if (open) {
            savedScrollTopRef.current = e.currentTarget.scrollTop;
          }
        }}
        aria-hidden={!open}
        className={
          open
            ? 'flex-1 overflow-y-auto px-3.5 py-2.5 panel-scroll'
            : 'h-0 overflow-hidden px-3.5 py-0 pointer-events-none opacity-0'
        }
      >
        {children}
      </div>
    </div>
  );
}
