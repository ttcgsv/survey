import { Crosshair, Download, MapPin, Navigation, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CrsId,
  FieldPoint,
  FieldPointKind,
  FieldPointSource,
  MapPickRequest,
} from '../types/cadastral';
import { decodeFileBuffer, exportFieldPointsToCoa } from '../utils/cadastralParser';
import { parseCsvFieldPointsText } from '../utils/offlineDb';
import { buildGoogleMapsNavUrl, convertTm } from '../utils/proj';

interface FieldPointsPanelProps {
  sectionCode: string;
  displayCrs: CrsId;
  fieldPoints: FieldPoint[];
  nextSuggestedId: string;
  csvSyncState: 'idle' | 'loading' | 'saving' | 'error';
  onAddPoint: (pt: {
    id: string;
    note: string;
    n: number;
    e: number;
    source: FieldPointSource;
    pointKind?: FieldPointKind;
  }) => void;
  onImportCsvPoints: (imported: FieldPoint[]) => void;
  onDeletePoint: (uid: string) => void;
  onClearAll: () => void;
  onZoomToPoint: (pt: FieldPoint) => void;
  onRequestPick: (req: MapPickRequest) => void;
}

const SOURCE_LABELS: Record<FieldPointSource, string> = {
  radiation: '光線法',
  intersection_dir: '夾角交會',
  intersection_dist: '距離交會',
  resection: '後方交會',
  manual: '手動/實測',
};

const KIND_META: Record<
  FieldPointKind,
  { label: string; idColorClass: string; kindColorClass: string }
> = {
  control: {
    label: '圖根點',
    idColorClass: 'text-emerald-700 dark:text-emerald-400',
    kindColorClass: 'text-emerald-700 dark:text-emerald-400',
  },
  urban: {
    label: '都計樁',
    idColorClass: 'text-indigo-700 dark:text-indigo-400',
    kindColorClass: 'text-indigo-700 dark:text-indigo-400',
  },
  ref: {
    label: '參考點',
    idColorClass: 'text-sky-700 dark:text-sky-400',
    kindColorClass: 'text-sky-700 dark:text-sky-400',
  },
  field: {
    label: '實測點',
    idColorClass: 'text-orange-600 dark:text-orange-400',
    kindColorClass: 'text-orange-600 dark:text-orange-400',
  },
};

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function FieldPointsPanel({
  sectionCode,
  displayCrs,
  fieldPoints,
  nextSuggestedId,
  csvSyncState,
  onAddPoint,
  onImportCsvPoints,
  onDeletePoint,
  onClearAll,
  onZoomToPoint,
  onRequestPick,
}: FieldPointsPanelProps) {
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const [idInput, setIdInput] = useState(nextSuggestedId);
  const [nInput, setNInput] = useState('');
  const [eInput, setEInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setIdInput(nextSuggestedId);
  }, [nextSuggestedId]);

  const handleManualAdd = () => {
    const n = parseFloat(nInput);
    const e = parseFloat(eInput);
    if (!Number.isFinite(n) || !Number.isFinite(e)) {
      setErrorMsg('請輸入有效的 N 與 E 坐標');
      return;
    }
    const cleanId = idInput.trim() || nextSuggestedId;
    onAddPoint({
      id: cleanId,
      note: noteInput.trim(),
      n,
      e,
      source: 'manual',
    });
    setErrorMsg(null);
    setNInput('');
    setEInput('');
    setNoteInput('');
  };

  const handleImportCsvFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { text } = decodeFileBuffer(buf);
      const parsed = parseCsvFieldPointsText(text, displayCrs);
      if (parsed.length === 0) {
        setErrorMsg('CSV 檔案未解析到有效的點位坐標（格式：點號,N,E）');
        return;
      }
      setErrorMsg(null);
      onImportCsvPoints(parsed);
    } catch {
      setErrorMsg('讀取 CSV 檔案失敗');
    }
  };

  const handleExportCsv = () => {
    const header = '\uFEFF點號,縱坐標N,橫坐標E,坐標系統,來源,備註,建立時間,點位類別';
    const rows = fieldPoints.map((fp) => {
      const disp = convertTm(fp.n, fp.e, fp.crs, displayCrs);
      const safeNote = `"${(fp.note || '').replace(/"/g, '""')}"`;
      const kindLabel = KIND_META[fp.pointKind ?? 'field'].label;
      return `${fp.id},${disp.n.toFixed(3)},${disp.e.toFixed(3)},${displayCrs},${SOURCE_LABELS[fp.source]},${safeNote},${fp.createdAt},${kindLabel}`;
    });
    triggerDownload(
      `${sectionCode}.csv`,
      [header, ...rows].join('\r\n'),
      'text/csv;charset=utf-8;'
    );
  };

  const handleExportCoa = () => {
    const converted = fieldPoints.map((fp) => {
      const disp = convertTm(fp.n, fp.e, fp.crs, displayCrs);
      return { id: fp.id, n: disp.n, e: disp.e };
    });
    const text = exportFieldPointsToCoa(sectionCode, converted);
    triggerDownload(`${sectionCode}_FIELD.COA`, text, 'text/plain;charset=utf-8;');
  };

  return (
    <div className="space-y-3">
      {/* Local Tablet Persistence Status Bar */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
        <div className="min-w-0 flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-slate-800 dark:text-slate-100 font-mono-tabular truncate">
            本機點庫 · {sectionCode}
          </span>
          <span className="text-slate-400">·</span>
          <span
            className={
              csvSyncState === 'error'
                ? 'text-red-600 dark:text-red-400 whitespace-nowrap'
                : 'text-emerald-700 dark:text-emerald-400 whitespace-nowrap'
            }
          >
            {csvSyncState === 'saving'
              ? '儲存中'
              : csvSyncState === 'loading'
              ? '讀取中'
              : csvSyncState === 'error'
              ? '寫入受限'
              : '已存本機'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => csvFileInputRef.current?.click()}
          title="從本機檔案匯入 CSV 點位"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-800 dark:text-slate-100 shrink-0 whitespace-nowrap"
        >
          <Upload className="w-3 h-3" />
          <span>匯入 CSV</span>
        </button>
        <input
          ref={csvFileInputRef}
          type="file"
          accept=".csv,.txt,.CSV,.TXT"
          className="hidden"
          onChange={(e) => {
            void handleImportCsvFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {/* Manual Input */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            新增實測點
          </span>
          <button
            type="button"
            onClick={() =>
              onRequestPick({
                id: `fp-pick-${Date.now()}`,
                mode: 'point',
                prompt: '點選坐標',
                onPickPoint: (pt) => {
                  setNInput(pt.n.toFixed(3));
                  setEInput(pt.e.toFixed(3));
                },
              })
            }
            className="inline-flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-medium"
          >
            <Crosshair className="w-3 h-3" />
            <span>選點</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <input
            type="text"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="點號"
            aria-label="點號"
            className="col-span-1 h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100"
          />
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="備註"
            aria-label="備註"
            className="col-span-2 h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <input
            type="number"
            step="0.001"
            value={nInput}
            onChange={(e) => setNInput(e.target.value)}
            placeholder="N 坐標"
            aria-label="N 坐標"
            className="h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 min-w-0"
          />
          <input
            type="number"
            step="0.001"
            value={eInput}
            onChange={(e) => setEInput(e.target.value)}
            placeholder="E 坐標"
            aria-label="E 坐標"
            className="h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 min-w-0"
          />
          <button
            type="button"
            onClick={handleManualAdd}
            className="h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>加入</span>
          </button>
        </div>
        {errorMsg && <div className="text-[11px] text-red-600 dark:text-red-400">{errorMsg}</div>}
      </section>

      <hr className="border-slate-200 dark:border-slate-800" />

      {/* Export & List Header */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            實測點 ({fieldPoints.length})
          </span>
          {fieldPoints.length > 0 && (
            <div className="flex items-center gap-2">
              {confirmClear ? (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                    }}
                    className="text-red-600 dark:text-red-400 font-semibold hover:underline"
                  >
                    確認清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-slate-500 hover:underline"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-[11px] text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                >
                  清空
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={fieldPoints.length === 0}
            onClick={handleExportCsv}
            className="flex items-center justify-center gap-1 h-8 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 text-xs font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>下載 CSV</span>
          </button>
          <button
            type="button"
            disabled={fieldPoints.length === 0}
            onClick={handleExportCoa}
            className="flex items-center justify-center gap-1 h-8 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 text-xs font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>匯出 .COA</span>
          </button>
        </div>
      </section>

      {/* Saved List */}
      {fieldPoints.length === 0 ? (
        <div className="py-4 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
          尚無實測點
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          {fieldPoints.map((fp) => {
            const disp = convertTm(fp.n, fp.e, fp.crs, displayCrs);
            const navUrl = buildGoogleMapsNavUrl(fp.n, fp.e, fp.crs);
            const kindMeta = KIND_META[fp.pointKind ?? 'field'];
            return (
              <div key={fp.uid} className="px-2.5 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-1.5 text-xs">
                    <span className={`font-mono-tabular font-bold shrink-0 ${kindMeta.idColorClass}`}>
                      {fp.id}
                    </span>
                    <span className="text-slate-400 shrink-0">·</span>
                    <span className={`text-[11px] font-medium shrink-0 ${kindMeta.kindColorClass}`}>
                      {kindMeta.label}
                    </span>
                    <span className="text-slate-400 shrink-0">·</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {fp.note || SOURCE_LABELS[fp.source]}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="定位"
                      onClick={() => onZoomToPoint(fp)}
                      className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={navUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="導航"
                      className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sky-700 dark:text-sky-400"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      title="刪除"
                      onClick={() => onDeletePoint(fp.uid)}
                      className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="text-[11px] font-mono-tabular text-slate-600 dark:text-slate-300">
                  N {disp.n.toFixed(3)} · E {disp.e.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
