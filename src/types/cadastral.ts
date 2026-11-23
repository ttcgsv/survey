export type CrsId = 'EPSG:3826' | 'EPSG:3828';

export type BasemapId = 'emap' | 'photo2' | 'hybrid' | 'osm';

export type AngleInputMode = 'dms' | 'deg';

export interface SectionDataFileEntry {
  name: string;
  encoding?: 'UTF-8' | 'Big5';
  text: string;
}

export interface SectionDataBundle {
  code: string;
  label: string;
  crs: CrsId;
  files: SectionDataFileEntry[];
}

export interface BoundaryPoint {
  id: string;
  n: number;
  e: number;
  elev: string;
  markerCode: string;
  isReference?: boolean;
}

export interface ParcelBoundaryRef {
  lotMain: number;
  lotSub: number;
  lotNo: string;
  pointIds: string[];
  cardCount: number;
}

export interface ParcelAttribute {
  lotMain: number;
  lotSub: number;
  lotNo: string;
  regArea: number;
  oldLotMain: number;
  oldLotSub: number;
  calcArea: number;
  landTypeCode: string;
  checkCode: string;
  labelN: number;
  labelE: number;
}

export interface ParcelVertex {
  id: string;
  n: number;
  e: number;
}

export interface ParcelEntity {
  lotNo: string;
  lotMain: number;
  lotSub: number;
  pointIds: string[];
  vertices: ParcelVertex[];
  regArea: number;
  parCalcArea: number;
  computedArea: number;
  landTypeCode: string;
  checkCode: string;
  labelN: number;
  labelE: number;
  centroidN: number;
  centroidE: number;
  visualCenterN: number;
  visualCenterE: number;
}

export interface ControlPoint {
  id: string;
  n: number;
  e: number;
}

export interface UrbanPlanPoint {
  id: string;
  n: number;
  e: number;
}

export interface LoadedFileMeta {
  name: string;
  ext: string;
  encoding: 'UTF-8' | 'Big5';
  count: number;
}

export interface CadastralSection {
  code: string;
  label: string;
  source: 'demo' | 'local';
  crs: CrsId;
  boundaryPoints: Record<string, BoundaryPoint>;
  refPoints: Record<string, BoundaryPoint>;
  parcels: ParcelEntity[];
  controlPoints: ControlPoint[];
  urbanPoints: UrbanPlanPoint[];
  mapLines: string[];
  disLines: string[];
  loadedFiles: LoadedFileMeta[];
  warnings: string[];
}

export type FieldPointSource =
  | 'radiation'
  | 'intersection_dir'
  | 'intersection_dist'
  | 'resection'
  | 'manual';

export type FieldPointKind = 'control' | 'urban' | 'ref' | 'field';

export interface FieldPoint {
  uid: string;
  id: string;
  note: string;
  n: number;
  e: number;
  crs: CrsId;
  source: FieldPointSource;
  pointKind?: FieldPointKind;
  createdAt: string;
}

export interface LayerVisibility {
  parcels: boolean;
  parcelLabels: boolean;
  boundaryPoints: boolean;
  boundaryPointLabels: boolean;
  controlPoints: boolean;
  controlPointLabels: boolean;
  urbanPoints: boolean;
  urbanPointLabels: boolean;
  refPoints: boolean;
  refPointLabels: boolean;
  fieldPoints: boolean;
  fieldPointLabels: boolean;
}

export interface PickedCoord {
  n: number;
  e: number;
  pointId?: string;
  pointKind?: string;
}

export interface PickedSegment {
  a: { n: number; e: number; id?: string };
  b: { n: number; e: number; id?: string };
  lotNo?: string;
}

export interface MapPickRequest {
  id: string;
  mode: 'point' | 'segment' | 'parcel';
  prompt: string;
  keepMobileSheetOpen?: boolean;
  onPickPoint?: (pt: PickedCoord) => void;
  onPickSegment?: (seg: PickedSegment) => void;
  onPickParcel?: (parcel: { lotNo: string }) => void;
}

export interface CogoPreviewOverlay {
  type:
    | 'radiation'
    | 'intersection_dir'
    | 'intersection_angle'
    | 'intersection_dist'
    | 'resection'
    | 'boundary';
  points: { label: string; n: number; e: number; role: 'known' | 'result' | 'alt' }[];
  lines: {
    from: { n: number; e: number };
    to: { n: number; e: number };
    dashed?: boolean;
    color?: string;
  }[];
  polygon?: { n: number; e: number }[];
  circles?: { center: { n: number; e: number }; radius: number; danger?: boolean }[];
  selectedSolutionIndex?: 0 | 1;
  onSelectSolution?: (idx: 0 | 1) => void;
}

export interface MeasureOverlay {
  mode: 'distance' | 'pointToLine' | 'area';
  points: { n: number; e: number; label?: string }[];
  segment?: { a: { n: number; e: number }; b: { n: number; e: number } };
  foot?: { n: number; e: number };
}

export type SidebarTab = 'dataset' | 'layers' | 'cogo' | 'points' | 'measure';

export interface CoordInputState {
  n: string;
  e: string;
  hint?: string;
}

export type CogoModule = 'radiation' | 'intersection' | 'resection' | 'boundary';

export interface CogoFormState {
  moduleTab: CogoModule;
  angleMode: AngleInputMode;
  radStation: CoordInputState;
  radBsMode: 'point' | 'azimuth';
  radBsPoint: CoordInputState;
  radBsAz: string;
  radHzAngle: string;
  radDist: string;
  intMode: 'dist' | 'angle';
  intPtA: CoordInputState;
  intPtB: CoordInputState;
  intAngleA: string;
  intAngleB: string;
  intDistA: string;
  intDistB: string;
  selectedDistSol: 0 | 1;
  resPtA: CoordInputState;
  resPtB: CoordInputState;
  resPtC: CoordInputState;
  resAlpha: string;
  resBeta: string;
  bndStationId: string;
  bndStation: CoordInputState;
  bndBacksightId: string;
  bndBacksight: CoordInputState;
  bndLotNo: string;
  bndSelectedPtId: string | null;
  bndObsAngle: string;
  bndObsDist: string;
}

