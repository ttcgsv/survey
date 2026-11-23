import { Crosshair, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CadastralSection,
  MapPickRequest,
  MeasureOverlay,
  PickedCoord,
  PickedSegment,
} from '../types/cadastral';
import {
  computePointToLineOffset,
  computeShoelaceArea,
  inverseCalculation,
} from '../utils/cogo';

interface MeasurePanelProps {
  section: CadastralSection;
  activePickId: string | null;
  onRequestPick: (req: MapPickRequest) => void;
  onCancelPick: () => void;
  onUpdateOverlay: (overlay: MeasureOverlay | null) => void;
}

type MeasureTab = 'distance' | 'pointToLine' | 'area';
type DistSlot = 'pt1' | 'pt2';
type PtlSlot = 'seg' | 'pt';

export function MeasurePanel({
  section,
  activePickId,
  onRequestPick,
  onCancelPick,
  onUpdateOverlay,
}: MeasurePanelProps) {
  const [tab, setTab] = useState<MeasureTab>('distance');
  const pickSeqRef = useRef(0);

  // 1. Distance & Azimuth Inverse
  const [pt1, setPt1] = useState<PickedCoord | null>(null);
  const [pt2, setPt2] = useState<PickedCoord | null>(null);
  const [distHistory, setDistHistory] = useState<DistSlot[]>([]);
  const [distPickStep, setDistPickStep] = useState<DistSlot | null>(null);
  const distStateRef = useRef({ pt1, pt2 });
  distStateRef.current = { pt1, pt2 };

  // 2. Point-to-Line Offset
  const [targetSeg, setTargetSeg] = useState<PickedSegment | null>(null);
  const [offsetPt, setOffsetPt] = useState<PickedCoord | null>(null);
  const [ptlHistory, setPtlHistory] = useState<PtlSlot[]>([]);
  const [ptlPickStep, setPtlPickStep] = useState<PtlSlot | null>(null);
  const ptlStateRef = useRef({ targetSeg, offsetPt });
  ptlStateRef.current = { targetSeg, offsetPt };

  // 3. Polygon Area
  const [polyPts, setPolyPts] = useState<PickedCoord[]>([]);
  const [isPickingPoly, setIsPickingPoly] = useState(false);
  const [compareLotNo, setCompareLotNo] = useState<string>('');

  const inverseRes = useMemo(() => {
    if (!pt1 || !pt2) return null;
    return inverseCalculation(pt1.n, pt1.e, pt2.n, pt2.e);
  }, [pt1, pt2]);

  const offsetRes = useMemo(() => {
    if (!targetSeg || !offsetPt) return null;
    return computePointToLineOffset(offsetPt, targetSeg.a, targetSeg.b);
  }, [targetSeg, offsetPt]);

  const areaRes = useMemo(() => {
    return computeShoelaceArea(polyPts);
  }, [polyPts]);

  const comparedParcel = useMemo(() => {
    if (!compareLotNo) return null;
    return section.parcels.find((p) => p.lotNo === compareLotNo) ?? null;
  }, [compareLotNo, section.parcels]);

  // Sync panel picking state if user cancels via map banner
  useEffect(() => {
    if (activePickId === null) {
      setIsPickingPoly(false);
      setDistPickStep(null);
      setPtlPickStep(null);
    }
  }, [activePickId]);

  // Keep map overlay synced
  useEffect(() => {
    if (tab === 'distance') {
      const pts: MeasureOverlay['points'] = [];
      if (pt1) pts.push({ n: pt1.n, e: pt1.e, label: pt1.pointId ?? '起點 1' });
      if (pt2) pts.push({ n: pt2.n, e: pt2.e, label: pt2.pointId ?? '終點 2' });
      onUpdateOverlay(pts.length > 0 ? { mode: 'distance', points: pts } : null);
      return;
    }

    if (tab === 'pointToLine') {
      if (!targetSeg && !offsetPt) {
        onUpdateOverlay(null);
        return;
      }
      onUpdateOverlay({
        mode: 'pointToLine',
        points: offsetPt
          ? [{ n: offsetPt.n, e: offsetPt.e, label: offsetPt.pointId ?? '檢核點' }]
          : [],
        segment: targetSeg ? { a: targetSeg.a, b: targetSeg.b } : undefined,
        foot: offsetRes?.foot,
      });
      return;
    }

    if (tab === 'area') {
      onUpdateOverlay(
        polyPts.length > 0
          ? {
              mode: 'area',
              points: polyPts.map((p, idx) => ({
                n: p.n,
                e: p.e,
                label: p.pointId ?? `V${idx + 1}`,
              })),
            }
          : null
      );
    }
  }, [tab, pt1, pt2, targetSeg, offsetPt, offsetRes, polyPts, onUpdateOverlay]);

  useEffect(() => {
    return () => {
      onUpdateOverlay(null);
    };
  }, [onUpdateOverlay]);

  // Sequential Distance & Azimuth picking
  const armDistStep = useCallback(
    (step: DistSlot, hasOtherPoint: boolean) => {
      setDistPickStep(step);
      onRequestPick({
        id: `dist-${step}-${++pickSeqRef.current}`,
        mode: 'point',
        prompt: step === 'pt1' ? '距離方位：點選起點 1' : '距離方位：點選終點 2',
        keepMobileSheetOpen: true,
        onPickPoint: (pt) => {
          if (step === 'pt1') {
            setPt1(pt);
            setDistHistory((prev) => [...prev.filter((s) => s !== 'pt1'), 'pt1']);
            if (!hasOtherPoint) {
              armDistStep('pt2', true);
            } else {
              setDistPickStep(null);
            }
          } else {
            setPt2(pt);
            setDistHistory((prev) => [...prev.filter((s) => s !== 'pt2'), 'pt2']);
            if (!hasOtherPoint) {
              armDistStep('pt1', true);
            } else {
              setDistPickStep(null);
            }
          }
        },
      });
    },
    [onRequestPick]
  );

  const startDistPicking = () => {
    if (!pt1) {
      armDistStep('pt1', Boolean(pt2));
      return;
    }
    if (!pt2) {
      armDistStep('pt2', true);
      return;
    }
    // Both already selected: restart cleanly from 起點 1
    setPt1(null);
    setPt2(null);
    setDistHistory([]);
    armDistStep('pt1', false);
  };

  const stopDistPicking = () => {
    setDistPickStep(null);
    onCancelPick();
  };

  const handleUndoDist = () => {
    const lastSlot: DistSlot | undefined =
      distHistory[distHistory.length - 1] ?? (pt2 ? 'pt2' : pt1 ? 'pt1' : undefined);
    if (!lastSlot) return;

    const remainingHasOther = lastSlot === 'pt1' ? Boolean(distStateRef.current.pt2) : Boolean(distStateRef.current.pt1);
    if (lastSlot === 'pt1') {
      setPt1(null);
    } else {
      setPt2(null);
    }
    setDistHistory((prev) => prev.slice(0, -1));

    if (distPickStep !== null) {
      armDistStep(lastSlot, remainingHasOther);
    }
  };

  const handleClearDist = () => {
    setPt1(null);
    setPt2(null);
    setDistHistory([]);
    if (distPickStep !== null) {
      stopDistPicking();
    }
  };

  // Sequential Point-to-Line picking
  const armPtlStep = useCallback(
    (step: PtlSlot, hasOtherItem: boolean) => {
      setPtlPickStep(step);
      if (step === 'seg') {
        onRequestPick({
          id: `ptl-seg-${++pickSeqRef.current}`,
          mode: 'segment',
          prompt: '點線垂距：點選地籍界址線',
          keepMobileSheetOpen: true,
          onPickSegment: (seg) => {
            setTargetSeg(seg);
            setPtlHistory((prev) => [...prev.filter((s) => s !== 'seg'), 'seg']);
            if (!hasOtherItem) {
              armPtlStep('pt', true);
            } else {
              setPtlPickStep(null);
            }
          },
        });
      } else {
        onRequestPick({
          id: `ptl-pt-${++pickSeqRef.current}`,
          mode: 'point',
          prompt: '點線垂距：點選檢核點',
          keepMobileSheetOpen: true,
          onPickPoint: (pt) => {
            setOffsetPt(pt);
            setPtlHistory((prev) => [...prev.filter((s) => s !== 'pt'), 'pt']);
            if (!hasOtherItem) {
              armPtlStep('seg', true);
            } else {
              setPtlPickStep(null);
            }
          },
        });
      }
    },
    [onRequestPick]
  );

  const startPtlPicking = () => {
    if (!targetSeg) {
      armPtlStep('seg', Boolean(offsetPt));
      return;
    }
    if (!offsetPt) {
      armPtlStep('pt', true);
      return;
    }
    // Both already selected: restart cleanly from 地籍線
    setTargetSeg(null);
    setOffsetPt(null);
    setPtlHistory([]);
    armPtlStep('seg', false);
  };

  const stopPtlPicking = () => {
    setPtlPickStep(null);
    onCancelPick();
  };

  const handleUndoPtl = () => {
    const lastSlot: PtlSlot | undefined =
      ptlHistory[ptlHistory.length - 1] ?? (offsetPt ? 'pt' : targetSeg ? 'seg' : undefined);
    if (!lastSlot) return;

    const remainingHasOther =
      lastSlot === 'seg' ? Boolean(ptlStateRef.current.offsetPt) : Boolean(ptlStateRef.current.targetSeg);
    if (lastSlot === 'seg') {
      setTargetSeg(null);
    } else {
      setOffsetPt(null);
    }
    setPtlHistory((prev) => prev.slice(0, -1));

    if (ptlPickStep !== null) {
      armPtlStep(lastSlot, remainingHasOther);
    }
  };

  const handleClearPtl = () => {
    setTargetSeg(null);
    setOffsetPt(null);
    setPtlHistory([]);
    if (ptlPickStep !== null) {
      stopPtlPicking();
    }
  };

  // Continuous Polygon Area picking
  const armPolyNext = useCallback(() => {
    onRequestPick({
      id: `poly-${++pickSeqRef.current}`,
      mode: 'point',
      prompt: '多邊形面積：依序點擊地圖加入頂點（自動吸附界址點／實測點）',
      keepMobileSheetOpen: true,
      onPickPoint: (pt) => {
        setPolyPts((prev) => [...prev, pt]);
        armPolyNext();
      },
    });
  }, [onRequestPick]);

  const startPolyPicking = () => {
    setIsPickingPoly(true);
    armPolyNext();
  };

  const stopPolyPicking = () => {
    setIsPickingPoly(false);
    onCancelPick();
  };

  const hasDistData = Boolean(pt1 || pt2);
  const hasPtlData = Boolean(targetSeg || offsetPt);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80">
        {(
          [
            { id: 'distance', label: '距離方位' },
            { id: 'pointToLine', label: '點線垂距' },
            { id: 'area', label: '面積' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (isPickingPoly || distPickStep !== null || ptlPickStep !== null) {
                setIsPickingPoly(false);
                setDistPickStep(null);
                setPtlPickStep(null);
                onCancelPick();
              }
              setTab(item.id);
            }}
            className={`py-1.5 px-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              tab === item.id
                ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Sub-tool 1: Distance & Azimuth Inverse */}
      {tab === 'distance' && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            {distPickStep === null ? (
              <button
                type="button"
                onClick={startDistPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>開始選點</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopDistPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <span>{distPickStep === 'pt1' ? '選取起點 1 (取消)' : '選取終點 2 (取消)'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={!hasDistData}
              onClick={handleUndoDist}
              title="復原"
              aria-label="復原"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!hasDistData}
              onClick={handleClearDist}
              title="刪除"
              aria-label="刪除"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!hasDistData && (
            <div className="px-2.5 py-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              {distPickStep === 'pt1'
                ? '請點擊圖面選取起點 1'
                : distPickStep === 'pt2'
                ? '請點擊圖面選取終點 2'
                : '點擊「開始選點」依序點選起點 1 與終點 2'}
            </div>
          )}

          {hasDistData && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
              {pt1 && (
                <div className="flex justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                  <span>1 {pt1.pointId ?? '起點'}</span>
                  <span>
                    {pt1.n.toFixed(3)}, {pt1.e.toFixed(3)}
                  </span>
                </div>
              )}
              {pt2 && (
                <div className="flex justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                  <span>2 {pt2.pointId ?? '終點'}</span>
                  <span>
                    {pt2.n.toFixed(3)}, {pt2.e.toFixed(3)}
                  </span>
                </div>
              )}
              {inverseRes && (
                <div className="pt-1.5 mt-1 border-t border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">水平距</span>
                    <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-50">
                      {inverseRes.distance.toFixed(3)} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">方位角</span>
                    <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                      {inverseRes.azimuthDms}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                    <span>
                      ΔN {inverseRes.dn >= 0 ? '+' : ''}
                      {inverseRes.dn.toFixed(3)}
                    </span>
                    <span>
                      ΔE {inverseRes.de >= 0 ? '+' : ''}
                      {inverseRes.de.toFixed(3)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sub-tool 2: Point to Boundary Line Perpendicular Offset */}
      {tab === 'pointToLine' && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            {ptlPickStep === null ? (
              <button
                type="button"
                onClick={startPtlPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>開始選點</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopPtlPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <span>{ptlPickStep === 'seg' ? '選取地籍線 (取消)' : '選取檢核點 (取消)'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={!hasPtlData}
              onClick={handleUndoPtl}
              title="復原"
              aria-label="復原"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!hasPtlData}
              onClick={handleClearPtl}
              title="刪除"
              aria-label="刪除"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!hasPtlData && (
            <div className="px-2.5 py-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              {ptlPickStep === 'seg'
                ? '請點擊圖面選取地籍界址線'
                : ptlPickStep === 'pt'
                ? '請點擊圖面選取檢核點'
                : '點擊「開始選點」依序點選地籍界址線與檢核點'}
            </div>
          )}

          {hasPtlData && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
              {targetSeg && (
                <div className="flex justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                  <span>地籍線</span>
                  <span>
                    {targetSeg.lotNo ? `${targetSeg.lotNo} · ` : ''}
                    {targetSeg.a.id ?? 'A'}–{targetSeg.b.id ?? 'B'}
                  </span>
                </div>
              )}
              {offsetPt && (
                <div className="flex justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                  <span>檢核點 {offsetPt.pointId ?? ''}</span>
                  <span>
                    {offsetPt.n.toFixed(3)}, {offsetPt.e.toFixed(3)}
                  </span>
                </div>
              )}
              {offsetRes && (
                <div className="pt-1.5 mt-1 border-t border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500 dark:text-slate-400">垂距</span>
                    <span className="font-mono-tabular font-bold text-orange-600 dark:text-orange-400">
                      {offsetRes.perpendicularDist.toFixed(3)} m ({(offsetRes.perpendicularDist * 100).toFixed(1)} cm)
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>垂足</span>
                    <span>{offsetRes.onSegment ? '線段內' : '延長線'}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                    <span>垂足坐標</span>
                    <span>
                      {offsetRes.foot.n.toFixed(3)}, {offsetRes.foot.e.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                    <span>邊長</span>
                    <span>{offsetRes.segmentLength.toFixed(3)} m</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sub-tool 3: Shoelace Polygon Area */}
      {tab === 'area' && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            {!isPickingPoly ? (
              <button
                type="button"
                onClick={startPolyPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>開始選點</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopPolyPicking}
                className="flex-1 h-9 flex items-center justify-center gap-1 px-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <span>完成 ({polyPts.length})</span>
              </button>
            )}
            <button
              type="button"
              disabled={polyPts.length === 0}
              onClick={() => setPolyPts((prev) => prev.slice(0, -1))}
              title="復原"
              aria-label="復原"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={polyPts.length === 0}
              onClick={() => setPolyPts([])}
              title="刪除"
              aria-label="刪除"
              className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">頂點</span>
              <span className="font-mono-tabular font-semibold">{polyPts.length} 點</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">計算面積</span>
              <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-50">
                {areaRes.areaSqm.toFixed(2)} m²
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">坪數</span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                {areaRes.areaPing.toFixed(2)} 坪
              </span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>周長</span>
              <span className="font-mono-tabular">{areaRes.perimeter.toFixed(3)} m</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <select
              aria-label="比對登記面積地號"
              value={compareLotNo}
              onChange={(e) => setCompareLotNo(e.target.value)}
              className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="">比對地號登記面積...</option>
              {section.parcels.map((p) => (
                <option key={p.lotNo} value={p.lotNo}>
                  {p.lotNo} ({p.regArea.toFixed(2)} m²)
                </option>
              ))}
            </select>

            {comparedParcel && polyPts.length >= 3 && (
              <div className="p-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-0.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">登記面積</span>
                  <span className="font-mono-tabular">{comparedParcel.regArea.toFixed(2)} m²</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">較差</span>
                  {(() => {
                    const diff = areaRes.areaSqm - comparedParcel.regArea;
                    return (
                      <span
                        className={`font-mono-tabular font-semibold ${
                          Math.abs(diff) > 0.5
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {diff >= 0 ? '+' : ''}
                        {diff.toFixed(2)} m²
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
