import { AlertTriangle, CheckCircle2, FolderOpen, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  CadastralSection,
  CrsId,
  SectionDataBundle,
  SectionDataFileEntry,
} from '../types/cadastral';
import { decodeFileBuffer } from '../utils/cadastralParser';
import { saveLocalSection, saveSectionCrsPref } from '../utils/offlineDb';
import { CRS_OPTIONS } from '../utils/proj';

const SUPPORTED_EXTS = new Set(['COA', 'BNP', 'PAR', 'CTL', 'UPN', 'RCO', 'MAP', 'DIS']);

interface ParsedPreviewFile {
  name: string;
  ext: string;
  encoding: 'UTF-8' | 'Big5';
  text: string;
  lineCount: number;
}

interface AddSectionModalProps {
  open: boolean;
  existingSections: CadastralSection[];
  onClose: () => void;
  onSectionImported: (section: CadastralSection) => void;
}

export function AddSectionModal({
  open,
  existingSections,
  onClose,
  onSectionImported,
}: AddSectionModalProps) {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const multiFileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [detectedCode, setDetectedCode] = useState('');
  const [label, setLabel] = useState('');
  const [crs, setCrs] = useState<CrsId>('EPSG:3826');
  const [files, setFiles] = useState<ParsedPreviewFile[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOverwriteMode, setConfirmOverwriteMode] = useState<{
    code: string;
    existingLabel: string;
  } | null>(null);

  const resetState = () => {
    setDetectedCode('');
    setLabel('');
    setCrs('EPSG:3826');
    setFiles([]);
    setErrorMsg(null);
    setSubmitting(false);
    setConfirmOverwriteMode(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const normalizedCode = detectedCode.trim().toUpperCase();

  const existingMatch = useMemo(() => {
    if (!normalizedCode) return null;
    return (
      existingSections.find(
        (s) =>
          s.code.toUpperCase() === normalizedCode ||
          (label.trim() && s.label.trim() === label.trim())
      ) ?? null
    );
  }, [existingSections, normalizedCode, label]);

  const handleProcessFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    setConfirmOverwriteMode(null);

    const parsed: ParsedPreviewFile[] = [];
    let folderNameFromPath = '';

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!folderNameFromPath && f.webkitRelativePath && f.webkitRelativePath.includes('/')) {
        folderNameFromPath = f.webkitRelativePath.split('/')[0];
      }
      const base = f.name.split('/').pop() ?? f.name;
      const dotIdx = base.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const ext = base.slice(dotIdx + 1).toUpperCase();
      if (!SUPPORTED_EXTS.has(ext)) continue;

      const buf = await f.arrayBuffer();
      const { text, encoding } = decodeFileBuffer(buf);
      const nonEmptyLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      parsed.push({
        name: base.toUpperCase(),
        ext,
        encoding,
        text,
        lineCount: nonEmptyLines,
      });
    }

    if (parsed.length === 0) {
      setErrorMsg('所選資料夾內未偵測到地籍交換檔（.COA / .BNP / .PAR / .CTL / .UPN 等）');
      setFiles([]);
      return;
    }

    parsed.sort((a, b) => a.ext.localeCompare(b.ext));
    const firstStem = parsed[0].name.slice(0, parsed[0].name.lastIndexOf('.'));
    const guessCode = (firstStem.length >= 6 ? firstStem.slice(0, 6) : firstStem).toUpperCase();

    setFiles(parsed);
    setDetectedCode(guessCode);
    setLabel(folderNameFromPath || `${guessCode} 地段`);
  };

  const executeImport = async (overwrite: boolean) => {
    if (!normalizedCode || files.length === 0) return;
    if (!/^[A-Z0-9_-]{2,24}$/.test(normalizedCode) || normalizedCode === 'INDEX') {
      setErrorMsg('段代碼僅能包含 2~24 碼英文字母、數字、底線或連字號，且不可為 INDEX');
      return;
    }

    if (!overwrite && existingMatch) {
      setConfirmOverwriteMode({
        code: existingMatch.code,
        existingLabel: existingMatch.label,
      });
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payloadFiles: SectionDataFileEntry[] = files.map((f) => ({
        name: f.name,
        encoding: f.encoding,
        text: f.text,
      }));

      const bundle: SectionDataBundle = {
        code: normalizedCode,
        label: label.trim() || `${normalizedCode} 地段`,
        crs,
        files: payloadFiles,
      };

      const { bundleToCadastralSection } = await import('../data');
      const section = bundleToCadastralSection(bundle, 'local');
      if (!section) {
        setErrorMsg('地籍交換檔解析結果為空，請確認檔案格式是否完整');
        setSubmitting(false);
        return;
      }

      const saved = await saveLocalSection(bundle);
      if (!saved) {
        setErrorMsg('瀏覽器本機儲存空間寫入失敗（請確認非無痕受限模式或清理空間）');
        setSubmitting(false);
        return;
      }
      await saveSectionCrsPref(bundle.code, bundle.crs);

      onSectionImported(section);
      resetState();
      onClose();
    } catch {
      setErrorMsg('解析或儲存本機地段資料時發生錯誤');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (existingMatch && !confirmOverwriteMode) {
      setConfirmOverwriteMode({
        code: existingMatch.code,
        existingLabel: existingMatch.label,
      });
      return;
    }
    void executeImport(Boolean(confirmOverwriteMode));
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-section-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h2
            id="add-section-modal-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-50"
          >
            新增地段
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="關閉"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 panel-scroll">
          {/* Folder Dropzone / Pick */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void handleProcessFiles(e.dataTransfer.files);
            }}
            className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
              isDragging
                ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/40'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60'
            }`}
          >
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
              選取含地籍交換檔之資料夾（.COA / .BNP / .PAR / .CTL）
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors"
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span>選資料夾</span>
              </button>
              <button
                type="button"
                onClick={() => multiFileInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>多檔選取</span>
              </button>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory allows selecting an entire folder
              webkitdirectory=""
              className="hidden"
              onChange={(e) => {
                void handleProcessFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={multiFileInputRef}
              type="file"
              multiple
              accept=".coa,.bnp,.par,.ctl,.upn,.rco,.map,.dis,.COA,.BNP,.PAR,.CTL,.UPN,.RCO,.MAP,.DIS"
              className="hidden"
              onChange={(e) => {
                void handleProcessFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {/* Metadata Configuration once files are selected */}
          {files.length > 0 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-1">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    段代碼
                  </label>
                  <input
                    type="text"
                    value={detectedCode}
                    onChange={(e) => {
                      setDetectedCode(e.target.value.toUpperCase());
                      setConfirmOverwriteMode(null);
                    }}
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    地段顯示名稱
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => {
                      setLabel(e.target.value);
                      setConfirmOverwriteMode(null);
                    }}
                    placeholder="例如：臺東市_VA0003_建農段"
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  坐標系統基準（121° 分帶）
                </label>
                <select
                  value={crs}
                  onChange={(e) => setCrs(e.target.value as CrsId)}
                  className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                >
                  {CRS_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.fullLabel}
                    </option>
                  ))}
                </select>
              </div>

              {/* Detected files list */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>偵測到的交換檔 ({files.length}/8)</span>
                  <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                    儲存至：本機瀏覽器（{normalizedCode || 'CODE'}）
                  </span>
                </div>
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 max-h-36 overflow-y-auto panel-scroll">
                  {files.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono-tabular font-medium text-slate-800 dark:text-slate-200">
                        {f.name}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                        {f.encoding} · {f.lineCount} 列
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Overwrite Confirmation Step */}
              {confirmOverwriteMode ? (
                <div className="p-3.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-amber-950 dark:text-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold">
                        此裝置已存在相同段別資料
                      </div>
                      <div className="leading-relaxed">
                        地段 <span className="font-mono-tabular font-semibold">{confirmOverwriteMode.code}</span>
                        （現有名稱：{confirmOverwriteMode.existingLabel}）已存在於本機。請問要覆蓋更新此地段資料，或取消不匯入？
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleClose}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      不新增（取消）
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void executeImport(true)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                    >
                      {submitting ? '覆蓋儲存中...' : '確認覆蓋更新'}
                    </button>
                  </div>
                </div>
              ) : existingMatch ? (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    注意：段別「{existingMatch.code}」已存在，送出後將請您確認是否覆蓋更新。
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    將儲存於此平板瀏覽器本機資料庫，僅此裝置可見且重新整理不遺失
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!confirmOverwriteMode && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              取消
            </button>
            <button
              type="button"
              disabled={files.length === 0 || !normalizedCode || submitting}
              onClick={handleSubmit}
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-45 text-white text-xs font-semibold transition-colors"
            >
              {submitting ? '解析儲存中...' : '匯入並儲存至本機'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
