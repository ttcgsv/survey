import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type {
  BasemapId,
  CadastralSection,
  CogoPreviewOverlay,
  CrsId,
  FieldPoint,
  FieldPointKind,
  LayerVisibility,
  MapPickRequest,
  MeasureOverlay,
} from '../types/cadastral';
import { getMarkerLabel } from '../utils/cadastralParser';
import { isPointInPolygon } from '../utils/cogo';
import { buildGoogleMapsNavUrl, convertTm, tmToWgs84, wgs84ToTm } from '../utils/proj';

interface MapCanvasProps {
  section: CadastralSection;
  displayCrs: CrsId;
  basemap: BasemapId;
  layers: LayerVisibility;
  fieldPoints: FieldPoint[];
  gpsPosition: { lat: number; lng: number; accuracy: number } | null;
  pickRequest: MapPickRequest | null;
  cogoPreview: CogoPreviewOverlay | null;
  measureOverlay: MeasureOverlay | null;
  focusTarget: { n: number; e: number; crs: CrsId; zoom?: number; ts: number } | null;
  fitBoundsTrigger: number;
  bottomOcclusionPx: number;
  onCursorMove: (coord: { n: number; e: number } | null) => void;
  onCancelPick?: () => void;
}

function createSvgIcon(svg: string, size: [number, number], anchor: [number, number]) {
  return L.divIcon({
    html: svg,
    className: 'bg-transparent border-0',
    iconSize: size,
    iconAnchor: anchor,
  });
}

const CONTROL_ICON = createSvgIcon(
  `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="9,2 16,15 2,15" fill="#10B981" fill-opacity="0.25" stroke="#047857" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="9" cy="11" r="1.5" fill="#047857"/>
  </svg>`,
  [18, 18],
  [9, 11]
);

const URBAN_ICON = createSvgIcon(
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="12" height="12" rx="1.5" fill="#6366F1" fill-opacity="0.22" stroke="#4338CA" stroke-width="2"/>
    <circle cx="8" cy="8" r="1.8" fill="#4338CA"/>
  </svg>`,
  [16, 16],
  [8, 8]
);

const REF_ICON = createSvgIcon(
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" fill="#0EA5E9" fill-opacity="0.25" stroke="#0369A1" stroke-width="2"/>
    <circle cx="8" cy="8" r="1.4" fill="#0369A1"/>
  </svg>`,
  [16, 16],
  [8, 8]
);

const FIELD_STAR_ICON = createSvgIcon(
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2.2L14.85 8.2L21.45 9.1L16.65 13.7L17.82 20.25L12 17.12L6.18 20.25L7.35 13.7L2.55 9.1L9.15 8.2L12 2.2Z" fill="#EA580C" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  [24, 24],
  [12, 12]
);

const FIELD_KIND_STYLE: Record<
  FieldPointKind,
  {
    titlePrefix: string;
    icon: L.DivIcon;
    tooltipOffset: [number, number];
    labelClass: string;
    layerKey: keyof LayerVisibility;
    labelKey: keyof LayerVisibility;
  }
> = {
  control: {
    titlePrefix: '圖根點',
    icon: CONTROL_ICON,
    tooltipOffset: [0, -10],
    labelClass: 'leaflet-point-label leaflet-label-control',
    layerKey: 'controlPoints',
    labelKey: 'controlPointLabels',
  },
  urban: {
    titlePrefix: '都計樁',
    icon: URBAN_ICON,
    tooltipOffset: [0, -8],
    labelClass: 'leaflet-point-label leaflet-label-urban',
    layerKey: 'urbanPoints',
    labelKey: 'urbanPointLabels',
  },
  ref: {
    titlePrefix: '參考點',
    icon: REF_ICON,
    tooltipOffset: [0, -8],
    labelClass: 'leaflet-point-label leaflet-label-ref',
    layerKey: 'refPoints',
    labelKey: 'refPointLabels',
  },
  field: {
    titlePrefix: '實測點',
    icon: FIELD_STAR_ICON,
    tooltipOffset: [0, -12],
    labelClass: 'leaflet-point-label leaflet-label-field',
    layerKey: 'fieldPoints',
    labelKey: 'fieldPointLabels',
  },
};

function buildPopupHtml(opts: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string }[];
  navUrl: string;
}) {
  const rowsHtml = opts.rows
    .map(
      (r) => `
      <div class="flex items-baseline justify-between gap-3 py-1 border-b border-slate-100 dark:border-slate-700/70 last:border-b-0">
        <span class="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">${r.label}</span>
        <span class="text-xs font-medium font-mono-tabular text-slate-900 dark:text-slate-100 text-right">${r.value}</span>
      </div>`
    )
    .join('');

  return `
    <div class="p-2.5 min-w-[216px]">
      <div class="mb-1.5">
        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">${opts.title}</div>
        ${opts.subtitle ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${opts.subtitle}</div>` : ''}
      </div>
      <div class="mb-2.5">${rowsHtml}</div>
      <a
        href="${opts.navUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium transition-colors no-underline"
      >
        <span>Google Maps 導航</span>
      </a>
    </div>
  `;
}

function buildPlanarCircleLatLngs(
  centerN: number,
  centerE: number,
  radius: number,
  crs: CrsId
): [number, number][] {
  const pts: [number, number][] = [];
  for (let deg = 0; deg <= 360; deg += 6) {
    const rad = (deg * Math.PI) / 180;
    const n = centerN + radius * Math.cos(rad);
    const e = centerE + radius * Math.sin(rad);
    pts.push(tmToWgs84(n, e, crs));
  }
  return pts;
}

export function MapCanvas({
  section,
  displayCrs,
  basemap,
  layers,
  fieldPoints,
  gpsPosition,
  pickRequest,
  cogoPreview,
  measureOverlay,
  focusTarget,
  fitBoundsTrigger,
  bottomOcclusionPx,
  onCursorMove,
  onCancelPick,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const basemapLayerRef = useRef<L.Layer | null>(null);

  const parcelGroupRef = useRef<L.LayerGroup | null>(null);
  const labelGroupRef = useRef<L.LayerGroup | null>(null);
  const boundaryGroupRef = useRef<L.LayerGroup | null>(null);
  const controlGroupRef = useRef<L.LayerGroup | null>(null);
  const urbanGroupRef = useRef<L.LayerGroup | null>(null);
  const refGroupRef = useRef<L.LayerGroup | null>(null);
  const fieldGroupRef = useRef<L.LayerGroup | null>(null);
  const gpsGroupRef = useRef<L.LayerGroup | null>(null);
  const cogoGroupRef = useRef<L.LayerGroup | null>(null);
  const measureGroupRef = useRef<L.LayerGroup | null>(null);

  const pickRequestRef = useRef<MapPickRequest | null>(pickRequest);
  pickRequestRef.current = pickRequest;
  const displayCrsRef = useRef<CrsId>(displayCrs);
  displayCrsRef.current = displayCrs;
  const sectionRef = useRef<CadastralSection>(section);
  sectionRef.current = section;
  const layersRef = useRef<LayerVisibility>(layers);
  layersRef.current = layers;
  const fieldPointsRef = useRef<FieldPoint[]>(fieldPoints);
  fieldPointsRef.current = fieldPoints;
  const onCursorMoveRef = useRef(onCursorMove);
  onCursorMoveRef.current = onCursorMove;
  const bottomOcclusionRef = useRef<number>(bottomOcclusionPx);
  bottomOcclusionRef.current = bottomOcclusionPx;
  const prevOcclusionRef = useRef<number>(bottomOcclusionPx);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [22.755, 121.148],
      zoom: 18,
      maxZoom: 22,
      minZoom: 7,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

    parcelGroupRef.current = L.layerGroup().addTo(map);
    labelGroupRef.current = L.layerGroup().addTo(map);
    boundaryGroupRef.current = L.layerGroup().addTo(map);
    refGroupRef.current = L.layerGroup().addTo(map);
    controlGroupRef.current = L.layerGroup().addTo(map);
    urbanGroupRef.current = L.layerGroup().addTo(map);
    fieldGroupRef.current = L.layerGroup().addTo(map);
    cogoGroupRef.current = L.layerGroup().addTo(map);
    measureGroupRef.current = L.layerGroup().addTo(map);
    gpsGroupRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (ev: L.LeafletMouseEvent) => {
      const tm = wgs84ToTm(ev.latlng.lat, ev.latlng.lng, displayCrsRef.current);
      onCursorMoveRef.current(tm);
    });

    map.on('mouseout', () => {
      onCursorMoveRef.current(null);
    });

    map.on('click', (ev: L.LeafletMouseEvent) => {
      const req = pickRequestRef.current;
      if (!req) return;

      const clickPt = map.latLngToContainerPoint(ev.latlng);
      const curSection = sectionRef.current;
      const curCrs = displayCrsRef.current;

      if (req.mode === 'point' && req.onPickPoint) {
        let bestDistPx = 22;
        let snapped: { n: number; e: number; pointId?: string; pointKind?: string } | null = null;

        const checkCandidate = (
          nRaw: number,
          eRaw: number,
          srcCrs: CrsId,
          id: string,
          kind: string
        ) => {
          if (!Number.isFinite(nRaw) || !Number.isFinite(eRaw)) return;
          const [lat, lng] = tmToWgs84(nRaw, eRaw, srcCrs);
          const px = map.latLngToContainerPoint([lat, lng]);
          const d = Math.hypot(px.x - clickPt.x, px.y - clickPt.y);
          if (d < bestDistPx) {
            bestDistPx = d;
            const converted = convertTm(nRaw, eRaw, srcCrs, curCrs);
            snapped = {
              n: converted.n,
              e: converted.e,
              pointId: id,
              pointKind: kind,
            };
          }
        };

        const curLayers = layersRef.current;

        for (const fp of fieldPointsRef.current) {
          const style = FIELD_KIND_STYLE[fp.pointKind ?? 'field'];
          if (!curLayers[style.layerKey]) continue;
          checkCandidate(fp.n, fp.e, fp.crs, fp.id, style.titlePrefix);
        }
        if (curLayers.controlPoints) {
          for (const cp of curSection.controlPoints) {
            checkCandidate(cp.n, cp.e, curSection.crs, cp.id, '圖根點');
          }
        }
        if (curLayers.urbanPoints) {
          for (const up of curSection.urbanPoints) {
            checkCandidate(up.n, up.e, curSection.crs, up.id, '都計樁');
          }
        }
        if (curLayers.refPoints) {
          for (const rp of Object.values(curSection.refPoints)) {
            checkCandidate(rp.n, rp.e, curSection.crs, rp.id, '參考點');
          }
        }
        if (curLayers.boundaryPoints) {
          for (const bp of Object.values(curSection.boundaryPoints)) {
            checkCandidate(bp.n, bp.e, curSection.crs, bp.id, '界址點');
          }
        }

        if (snapped) {
          req.onPickPoint(snapped);
        } else {
          const tm = wgs84ToTm(ev.latlng.lat, ev.latlng.lng, curCrs);
          req.onPickPoint({ n: tm.n, e: tm.e });
        }
      } else if (req.mode === 'segment' && req.onPickSegment) {
        let bestDistPx = 22;
        let bestSeg: {
          a: { n: number; e: number; id?: string };
          b: { n: number; e: number; id?: string };
          lotNo?: string;
        } | null = null;

        for (const parcel of curSection.parcels) {
          const verts = parcel.vertices;
          if (verts.length < 2) continue;
          for (let i = 0; i < verts.length; i++) {
            const va = verts[i];
            const vb = verts[(i + 1) % verts.length];
            const [latA, lngA] = tmToWgs84(va.n, va.e, curSection.crs);
            const [latB, lngB] = tmToWgs84(vb.n, vb.e, curSection.crs);
            const pA = map.latLngToContainerPoint([latA, lngA]);
            const pB = map.latLngToContainerPoint([latB, lngB]);

            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < 1) continue;
            const t = Math.max(
              0,
              Math.min(1, ((clickPt.x - pA.x) * dx + (clickPt.y - pA.y) * dy) / lenSq)
            );
            const projX = pA.x + t * dx;
            const projY = pA.y + t * dy;
            const d = Math.hypot(clickPt.x - projX, clickPt.y - projY);
            if (d < bestDistPx) {
              bestDistPx = d;
              const convA = convertTm(va.n, va.e, curSection.crs, curCrs);
              const convB = convertTm(vb.n, vb.e, curSection.crs, curCrs);
              bestSeg = {
                a: { n: convA.n, e: convA.e, id: va.id },
                b: { n: convB.n, e: convB.e, id: vb.id },
                lotNo: parcel.lotNo,
              };
            }
          }
        }

        if (bestSeg) {
          req.onPickSegment(bestSeg);
        }
      } else if (req.mode === 'parcel' && req.onPickParcel) {
        const tm = wgs84ToTm(ev.latlng.lat, ev.latlng.lng, curSection.crs);
        let pickedLotNo: string | null = null;

        for (const parcel of curSection.parcels) {
          if (isPointInPolygon(tm.n, tm.e, parcel.vertices)) {
            pickedLotNo = parcel.lotNo;
            break;
          }
        }

        // Fallback if user tapped right on a boundary edge
        if (!pickedLotNo) {
          let bestDistPx = 14;
          for (const parcel of curSection.parcels) {
            const verts = parcel.vertices;
            if (verts.length < 2) continue;
            for (let i = 0; i < verts.length; i++) {
              const va = verts[i];
              const vb = verts[(i + 1) % verts.length];
              const [latA, lngA] = tmToWgs84(va.n, va.e, curSection.crs);
              const [latB, lngB] = tmToWgs84(vb.n, vb.e, curSection.crs);
              const pA = map.latLngToContainerPoint([latA, lngA]);
              const pB = map.latLngToContainerPoint([latB, lngB]);
              const dx = pB.x - pA.x;
              const dy = pB.y - pA.y;
              const lenSq = dx * dx + dy * dy;
              if (lenSq < 1) continue;
              const t = Math.max(
                0,
                Math.min(1, ((clickPt.x - pA.x) * dx + (clickPt.y - pA.y) * dy) / lenSq)
              );
              const d = Math.hypot(clickPt.x - (pA.x + t * dx), clickPt.y - (pA.y + t * dy));
              if (d < bestDistPx) {
                bestDistPx = d;
                pickedLotNo = parcel.lotNo;
              }
            }
          }
        }

        if (pickedLotNo) {
          req.onPickParcel({ lotNo: pickedLotNo });
        }
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Toggle Leaflet crosshair cursor safely without overwriting Leaflet container classes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (pickRequest) {
      map.closePopup();
      L.DomUtil.addClass(container, 'leaflet-crosshair');
    } else {
      L.DomUtil.removeClass(container, 'leaflet-crosshair');
    }
  }, [pickRequest]);

  // Dynamically pan map center when bottom sheet opens/closes on mobile so visual center tracks visible area
  useEffect(() => {
    const map = mapRef.current;
    const prev = prevOcclusionRef.current;
    prevOcclusionRef.current = bottomOcclusionPx;
    if (!map) return;
    const delta = bottomOcclusionPx - prev;
    if (Math.abs(delta) > 4) {
      map.panBy([0, delta / 2], { animate: true, duration: 0.22 });
    }
  }, [bottomOcclusionPx]);

  // Switch Basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
      basemapLayerRef.current = null;
    }

    let nextLayer: L.Layer;
    if (basemap === 'emap') {
      nextLayer = L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
        { maxZoom: 22, maxNativeZoom: 19, crossOrigin: true }
      );
    } else if (basemap === 'photo2') {
      nextLayer = L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
        { maxZoom: 22, maxNativeZoom: 19, crossOrigin: true }
      );
    } else if (basemap === 'hybrid') {
      const photo = L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
        { maxZoom: 22, maxNativeZoom: 19, crossOrigin: true }
      );
      const overlay = L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/EMAP2/default/GoogleMapsCompatible/{z}/{y}/{x}',
        { maxZoom: 22, maxNativeZoom: 19, crossOrigin: true }
      );
      nextLayer = L.layerGroup([photo, overlay]);
    } else {
      nextLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 22,
        maxNativeZoom: 19,
        crossOrigin: true,
      });
    }

    nextLayer.addTo(map);
    if ('bringToBack' in nextLayer && typeof nextLayer.bringToBack === 'function') {
      nextLayer.bringToBack();
    } else if (nextLayer instanceof L.LayerGroup) {
      nextLayer.eachLayer((l) => {
        if ('bringToBack' in l && typeof (l as L.TileLayer).bringToBack === 'function') {
          (l as L.TileLayer).bringToBack();
        }
      });
    }
    basemapLayerRef.current = nextLayer;
  }, [basemap]);

  // Fit bounds on section change or trigger with bottom occlusion compensation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const coords: [number, number][] = [];
    for (const p of section.parcels) {
      for (const v of p.vertices) {
        coords.push(tmToWgs84(v.n, v.e, section.crs));
      }
    }
    if (coords.length === 0) {
      for (const bp of Object.values(section.boundaryPoints)) {
        coords.push(tmToWgs84(bp.n, bp.e, section.crs));
      }
      for (const cp of section.controlPoints) {
        coords.push(tmToWgs84(cp.n, cp.e, section.crs));
      }
    }

    if (coords.length > 0) {
      const bounds = L.latLngBounds(coords);
      const occ = bottomOcclusionRef.current;
      map.fitBounds(bounds, {
        paddingTopLeft: [24, 52],
        paddingBottomRight: [24, occ + 24],
        maxZoom: 20,
      });
    }
  }, [section.code, section.crs, fitBoundsTrigger]);

  // Focus target coordinate centered in the unoccluded top viewport
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTarget) return;
    const [lat, lng] = tmToWgs84(focusTarget.n, focusTarget.e, focusTarget.crs);
    const targetZoom = focusTarget.zoom ?? Math.max(map.getZoom(), 19);
    const occ = bottomOcclusionRef.current;

    if (occ > 0) {
      const projected = map.project([lat, lng], targetZoom);
      const shiftedCenter = map.unproject(
        L.point(projected.x, projected.y + occ / 2),
        targetZoom
      );
      map.setView(shiftedCenter, targetZoom, { animate: true });
    } else {
      map.setView([lat, lng], targetZoom, { animate: true });
    }
  }, [focusTarget]);

  // Render Cadastral Vectors
  useEffect(() => {
    const parcelGroup = parcelGroupRef.current;
    const labelGroup = labelGroupRef.current;
    const boundaryGroup = boundaryGroupRef.current;
    const controlGroup = controlGroupRef.current;
    const urbanGroup = urbanGroupRef.current;
    const refGroup = refGroupRef.current;

    if (!parcelGroup || !labelGroup || !boundaryGroup || !controlGroup || !urbanGroup || !refGroup) {
      return;
    }

    parcelGroup.clearLayers();
    labelGroup.clearLayers();
    boundaryGroup.clearLayers();
    controlGroup.clearLayers();
    urbanGroup.clearLayers();
    refGroup.clearLayers();

    const isPicking = Boolean(pickRequest);
    const strokeColor = basemap === 'photo2' || basemap === 'hybrid' ? '#FDE047' : '#DC2626';
    const fillColor = basemap === 'photo2' || basemap === 'hybrid' ? '#FACC15' : '#EF4444';

    // 1. Parcels
    if (layers.parcels) {
      for (const parcel of section.parcels) {
        if (parcel.vertices.length < 3) continue;
        const latLngs = parcel.vertices.map((v) => tmToWgs84(v.n, v.e, section.crs));
        const poly = L.polygon(latLngs, {
          color: strokeColor,
          weight: 2.2,
          fillColor,
          fillOpacity: 0.1,
          interactive: !isPicking,
        });

        const anchorN = parcel.visualCenterN || parcel.labelN || parcel.centroidN;
        const anchorE = parcel.visualCenterE || parcel.labelE || parcel.centroidE;
        const dispLabel = convertTm(anchorN, anchorE, section.crs, displayCrs);
        const areaDiff = parcel.computedArea - parcel.regArea;
        const ping = parcel.computedArea * 0.3025;

        poly.bindPopup(
          buildPopupHtml({
            title: `地號 ${parcel.lotNo}`,
            subtitle: section.code,
            rows: [
              { label: '登記面積', value: `${parcel.regArea.toFixed(2)} m²` },
              {
                label: '計算面積',
                value: `${parcel.computedArea.toFixed(2)} m² (${ping.toFixed(2)} 坪)`,
              },
              {
                label: '較差',
                value: `${areaDiff >= 0 ? '+' : ''}${areaDiff.toFixed(2)} m²`,
              },
              {
                label: 'N / E',
                value: `${dispLabel.n.toFixed(2)}, ${dispLabel.e.toFixed(2)}`,
              },
            ],
            navUrl: buildGoogleMapsNavUrl(anchorN, anchorE, section.crs),
          })
        );
        poly.addTo(parcelGroup);
      }
    }

    // 1B. Parcel Lot Number Labels (linked to 地籍線 visibility, centered inside polygon via auto-width tooltip)
    if (layers.parcels && layers.parcelLabels) {
      for (const parcel of section.parcels) {
        if (parcel.vertices.length < 3) continue;
        const anchorN = parcel.visualCenterN || parcel.labelN || parcel.centroidN;
        const anchorE = parcel.visualCenterE || parcel.labelE || parcel.centroidE;
        const [lLat, lLng] = tmToWgs84(anchorN, anchorE, section.crs);
        const labelAnchor = L.circleMarker([lLat, lLng], {
          radius: 0,
          weight: 0,
          opacity: 0,
          fillOpacity: 0,
          interactive: false,
        });
        labelAnchor.bindTooltip(parcel.lotNo, {
          permanent: true,
          direction: 'center',
          opacity: 1,
          className: 'leaflet-point-label leaflet-parcel-lot-label',
        });
        labelAnchor.addTo(labelGroup);
      }
    }

    // 2. Boundary Points (.COA)
    if (layers.boundaryPoints) {
      for (const bp of Object.values(section.boundaryPoints)) {
        const [lat, lng] = tmToWgs84(bp.n, bp.e, section.crs);
        const disp = convertTm(bp.n, bp.e, section.crs, displayCrs);
        const circle = L.circleMarker([lat, lng], {
          radius: 4.5,
          color: '#FFFFFF',
          weight: 1.5,
          fillColor: '#DC2626',
          fillOpacity: 1,
          interactive: !isPicking,
        });
        circle.bindTooltip(bp.id, {
          permanent: layers.boundaryPointLabels,
          direction: 'top',
          offset: [0, -5],
          className: layers.boundaryPointLabels
            ? 'leaflet-point-label leaflet-label-boundary'
            : 'text-[10px] font-mono-tabular px-1 py-0.5',
        });
        circle.bindPopup(
          buildPopupHtml({
            title: `界址點 ${bp.id}`,
            subtitle: getMarkerLabel(bp.markerCode),
            rows: [
              { label: 'N', value: `${disp.n.toFixed(3)} m` },
              { label: 'E', value: `${disp.e.toFixed(3)} m` },
            ],
            navUrl: buildGoogleMapsNavUrl(bp.n, bp.e, section.crs),
          })
        );
        circle.addTo(boundaryGroup);
      }
    }

    // 3. Reference Points (.RCO)
    if (layers.refPoints) {
      for (const rp of Object.values(section.refPoints)) {
        const [lat, lng] = tmToWgs84(rp.n, rp.e, section.crs);
        const disp = convertTm(rp.n, rp.e, section.crs, displayCrs);
        const marker = L.marker([lat, lng], {
          icon: REF_ICON,
          interactive: !isPicking,
        });
        marker.bindTooltip(layers.refPointLabels ? rp.id : `參考 ${rp.id}`, {
          permanent: layers.refPointLabels,
          direction: 'top',
          offset: [0, -8],
          className: layers.refPointLabels ? 'leaflet-point-label leaflet-label-ref' : undefined,
        });
        marker.bindPopup(
          buildPopupHtml({
            title: `參考點 ${rp.id}`,
            subtitle: getMarkerLabel(rp.markerCode),
            rows: [
              { label: 'N', value: `${disp.n.toFixed(3)} m` },
              { label: 'E', value: `${disp.e.toFixed(3)} m` },
            ],
            navUrl: buildGoogleMapsNavUrl(rp.n, rp.e, section.crs),
          })
        );
        marker.addTo(refGroup);
      }
    }

    // 4. Control Points (.CTL)
    if (layers.controlPoints) {
      for (const cp of section.controlPoints) {
        const [lat, lng] = tmToWgs84(cp.n, cp.e, section.crs);
        const disp = convertTm(cp.n, cp.e, section.crs, displayCrs);
        const marker = L.marker([lat, lng], {
          icon: CONTROL_ICON,
          interactive: !isPicking,
        });
        marker.bindTooltip(cp.id, {
          permanent: layers.controlPointLabels,
          direction: 'top',
          offset: [0, -10],
          className: layers.controlPointLabels
            ? 'leaflet-point-label leaflet-label-control'
            : undefined,
        });
        marker.bindPopup(
          buildPopupHtml({
            title: `圖根點 ${cp.id}`,
            rows: [
              { label: 'N', value: `${disp.n.toFixed(3)} m` },
              { label: 'E', value: `${disp.e.toFixed(3)} m` },
            ],
            navUrl: buildGoogleMapsNavUrl(cp.n, cp.e, section.crs),
          })
        );
        marker.addTo(controlGroup);
      }
    }

    // 5. Urban Plan Points (.UPN)
    if (layers.urbanPoints) {
      for (const up of section.urbanPoints) {
        const [lat, lng] = tmToWgs84(up.n, up.e, section.crs);
        const disp = convertTm(up.n, up.e, section.crs, displayCrs);
        const marker = L.marker([lat, lng], {
          icon: URBAN_ICON,
          interactive: !isPicking,
        });
        marker.bindTooltip(up.id, {
          permanent: layers.urbanPointLabels,
          direction: 'top',
          offset: [0, -8],
          className: layers.urbanPointLabels ? 'leaflet-point-label leaflet-label-urban' : undefined,
        });
        marker.bindPopup(
          buildPopupHtml({
            title: `都計樁 ${up.id}`,
            rows: [
              { label: 'N', value: `${disp.n.toFixed(3)} m` },
              { label: 'E', value: `${disp.e.toFixed(3)} m` },
            ],
            navUrl: buildGoogleMapsNavUrl(up.n, up.e, section.crs),
          })
        );
        marker.addTo(urbanGroup);
      }
    }
  }, [section, layers, basemap, displayCrs, pickRequest]);

  // Render Field Points (controlled by each pointKind's layer visibility and label switches)
  useEffect(() => {
    const fieldGroup = fieldGroupRef.current;
    if (!fieldGroup) return;
    fieldGroup.clearLayers();

    const isPicking = Boolean(pickRequest);

    for (const fp of fieldPoints) {
      const style = FIELD_KIND_STYLE[fp.pointKind ?? 'field'];
      if (!layers[style.layerKey]) continue;

      const showLabel = layers[style.labelKey];
      const [lat, lng] = tmToWgs84(fp.n, fp.e, fp.crs);
      const disp = convertTm(fp.n, fp.e, fp.crs, displayCrs);
      const marker = L.marker([lat, lng], {
        icon: style.icon,
        interactive: !isPicking,
        zIndexOffset: 300,
      });
      marker.bindTooltip(fp.id, {
        permanent: showLabel,
        direction: 'top',
        offset: style.tooltipOffset,
        className: showLabel ? style.labelClass : undefined,
      });
      marker.bindPopup(
        buildPopupHtml({
          title: `${style.titlePrefix} ${fp.id}`,
          subtitle: fp.note || undefined,
          rows: [
            { label: 'N', value: `${disp.n.toFixed(3)} m` },
            { label: 'E', value: `${disp.e.toFixed(3)} m` },
          ],
          navUrl: buildGoogleMapsNavUrl(fp.n, fp.e, fp.crs),
        })
      );
      marker.addTo(fieldGroup);
    }
  }, [fieldPoints, layers, displayCrs, pickRequest]);

  // Render GPS Location Marker
  useEffect(() => {
    const gpsGroup = gpsGroupRef.current;
    if (!gpsGroup) return;
    gpsGroup.clearLayers();
    if (!gpsPosition) return;

    const { lat, lng, accuracy } = gpsPosition;
    L.circle([lat, lng], {
      radius: Math.min(accuracy, 200),
      color: '#0284C7',
      weight: 1,
      fillColor: '#38BDF8',
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(gpsGroup);

    L.circleMarker([lat, lng], {
      radius: 7,
      color: '#FFFFFF',
      weight: 2.5,
      fillColor: '#0284C7',
      fillOpacity: 1,
      interactive: false,
    }).addTo(gpsGroup);
  }, [gpsPosition]);

  // Render COGO Preview Geometry
  useEffect(() => {
    const cogoGroup = cogoGroupRef.current;
    if (!cogoGroup) return;
    cogoGroup.clearLayers();
    if (!cogoPreview) return;

    if (cogoPreview.polygon && cogoPreview.polygon.length >= 3) {
      const polyLatLngs = cogoPreview.polygon.map((v) => tmToWgs84(v.n, v.e, displayCrs));
      L.polygon(polyLatLngs, {
        color: '#0EA5E9',
        weight: 3,
        fillColor: '#38BDF8',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(cogoGroup);
    }

    if (cogoPreview.circles) {
      for (const c of cogoPreview.circles) {
        const pts = buildPlanarCircleLatLngs(c.center.n, c.center.e, c.radius, displayCrs);
        L.polyline(pts, {
          color: c.danger ? '#DC2626' : '#0284C7',
          weight: c.danger ? 2 : 1.5,
          dashArray: '6 5',
          interactive: false,
        }).addTo(cogoGroup);
      }
    }

    for (const line of cogoPreview.lines) {
      const p1 = tmToWgs84(line.from.n, line.from.e, displayCrs);
      const p2 = tmToWgs84(line.to.n, line.to.e, displayCrs);
      L.polyline([p1, p2], {
        color: line.color ?? '#0284C7',
        weight: 2.2,
        dashArray: line.dashed ? '6 4' : undefined,
        interactive: false,
      }).addTo(cogoGroup);
    }

    let solCounter = 0;
    for (const pt of cogoPreview.points) {
      const [lat, lng] = tmToWgs84(pt.n, pt.e, displayCrs);
      if (pt.role === 'known') {
        L.circleMarker([lat, lng], {
          radius: 6,
          color: '#FFFFFF',
          weight: 2,
          fillColor: '#0284C7',
          fillOpacity: 1,
          interactive: false,
        })
          .bindTooltip(pt.label, { permanent: true, direction: 'top', offset: [0, -6] })
          .addTo(cogoGroup);
      } else {
        const isAlt = pt.role === 'alt';
        const solIdx = solCounter as 0 | 1;
        if (cogoPreview.type === 'intersection_dist') {
          solCounter++;
        }
        const selected =
          cogoPreview.type === 'intersection_dist'
            ? cogoPreview.selectedSolutionIndex === solIdx
            : !isAlt;

        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            html: `<div class="inline-block w-max px-2 py-0.5 rounded-md text-[11px] font-semibold leading-tight whitespace-nowrap -translate-x-1/2 -translate-y-1/2 shadow-md border ${
              selected
                ? 'bg-orange-600 text-white border-white'
                : 'bg-white text-slate-900 border-orange-500 hover:bg-orange-50'
            }">${pt.label}</div>`,
            className: 'bg-transparent border-0 !w-auto !h-auto',
            iconAnchor: [0, 0],
          }),
          interactive: !pickRequest && Boolean(cogoPreview.onSelectSolution),
          zIndexOffset: 500,
        });

        if (!pickRequest && cogoPreview.onSelectSolution && cogoPreview.type === 'intersection_dist') {
          const capturedIdx = solIdx;
          m.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            cogoPreview.onSelectSolution?.(capturedIdx);
          });
        }

        m.addTo(cogoGroup);
      }
    }
  }, [cogoPreview, displayCrs, pickRequest]);

  // Render Measure Overlay
  useEffect(() => {
    const measureGroup = measureGroupRef.current;
    if (!measureGroup) return;
    measureGroup.clearLayers();
    if (!measureOverlay) return;

    if (measureOverlay.segment) {
      const pA = tmToWgs84(measureOverlay.segment.a.n, measureOverlay.segment.a.e, displayCrs);
      const pB = tmToWgs84(measureOverlay.segment.b.n, measureOverlay.segment.b.e, displayCrs);
      L.polyline([pA, pB], {
        color: '#0369A1',
        weight: 4,
        interactive: false,
      }).addTo(measureGroup);
    }

    if (measureOverlay.mode === 'area' && measureOverlay.points.length >= 2) {
      const latLngs = measureOverlay.points.map((p) => tmToWgs84(p.n, p.e, displayCrs));
      if (measureOverlay.points.length >= 3) {
        L.polygon(latLngs, {
          color: '#0D9488',
          weight: 2.5,
          fillColor: '#14B8A6',
          fillOpacity: 0.22,
          interactive: false,
        }).addTo(measureGroup);
      } else {
        L.polyline(latLngs, { color: '#0D9488', weight: 2.5, interactive: false }).addTo(
          measureGroup
        );
      }
    } else if (measureOverlay.mode === 'distance' && measureOverlay.points.length === 2) {
      const p1 = tmToWgs84(measureOverlay.points[0].n, measureOverlay.points[0].e, displayCrs);
      const p2 = tmToWgs84(measureOverlay.points[1].n, measureOverlay.points[1].e, displayCrs);
      L.polyline([p1, p2], {
        color: '#0D9488',
        weight: 2.5,
        dashArray: '6 4',
        interactive: false,
      }).addTo(measureGroup);
    } else if (
      measureOverlay.mode === 'pointToLine' &&
      measureOverlay.points.length >= 1 &&
      measureOverlay.foot
    ) {
      const p = tmToWgs84(measureOverlay.points[0].n, measureOverlay.points[0].e, displayCrs);
      const f = tmToWgs84(measureOverlay.foot.n, measureOverlay.foot.e, displayCrs);
      L.polyline([p, f], {
        color: '#EA580C',
        weight: 2.5,
        dashArray: '4 4',
        interactive: false,
      }).addTo(measureGroup);
      L.circleMarker(f, {
        radius: 5,
        color: '#FFFFFF',
        weight: 1.5,
        fillColor: '#0369A1',
        fillOpacity: 1,
        interactive: false,
      }).addTo(measureGroup);
    }

    measureOverlay.points.forEach((pt, idx) => {
      const [lat, lng] = tmToWgs84(pt.n, pt.e, displayCrs);
      L.circleMarker([lat, lng], {
        radius: 5.5,
        color: '#FFFFFF',
        weight: 2,
        fillColor: '#0D9488',
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip(pt.label ?? `P${idx + 1}`, {
          permanent: true,
          direction: 'top',
          offset: [0, -6],
        })
        .addTo(measureGroup);
    });
  }, [measureOverlay, displayCrs]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {pickRequest && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[1000] max-w-[90vw]">
          <div className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg bg-sky-700 text-white shadow-lg border border-sky-500 text-xs font-medium">
            <span className="truncate">{pickRequest.prompt}</span>
            {onCancelPick && (
              <button
                type="button"
                onClick={onCancelPick}
                className="px-2 py-0.5 rounded bg-sky-900/75 hover:bg-sky-900 text-white text-[11px] font-semibold shrink-0"
              >
                取消
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
