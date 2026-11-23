import {
  AlertTriangle,
  Check,
  FolderPlus,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { CadastralSection, CrsId, ParcelEntity } from '../types/cadastral';
import { getExchangeFileDescription } from '../utils/cadastralParser';
import { buildGoogleMapsNavUrl } from '../utils/proj';

interface DatasetPanelProps {
  sections: CadastralSection[];
  activeSection: CadastralSection;
  onSelectSection: (code: string) => void;
  onChangeSectionCrs: (code: string, crs: CrsId) => void;
  onOpenAddSectionModal: () => void;
  onRefreshSections: () => Promise<void>;
  onDeleteLocalSection: (code: string) => Promise<void>;
  onJumpToParcel: (parcel: ParcelEntity) => void;
}

export function DatasetPanel({
  sections,
  activeSection,
  onSelectSection,
  onChangeSectionCrs,
  onOpenAddSectionModal,
  onRefreshSections,
  onDeleteLocalSection,
  onJumpToParcel,
}: DatasetPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [sectionSearch, setSectionSearch] = useState('');
  const [lotSearch, setLotSearch] = useState('');
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshSections();
    } finally {
      setRefreshing(false);
    }
  };

  const normalizeSearch = (val: string) =>
    val.trim().toLowerCase().replace(/台/g, '臺');

  const filteredSections = sections.filter((sec) => {
    const q = normalizeSearch(sectionSearch);
    if (!q) return true;
    const haystack = normalizeSearch(`${sec.code} ${sec.label}`);
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every((token) => haystack.includes(token));
  });

  const filteredParcels = activeSection.parcels.filter((p) =>
    p.lotNo.toLowerCase().includes(lotSearch.trim().toLowerCase())
  );

  return (
    <div className="space-y-3.5">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenAddSectionModal}
          className="flex-1 min-h-[38px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
        >
          <FolderPlus className="w-3.5 h-3.5 shrink-0" />
          <span>匯入本機地段</span>
        </button>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          title="重新載入本機地段"
          aria-label="重新載入本機地段"
          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Searchable Section List */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="section-search"
            className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
          >
            地段 ({sections.length})
          </label>
          <div className="relative flex-1 max-w-[168px]">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="section-search"
              type="text"
              value={sectionSearch}
              onChange={(e) => setSectionSearch(e.target.value)}
              placeholder="搜尋地段"
              className="w-full h-7 pl-6 pr-6 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            {sectionSearch && (
              <button
                type="button"
                onClick={() => setSectionSearch('')}
                aria-label="清除地段搜尋"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 max-h-32 overflow-y-auto panel-scroll">
          {filteredSections.length === 0 ? (
            <div className="p-2.5 text-xs text-slate-500 text-center">無符合地段</div>
          ) : (
            filteredSections.map((sec) => {
              const isActive = sec.code === activeSection.code;
              const isLocal = sec.source === 'local';
              const isConfirmingDelete = confirmDeleteCode === sec.code;
              return (
                <div
                  key={sec.code}
                  className={`flex items-center justify-between gap-1 transition-colors ${
                    isActive
                      ? 'bg-sky-50 dark:bg-sky-900/35 text-sky-900 dark:text-sky-100'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteCode(null);
                      onSelectSection(sec.code);
                    }}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-3.5 flex items-center justify-center shrink-0">
                        {isActive && <Check className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" />}
                      </span>
                      <span className={`text-xs truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                        {sec.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                      <span>{sec.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{sec.parcels.length}</span>
                    </div>
                  </button>

                  {isLocal &&
                    (isConfirmingDelete ? (
                      <div className="flex items-center gap-1 pr-1.5 shrink-0 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteCode(null);
                            void onDeleteLocalSection(sec.code);
                          }}
                          className="px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold whitespace-nowrap"
                        >
                          移除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteCode(null)}
                          className="px-1 py-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 whitespace-nowrap"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteCode(sec.code)}
                        title={`移除本機匯入地段 ${sec.label}`}
                        aria-label={`移除本機匯入地段 ${sec.label}`}
                        className="p-1.5 mr-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ))}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Single Section CRS Configuration */}
      <section>
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
          地段坐標系
        </div>
        <div
          role="group"
          aria-label="地段坐標系"
          className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
        >
          {(
            [
              { id: 'EPSG:3828' as CrsId, label: 'TWD67' },
              { id: 'EPSG:3826' as CrsId, label: 'TWD97' },
            ] as const
          ).map((opt) => {
            const active = activeSection.crs === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeSectionCrs(activeSection.code, opt.id)}
                className={`min-h-[34px] px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {activeSection.warnings.length > 0 && (
        <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-[11px] space-y-1">
          <div className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>解析提醒</span>
          </div>
          {activeSection.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {/* Compact Parcel Directory */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
            宗地 ({activeSection.parcels.length})
          </span>
          <input
            type="text"
            value={lotSearch}
            onChange={(e) => setLotSearch(e.target.value)}
            placeholder="搜尋地號"
            className="w-32 h-7 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 max-h-40 overflow-y-auto panel-scroll">
          {filteredParcels.length === 0 ? (
            <div className="p-2.5 text-xs text-slate-500 text-center">無符合地號</div>
          ) : (
            filteredParcels.map((p) => {
              const navN = p.visualCenterN || p.labelN || p.centroidN;
              const navE = p.visualCenterE || p.labelE || p.centroidE;
              return (
                <div
                  key={p.lotNo}
                  className="flex items-center hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToParcel(p)}
                    title={`定位至地號 ${p.lotNo}`}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                      <span className="text-xs font-semibold font-mono-tabular text-slate-900 dark:text-slate-100 truncate">
                        {p.lotNo}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-slate-600 dark:text-slate-300 shrink-0">
                      {p.regArea.toFixed(2)} m²
                    </span>
                  </button>
                  <a
                    href={buildGoogleMapsNavUrl(navN, navE, activeSection.crs)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Google Maps 導航至地號 ${p.lotNo}`}
                    aria-label={`Google Maps 導航至地號 ${p.lotNo}`}
                    className="flex items-center justify-center w-9 h-8 mr-1 my-0.5 rounded-md bg-orange-600 hover:bg-orange-700 dark:bg-orange-600 dark:hover:bg-orange-500 text-sky-100 shadow-xs transition-colors shrink-0"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                  </a>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Loaded Files Summary */}
      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          交換檔 ({activeSection.loadedFiles.length}/8)
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          {activeSection.loadedFiles.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono-tabular font-medium text-slate-800 dark:text-slate-200 shrink-0">
                  {f.name}
                </span>
                <span className="text-slate-500 dark:text-slate-400 truncate">
                  {getExchangeFileDescription(f.ext)}
                </span>
              </div>
              <span className="text-slate-500 dark:text-slate-400 font-mono-tabular shrink-0">
                {f.count}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
