import type {
  BasemapId,
  CadastralSection,
  FieldPointKind,
  LayerVisibility,
} from '../types/cadastral';

interface LayersPanelProps {
  basemap: BasemapId;
  onChangeBasemap: (b: BasemapId) => void;
  layers: LayerVisibility;
  onToggleLayer: (key: keyof LayerVisibility) => void;
  section: CadastralSection;
  fieldPointCountsByKind: Record<FieldPointKind, number>;
}

const BASEMAPS: { id: BasemapId; title: string }[] = [
  { id: 'emap', title: '電子地圖' },
  { id: 'photo2', title: '正射影像' },
  { id: 'hybrid', title: '混和圖' },
  { id: 'osm', title: 'OSM' },
];

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  dimmed?: boolean;
}

function ToggleSwitch({ checked, onChange, ariaLabel, dimmed = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-1 ${
        checked ? 'bg-sky-700 dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'
      } ${dimmed ? 'opacity-45' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
          checked ? 'translate-x-[15px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export function LayersPanel({
  basemap,
  onChangeBasemap,
  layers,
  onToggleLayer,
  section,
  fieldPointCountsByKind,
}: LayersPanelProps) {
  const vectorItems: {
    key: keyof LayerVisibility;
    labelKey: keyof LayerVisibility;
    label: string;
    count: number;
    addedCount: number;
    addedClass?: string;
    symbol: 'polygon' | 'circle' | 'triangle' | 'square' | 'diamond' | 'star';
  }[] = [
    {
      key: 'parcels',
      labelKey: 'parcelLabels',
      label: '地籍線',
      count: section.parcels.length,
      addedCount: 0,
      symbol: 'polygon',
    },
    {
      key: 'boundaryPoints',
      labelKey: 'boundaryPointLabels',
      label: '界址點',
      count: Object.keys(section.boundaryPoints).length,
      addedCount: 0,
      symbol: 'circle',
    },
    {
      key: 'controlPoints',
      labelKey: 'controlPointLabels',
      label: '圖根點',
      count: section.controlPoints.length,
      addedCount: fieldPointCountsByKind.control,
      addedClass: 'text-emerald-600 dark:text-emerald-400',
      symbol: 'triangle',
    },
    {
      key: 'urbanPoints',
      labelKey: 'urbanPointLabels',
      label: '都計樁',
      count: section.urbanPoints.length,
      addedCount: fieldPointCountsByKind.urban,
      addedClass: 'text-indigo-600 dark:text-indigo-400',
      symbol: 'square',
    },
    {
      key: 'refPoints',
      labelKey: 'refPointLabels',
      label: '參考點',
      count: Object.keys(section.refPoints).length,
      addedCount: fieldPointCountsByKind.ref,
      addedClass: 'text-sky-600 dark:text-sky-400',
      symbol: 'diamond',
    },
    {
      key: 'fieldPoints',
      labelKey: 'fieldPointLabels',
      label: '實測點',
      count: fieldPointCountsByKind.field,
      addedCount: 0,
      symbol: 'star',
    },
  ];

  const renderSymbol = (sym: (typeof vectorItems)[number]['symbol']) => {
    switch (sym) {
      case 'polygon':
        return <span className="inline-block w-3 h-3 border-2 border-red-600 bg-red-500/15" />;
      case 'circle':
        return (
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-600 border border-white ring-1 ring-red-600" />
        );
      case 'triangle':
        return (
          <svg width="13" height="13" viewBox="0 0 18 18" className="shrink-0">
            <polygon
              points="9,2 16,15 2,15"
              fill="#10B981"
              fillOpacity="0.25"
              stroke="#047857"
              strokeWidth="2"
            />
          </svg>
        );
      case 'square':
        return (
          <span className="inline-block w-2.5 h-2.5 border-2 border-indigo-700 bg-indigo-500/20" />
        );
      case 'diamond':
        return (
          <span className="inline-block w-2.5 h-2.5 rotate-45 border-2 border-sky-700 bg-sky-500/25" />
        );
      case 'star':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0">
            <path
              d="M12 2.2L14.85 8.2L21.45 9.1L16.65 13.7L17.82 20.25L12 17.12L6.18 20.25L7.35 13.7L2.55 9.1L9.15 8.2L12 2.2Z"
              fill="#EA580C"
            />
          </svg>
        );
    }
  };

  return (
    <div className="space-y-3.5">
      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">底圖</div>
        <div className="grid grid-cols-4 gap-1">
          {BASEMAPS.map((bm) => {
            const active = basemap === bm.id;
            return (
              <button
                key={bm.id}
                type="button"
                onClick={() => onChangeBasemap(bm.id)}
                className={`min-h-[36px] px-1 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap flex items-center justify-center ${
                  active
                    ? 'bg-sky-700 border-sky-700 text-white'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {bm.title}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">圖層</div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-200 dark:divide-slate-800">
          <div className="grid grid-cols-[1fr_44px_44px] items-center px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            <span>圖層名稱</span>
            <span className="text-center whitespace-nowrap">顯示</span>
            <span className="text-center whitespace-nowrap">點號</span>
          </div>
          {vectorItems.map((item) => (
            <div
              key={item.key}
              className="grid grid-cols-[1fr_44px_44px] items-center px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0 pr-1">
                <span className="w-4 flex items-center justify-center shrink-0">
                  {renderSymbol(item.symbol)}
                </span>
                <span className="text-xs text-slate-800 dark:text-slate-200 truncate">
                  {item.label}
                </span>
                <span className="text-[11px] font-mono-tabular text-slate-400 dark:text-slate-500 shrink-0 whitespace-nowrap">
                  {item.count}
                  {item.addedCount > 0 ? (
                    <span className={item.addedClass}>(+{item.addedCount})</span>
                  ) : null}
                </span>
              </div>
              <div className="flex items-center justify-center">
                <ToggleSwitch
                  checked={layers[item.key]}
                  onChange={() => onToggleLayer(item.key)}
                  ariaLabel={`切換${item.label}圖層顯示`}
                />
              </div>
              <div className="flex items-center justify-center">
                {item.labelKey ? (
                  <ToggleSwitch
                    checked={layers[item.labelKey]}
                    onChange={() => onToggleLayer(item.labelKey!)}
                    ariaLabel={`切換${item.label}顯示點號`}
                    dimmed={!layers[item.key]}
                  />
                ) : (
                  <span className="text-[11px] text-slate-300 dark:text-slate-600 select-none">
                    —
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
