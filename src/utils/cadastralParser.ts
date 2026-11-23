import type {
  BoundaryPoint,
  CadastralSection,
  ControlPoint,
  CrsId,
  LoadedFileMeta,
  ParcelAttribute,
  ParcelBoundaryRef,
  ParcelEntity,
  UrbanPlanPoint,
} from '../types/cadastral';
import { computePolygonVisualCenter, computeShoelaceArea } from './cogo';

const SUPPORTED_EXTS = new Set(['COA', 'BNP', 'PAR', 'CTL', 'UPN', 'RCO', 'MAP', 'DIS']);

const EXCHANGE_FILE_DESCRIPTIONS: Record<string, string> = {
  COA: '界址點坐標檔',
  BNP: '宗地界址連線檔',
  PAR: '宗地屬性面積檔',
  CTL: '控制點坐標檔',
  UPN: '都計樁坐標檔',
  RCO: '參考點坐標檔',
  MAP: '圖廓註記檔',
  DIS: '宗地邊長檔',
};

export function getExchangeFileDescription(ext: string): string {
  return EXCHANGE_FILE_DESCRIPTIONS[ext.toUpperCase()] ?? '地籍交換檔';
}

export function decodeFileBuffer(buffer: ArrayBuffer): {
  text: string;
  encoding: 'UTF-8' | 'Big5';
} {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
  } catch {
    const text = new TextDecoder('big5').decode(buffer);
    return { text, encoding: 'Big5' };
  }
}

export function formatLotNo(lotMain: number, lotSub: number): string {
  return lotSub > 0 ? `${lotMain}-${lotSub}` : `${lotMain}`;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Parse .COA / .RCO Fortran fixed-width coordinate file with tolerant decimal-anchor extraction.
 */
export function parseCoaOrRco(
  text: string,
  isReference = false
): { points: Record<string, BoundaryPoint>; count: number } {
  const lines = splitLines(text);
  const points: Record<string, BoundaryPoint> = {};
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Skip section header line (first non-empty line, usually starts with 6-char section code or has no decimal point)
    if (i === 0 && !line.includes('.')) continue;

    // Decimal anchor extraction handles glued fields like "  5458 2517100.00000000266500.00000001"
    const dot1 = line.indexOf('.');
    const dot2 = dot1 >= 0 ? line.indexOf('.', dot1 + 1) : -1;

    if (dot1 > 0 && dot2 > dot1) {
      const nEnd = Math.min(line.length, dot1 + 4);
      // Scan left up to 7 digits for N (Taiwan TM2 N is 7 digits ~2400000..2800000)
      let nStart = dot1 - 1;
      let digitsN = 0;
      while (nStart >= 0 && /\d/.test(line[nStart]) && digitsN < 7) {
        nStart--;
        digitsN++;
      }
      nStart++;

      // Scan left up to 6 digits for E (Taiwan TM2 E is 6 digits ~140000..360000)
      let eStart = dot2 - 1;
      let digitsE = 0;
      while (eStart >= nEnd && /\d/.test(line[eStart]) && digitsE < 6) {
        eStart--;
        digitsE++;
      }
      eStart++;
      const eEnd = Math.min(line.length, dot2 + 4);

      const id = line.slice(0, nStart).trim();
      const n = parseFloat(line.slice(nStart, nEnd));
      const elev = line.slice(nEnd, eStart).trim();
      const e = parseFloat(line.slice(eStart, eEnd));
      const markerCode = line.slice(eEnd).trim() || '00000';

      if (id && Number.isFinite(n) && Number.isFinite(e)) {
        points[id] = { id, n, e, elev, markerCode, isReference };
        count++;
        continue;
      }
    }

    // Fallback: whitespace-separated
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 3) {
      const id = tokens[0];
      const n = parseFloat(tokens[1]);
      const e = parseFloat(tokens[2]);
      const markerCode = tokens[3] || '00000';
      if (id && Number.isFinite(n) && Number.isFinite(e)) {
        points[id] = { id, n, e, elev: '0000', markerCode, isReference };
        count++;
      }
    }
  }

  return { points, count };
}

/**
 * Parse .BNP parcel boundary connection file, supporting multi-card continuations.
 */
export function parseBnp(text: string): ParcelBoundaryRef[] {
  const lines = splitLines(text);
  const grouped = new Map<
    string,
    {
      lotMain: number;
      lotSub: number;
      cards: { seq: number; pts: string[] }[];
    }
  >();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Skip header line
    if (i === 0 && /^[A-Za-z0-9]{4,8}\s+\d+\s*$/.test(line.trim())) continue;

    // Try fixed-column parsing first: I4, I4, I3, I4, then I6...
    let lotMain = NaN;
    let lotSub = NaN;
    let cardSeq = 1;
    let ptIds: string[] = [];

    if (line.length >= 16 && /^\s*\d+\s+\d+\s+\d+\s+\d+/.test(line.slice(0, 16))) {
      lotMain = parseInt(line.slice(0, 4).trim(), 10);
      lotSub = parseInt(line.slice(4, 8).trim() || '0', 10);
      cardSeq = parseInt(line.slice(8, 11).trim() || '1', 10);
      const rest = line.slice(15);
      // Slice every 6 chars, or fallback to whitespace split if irregular
      if (rest.length >= 6) {
        const sliced: string[] = [];
        for (let pos = 0; pos < rest.length; pos += 6) {
          const chunk = rest.slice(pos, pos + 6).trim();
          if (chunk) sliced.push(chunk);
        }
        ptIds = sliced;
      }
    }

    // Fallback whitespace tokenization
    if (!Number.isFinite(lotMain) || ptIds.length === 0) {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length >= 5) {
        lotMain = parseInt(tokens[0], 10);
        lotSub = parseInt(tokens[1], 10);
        cardSeq = parseInt(tokens[2], 10);
        ptIds = tokens.slice(4);
      }
    }

    if (!Number.isFinite(lotMain) || ptIds.length === 0) continue;
    if (!Number.isFinite(lotSub)) lotSub = 0;
    if (!Number.isFinite(cardSeq)) cardSeq = 1;

    const key = formatLotNo(lotMain, lotSub);
    const existing = grouped.get(key) ?? { lotMain, lotSub, cards: [] };
    existing.cards.push({ seq: cardSeq, pts: ptIds });
    grouped.set(key, existing);
  }

  const results: ParcelBoundaryRef[] = [];
  for (const [lotNo, entry] of grouped.entries()) {
    entry.cards.sort((a, b) => a.seq - b.seq);
    const pointIds = entry.cards.flatMap((c) => c.pts);
    results.push({
      lotMain: entry.lotMain,
      lotSub: entry.lotSub,
      lotNo,
      pointIds,
      cardCount: entry.cards.length,
    });
  }

  return results;
}

/**
 * Parse .PAR parcel attribute and area file.
 */
export function parsePar(text: string): Record<string, ParcelAttribute> {
  const lines = splitLines(text);
  const map: Record<string, ParcelAttribute> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (i === 0 && /^[A-Za-z0-9]{4,8}\s+\d+/.test(line.trim())) continue;

    // Regex matches: lotMain, lotSub, flag, regArea, oldMain, oldSub, calcArea, landType, checkCode, labelN, labelE
    // Handles both whitespace-separated and glued Fortran coordinates (e.g. 2517110.0266512.5)
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+\d+\s+(\d+\.\d+)\s+(\d+)\s+(\d+)\s+(\d+\.\d+)([A-Za-z\u4e00-\u9fa5]?)\s*(\d?)\s*(?:(\d{6,7}\.\d+)\s+(\d{5,6}\.\d+)|(\d{6,7}\.\d+?)(\d{6}\.\d+))/
    );

    if (match) {
      const lotMain = parseInt(match[1], 10);
      const lotSub = parseInt(match[2], 10);
      const regArea = parseFloat(match[3]);
      const oldLotMain = parseInt(match[4], 10);
      const oldLotSub = parseInt(match[5], 10);
      const calcArea = parseFloat(match[6]);
      const landTypeCode = match[7] || '-';
      const checkCode = match[8] || '0';
      const labelN = parseFloat(match[9] ?? match[11]);
      const labelE = parseFloat(match[10] ?? match[12]);

      const lotNo = formatLotNo(lotMain, lotSub);
      map[lotNo] = {
        lotMain,
        lotSub,
        lotNo,
        regArea,
        oldLotMain,
        oldLotSub,
        calcArea,
        landTypeCode,
        checkCode,
        labelN,
        labelE,
      };
      continue;
    }

    // Fallback whitespace tokenization if glued numbers differ
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 7) {
      const lotMain = parseInt(tokens[0], 10);
      const lotSub = parseInt(tokens[1], 10);
      const regArea = parseFloat(tokens[3]);
      const oldLotMain = parseInt(tokens[4], 10);
      const oldLotSub = parseInt(tokens[5], 10);
      const calcArea = parseFloat(tokens[6]);
      if (Number.isFinite(lotMain) && Number.isFinite(regArea)) {
        const lotNo = formatLotNo(lotMain, Number.isFinite(lotSub) ? lotSub : 0);
        map[lotNo] = {
          lotMain,
          lotSub: Number.isFinite(lotSub) ? lotSub : 0,
          lotNo,
          regArea,
          oldLotMain: Number.isFinite(oldLotMain) ? oldLotMain : lotMain,
          oldLotSub: Number.isFinite(oldLotSub) ? oldLotSub : 0,
          calcArea: Number.isFinite(calcArea) ? calcArea : regArea,
          landTypeCode: '-',
          checkCode: '0',
          labelN: 0,
          labelE: 0,
        };
      }
    }
  }

  return map;
}

/**
 * Parse .CTL control & traverse points file (e.g. "C689"  2517075.500266490.200).
 */
export function parseCtl(text: string): ControlPoint[] {
  const lines = splitLines(text);
  const points: ControlPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (i === 0 && !line.includes('.')) continue;

    const match = line.match(
      /^\s*"?([^"\s]+)"?\s+(?:(\d{6,7}\.\d+)\s+(\d{5,6}\.\d+)|(\d{6,7}\.\d+?)(\d{6}\.\d+))/
    );
    if (match) {
      const id = match[1].trim();
      const n = parseFloat(match[2] ?? match[4]);
      const e = parseFloat(match[3] ?? match[5]);
      if (id && Number.isFinite(n) && Number.isFinite(e)) {
        points.push({ id, n, e });
      }
    }
  }

  return points;
}

/**
 * Parse .UPN urban plan monument points file (e.g. C666-1         2517065.000266500.000).
 */
export function parseUpn(text: string): UrbanPlanPoint[] {
  const lines = splitLines(text);
  const points: UrbanPlanPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (i === 0 && !line.includes('.')) continue;

    const match = line.match(
      /^\s*(\S+)\s+(?:(\d{6,7}\.\d+)\s+(\d{5,6}\.\d+)|(\d{6,7}\.\d+?)(\d{6}\.\d+))/
    );
    if (match) {
      const id = match[1].trim();
      const n = parseFloat(match[2] ?? match[4]);
      const e = parseFloat(match[3] ?? match[5]);
      if (id && Number.isFinite(n) && Number.isFinite(e)) {
        points.push({ id, n, e });
      }
    }
  }

  return points;
}

export interface RawFileInput {
  name: string;
  text: string;
  encoding: 'UTF-8' | 'Big5';
}

/**
 * Group files by 6-char section prefix (e.g. VA0001) and build complete CadastralSection objects.
 */
export function parseCadastralBatch(
  files: RawFileInput[],
  options?: {
    source?: 'demo' | 'local';
    defaultCrs?: CrsId;
    labelOverrides?: Record<string, string>;
  }
): CadastralSection[] {
  const groups = new Map<string, RawFileInput[]>();

  for (const file of files) {
    const baseName = file.name.split('/').pop() ?? file.name;
    const dotIdx = baseName.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const ext = baseName.slice(dotIdx + 1).toUpperCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    const stem = baseName.slice(0, dotIdx).toUpperCase();
    const sectionCode = stem.length >= 6 ? stem.slice(0, 6) : stem;
    const list = groups.get(sectionCode) ?? [];
    list.push({ ...file, name: baseName });
    groups.set(sectionCode, list);
  }

  const sections: CadastralSection[] = [];
  const defaultCrs = options?.source ? options.defaultCrs ?? 'EPSG:3826' : 'EPSG:3826';

  for (const [code, groupFiles] of groups.entries()) {
    let boundaryPoints: Record<string, BoundaryPoint> = {};
    let refPoints: Record<string, BoundaryPoint> = {};
    let bnpList: ParcelBoundaryRef[] = [];
    let parMap: Record<string, ParcelAttribute> = {};
    let controlPoints: ControlPoint[] = [];
    let urbanPoints: UrbanPlanPoint[] = [];
    let mapLines: string[] = [];
    let disLines: string[] = [];
    const loadedFiles: LoadedFileMeta[] = [];
    const warnings: string[] = [];

    for (const f of groupFiles) {
      const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toUpperCase();
      if (ext === 'COA') {
        const res = parseCoaOrRco(f.text, false);
        boundaryPoints = { ...boundaryPoints, ...res.points };
        loadedFiles.push({ name: f.name, ext, encoding: f.encoding, count: res.count });
      } else if (ext === 'RCO') {
        const res = parseCoaOrRco(f.text, true);
        refPoints = { ...refPoints, ...res.points };
        loadedFiles.push({ name: f.name, ext, encoding: f.encoding, count: res.count });
      } else if (ext === 'BNP') {
        bnpList = parseBnp(f.text);
        loadedFiles.push({ name: f.name, ext, encoding: f.encoding, count: bnpList.length });
      } else if (ext === 'PAR') {
        parMap = parsePar(f.text);
        loadedFiles.push({
          name: f.name,
          ext,
          encoding: f.encoding,
          count: Object.keys(parMap).length,
        });
      } else if (ext === 'CTL') {
        controlPoints = parseCtl(f.text);
        loadedFiles.push({
          name: f.name,
          ext,
          encoding: f.encoding,
          count: controlPoints.length,
        });
      } else if (ext === 'UPN') {
        urbanPoints = parseUpn(f.text);
        loadedFiles.push({
          name: f.name,
          ext,
          encoding: f.encoding,
          count: urbanPoints.length,
        });
      } else if (ext === 'MAP') {
        mapLines = splitLines(f.text).filter((l) => l.trim().length > 0);
        loadedFiles.push({ name: f.name, ext, encoding: f.encoding, count: mapLines.length });
      } else if (ext === 'DIS') {
        disLines = splitLines(f.text).filter((l) => l.trim().length > 0);
        loadedFiles.push({ name: f.name, ext, encoding: f.encoding, count: disLines.length });
      }
    }

    // Build joined ParcelEntity list
    const parcels: ParcelEntity[] = [];
    for (const bnp of bnpList) {
      const vertices: { id: string; n: number; e: number }[] = [];
      const missingPts: string[] = [];

      for (const pid of bnp.pointIds) {
        const pt = boundaryPoints[pid] ?? refPoints[pid];
        if (pt) {
          vertices.push({ id: pid, n: pt.n, e: pt.e });
        } else {
          missingPts.push(pid);
        }
      }

      if (missingPts.length > 0) {
        warnings.push(`地號 ${bnp.lotNo} 缺少界址點坐標：${missingPts.join(', ')}`);
      }

      const attr = parMap[bnp.lotNo];
      const computed = computeShoelaceArea(vertices);

      let centroidN = 0;
      let centroidE = 0;
      if (vertices.length > 0) {
        centroidN = vertices.reduce((s, v) => s + v.n, 0) / vertices.length;
        centroidE = vertices.reduce((s, v) => s + v.e, 0) / vertices.length;
      }

      const labelN = attr && attr.labelN > 0 ? attr.labelN : centroidN;
      const labelE = attr && attr.labelE > 0 ? attr.labelE : centroidE;
      const visualCenter = computePolygonVisualCenter(vertices);

      parcels.push({
        lotNo: bnp.lotNo,
        lotMain: bnp.lotMain,
        lotSub: bnp.lotSub,
        pointIds: bnp.pointIds,
        vertices,
        regArea: attr ? attr.regArea : computed.areaSqm,
        parCalcArea: attr ? attr.calcArea : computed.areaSqm,
        computedArea: computed.areaSqm,
        landTypeCode: attr ? attr.landTypeCode : '-',
        checkCode: attr ? attr.checkCode : '0',
        labelN,
        labelE,
        centroidN,
        centroidE,
        visualCenterN: visualCenter.n || labelN || centroidN,
        visualCenterE: visualCenter.e || labelE || centroidE,
      });
    }

    loadedFiles.sort((a, b) => a.ext.localeCompare(b.ext));

    sections.push({
      code,
      label: options?.labelOverrides?.[code] ?? `${code} 匯入地段`,
      source: options?.source ?? 'local',
      crs: defaultCrs,
      boundaryPoints,
      refPoints,
      parcels,
      controlPoints,
      urbanPoints,
      mapLines,
      disLines,
      loadedFiles,
      warnings,
    });
  }

  return sections;
}

/**
 * Export FieldPoints as standard .COA fixed-width format.
 */
export function exportFieldPointsToCoa(
  sectionCode: string,
  points: { id: string; n: number; e: number }[]
): string {
  const code = (sectionCode || 'FIELD0').slice(0, 6).padEnd(6, '0');
  const header = `${code}1151120${String(points.length).padStart(5, ' ')}11511`;
  const rows = points.map((p) => {
    const idCol = p.id.slice(0, 6).padStart(6, ' ');
    const nCol = p.n.toFixed(3).padStart(12, ' ');
    const elevCol = '0000';
    const eCol = p.e.toFixed(3).padStart(11, ' ');
    const markerCol = '00001';
    return `${idCol}${nCol}${elevCol}${eCol}${markerCol}`;
  });
  return [header, ...rows].join('\r\n');
}

export function getMarkerLabel(code: string): string {
  const trimmed = code.replace(/^0+/, '') || '0';
  switch (trimmed) {
    case '1':
      return '鋼釘 (00001)';
    case '2':
      return '水泥樁 (00002)';
    case '3':
      return '塑膠樁 (00003)';
    case '4':
      return '噴漆/刻記 (00004)';
    case '0':
      return '未設界標 (00000)';
    default:
      return `界標代碼 ${code}`;
  }
}
