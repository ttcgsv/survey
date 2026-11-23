import {
  Calculator,
  Compass,
  FolderOpen,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddSectionModal } from './components/AddSectionModal';
import { CogoPanel } from './components/CogoPanel';
import { DatasetPanel } from './components/DatasetPanel';
import { FieldPointsPanel } from './components/FieldPointsPanel';
import { LayersPanel } from './components/LayersPanel';
import { MapCanvas } from './components/MapCanvas';
import { MeasurePanel } from './components/MeasurePanel';
import { MobileBottomSheet } from './components/MobileBottomSheet';
import { StatusBar } from './components/StatusBar';
import { bundleToCadastralSection, loadStaticSections } from './data';
import type {
  BasemapId,
  CadastralSection,
  CogoFormState,
  CogoPreviewOverlay,
  CrsId,
  FieldPoint,
  FieldPointKind,
  FieldPointSource,
  LayerVisibility,
  MapPickRequest,
  MeasureOverlay,
  ParcelEntity,
  SectionDataBundle,
  SidebarTab,
} from './types/cadastral';
import {
  deleteLocalSection,
  getSavedActiveSectionCode,
  loadAllLocalSections,
  loadLocalFieldPoints,
  loadSectionCrsMap,
  saveActiveSectionCode,
  saveLocalFieldPoints,
  saveSectionCrsPref,
} from './utils/offlineDb';
import { wgs84ToTm } from './utils/proj';

const STORAGE_THEME = 'tw_cadastral_theme_v1';

const SIDEBAR_TABS: { id: SidebarTab; label: string; icon: typeof FolderOpen }[] = [
  { id: 'dataset', label: '地段', icon: FolderOpen },
  { id: 'layers', label: '圖層', icon: Layers },
  { id: 'cogo', label: '測量', icon: Compass },
  { id: 'points', label: '實測點', icon: MapPin },
  { id: 'measure', label: '圖面計算', icon: Calculator },
];

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_THEME, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const [sections, setSections] = useState<CadastralSection[]>(() => loadStaticSections());
  const [activeSectionCode, setActiveSectionCode] = useState<string>(() => {
    const initial = loadStaticSections();
    const saved = getSavedActiveSectionCode();
    if (saved && initial.some((s) => s.code === saved)) {
      return saved;
    }
    return initial[0]?.code ?? 'VA0001';
  });

  useEffect(() => {
    if (activeSectionCode) {
      saveActiveSectionCode(activeSectionCode);
    }
  }, [activeSectionCode]);

  const activeSection = useMemo(
    () => sections.find((s) => s.code === activeSectionCode) ?? sections[0],
    [sections, activeSectionCode]
  );

  const displayCrs: CrsId = activeSection?.crs ?? 'EPSG:3826';
  const [basemap, setBasemap] = useState<BasemapId>('emap');
  const [layers, setLayers] = useState<LayerVisibility>({
    parcels: true,
    parcelLabels: true,
    boundaryPoints: true,
    boundaryPointLabels: false,
    controlPoints: true,
    controlPointLabels: true,
    urbanPoints: true,
    urbanPointLabels: true,
    refPoints: true,
    refPointLabels: true,
    fieldPoints: true,
    fieldPointLabels: true,
  });

  const [fieldPoints, setFieldPoints] = useState<FieldPoint[]>([]);
  const [csvSyncState, setCsvSyncState] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [addSectionModalOpen, setAddSectionModalOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('dataset');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [cogoFormState, setCogoFormState] = useState<CogoFormState>({
    moduleTab: 'radiation',
    angleMode: 'dms',
    radStation: { n: '', e: '' },
    radBsMode: 'point',
    radBsPoint: { n: '', e: '' },
    radBsAz: '',
    radHzAngle: '',
    radDist: '',
    intMode: 'dist',
    intPtA: { n: '', e: '' },
    intPtB: { n: '', e: '' },
    intAngleA: '',
    intAngleB: '',
    intDistA: '',
    intDistB: '',
    selectedDistSol: 0,
    resPtA: { n: '', e: '' },
    resPtB: { n: '', e: '' },
    resPtC: { n: '', e: '' },
    resAlpha: '',
    resBeta: '',
    bndStationId: '',
    bndStation: { n: '', e: '' },
    bndBacksightId: '',
    bndBacksight: { n: '', e: '' },
    bndLotNo: '',
    bndSelectedPtId: null,
    bndObsAngle: '',
    bndObsDist: '',
  });
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const bottomOcclusionPx = useMemo(() => {
    if (viewport.width >= 768) return 0;
    return mobileSheetOpen ? Math.round(viewport.height * 0.35) : 54;
  }, [viewport, mobileSheetOpen]);

  const [cursorCoord, setCursorCoord] = useState<{ n: number; e: number } | null>(null);
  const [gpsPosition, setGpsPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [gpsTracking, setGpsTracking] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (sidebarScrollRef.current) {
      sidebarScrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const [pickRequest, setPickRequest] = useState<MapPickRequest | null>(null);
  const [cogoPreview, setCogoPreview] = useState<CogoPreviewOverlay | null>(null);
  const [measureOverlay, setMeasureOverlay] = useState<MeasureOverlay | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    n: number;
    e: number;
    crs: CrsId;
    zoom?: number;
    ts: number;
  } | null>(null);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Load merged sections: static built-in demo + optional dev disk + browser-local IndexedDB + saved CRS prefs
  const refreshSectionsFromStorage = useCallback(async () => {
    const mergedMap = new Map<string, CadastralSection>();

    for (const sec of loadStaticSections()) {
      mergedMap.set(sec.code.toUpperCase(), sec);
    }

    try {
      const resp = await fetch('/api/sections/disk');
      if (resp.ok) {
        const data = (await resp.json()) as { bundles?: SectionDataBundle[] };
        if (Array.isArray(data.bundles)) {
          for (const b of data.bundles) {
            const sec = bundleToCadastralSection(b, 'demo');
            if (sec) mergedMap.set(sec.code.toUpperCase(), sec);
          }
        }
      }
    } catch {
      // Static/published deployment without backend disk API: ignore cleanly
    }

    const localBundles = await loadAllLocalSections();
    for (const b of localBundles) {
      const sec = bundleToCadastralSection(b, 'local');
      if (sec) mergedMap.set(sec.code.toUpperCase(), sec);
    }

    const crsPrefs = await loadSectionCrsMap();
    const nextSections = Array.from(mergedMap.values())
      .map((sec) => {
        const prefCrs = crsPrefs[sec.code.toUpperCase()];
        return prefCrs ? { ...sec, crs: prefCrs } : sec;
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    if (nextSections.length > 0) {
      setSections(nextSections);
      const savedCode = getSavedActiveSectionCode();
      setActiveSectionCode((prev) => {
        if (nextSections.some((s) => s.code === prev)) return prev;
        if (savedCode && nextSections.some((s) => s.code === savedCode)) return savedCode;
        return nextSections[0].code;
      });
    }
  }, []);

  useEffect(() => {
    void refreshSectionsFromStorage();
  }, [refreshSectionsFromStorage]);

  // Load per-section field points from tablet-local IndexedDB (seed once from /api/field-points if uninitialized)
  const loadFieldPointsForSection = useCallback(async (code: string, crs: CrsId) => {
    if (!code) return;
    setCsvSyncState('loading');
    try {
      const localPts = await loadLocalFieldPoints(code);
      if (localPts !== null) {
        setFieldPoints(localPts);
        setCsvSyncState('idle');
        return;
      }

      let seeded: FieldPoint[] = [];
      try {
        const resp = await fetch(
          `/api/field-points/${encodeURIComponent(code)}?crs=${encodeURIComponent(crs)}`
        );
        if (resp.ok) {
          const data = (await resp.json()) as { points?: FieldPoint[] };
          if (Array.isArray(data.points)) {
            seeded = data.points;
          }
        }
      } catch {
        // Offline or static hosting: initialize empty local store cleanly
      }

      await saveLocalFieldPoints(code, seeded);
      setFieldPoints(seeded);
      setCsvSyncState('idle');
    } catch {
      setFieldPoints([]);
      setCsvSyncState('idle');
    }
  }, []);

  useEffect(() => {
    if (activeSection?.code) {
      void loadFieldPointsForSection(activeSection.code, activeSection.crs);
    }
  }, [activeSection?.code, activeSection?.crs, loadFieldPointsForSection]);

  const persistFieldPointsLocal = useCallback(
    async (code: string, nextPoints: FieldPoint[]) => {
      setCsvSyncState('saving');
      try {
        await saveLocalFieldPoints(code, nextPoints);
        setCsvSyncState('idle');
      } catch {
        setCsvSyncState('error');
        showToast('本機儲存實測點失敗，請檢查瀏覽器儲存空間');
      }
    },
    [showToast]
  );

  const nextPointIdsByKind = useMemo<Record<FieldPointKind, string>>(() => {
    const defaults: Record<FieldPointKind, string> = {
      control: 'G0001',
      urban: 'U0001',
      ref: 'R0001',
      field: 'T0001',
    };
    const existingIds = new Set(fieldPoints.map((fp) => fp.id.trim().toUpperCase()));

    const nextForKind = (kind: FieldPointKind): string => {
      const latestOfKind = fieldPoints.find((fp) => (fp.pointKind ?? 'field') === kind);
      if (!latestOfKind) {
        let candidate = defaults[kind];
        const m = candidate.match(/^(.*?)(\d+)$/);
        if (m) {
          const [, prefix, digits] = m;
          let num = parseInt(digits, 10);
          while (existingIds.has(candidate.toUpperCase()) && num < 999999) {
            num += 1;
            candidate = `${prefix}${String(num).padStart(digits.length, '0')}`;
          }
        }
        return candidate;
      }

      const rawId = latestOfKind.id.trim();
      const match = rawId.match(/^(.*?)(\d+)$/);
      if (match) {
        const [, prefix, digits] = match;
        let num = parseInt(digits, 10) + 1;
        let candidate = `${prefix}${String(num).padStart(digits.length, '0')}`;
        let guard = 0;
        while (existingIds.has(candidate.toUpperCase()) && guard < 1000) {
          num += 1;
          guard += 1;
          candidate = `${prefix}${String(num).padStart(digits.length, '0')}`;
        }
        return candidate;
      }

      let num = 1;
      let candidate = `${rawId}0001`;
      let guard = 0;
      while (existingIds.has(candidate.toUpperCase()) && guard < 1000) {
        num += 1;
        guard += 1;
        candidate = `${rawId}${String(num).padStart(4, '0')}`;
      }
      return candidate;
    };

    return {
      control: nextForKind('control'),
      urban: nextForKind('urban'),
      ref: nextForKind('ref'),
      field: nextForKind('field'),
    };
  }, [fieldPoints]);

  const fieldPointCountsByKind = useMemo<Record<FieldPointKind, number>>(() => {
    const counts: Record<FieldPointKind, number> = {
      control: 0,
      urban: 0,
      ref: 0,
      field: 0,
    };
    for (const fp of fieldPoints) {
      counts[fp.pointKind ?? 'field'] += 1;
    }
    return counts;
  }, [fieldPoints]);

  const handleToggleLayer = (key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleEnsureBoundaryLayers = useCallback(() => {
    setLayers((prev) => {
      if (
        prev.parcels &&
        prev.parcelLabels &&
        prev.boundaryPoints &&
        prev.boundaryPointLabels
      ) {
        return prev;
      }
      return {
        ...prev,
        parcels: true,
        parcelLabels: true,
        boundaryPoints: true,
        boundaryPointLabels: true,
      };
    });
  }, []);

  const handleSelectSection = (code: string) => {
    setActiveSectionCode(code);
  };

  const handleChangeSectionCrs = (code: string, crs: CrsId) => {
    setSections((prev) => prev.map((s) => (s.code === code ? { ...s, crs } : s)));
    void saveSectionCrsPref(code, crs);
  };

  const handleSectionImported = (newSec: CadastralSection) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.code.toUpperCase() === newSec.code.toUpperCase());
      const next = [...prev];
      if (idx >= 0) {
        next[idx] = newSec;
      } else {
        next.push(newSec);
        next.sort((a, b) => a.code.localeCompare(b.code));
      }
      return next;
    });
    setActiveSectionCode(newSec.code);
    setFitBoundsTrigger((n) => n + 1);
    showToast(`已匯入「${newSec.label}」並儲存至本機`);
  };

  const handleDeleteLocalSection = async (code: string) => {
    await deleteLocalSection(code);
    await refreshSectionsFromStorage();
    showToast(`已從本機移除地段 ${code}`);
  };

  const handleAddFieldPoint = (pt: {
    id: string;
    note: string;
    n: number;
    e: number;
    source: FieldPointSource;
    pointKind?: FieldPointKind;
  }) => {
    const entry: FieldPoint = {
      uid: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      id: pt.id,
      note: pt.note,
      n: pt.n,
      e: pt.e,
      crs: displayCrs,
      source: pt.source,
      pointKind: pt.pointKind ?? 'field',
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...fieldPoints];
    setFieldPoints(next);
    setFocusTarget({ n: pt.n, e: pt.e, crs: displayCrs, ts: Date.now() });
    void persistFieldPointsLocal(activeSection.code, next);
  };

  const handleImportCsvPoints = (imported: FieldPoint[]) => {
    if (imported.length === 0) return;
    const next = [...imported, ...fieldPoints];
    setFieldPoints(next);
    const first = imported[0];
    setFocusTarget({ n: first.n, e: first.e, crs: first.crs, zoom: 19, ts: Date.now() });
    void persistFieldPointsLocal(activeSection.code, next);
    showToast(`已匯入 ${imported.length} 筆點位並儲存至本機`);
  };

  const handleDeleteFieldPoint = (uid: string) => {
    const next = fieldPoints.filter((p) => p.uid !== uid);
    setFieldPoints(next);
    void persistFieldPointsLocal(activeSection.code, next);
  };

  const handleClearFieldPoints = () => {
    setFieldPoints([]);
    void persistFieldPointsLocal(activeSection.code, []);
  };

  const handleJumpToParcel = (parcel: ParcelEntity) => {
    setFocusTarget({
      n: parcel.visualCenterN || parcel.labelN || parcel.centroidN,
      e: parcel.visualCenterE || parcel.labelE || parcel.centroidE,
      crs: activeSection.crs,
      zoom: 20,
      ts: Date.now(),
    });
  };

  const handleRequestPick = useCallback((req: MapPickRequest) => {
    const wrapped: MapPickRequest = {
      ...req,
      onPickPoint: req.onPickPoint
        ? (pt) => {
            setPickRequest(null);
            req.onPickPoint?.(pt);
            if (window.innerWidth < 768 && !req.keepMobileSheetOpen && !req.id.startsWith('poly-')) {
              setMobileSheetOpen(true);
            }
          }
        : undefined,
      onPickSegment: req.onPickSegment
        ? (seg) => {
            setPickRequest(null);
            req.onPickSegment?.(seg);
            if (window.innerWidth < 768 && !req.keepMobileSheetOpen) {
              setMobileSheetOpen(true);
            }
          }
        : undefined,
      onPickParcel: req.onPickParcel
        ? (parcel) => {
            setPickRequest(null);
            req.onPickParcel?.(parcel);
            if (window.innerWidth < 768 && !req.keepMobileSheetOpen) {
              setMobileSheetOpen(true);
            }
          }
        : undefined,
    };
    setPickRequest(wrapped);
    if (window.innerWidth < 768 && !req.keepMobileSheetOpen) {
      setMobileSheetOpen(false);
    }
  }, []);

  const handleCancelPick = useCallback(() => {
    setPickRequest(null);
  }, []);

  const handleFocusPoint = useCallback(
    (pt: { n: number; e: number; crs: CrsId; zoom?: number }) => {
      setFocusTarget({ ...pt, ts: Date.now() });
    },
    []
  );

  const handleToggleGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsError('此瀏覽器不支援 GPS 定位');
      showToast('此瀏覽器不支援 GPS 定位');
      return;
    }

    if (gpsTracking && gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
      setGpsTracking(false);
      setGpsPosition(null);
      return;
    }

    setGpsError(null);
    setGpsTracking(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGpsPosition({ lat: latitude, lng: longitude, accuracy });
        const tm = wgs84ToTm(latitude, longitude, displayCrs);
        setFocusTarget({ n: tm.n, e: tm.e, crs: displayCrs, zoom: 19, ts: Date.now() });
      },
      (err) => {
        setGpsError(err.message);
        setGpsTracking(false);
        showToast(`GPS 定位失敗：${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => {
        // Keep watching silently on transient watch errors
      },
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
  };

  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  const renderPanelContent = () => {
    switch (activeTab) {
      case 'dataset':
        return (
          <DatasetPanel
            sections={sections}
            activeSection={activeSection}
            onSelectSection={handleSelectSection}
            onChangeSectionCrs={handleChangeSectionCrs}
            onOpenAddSectionModal={() => setAddSectionModalOpen(true)}
            onRefreshSections={async () => {
              await refreshSectionsFromStorage();
              showToast('已重新載入本機與內建地段');
            }}
            onDeleteLocalSection={handleDeleteLocalSection}
            onJumpToParcel={handleJumpToParcel}
          />
        );
      case 'layers':
        return (
          <LayersPanel
            basemap={basemap}
            onChangeBasemap={setBasemap}
            layers={layers}
            onToggleLayer={handleToggleLayer}
            section={activeSection}
            fieldPointCountsByKind={fieldPointCountsByKind}
          />
        );
      case 'cogo':
        return (
          <CogoPanel
            section={activeSection}
            fieldPoints={fieldPoints}
            displayCrs={displayCrs}
            nextPointIdsByKind={nextPointIdsByKind}
            formState={cogoFormState}
            onChangeFormState={setCogoFormState}
            onRequestPick={handleRequestPick}
            onEnsureBoundaryLayers={handleEnsureBoundaryLayers}
            onFocusPoint={handleFocusPoint}
            onUpdatePreview={setCogoPreview}
            onSaveFieldPoint={handleAddFieldPoint}
          />
        );
      case 'points':
        return (
          <FieldPointsPanel
            sectionCode={activeSection.code}
            displayCrs={displayCrs}
            fieldPoints={fieldPoints}
            nextSuggestedId={nextPointIdsByKind.field}
            csvSyncState={csvSyncState}
            onAddPoint={handleAddFieldPoint}
            onImportCsvPoints={handleImportCsvPoints}
            onDeletePoint={handleDeleteFieldPoint}
            onClearAll={handleClearFieldPoints}
            onZoomToPoint={(pt) =>
              setFocusTarget({ n: pt.n, e: pt.e, crs: pt.crs, zoom: 20, ts: Date.now() })
            }
            onRequestPick={handleRequestPick}
          />
        );
      case 'measure':
        return (
          <MeasurePanel
            section={activeSection}
            activePickId={pickRequest?.id ?? null}
            onRequestPick={handleRequestPick}
            onCancelPick={handleCancelPick}
            onUpdateOverlay={setMeasureOverlay}
          />
        );
    }
  };

  return (
    <div
      data-mobile-sheet-open={mobileSheetOpen ? 'true' : 'false'}
      className="flex flex-col h-full w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
    >
      <div className="flex flex-1 min-h-0 relative">
        {/* Desktop Collapsible Sidebar (>= 768px) */}
        <aside
          className={`hidden md:flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shrink-0 transition-all duration-200 ${
            sidebarOpen ? 'w-[284px] lg:w-[296px]' : 'w-0 overflow-hidden border-r-0'
          }`}
        >
          {/* Sidebar Top Header */}
          <div className="flex items-center justify-between gap-2 px-3 h-11 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <h1 className="text-xs font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap truncate">
              數值地籍複丈圖台
            </h1>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                aria-label="切換深色或淺色主題"
                title={theme === 'light' ? '深色模式' : '日間模式'}
                className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {theme === 'light' ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="收合側邊欄"
                title="收合"
                className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 5 Function Navigation Tabs */}
          <nav
            aria-label="功能分頁"
            className="grid grid-cols-5 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/70 dark:bg-slate-900"
          >
            {SIDEBAR_TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 px-0.5 text-[10px] font-medium border-b-2 transition-colors ${
                    active
                      ? 'border-sky-700 dark:border-sky-400 text-sky-700 dark:text-sky-300 bg-white dark:bg-slate-900'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Active Panel Body (Desktop single instance) */}
          <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto p-3 panel-scroll">
            {viewport.width >= 768 ? renderPanelContent() : null}
          </div>
        </aside>

        {/* Map Viewport */}
        <main className="relative flex-1 min-w-0 h-full">
          <MapCanvas
            section={activeSection}
            displayCrs={displayCrs}
            basemap={basemap}
            layers={layers}
            fieldPoints={fieldPoints}
            gpsPosition={gpsPosition}
            pickRequest={pickRequest}
            cogoPreview={cogoPreview}
            measureOverlay={measureOverlay}
            focusTarget={focusTarget}
            fitBoundsTrigger={fitBoundsTrigger}
            bottomOcclusionPx={bottomOcclusionPx}
            onCursorMove={setCursorCoord}
            onCancelPick={handleCancelPick}
          />

          {/* Desktop Expand Sidebar Button (when collapsed) */}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="展開功能側邊欄"
              className="hidden md:flex items-center gap-1.5 absolute top-3 left-3 z-[900] h-9 px-2.5 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800"
            >
              <PanelLeftOpen className="w-4 h-4" />
              <span>工具列</span>
            </button>
          )}

          {/* Top-Left Mobile Compact Section Code Bubble */}
          <div className="md:hidden absolute top-3 left-3 z-[900] pointer-events-none">
            <div className="pointer-events-auto px-2.5 py-1 rounded-lg bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-sm text-xs font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
              {activeSection.code}
            </div>
          </div>

          {/* Top-Right Floating Quick Controls */}
          <div className="absolute top-3 right-3 z-[900] flex flex-col gap-1.5">
            <button
              type="button"
              onClick={handleToggleGps}
              title={gpsTracking ? '關閉 GPS' : 'GPS 定位'}
              aria-label="GPS 定位"
              className={`min-w-[44px] min-h-[44px] md:min-w-[36px] md:min-h-[36px] flex items-center justify-center rounded-lg backdrop-blur-md border shadow-md transition-colors ${
                gpsTracking
                  ? 'bg-sky-700 border-sky-600 text-white'
                  : 'bg-white/95 dark:bg-slate-900/95 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <LocateFixed className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setFitBoundsTrigger((n) => n + 1)}
              title="縮放全段"
              aria-label="縮放全段"
              className="min-w-[44px] min-h-[44px] md:min-w-[36px] md:min-h-[36px] flex items-center justify-center rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="切換主題"
              aria-label="切換主題"
              className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md text-slate-800 dark:text-slate-100"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>

          {/* Toast Feedback */}
          {(toastMsg || gpsError) && (
            <div
              className={`fixed md:absolute left-1/2 -translate-x-1/2 z-[1050] max-w-[88vw] transition-[bottom] duration-200 ${
                mobileSheetOpen ? 'bottom-[calc(35vh+12px)] md:bottom-4' : 'bottom-16 md:bottom-4'
              }`}
            >
              <div className="px-3.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 text-xs font-medium shadow-lg whitespace-nowrap truncate">
                {toastMsg ?? gpsError}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Desktop Bottom Status Bar */}
      <StatusBar
        displayCrs={displayCrs}
        cursorCoord={cursorCoord}
        gpsPosition={gpsPosition}
      />

      {/* Mobile Bottom 1/3 Drawer (< 768px) */}
      <MobileBottomSheet
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        open={mobileSheetOpen}
        onToggleOpen={setMobileSheetOpen}
      >
        {viewport.width < 768 ? renderPanelContent() : null}
      </MobileBottomSheet>

      {/* Add Section Modal */}
      <AddSectionModal
        open={addSectionModalOpen}
        existingSections={sections}
        onClose={() => setAddSectionModalOpen(false)}
        onSectionImported={handleSectionImported}
      />
    </div>
  );
}
