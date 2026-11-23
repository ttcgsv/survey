import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Crosshair,
  MapPin,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  CadastralSection,
  CogoFormState,
  CogoPreviewOverlay,
  CoordInputState,
  CrsId,
  FieldPoint,
  FieldPointKind,
  FieldPointSource,
  MapPickRequest,
} from '../types/cadastral';
import {
  computeAngleIntersection,
  computeBoundaryStakeoutGuidance,
  computeDistanceIntersection,
  computeRadiation,
  computeThreePointResection,
  formatDegToDms,
  inverseCalculation,
  normalizeDeg,
  parseAngleInput,
} from '../utils/cogo';
import { convertTm } from '../utils/proj';

interface CogoPanelProps {
  section: CadastralSection;
  fieldPoints: FieldPoint[];
  displayCrs: CrsId;
  nextPointIdsByKind: Record<FieldPointKind, string>;
  formState: CogoFormState;
  onChangeFormState: Dispatch<SetStateAction<CogoFormState>>;
  onRequestPick: (req: MapPickRequest) => void;
  onEnsureBoundaryLayers: () => void;
  onFocusPoint: (pt: { n: number; e: number; crs: CrsId; zoom?: number }) => void;
  onUpdatePreview: (overlay: CogoPreviewOverlay | null) => void;
  onSaveFieldPoint: (pt: {
    id: string;
    note: string;
    n: number;
    e: number;
    source: FieldPointSource;
    pointKind?: FieldPointKind;
  }) => void;
}

const POINT_KIND_OPTIONS: {
  id: FieldPointKind;
  label: string;
  activeClass: string;
  saveBtnClass: string;
}[] = [
  {
    id: 'control',
    label: '圖根點',
    activeClass: 'bg-emerald-600 text-white shadow-xs',
    saveBtnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  },
  {
    id: 'urban',
    label: '都計樁',
    activeClass: 'bg-indigo-600 text-white shadow-xs',
    saveBtnClass: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  },
  {
    id: 'ref',
    label: '參考點',
    activeClass: 'bg-sky-600 text-white shadow-xs',
    saveBtnClass: 'bg-sky-600 hover:bg-sky-700 text-white',
  },
  {
    id: 'field',
    label: '實測點',
    activeClass: 'bg-orange-600 text-white shadow-xs',
    saveBtnClass: 'bg-orange-600 hover:bg-orange-700 text-white',
  },
];

interface CoordFieldsProps {
  label: string;
  nVal: string;
  eVal: string;
  nPlaceholder: string;
  ePlaceholder: string;
  pointHint?: string;
  onChangeN: (v: string) => void;
  onChangeE: (v: string) => void;
  onPick: () => void;
}

function CoordFields({
  label,
  nVal,
  eVal,
  nPlaceholder,
  ePlaceholder,
  pointHint,
  onChangeN,
  onChangeE,
  onPick,
}: CoordFieldsProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
          {label}
          {pointHint ? (
            <span className="ml-1 font-mono-tabular text-sky-700 dark:text-sky-400">
              ({pointHint})
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onPick}
          className="inline-flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Crosshair className="w-3 h-3" />
          <span>選點</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="number"
          step="0.001"
          value={nVal}
          onChange={(e) => onChangeN(e.target.value)}
          placeholder={nPlaceholder}
          aria-label={`${label} N`}
          className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
        />
        <input
          type="number"
          step="0.001"
          value={eVal}
          onChange={(e) => onChangeE(e.target.value)}
          placeholder={ePlaceholder}
          aria-label={`${label} E`}
          className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
        />
      </div>
    </div>
  );
}

function parseOptionalFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const val = Number(trimmed);
  return Number.isFinite(val) ? val : NaN;
}

type CoordFieldKey =
  | 'radStation'
  | 'radBsPoint'
  | 'intPtA'
  | 'intPtB'
  | 'resPtA'
  | 'resPtB'
  | 'resPtC'
  | 'bndStation'
  | 'bndBacksight';

export function CogoPanel({
  section,
  fieldPoints,
  displayCrs,
  nextPointIdsByKind,
  formState,
  onChangeFormState,
  onRequestPick,
  onEnsureBoundaryLayers,
  onFocusPoint,
  onUpdatePreview,
  onSaveFieldPoint,
}: CogoPanelProps) {
  const {
    moduleTab,
    angleMode,
    radStation,
    radBsMode,
    radBsPoint,
    radBsAz,
    radHzAngle,
    radDist,
    intMode,
    intPtA,
    intPtB,
    intAngleA,
    intAngleB,
    intDistA,
    intDistB,
    selectedDistSol,
    resPtA,
    resPtB,
    resPtC,
    resAlpha,
    resBeta,
    bndStationId,
    bndStation,
    bndBacksightId,
    bndBacksight,
    bndLotNo,
    bndSelectedPtId,
    bndObsAngle,
    bndObsDist,
  } = formState;

  // Save Point inline state
  const [saveKind, setSaveKind] = useState<FieldPointKind>('field');
  const currentSuggestedId = nextPointIdsByKind[saveKind];
  const [saveId, setSaveId] = useState(currentSuggestedId);
  const [saveNote, setSaveNote] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setSaveId(currentSuggestedId);
  }, [currentSuggestedId]);

  // Catalog of all known points converted into displayCrs for ID lookup
  const knownPointCatalog = useMemo(() => {
    const list: { id: string; n: number; e: number; category: string }[] = [];
    const seen = new Set<string>();
    const addPoint = (id: string, n: number, e: number, srcCrs: CrsId, category: string) => {
      const clean = id.trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const conv = convertTm(n, e, srcCrs, displayCrs);
      list.push({ id: clean, n: conv.n, e: conv.e, category });
    };

    for (const pt of fieldPoints) {
      addPoint(pt.id, pt.n, pt.e, pt.crs, '測量點');
    }
    for (const pt of section.controlPoints) {
      addPoint(pt.id, pt.n, pt.e, section.crs, '圖根點');
    }
    for (const pt of section.urbanPoints) {
      addPoint(pt.id, pt.n, pt.e, section.crs, '都計樁');
    }
    for (const pt of Object.values(section.refPoints)) {
      addPoint(pt.id, pt.n, pt.e, section.crs, '參考點');
    }
    for (const pt of Object.values(section.boundaryPoints)) {
      addPoint(pt.id, pt.n, pt.e, section.crs, '界址點');
    }
    return list;
  }, [section, fieldPoints, displayCrs]);

  const knownPointMap = useMemo(() => {
    const map = new Map<string, { id: string; n: number; e: number; category: string }>();
    for (const item of knownPointCatalog) {
      map.set(item.id.toLowerCase(), item);
    }
    return map;
  }, [knownPointCatalog]);

  const hasActiveModuleInputs = useMemo(() => {
    if (moduleTab === 'radiation') {
      return [
        radStation.n,
        radStation.e,
        radBsPoint.n,
        radBsPoint.e,
        radBsAz,
        radHzAngle,
        radDist,
      ].some((v) => v.trim() !== '');
    }
    if (moduleTab === 'intersection') {
      return [
        intPtA.n,
        intPtA.e,
        intPtB.n,
        intPtB.e,
        intAngleA,
        intAngleB,
        intDistA,
        intDistB,
      ].some((v) => v.trim() !== '');
    }
    if (moduleTab === 'boundary') {
      return [
        bndStationId,
        bndStation.n,
        bndStation.e,
        bndBacksightId,
        bndBacksight.n,
        bndBacksight.e,
        bndLotNo,
        bndObsAngle,
        bndObsDist,
      ].some((v) => v.trim() !== '');
    }
    return [
      resPtA.n,
      resPtA.e,
      resPtB.n,
      resPtB.e,
      resPtC.n,
      resPtC.e,
      resAlpha,
      resBeta,
    ].some((v) => v.trim() !== '');
  }, [
    moduleTab,
    radStation,
    radBsPoint,
    radBsAz,
    radHzAngle,
    radDist,
    intPtA,
    intPtB,
    intAngleA,
    intAngleB,
    intDistA,
    intDistB,
    resPtA,
    resPtB,
    resPtC,
    resAlpha,
    resBeta,
    bndStationId,
    bndStation,
    bndBacksightId,
    bndBacksight,
    bndLotNo,
    bndObsAngle,
    bndObsDist,
  ]);

  const handleClearActiveModule = () => {
    onChangeFormState((prev) => {
      if (prev.moduleTab === 'radiation') {
        return {
          ...prev,
          radStation: { n: '', e: '' },
          radBsPoint: { n: '', e: '' },
          radBsAz: '',
          radHzAngle: '',
          radDist: '',
        };
      }
      if (prev.moduleTab === 'intersection') {
        return {
          ...prev,
          intPtA: { n: '', e: '' },
          intPtB: { n: '', e: '' },
          intAngleA: '',
          intAngleB: '',
          intDistA: '',
          intDistB: '',
          selectedDistSol: 0,
        };
      }
      if (prev.moduleTab === 'boundary') {
        return {
          ...prev,
          bndStationId: '',
          bndStation: { n: '', e: '' },
          bndBacksightId: '',
          bndBacksight: { n: '', e: '' },
          bndLotNo: '',
          bndSelectedPtId: null,
          bndObsAngle: '',
          bndObsDist: '',
        };
      }
      return {
        ...prev,
        resPtA: { n: '', e: '' },
        resPtB: { n: '', e: '' },
        resPtC: { n: '', e: '' },
        resAlpha: '',
        resBeta: '',
      };
    });
  };

  const updateCoordField = (key: CoordFieldKey, updater: (prev: CoordInputState) => CoordInputState) => {
    onChangeFormState((prev) => ({
      ...prev,
      [key]: updater(prev[key]),
    }));
  };

  const pickCoordFor = (prompt: string, key: CoordFieldKey) => {
    onRequestPick({
      id: `cogo-${key}-${Date.now()}`,
      mode: 'point',
      prompt,
      onPickPoint: (pt) => {
        onChangeFormState((prev) => ({
          ...prev,
          ...(key === 'bndStation' ? { bndStationId: pt.pointId ?? '' } : {}),
          ...(key === 'bndBacksight' ? { bndBacksightId: pt.pointId ?? '' } : {}),
          [key]: {
            n: pt.n.toFixed(3),
            e: pt.e.toFixed(3),
            hint: pt.pointId,
          },
        }));
      },
    });
  };

  // Compute Radiation (returns null while required fields are empty and valid so far)
  const radiationResult = useMemo(() => {
    if (moduleTab !== 'radiation') return null;

    const n0 = parseOptionalFinite(radStation.n);
    const e0 = parseOptionalFinite(radStation.e);
    if (Number.isNaN(n0) || Number.isNaN(e0)) {
      return { ok: false as const, error: '測站坐標無效' };
    }

    let nBs: number | null = null;
    let eBs: number | null = null;
    let parsedBsAz: ReturnType<typeof parseAngleInput> | null = null;

    if (radBsMode === 'point') {
      nBs = parseOptionalFinite(radBsPoint.n);
      eBs = parseOptionalFinite(radBsPoint.e);
      if (Number.isNaN(nBs) || Number.isNaN(eBs)) {
        return { ok: false as const, error: '後視坐標無效' };
      }
      if (n0 !== null && e0 !== null && nBs !== null && eBs !== null && Math.hypot(nBs - n0, eBs - e0) < 1e-6) {
        return { ok: false as const, error: '測站與後視重合' };
      }
    } else if (radBsAz.trim()) {
      parsedBsAz = parseAngleInput(radBsAz, angleMode);
      if (!parsedBsAz.ok) return { ok: false as const, error: `後視角：${parsedBsAz.error}` };
    }

    let parsedHz: ReturnType<typeof parseAngleInput> | null = null;
    if (radHzAngle.trim()) {
      parsedHz = parseAngleInput(radHzAngle, angleMode);
      if (!parsedHz.ok) return { ok: false as const, error: `夾角：${parsedHz.error}` };
    }

    const dist = parseOptionalFinite(radDist);
    if (Number.isNaN(dist) || (dist !== null && dist < 0)) {
      return { ok: false as const, error: '距離無效 (≥ 0)' };
    }

    // Wait silently until all required inputs are filled
    if (
      n0 === null ||
      e0 === null ||
      dist === null ||
      !parsedHz ||
      !parsedHz.ok ||
      (radBsMode === 'point' ? nBs === null || eBs === null : !parsedBsAz || !parsedBsAz.ok)
    ) {
      return null;
    }

    let bsAzDeg = 0;
    let bsPoint: { n: number; e: number } | null = null;
    if (radBsMode === 'point' && nBs !== null && eBs !== null) {
      bsPoint = { n: nBs, e: eBs };
      bsAzDeg = inverseCalculation(n0, e0, nBs, eBs).azimuthDeg;
    } else if (parsedBsAz && parsedBsAz.ok) {
      bsAzDeg = parsedBsAz.deg;
    }

    const out = computeRadiation({
      n0,
      e0,
      backsightAzDeg: bsAzDeg,
      hzAngleDeg: parsedHz.deg,
      distance: dist,
    });

    return {
      ok: true as const,
      n0,
      e0,
      bsPoint,
      bsAzDeg,
      ...out,
    };
  }, [moduleTab, radStation, radBsMode, radBsPoint, radBsAz, radHzAngle, radDist, angleMode]);

  // Compute Forward Intersection (returns null while required fields are empty)
  const intersectionResult = useMemo(() => {
    if (moduleTab !== 'intersection') return null;

    const nA = parseOptionalFinite(intPtA.n);
    const eA = parseOptionalFinite(intPtA.e);
    const nB = parseOptionalFinite(intPtB.n);
    const eB = parseOptionalFinite(intPtB.e);
    if ([nA, eA, nB, eB].some((v) => Number.isNaN(v))) {
      return { ok: false as const, error: '已知點 A / B 無效' };
    }

    if (intMode === 'angle') {
      const pAngA = intAngleA.trim() ? parseAngleInput(intAngleA, angleMode) : null;
      if (pAngA && !pAngA.ok) return { ok: false as const, error: `∠A：${pAngA.error}` };
      const pAngB = intAngleB.trim() ? parseAngleInput(intAngleB, angleMode) : null;
      if (pAngB && !pAngB.ok) return { ok: false as const, error: `∠B：${pAngB.error}` };

      if (
        nA === null ||
        eA === null ||
        nB === null ||
        eB === null ||
        !pAngA ||
        !pAngA.ok ||
        !pAngB ||
        !pAngB.ok
      ) {
        return null;
      }

      const res = computeAngleIntersection({
        nA,
        eA,
        angleAtADeg: pAngA.deg,
        nB,
        eB,
        angleAtBDeg: pAngB.deg,
      });
      if (!res.ok) return res;
      return { ...res, mode: 'angle' as const, nA, eA, nB, eB };
    } else {
      const dA = parseOptionalFinite(intDistA);
      const dB = parseOptionalFinite(intDistB);
      if (Number.isNaN(dA) || Number.isNaN(dB) || (dA !== null && dA < 0) || (dB !== null && dB < 0)) {
        return { ok: false as const, error: '距離無效' };
      }

      if (nA === null || eA === null || nB === null || eB === null || dA === null || dB === null) {
        return null;
      }

      const res = computeDistanceIntersection({
        nA,
        eA,
        distAP: dA,
        nB,
        eB,
        distBP: dB,
      });
      if (!res.ok) return res;
      return { ...res, mode: 'dist' as const, nA, eA, nB, eB, dA, dB };
    }
  }, [moduleTab, intMode, intPtA, intPtB, intAngleA, intAngleB, intDistA, intDistB, angleMode]);

  // Compute Resection (returns null while required fields are empty)
  const resectionResult = useMemo(() => {
    if (moduleTab !== 'resection') return null;

    const nA = parseOptionalFinite(resPtA.n);
    const eA = parseOptionalFinite(resPtA.e);
    const nB = parseOptionalFinite(resPtB.n);
    const eB = parseOptionalFinite(resPtB.e);
    const nC = parseOptionalFinite(resPtC.n);
    const eC = parseOptionalFinite(resPtC.e);
    if ([nA, eA, nB, eB, nC, eC].some((v) => Number.isNaN(v))) {
      return { ok: false as const, error: '控制點 A / B / C 無效' };
    }

    const pAlpha = resAlpha.trim() ? parseAngleInput(resAlpha, angleMode) : null;
    if (pAlpha && !pAlpha.ok) return { ok: false as const, error: `α：${pAlpha.error}` };
    const pBeta = resBeta.trim() ? parseAngleInput(resBeta, angleMode) : null;
    if (pBeta && !pBeta.ok) return { ok: false as const, error: `β：${pBeta.error}` };

    if (
      nA === null ||
      eA === null ||
      nB === null ||
      eB === null ||
      nC === null ||
      eC === null ||
      !pAlpha ||
      !pAlpha.ok ||
      !pBeta ||
      !pBeta.ok
    ) {
      return null;
    }

    const res = computeThreePointResection({
      nA,
      eA,
      nB,
      eB,
      nC,
      eC,
      alphaDeg: pAlpha.deg,
      betaDeg: pBeta.deg,
    });
    if (!res.ok) return res;
    return { ...res, nA, eA, nB, eB, nC, eC };
  }, [moduleTab, resPtA, resPtB, resPtC, resAlpha, resBeta, angleMode]);

  // Boundary Measurement (界址測量) calculations
  const matchedParcel = useMemo(() => {
    const q = bndLotNo.trim().toLowerCase();
    if (!q) return null;
    return section.parcels.find((p) => p.lotNo.toLowerCase() === q) ?? null;
  }, [section.parcels, bndLotNo]);

  const boundarySetup = useMemo(() => {
    if (moduleTab !== 'boundary') return null;

    const nSt = parseOptionalFinite(bndStation.n);
    const eSt = parseOptionalFinite(bndStation.e);
    const nBs = parseOptionalFinite(bndBacksight.n);
    const eBs = parseOptionalFinite(bndBacksight.e);

    if ([nSt, eSt, nBs, eBs].some((v) => Number.isNaN(v))) {
      return { ok: false as const, error: '測站或後視點坐標無效' };
    }
    if (nSt === null || eSt === null || nBs === null || eBs === null) {
      return null;
    }
    if (Math.hypot(nBs - nSt, eBs - eSt) < 1e-6) {
      return { ok: false as const, error: '測站與後視點重合，無法計算夾角' };
    }

    const backsightAzDeg = inverseCalculation(nSt, eSt, nBs, eBs).azimuthDeg;
    return {
      ok: true as const,
      nSt,
      eSt,
      nBs,
      eBs,
      backsightAzDeg,
    };
  }, [moduleTab, bndStation, bndBacksight]);

  // Force-enable parcel + boundary point + label layers only after station, backsight, and lot are all set
  useEffect(() => {
    if (moduleTab === 'boundary' && boundarySetup?.ok && matchedParcel) {
      onEnsureBoundaryLayers();
    }
  }, [moduleTab, boundarySetup, matchedParcel, onEnsureBoundaryLayers]);

  const boundaryList = useMemo(() => {
    if (!matchedParcel) return [];

    const uniqueMap = new Map<string, { id: string; n: number; e: number }>();
    for (const v of matchedParcel.vertices) {
      const id = v.id.trim();
      if (!id || uniqueMap.has(id)) continue;
      const conv = convertTm(v.n, v.e, section.crs, displayCrs);
      uniqueMap.set(id, { id, n: conv.n, e: conv.e });
    }
    for (const pid of matchedParcel.pointIds) {
      const id = pid.trim();
      if (!id || uniqueMap.has(id)) continue;
      const bp = section.boundaryPoints[id];
      if (!bp) continue;
      const conv = convertTm(bp.n, bp.e, section.crs, displayCrs);
      uniqueMap.set(id, { id, n: conv.n, e: conv.e });
    }

    const sorted = Array.from(uniqueMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );

    return sorted.map((pt) => {
      if (!boundarySetup || !boundarySetup.ok) {
        return { ...pt, designHzDeg: null as number | null, designDist: null as number | null };
      }
      const inv = inverseCalculation(boundarySetup.nSt, boundarySetup.eSt, pt.n, pt.e);
      const designHzDeg = normalizeDeg(inv.azimuthDeg - boundarySetup.backsightAzDeg);
      return {
        ...pt,
        designHzDeg,
        designDist: inv.distance,
      };
    });
  }, [matchedParcel, section.crs, section.boundaryPoints, displayCrs, boundarySetup]);

  const selectedBoundaryPt = useMemo(() => {
    if (!bndSelectedPtId) return null;
    return boundaryList.find((p) => p.id === bndSelectedPtId) ?? null;
  }, [boundaryList, bndSelectedPtId]);

  const stakeoutGuidance = useMemo(() => {
    if (moduleTab !== 'boundary' || !selectedBoundaryPt) return null;

    let parsedObsHz: ReturnType<typeof parseAngleInput> | null = null;
    if (bndObsAngle.trim()) {
      parsedObsHz = parseAngleInput(bndObsAngle, angleMode);
      if (!parsedObsHz.ok) {
        return { ok: false as const, error: `實測夾角：${parsedObsHz.error}` };
      }
    }

    const obsDist = parseOptionalFinite(bndObsDist);
    if (Number.isNaN(obsDist) || (obsDist !== null && obsDist < 0)) {
      return { ok: false as const, error: '實測距離無效 (≥ 0)' };
    }

    if (!parsedObsHz || !parsedObsHz.ok || obsDist === null) {
      return null;
    }

    if (!boundarySetup || !boundarySetup.ok) {
      return { ok: false as const, error: '請先設定有效的測站與後視點' };
    }

    const out = computeBoundaryStakeoutGuidance({
      nSt: boundarySetup.nSt,
      eSt: boundarySetup.eSt,
      backsightAzDeg: boundarySetup.backsightAzDeg,
      nTarget: selectedBoundaryPt.n,
      eTarget: selectedBoundaryPt.e,
      obsHzDeg: parsedObsHz.deg,
      obsDist,
    });

    return { ok: true as const, ...out };
  }, [moduleTab, selectedBoundaryPt, bndObsAngle, bndObsDist, angleMode, boundarySetup]);

  // Auto-center and zoom to max level (22) on the selected boundary point once both obs inputs settle
  const lastBoundaryFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (moduleTab !== 'boundary' || !selectedBoundaryPt || !stakeoutGuidance?.ok) {
      lastBoundaryFocusKeyRef.current = null;
      return;
    }

    const focusKey = `${selectedBoundaryPt.id}|${bndObsAngle.trim()}|${bndObsDist.trim()}|${displayCrs}|${selectedBoundaryPt.n.toFixed(3)}|${selectedBoundaryPt.e.toFixed(3)}`;
    if (lastBoundaryFocusKeyRef.current === focusKey) return;

    const timer = window.setTimeout(() => {
      lastBoundaryFocusKeyRef.current = focusKey;
      onFocusPoint({
        n: selectedBoundaryPt.n,
        e: selectedBoundaryPt.e,
        crs: displayCrs,
        zoom: 22,
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [moduleTab, selectedBoundaryPt, stakeoutGuidance, bndObsAngle, bndObsDist, displayCrs, onFocusPoint]);

  // Sync COGO Map Preview Overlay
  useEffect(() => {
    if (moduleTab === 'radiation' && radiationResult?.ok) {
      const points: CogoPreviewOverlay['points'] = [
        { label: '測站', n: radiationResult.n0, e: radiationResult.e0, role: 'known' },
        { label: 'P', n: radiationResult.nP, e: radiationResult.eP, role: 'result' },
      ];
      const lines: CogoPreviewOverlay['lines'] = [
        {
          from: { n: radiationResult.n0, e: radiationResult.e0 },
          to: { n: radiationResult.nP, e: radiationResult.eP },
        },
      ];
      if (radiationResult.bsPoint) {
        points.push({
          label: '後視',
          n: radiationResult.bsPoint.n,
          e: radiationResult.bsPoint.e,
          role: 'known',
        });
        lines.push({
          from: { n: radiationResult.n0, e: radiationResult.e0 },
          to: radiationResult.bsPoint,
          dashed: true,
        });
      }
      onUpdatePreview({ type: 'radiation', points, lines });
      return;
    }

    if (moduleTab === 'intersection' && intersectionResult?.ok) {
      if (intersectionResult.mode === 'angle') {
        onUpdatePreview({
          type: 'intersection_angle',
          points: [
            { label: 'A', n: intersectionResult.nA, e: intersectionResult.eA, role: 'known' },
            { label: 'B', n: intersectionResult.nB, e: intersectionResult.eB, role: 'known' },
            { label: 'P', n: intersectionResult.nP, e: intersectionResult.eP, role: 'result' },
          ],
          lines: [
            {
              from: { n: intersectionResult.nA, e: intersectionResult.eA },
              to: { n: intersectionResult.nB, e: intersectionResult.eB },
              dashed: true,
            },
            {
              from: { n: intersectionResult.nA, e: intersectionResult.eA },
              to: { n: intersectionResult.nP, e: intersectionResult.eP },
            },
            {
              from: { n: intersectionResult.nB, e: intersectionResult.eB },
              to: { n: intersectionResult.nP, e: intersectionResult.eP },
            },
          ],
        });
      } else {
        const s1 = intersectionResult.solutions[0];
        const s2 = intersectionResult.solutions[1];
        const activeSol = intersectionResult.solutions[selectedDistSol];
        onUpdatePreview({
          type: 'intersection_dist',
          selectedSolutionIndex: selectedDistSol,
          onSelectSolution: (idx) =>
            onChangeFormState((prev) => ({ ...prev, selectedDistSol: idx })),
          points: [
            { label: 'A', n: intersectionResult.nA, e: intersectionResult.eA, role: 'known' },
            { label: 'B', n: intersectionResult.nB, e: intersectionResult.eB, role: 'known' },
            { label: '解1', n: s1.n, e: s1.e, role: selectedDistSol === 0 ? 'result' : 'alt' },
            { label: '解2', n: s2.n, e: s2.e, role: selectedDistSol === 1 ? 'result' : 'alt' },
          ],
          lines: [
            {
              from: { n: intersectionResult.nA, e: intersectionResult.eA },
              to: { n: activeSol.n, e: activeSol.e },
            },
            {
              from: { n: intersectionResult.nB, e: intersectionResult.eB },
              to: { n: activeSol.n, e: activeSol.e },
            },
          ],
          circles: [
            {
              center: { n: intersectionResult.nA, e: intersectionResult.eA },
              radius: intersectionResult.dA,
            },
            {
              center: { n: intersectionResult.nB, e: intersectionResult.eB },
              radius: intersectionResult.dB,
            },
          ],
        });
      }
      return;
    }

    if (moduleTab === 'resection' && resectionResult?.ok) {
      const circles: CogoPreviewOverlay['circles'] = [];
      if (resectionResult.circumcenter && resectionResult.circumradius) {
        circles.push({
          center: resectionResult.circumcenter,
          radius: resectionResult.circumradius,
          danger: resectionResult.dangerCircle,
        });
      }
      onUpdatePreview({
        type: 'resection',
        points: [
          { label: 'A', n: resectionResult.nA, e: resectionResult.eA, role: 'known' },
          { label: 'B', n: resectionResult.nB, e: resectionResult.eB, role: 'known' },
          { label: 'C', n: resectionResult.nC, e: resectionResult.eC, role: 'known' },
          { label: 'P', n: resectionResult.nP, e: resectionResult.eP, role: 'result' },
        ],
        lines: [
          {
            from: { n: resectionResult.nP, e: resectionResult.eP },
            to: { n: resectionResult.nA, e: resectionResult.eA },
            dashed: true,
          },
          {
            from: { n: resectionResult.nP, e: resectionResult.eP },
            to: { n: resectionResult.nB, e: resectionResult.eB },
            dashed: true,
          },
          {
            from: { n: resectionResult.nP, e: resectionResult.eP },
            to: { n: resectionResult.nC, e: resectionResult.eC },
            dashed: true,
          },
        ],
        circles,
      });
      return;
    }

    if (moduleTab === 'boundary') {
      const points: CogoPreviewOverlay['points'] = [];
      const lines: CogoPreviewOverlay['lines'] = [];
      const polygon = matchedParcel
        ? matchedParcel.vertices.map((v) => convertTm(v.n, v.e, section.crs, displayCrs))
        : undefined;

      const nStVal = parseOptionalFinite(bndStation.n);
      const eStVal = parseOptionalFinite(bndStation.e);
      const nBsVal = parseOptionalFinite(bndBacksight.n);
      const eBsVal = parseOptionalFinite(bndBacksight.e);

      const hasSt = nStVal !== null && eStVal !== null && Number.isFinite(nStVal) && Number.isFinite(eStVal);
      const hasBs = nBsVal !== null && eBsVal !== null && Number.isFinite(nBsVal) && Number.isFinite(eBsVal);

      if (hasSt) {
        points.push({
          label: bndStationId.trim() || bndStation.hint || '測站',
          n: nStVal,
          e: eStVal,
          role: 'known',
        });
      }
      if (hasBs) {
        points.push({
          label: bndBacksightId.trim() || bndBacksight.hint || '後視',
          n: nBsVal,
          e: eBsVal,
          role: 'known',
        });
      }
      if (hasSt && hasBs) {
        lines.push({
          from: { n: nStVal, e: eStVal },
          to: { n: nBsVal, e: eBsVal },
          dashed: true,
          color: '#0284C7',
        });
      }
      if (selectedBoundaryPt) {
        points.push({
          label: `目標 ${selectedBoundaryPt.id}`,
          n: selectedBoundaryPt.n,
          e: selectedBoundaryPt.e,
          role: 'alt',
        });
        if (hasSt) {
          lines.push({
            from: { n: nStVal, e: eStVal },
            to: { n: selectedBoundaryPt.n, e: selectedBoundaryPt.e },
            color: '#0284C7',
          });
        }
      }
      if (stakeoutGuidance?.ok && selectedBoundaryPt && hasSt) {
        points.push({
          label: '觀測點',
          n: stakeoutGuidance.nObs,
          e: stakeoutGuidance.eObs,
          role: 'result',
        });
        lines.push({
          from: { n: nStVal, e: eStVal },
          to: { n: stakeoutGuidance.nObs, e: stakeoutGuidance.eObs },
          color: '#EA580C',
        });
        lines.push({
          from: { n: stakeoutGuidance.nObs, e: stakeoutGuidance.eObs },
          to: { n: selectedBoundaryPt.n, e: selectedBoundaryPt.e },
          dashed: true,
          color: '#DC2626',
        });
      }

      if (points.length > 0 || lines.length > 0 || (polygon && polygon.length > 0)) {
        onUpdatePreview({ type: 'boundary', points, lines, polygon });
      } else {
        onUpdatePreview(null);
      }
      return;
    }

    onUpdatePreview(null);
  }, [
    moduleTab,
    radiationResult,
    intersectionResult,
    resectionResult,
    selectedDistSol,
    matchedParcel,
    section.crs,
    displayCrs,
    bndStation,
    bndStationId,
    bndBacksight,
    bndBacksightId,
    selectedBoundaryPt,
    stakeoutGuidance,
    onUpdatePreview,
    onChangeFormState,
  ]);

  useEffect(() => {
    return () => onUpdatePreview(null);
  }, [onUpdatePreview]);

  const activeOutput: {
    n: number;
    e: number;
    source: FieldPointSource;
  } | null = useMemo(() => {
    if (moduleTab === 'radiation' && radiationResult?.ok) {
      return { n: radiationResult.nP, e: radiationResult.eP, source: 'radiation' };
    }
    if (moduleTab === 'intersection' && intersectionResult?.ok) {
      if (intersectionResult.mode === 'angle') {
        return { n: intersectionResult.nP, e: intersectionResult.eP, source: 'intersection_dir' };
      }
      const sol = intersectionResult.solutions[selectedDistSol];
      return { n: sol.n, e: sol.e, source: 'intersection_dist' };
    }
    if (moduleTab === 'resection' && resectionResult?.ok) {
      return { n: resectionResult.nP, e: resectionResult.eP, source: 'resection' };
    }
    if (moduleTab === 'boundary' && stakeoutGuidance?.ok) {
      return { n: stakeoutGuidance.nObs, e: stakeoutGuidance.eObs, source: 'radiation' };
    }
    return null;
  }, [moduleTab, radiationResult, intersectionResult, resectionResult, selectedDistSol, stakeoutGuidance]);

  const activeKindOption =
    POINT_KIND_OPTIONS.find((opt) => opt.id === saveKind) ?? POINT_KIND_OPTIONS[3];

  const handleSave = () => {
    if (!activeOutput) return;
    const cleanId = saveId.trim() || currentSuggestedId;
    onSaveFieldPoint({
      id: cleanId,
      note: saveNote.trim(),
      n: activeOutput.n,
      e: activeOutput.e,
      source: activeOutput.source,
      pointKind: saveKind,
    });
    setSaveNote('');
    setSavedNotice(`已存 ${cleanId}`);
    setTimeout(() => setSavedNotice(null), 2000);
  };

  return (
    <div className="space-y-2.5">
      {/* Module Segmented Tabs */}
      <div className="grid grid-cols-4 gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80">
        {(
          [
            { id: 'radiation', label: '光線法' },
            { id: 'intersection', label: '前方交會' },
            { id: 'resection', label: '後方交會' },
            { id: 'boundary', label: '界址測量' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeFormState((prev) => ({ ...prev, moduleTab: tab.id }))}
            className={`py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              moduleTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Angle Format & Clear All Row */}
      <div className="flex items-center justify-between gap-1 text-[11px]">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10.5px] text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            角度({displayCrs === 'EPSG:3826' ? 'TWD97' : 'TWD67'})
          </span>
          <div className="flex items-center gap-0.5 p-0.5 rounded bg-slate-100 dark:bg-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => onChangeFormState((prev) => ({ ...prev, angleMode: 'dms' }))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                angleMode === 'dms'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              DDD.MMSS
            </button>
            <button
              type="button"
              onClick={() => onChangeFormState((prev) => ({ ...prev, angleMode: 'deg' }))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                angleMode === 'deg'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              度
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={!hasActiveModuleInputs}
          onClick={handleClearActiveModule}
          className={`inline-flex items-center gap-0.5 px-1.5 py-1 rounded border text-[10.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${
            hasActiveModuleInputs
              ? 'border-red-200 dark:border-red-800/80 bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50'
              : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          <RotateCcw className="w-2.5 h-2.5 shrink-0" />
          <span>清空所有資料</span>
        </button>
      </div>

      {/* Module 1: Radiation */}
      {moduleTab === 'radiation' && (
        <div className="space-y-2.5">
          <CoordFields
            label="測站"
            nVal={radStation.n}
            eVal={radStation.e}
            nPlaceholder="例: 2517075.500"
            ePlaceholder="例: 266490.200"
            pointHint={radStation.hint}
            onChangeN={(v) => updateCoordField('radStation', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('radStation', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選測站', 'radStation')}
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                後視
              </span>
              <div className="flex items-center gap-0.5 p-0.5 rounded bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => onChangeFormState((prev) => ({ ...prev, radBsMode: 'point' }))}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                    radBsMode === 'point'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  後視點
                </button>
                <button
                  type="button"
                  onClick={() => onChangeFormState((prev) => ({ ...prev, radBsMode: 'azimuth' }))}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                    radBsMode === 'azimuth'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  方位角
                </button>
              </div>
            </div>

            {radBsMode === 'point' ? (
              <CoordFields
                label="後視點"
                nVal={radBsPoint.n}
                eVal={radBsPoint.e}
                nPlaceholder="例: 2517130.800"
                ePlaceholder="例: 266495.600"
                pointHint={radBsPoint.hint}
                onChangeN={(v) => updateCoordField('radBsPoint', (s) => ({ ...s, n: v, hint: undefined }))}
                onChangeE={(v) => updateCoordField('radBsPoint', (s) => ({ ...s, e: v, hint: undefined }))}
                onPick={() => pickCoordFor('點選後視點', 'radBsPoint')}
              />
            ) : (
              <input
                type="text"
                value={radBsAz}
                onChange={(e) => onChangeFormState((prev) => ({ ...prev, radBsAz: e.target.value }))}
                placeholder={angleMode === 'dms' ? '例: 5.3442' : '例: 5.5783'}
                aria-label="後視方位角"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                夾角 β
              </label>
              <input
                type="text"
                value={radHzAngle}
                onChange={(e) => onChangeFormState((prev) => ({ ...prev, radHzAngle: e.target.value }))}
                placeholder={angleMode === 'dms' ? '例: 45.0000' : '例: 45.0'}
                aria-label="夾角 β"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                距 S (m)
              </label>
              <input
                type="number"
                step="0.001"
                value={radDist}
                onChange={(e) => onChangeFormState((prev) => ({ ...prev, radDist: e.target.value }))}
                placeholder="例: 32.500"
                aria-label="距 S (m)"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
          </div>

          {radiationResult && !radiationResult.ok && (
            <div className="px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {radiationResult.error}
            </div>
          )}

          {radiationResult?.ok && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">N_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {radiationResult.nP.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">E_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {radiationResult.eP.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between text-[11px] pt-1 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400">方位角</span>
                <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
                  {radiationResult.targetAzDms}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Module 2: Forward Intersection */}
      {moduleTab === 'intersection' && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => onChangeFormState((prev) => ({ ...prev, intMode: 'dist' }))}
              className={`py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                intMode === 'dist'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              距離雙解
            </button>
            <button
              type="button"
              onClick={() => onChangeFormState((prev) => ({ ...prev, intMode: 'angle' }))}
              className={`py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                intMode === 'angle'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              夾角交會
            </button>
          </div>

          <CoordFields
            label="已知點 A"
            nVal={intPtA.n}
            eVal={intPtA.e}
            nPlaceholder="例: 2517075.500"
            ePlaceholder="例: 266490.200"
            pointHint={intPtA.hint}
            onChangeN={(v) => updateCoordField('intPtA', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('intPtA', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選 A 點', 'intPtA')}
          />

          <CoordFields
            label="已知點 B"
            nVal={intPtB.n}
            eVal={intPtB.e}
            nPlaceholder="例: 2517070.100"
            ePlaceholder="例: 266555.300"
            pointHint={intPtB.hint}
            onChangeN={(v) => updateCoordField('intPtB', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('intPtB', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選 B 點', 'intPtB')}
          />

          {intMode === 'angle' ? (
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5 truncate">
                  ∠A (A照准B歸0)
                </label>
                <input
                  type="text"
                  value={intAngleA}
                  onChange={(e) => onChangeFormState((prev) => ({ ...prev, intAngleA: e.target.value }))}
                  placeholder={angleMode === 'dms' ? '例: 315.0000' : '例: 315.0'}
                  aria-label="∠A (A照准B歸0)"
                  className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5 truncate">
                  ∠B (B照准A歸0)
                </label>
                <input
                  type="text"
                  value={intAngleB}
                  onChange={(e) => onChangeFormState((prev) => ({ ...prev, intAngleB: e.target.value }))}
                  placeholder={angleMode === 'dms' ? '例: 45.0000' : '例: 45.0'}
                  aria-label="∠B (B照准A歸0)"
                  className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                  S_AP (m)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={intDistA}
                  onChange={(e) => onChangeFormState((prev) => ({ ...prev, intDistA: e.target.value }))}
                  placeholder="例: 42.000"
                  aria-label="S_AP (m)"
                  className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                  S_BP (m)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={intDistB}
                  onChange={(e) => onChangeFormState((prev) => ({ ...prev, intDistB: e.target.value }))}
                  placeholder="例: 45.000"
                  aria-label="S_BP (m)"
                  className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
            </div>
          )}

          {intersectionResult && !intersectionResult.ok && (
            <div className="px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {intersectionResult.error}
            </div>
          )}

          {intersectionResult?.ok && intersectionResult.mode === 'angle' && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
              {intersectionResult.warning && (
                <div className="flex items-start gap-1.5 p-1.5 mb-1 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-[11px] text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{intersectionResult.warning}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">N_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {intersectionResult.nP.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">E_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {intersectionResult.eP.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700 font-mono-tabular">
                <span>AP {intersectionResult.distAP.toFixed(2)}m</span>
                <span>BP {intersectionResult.distBP.toFixed(2)}m</span>
                <span>{intersectionResult.intersectionAngleDeg.toFixed(1)}°</span>
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 truncate">
                α_AP {formatDegToDms(intersectionResult.azAPDeg)} · α_BP{' '}
                {formatDegToDms(intersectionResult.azBPDeg)}
              </div>
            </div>
          )}

          {intersectionResult?.ok && intersectionResult.mode === 'dist' && (
            <div className="grid grid-cols-2 gap-1.5">
              {intersectionResult.solutions.map((sol, idx) => {
                const active = selectedDistSol === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() =>
                      onChangeFormState((prev) => ({ ...prev, selectedDistSol: idx as 0 | 1 }))
                    }
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-500 text-slate-900 dark:text-slate-100'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                      解 {idx + 1}
                    </div>
                    <div className="text-[11px] font-mono-tabular">{sol.n.toFixed(3)}</div>
                    <div className="text-[11px] font-mono-tabular">{sol.e.toFixed(3)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Module 3: Three-Point Resection */}
      {moduleTab === 'resection' && (
        <div className="space-y-2.5">
          <CoordFields
            label="點 A"
            nVal={resPtA.n}
            eVal={resPtA.e}
            nPlaceholder="例: 2517130.800"
            ePlaceholder="例: 266495.600"
            pointHint={resPtA.hint}
            onChangeN={(v) => updateCoordField('resPtA', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('resPtA', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選 A 點', 'resPtA')}
          />
          <CoordFields
            label="點 B"
            nVal={resPtB.n}
            eVal={resPtB.e}
            nPlaceholder="例: 2517125.400"
            ePlaceholder="例: 266560.800"
            pointHint={resPtB.hint}
            onChangeN={(v) => updateCoordField('resPtB', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('resPtB', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選 B 點', 'resPtB')}
          />
          <CoordFields
            label="點 C"
            nVal={resPtC.n}
            eVal={resPtC.e}
            nPlaceholder="例: 2517070.100"
            ePlaceholder="例: 266555.300"
            pointHint={resPtC.hint}
            onChangeN={(v) => updateCoordField('resPtC', (s) => ({ ...s, n: v, hint: undefined }))}
            onChangeE={(v) => updateCoordField('resPtC', (s) => ({ ...s, e: v, hint: undefined }))}
            onPick={() => pickCoordFor('點選 C 點', 'resPtC')}
          />

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                α (A→B)
              </label>
              <input
                type="text"
                value={resAlpha}
                onChange={(e) => onChangeFormState((prev) => ({ ...prev, resAlpha: e.target.value }))}
                placeholder={angleMode === 'dms' ? '例: 72.3000' : '例: 72.5'}
                aria-label="α (A→B)"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                β (B→C)
              </label>
              <input
                type="text"
                value={resBeta}
                onChange={(e) => onChangeFormState((prev) => ({ ...prev, resBeta: e.target.value }))}
                placeholder={angleMode === 'dms' ? '例: 68.1500' : '例: 68.25'}
                aria-label="β (B→C)"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
          </div>

          {resectionResult && !resectionResult.ok && (
            <div className="p-2 rounded-md border border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/50 text-xs text-red-800 dark:text-red-200 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <span>{resectionResult.error}</span>
            </div>
          )}

          {resectionResult?.ok && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1 text-xs">
              {resectionResult.dangerCircle && (
                <div className="p-2 rounded border border-red-400 dark:border-red-700 bg-red-100 dark:bg-red-950/70 text-red-900 dark:text-red-100 text-[11px] flex items-start gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <span>{resectionResult.dangerWarning}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">N_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {resectionResult.nP.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">E_P</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-50">
                  {resectionResult.eP.toFixed(3)}
                </span>
              </div>
              <div className="pt-1 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>強度</span>
                <span
                  className={`font-mono-tabular font-semibold ${
                    resectionResult.dangerCircle
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {resectionResult.strengthScore}/100
                </span>
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 truncate">
                α {formatDegToDms(resectionResult.checkAlphaDeg)} · β{' '}
                {formatDegToDms(resectionResult.checkBetaDeg)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Module 4: Boundary Measurement (界址測量) */}
      {moduleTab === 'boundary' && (
        <div className="space-y-2.5">
          <datalist id="cogo-known-points">
            {knownPointCatalog.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.id} ({pt.category})
              </option>
            ))}
          </datalist>
          <datalist id="cogo-lot-numbers">
            {section.parcels.map((p) => (
              <option key={p.lotNo} value={p.lotNo} />
            ))}
          </datalist>

          {/* 1. 測站 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
                1. 測站
              </span>
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  list="cogo-known-points"
                  value={bndStationId}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = knownPointMap.get(val.trim().toLowerCase());
                    onChangeFormState((prev) => ({
                      ...prev,
                      bndStationId: val,
                      ...(match
                        ? {
                            bndStation: {
                              n: match.n.toFixed(3),
                              e: match.e.toFixed(3),
                              hint: match.id,
                            },
                          }
                        : {}),
                    }));
                  }}
                  placeholder="點號"
                  aria-label="測站點號"
                  className="w-24 h-7 px-2 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <button
                  type="button"
                  onClick={() => pickCoordFor('點選測站', 'bndStation')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  <Crosshair className="w-3 h-3" />
                  <span>選點</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                step="0.001"
                value={bndStation.n}
                onChange={(e) => updateCoordField('bndStation', (s) => ({ ...s, n: e.target.value, hint: undefined }))}
                placeholder="N 坐標"
                aria-label="測站 N"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              <input
                type="number"
                step="0.001"
                value={bndStation.e}
                onChange={(e) => updateCoordField('bndStation', (s) => ({ ...s, e: e.target.value, hint: undefined }))}
                placeholder="E 坐標"
                aria-label="測站 E"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
          </div>

          {/* 2. 後視點 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
                2. 後視點
              </span>
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  list="cogo-known-points"
                  value={bndBacksightId}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = knownPointMap.get(val.trim().toLowerCase());
                    onChangeFormState((prev) => ({
                      ...prev,
                      bndBacksightId: val,
                      ...(match
                        ? {
                            bndBacksight: {
                              n: match.n.toFixed(3),
                              e: match.e.toFixed(3),
                              hint: match.id,
                            },
                          }
                        : {}),
                    }));
                  }}
                  placeholder="點號"
                  aria-label="後視點號"
                  className="w-24 h-7 px-2 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <button
                  type="button"
                  onClick={() => pickCoordFor('點選後視點', 'bndBacksight')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  <Crosshair className="w-3 h-3" />
                  <span>選點</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                step="0.001"
                value={bndBacksight.n}
                onChange={(e) => updateCoordField('bndBacksight', (s) => ({ ...s, n: e.target.value, hint: undefined }))}
                placeholder="N 坐標"
                aria-label="後視點 N"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              <input
                type="number"
                step="0.001"
                value={bndBacksight.e}
                onChange={(e) => updateCoordField('bndBacksight', (s) => ({ ...s, e: e.target.value, hint: undefined }))}
                placeholder="E 坐標"
                aria-label="後視點 E"
                className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
          </div>

          {boundarySetup && !boundarySetup.ok && (
            <div className="px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {boundarySetup.error}
            </div>
          )}

          {/* 3. 目標地號 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                3. 目標地號
              </span>
              <button
                type="button"
                onClick={() => {
                  onRequestPick({
                    id: `cogo-parcel-${Date.now()}`,
                    mode: 'parcel',
                    prompt: '點選圖面地號',
                    onPickParcel: ({ lotNo }) => {
                      onChangeFormState((prev) => ({
                        ...prev,
                        bndLotNo: lotNo,
                        bndSelectedPtId: null,
                        bndObsAngle: '',
                        bndObsDist: '',
                      }));
                    },
                  });
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <MapPin className="w-3 h-3" />
                <span>圖面選地號</span>
              </button>
            </div>
            <input
              type="text"
              list="cogo-lot-numbers"
              value={bndLotNo}
              onChange={(e) => {
                const nextLot = e.target.value;
                onChangeFormState((prev) => ({
                  ...prev,
                  bndLotNo: nextLot,
                  bndSelectedPtId: null,
                  bndObsAngle: '',
                  bndObsDist: '',
                }));
              }}
              placeholder="輸入地號，例: 120 或 120-1"
              aria-label="目標地號"
              className="w-full h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <div className="flex items-center justify-between gap-1 text-[10.5px] text-slate-500 dark:text-slate-400">
              <span className="truncate">
                {boundarySetup?.ok && matchedParcel
                  ? '已自動開啟地籍線與界址點圖層'
                  : '設妥測站、後視與地號後自動開啟地籍圖層'}
              </span>
              {matchedParcel && (
                <span className="font-mono-tabular text-sky-700 dark:text-sky-300 font-medium whitespace-nowrap shrink-0">
                  {matchedParcel.lotNo} · {boundaryList.length}點
                </span>
              )}
            </div>
            {bndLotNo.trim() !== '' && !matchedParcel && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                查無「{bndLotNo.trim()}」地號資料
              </div>
            )}
          </div>

          {/* 4. 界址點清冊 */}
          {matchedParcel && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="grid grid-cols-[64px_1fr_64px] gap-1 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">
                <span>界址點</span>
                <span className="text-right">夾角(歸0)</span>
                <span className="text-right">距離</span>
              </div>

              {boundaryList.length === 0 ? (
                <div className="px-2.5 py-3 text-[11px] text-slate-500 dark:text-slate-400 text-center">
                  此地號無可用界址點坐標
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {boundaryList.map((pt) => {
                    const isSelected = bndSelectedPtId === pt.id;
                    const angleText =
                      pt.designHzDeg !== null
                        ? angleMode === 'dms'
                          ? formatDegToDms(pt.designHzDeg)
                          : `${pt.designHzDeg.toFixed(4)}°`
                        : '—';
                    const distText = pt.designDist !== null ? `${pt.designDist.toFixed(3)}` : '—';

                    return (
                      <div key={pt.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onChangeFormState((prev) => ({
                              ...prev,
                              bndSelectedPtId: isSelected ? null : pt.id,
                              bndObsAngle: isSelected ? prev.bndObsAngle : '',
                              bndObsDist: isSelected ? prev.bndObsDist : '',
                            }))
                          }
                          aria-expanded={isSelected}
                          className={`w-full grid grid-cols-[64px_1fr_64px] gap-1 items-center px-2 py-2 text-left text-[11px] transition-colors ${
                            isSelected
                              ? 'bg-slate-950 text-white border-2 border-orange-500 shadow-xs'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <span className="inline-flex items-center gap-0.5 font-mono-tabular font-semibold truncate">
                            {isSelected ? (
                              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-orange-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                            )}
                            <span className="truncate">{pt.id}</span>
                          </span>
                          <span className="font-mono-tabular text-right truncate">{angleText}</span>
                          <span className="font-mono-tabular text-right">{distText}</span>
                        </button>

                        {isSelected && (
                          <div className="px-2.5 py-2 bg-slate-50/90 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700/80 space-y-2">
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <label className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                  實測夾角(歸0)
                                </label>
                                <input
                                  type="text"
                                  value={bndObsAngle}
                                  onChange={(e) =>
                                    onChangeFormState((prev) => ({ ...prev, bndObsAngle: e.target.value }))
                                  }
                                  placeholder={angleMode === 'dms' ? '例: 45.0000' : '例: 45.0'}
                                  aria-label={`界址點 ${pt.id} 實測夾角`}
                                  className="w-full h-7 px-2 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                                />
                              </div>
                              <div>
                                <label className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                  實測距離 (m)
                                </label>
                                <input
                                  type="number"
                                  step="0.001"
                                  value={bndObsDist}
                                  onChange={(e) =>
                                    onChangeFormState((prev) => ({ ...prev, bndObsDist: e.target.value }))
                                  }
                                  placeholder="例: 28.500"
                                  aria-label={`界址點 ${pt.id} 實測距離`}
                                  className="w-full h-7 px-2 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
                                />
                              </div>
                            </div>

                            {!boundarySetup?.ok && (
                              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                                請先完成「測站」與「後視點」設定以計算移動指示
                              </div>
                            )}

                            {stakeoutGuidance && !stakeoutGuidance.ok && (
                              <div className="px-2 py-1 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-[11px] text-red-700 dark:text-red-300">
                                {stakeoutGuidance.error}
                              </div>
                            )}

                            {stakeoutGuidance?.ok && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <div className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                  <div className="flex items-center gap-1 text-[10.5px] font-medium text-slate-600 dark:text-slate-400">
                                    {stakeoutGuidance.forwardTowardStation >= 0 ? (
                                      <ArrowUp className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                                    ) : (
                                      <ArrowDown className="w-3 h-3 text-orange-600 dark:text-orange-400 shrink-0" />
                                    )}
                                    <span className="whitespace-nowrap">
                                      {Math.abs(stakeoutGuidance.forwardTowardStation) < 0.0005
                                        ? '前後到位'
                                        : stakeoutGuidance.forwardTowardStation > 0
                                        ? '往前'
                                        : '往後'}
                                    </span>
                                  </div>
                                  <div className="font-mono-tabular text-xs font-bold text-slate-900 dark:text-slate-50 mt-0.5">
                                    {Math.abs(stakeoutGuidance.forwardTowardStation).toFixed(3)} m
                                  </div>
                                </div>

                                <div className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                  <div className="flex items-center gap-1 text-[10.5px] font-medium text-slate-600 dark:text-slate-400">
                                    {stakeoutGuidance.rightFromStation >= 0 ? (
                                      <ArrowRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    ) : (
                                      <ArrowLeft className="w-3 h-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                    )}
                                    <span className="whitespace-nowrap">
                                      {Math.abs(stakeoutGuidance.rightFromStation) < 0.0005
                                        ? '左右到位'
                                        : stakeoutGuidance.rightFromStation > 0
                                        ? '往右'
                                        : '往左'}
                                    </span>
                                  </div>
                                  <div className="font-mono-tabular text-xs font-bold text-slate-900 dark:text-slate-50 mt-0.5">
                                    {Math.abs(stakeoutGuidance.rightFromStation).toFixed(3)} m
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save Computed Result */}
      {activeOutput && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
              點位類別
            </span>
            <div
              role="group"
              aria-label="點位類別"
              className="grid grid-cols-4 gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-slate-800"
            >
              {POINT_KIND_OPTIONS.map((opt) => {
                const active = saveKind === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSaveKind(opt.id)}
                    aria-pressed={active}
                    className={`py-1 px-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? opt.activeClass
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-[72px_1fr_auto] gap-1.5 items-center">
            <input
              type="text"
              value={saveId}
              onChange={(e) => setSaveId(e.target.value)}
              placeholder={currentSuggestedId}
              aria-label="點號"
              className="h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono-tabular text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={saveNote}
              onChange={(e) => setSaveNote(e.target.value)}
              placeholder="備註"
              aria-label="備註"
              className="h-8 px-2 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={handleSave}
              className={`h-8 px-2.5 inline-flex items-center gap-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${activeKindOption.saveBtnClass}`}
            >
              <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
              <span>存點</span>
            </button>
          </div>
          {savedNotice && (
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium text-right">
              {savedNotice}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
