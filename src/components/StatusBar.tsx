import type { CrsId } from '../types/cadastral';
import { CRS_OPTIONS, wgs84ToTm } from '../utils/proj';

interface StatusBarProps {
  displayCrs: CrsId;
  cursorCoord: { n: number; e: number } | null;
  gpsPosition: { lat: number; lng: number; accuracy: number } | null;
}

export function StatusBar({ displayCrs, cursorCoord, gpsPosition }: StatusBarProps) {
  const crsMeta = CRS_OPTIONS.find((c) => c.id === displayCrs);
  const gpsTm = gpsPosition
    ? wgs84ToTm(gpsPosition.lat, gpsPosition.lng, displayCrs)
    : null;

  return (
    <footer className="hidden md:flex items-center justify-between h-8 px-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 shrink-0 select-none">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
          {crsMeta?.shortLabel} ({displayCrs})
        </span>
        <span aria-hidden="true">·</span>
        {cursorCoord ? (
          <span className="font-mono-tabular text-slate-800 dark:text-slate-200 whitespace-nowrap">
            游標 N {cursorCoord.n.toFixed(3)} · E {cursorCoord.e.toFixed(3)}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap">
            移動游標檢視二度分帶坐標
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {gpsTm && gpsPosition ? (
          <span className="font-mono-tabular text-sky-700 dark:text-sky-400 whitespace-nowrap">
            GPS N {gpsTm.n.toFixed(2)} · E {gpsTm.e.toFixed(2)} (±{gpsPosition.accuracy.toFixed(1)}m)
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap">
            GPS 未啟用
          </span>
        )}
      </div>
    </footer>
  );
}
