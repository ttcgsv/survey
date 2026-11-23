import type { AngleInputMode } from '../types/cadastral';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Parse angle input in either packed DDD.MMSS or decimal degrees.
 * Also gracefully accepts DMS symbols like 123°45'30" when in DMS mode.
 */
export function parseAngleInput(
  raw: string,
  mode: AngleInputMode
): { ok: true; deg: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: '請輸入角度數值' };
  }

  if (mode === 'deg') {
    const val = Number(trimmed);
    if (!Number.isFinite(val)) {
      return { ok: false, error: '十進位角度格式無效' };
    }
    return { ok: true, deg: val };
  }

  // DMS mode: support explicit symbols like 123°45'30.5" or standard DDD.MMSS
  if (/[°'"]/.test(trimmed)) {
    const match = trimmed.match(/^(-?\d+)°\s*(\d{1,2})'?\s*(\d{1,2}(?:\.\d+)?)?"?$/);
    if (!match) {
      return { ok: false, error: '度分秒格式無效（範例：123.4530）' };
    }
    const sign = match[1].startsWith('-') ? -1 : 1;
    const d = Math.abs(parseInt(match[1], 10));
    const m = parseInt(match[2], 10);
    const s = parseFloat(match[3] || '0');
    if (m >= 60 || s >= 60) {
      return { ok: false, error: '分或秒數值不可大於等於 60' };
    }
    return { ok: true, deg: sign * (d + m / 60 + s / 3600) };
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { ok: false, error: 'DDD.MMSS 格式無效' };
  }

  const sign = num < 0 ? -1 : 1;
  const absStr = Math.abs(num).toFixed(6); // preserve trailing fractional seconds like DDD.MMSSss
  const [degPartStr, fracPartStr = '000000'] = absStr.split('.');
  const d = parseInt(degPartStr, 10);
  const padded = fracPartStr.padEnd(6, '0');
  const m = parseInt(padded.slice(0, 2), 10);
  const sWhole = parseInt(padded.slice(2, 4), 10);
  const sDec = parseInt(padded.slice(4, 6), 10);
  const s = sWhole + sDec / 100;

  if (m >= 60 || s >= 60) {
    return { ok: false, error: `DDD.MMSS 分(${m})或秒(${s.toFixed(2)})不可 >= 60` };
  }

  return { ok: true, deg: sign * (d + m / 60 + s / 3600) };
}

export function formatDegToDms(deg: number): string {
  const norm = normalizeDeg(deg);
  let d = Math.floor(norm);
  const remMin = (norm - d) * 60;
  let m = Math.floor(remMin);
  let s = (remMin - m) * 60;

  if (s >= 59.95) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d = (d + 1) % 360;
  }

  const dd = String(d).padStart(3, '0');
  const mm = String(m).padStart(2, '0');
  const ss = s.toFixed(1).padStart(4, '0');
  return `${dd}°${mm}'${ss}"`;
}

export function formatDegToDmsPacked(deg: number): string {
  const norm = normalizeDeg(deg);
  let d = Math.floor(norm);
  const remMin = (norm - d) * 60;
  let m = Math.floor(remMin);
  let s = Math.round((remMin - m) * 60);

  if (s >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d = (d + 1) % 360;
  }

  return `${d}.${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
}

export interface InverseResult {
  dn: number;
  de: number;
  distance: number;
  azimuthDeg: number;
  azimuthDms: string;
}

/**
 * Surveying inverse calculation between two TM2 points.
 * Azimuth is clockwise from North (0° = North, 90° = East).
 */
export function inverseCalculation(
  n1: number,
  e1: number,
  n2: number,
  e2: number
): InverseResult {
  const dn = n2 - n1;
  const de = e2 - e1;
  const distance = Math.hypot(dn, de);
  const azRad = Math.atan2(de, dn);
  const azimuthDeg = normalizeDeg(azRad * RAD_TO_DEG);
  return {
    dn,
    de,
    distance,
    azimuthDeg,
    azimuthDms: formatDegToDms(azimuthDeg),
  };
}

/**
 * 1. Radiation (光線法)
 * Computes target point (nP, eP) from station, backsight azimuth, clockwise horizontal angle, and horizontal distance.
 */
export function computeRadiation(params: {
  n0: number;
  e0: number;
  backsightAzDeg: number;
  hzAngleDeg: number;
  distance: number;
}): {
  nP: number;
  eP: number;
  targetAzDeg: number;
  targetAzDms: string;
} {
  const targetAzDeg = normalizeDeg(params.backsightAzDeg + params.hzAngleDeg);
  const rad = targetAzDeg * DEG_TO_RAD;
  const nP = params.n0 + params.distance * Math.cos(rad);
  const eP = params.e0 + params.distance * Math.sin(rad);
  return {
    nP,
    eP,
    targetAzDeg,
    targetAzDms: formatDegToDms(targetAzDeg),
  };
}

/**
 * 2A. Forward Intersection by Azimuths (前方交會：方向角交會)
 */
export function computeDirectionIntersection(params: {
  nA: number;
  eA: number;
  azAPDeg: number;
  nB: number;
  eB: number;
  azBPDeg: number;
}):
  | {
      ok: true;
      nP: number;
      eP: number;
      distAP: number;
      distBP: number;
      intersectionAngleDeg: number;
      warning?: string;
    }
  | { ok: false; error: string } {
  const rA = params.azAPDeg * DEG_TO_RAD;
  const rB = params.azBPDeg * DEG_TO_RAD;

  const uAn = Math.cos(rA);
  const uAe = Math.sin(rA);
  const uBn = Math.cos(rB);
  const uBe = Math.sin(rB);

  // Solve: A + t*uA = B + s*uB => t*uA - s*uB = B - A
  const det = uAn * -uBe - uAe * -uBn; // = uAe*uBn - uAn*uBe = sin(rA - rB)
  const sinDiff = Math.abs(det);

  if (sinDiff < 1e-6) {
    return {
      ok: false,
      error: '兩觀測方向線平行或重合，無法計算唯一交點',
    };
  }

  const dn = params.nB - params.nA;
  const de = params.eB - params.eA;

  const t = (dn * -uBe - de * -uBn) / det;
  const s = (uAn * de - uAe * dn) / det;

  const nP = params.nA + t * uAn;
  const eP = params.eA + t * uAe;

  const intersectionAngleDeg = Math.asin(Math.min(1, sinDiff)) * RAD_TO_DEG;

  let warning: string | undefined;
  if (t < 0 || s < 0) {
    warning = '交會點位於其中一條觀測方位角的反向延長線上，請核對觀測方向角。';
  } else if (intersectionAngleDeg < 15) {
    warning = `交會角僅 ${intersectionAngleDeg.toFixed(1)}°（小於 15°），幾何強度偏弱。`;
  }

  return {
    ok: true,
    nP,
    eP,
    distAP: Math.abs(t),
    distBP: Math.abs(s),
    intersectionAngleDeg,
    warning,
  };
}

/**
 * 2A-Alt. Forward Intersection by Horizontal Angles (前方交會：夾角交會)
 * Station A backsights B (zeroed), clockwise horizontal angle angleAtADeg to P.
 * Station B backsights A (zeroed), clockwise horizontal angle angleAtBDeg to P.
 */
export function computeAngleIntersection(params: {
  nA: number;
  eA: number;
  angleAtADeg: number;
  nB: number;
  eB: number;
  angleAtBDeg: number;
}):
  | {
      ok: true;
      nP: number;
      eP: number;
      distAP: number;
      distBP: number;
      baseDistance: number;
      azABDeg: number;
      azAPDeg: number;
      azBPDeg: number;
      intersectionAngleDeg: number;
      warning?: string;
    }
  | { ok: false; error: string } {
  const { nA, eA, angleAtADeg, nB, eB, angleAtBDeg } = params;
  const invAB = inverseCalculation(nA, eA, nB, eB);
  if (invAB.distance < 1e-6) {
    return { ok: false, error: '已知點 A 與 B 坐標重合，無法構成交會' };
  }

  const azABDeg = invAB.azimuthDeg;
  const azBADeg = normalizeDeg(azABDeg + 180);
  const azAPDeg = normalizeDeg(azABDeg + angleAtADeg);
  const azBPDeg = normalizeDeg(azBADeg + angleAtBDeg);

  const res = computeDirectionIntersection({
    nA,
    eA,
    azAPDeg,
    nB,
    eB,
    azBPDeg,
  });

  if (!res.ok) {
    return res;
  }

  let warning = res.warning;
  if (warning && warning.includes('觀測方位角')) {
    warning = '交會點位於觀測方向的反向延長線上，請核對兩站順時針夾角讀數。';
  }

  return {
    ok: true,
    nP: res.nP,
    eP: res.eP,
    distAP: res.distAP,
    distBP: res.distBP,
    baseDistance: invAB.distance,
    azABDeg,
    azAPDeg,
    azBPDeg,
    intersectionAngleDeg: res.intersectionAngleDeg,
    warning,
  };
}

/**
 * 2B. Forward Intersection by Distances (前方交會：距離交會 / 弧交會)
 * Returns both Solution 1 and Solution 2 for field selection.
 */
export function computeDistanceIntersection(params: {
  nA: number;
  eA: number;
  distAP: number;
  nB: number;
  eB: number;
  distBP: number;
}):
  | {
      ok: true;
      baseDistance: number;
      solutions: [
        { n: number; e: number; azFromADeg: number; azFromBDeg: number },
        { n: number; e: number; azFromADeg: number; azFromBDeg: number }
      ];
      isTangent: boolean;
    }
  | { ok: false; error: string } {
  const { nA, eA, distAP: r1, nB, eB, distBP: r2 } = params;
  if (r1 <= 0 || r2 <= 0) {
    return { ok: false, error: '觀測距離必須大於 0' };
  }

  const dn = nB - nA;
  const de = eB - eA;
  const d = Math.hypot(dn, de);

  if (d < 1e-6) {
    return { ok: false, error: '已知點 A 與 B 坐標重合，無法構成弧交會' };
  }
  if (d > r1 + r2 + 1e-6) {
    return {
      ok: false,
      error: `兩圓不相交：AB 基線長 (${d.toFixed(3)} m) 大於兩觀測距離之和 (${(r1 + r2).toFixed(3)} m)`,
    };
  }
  if (d < Math.abs(r1 - r2) - 1e-6) {
    return {
      ok: false,
      error: `兩圓內含不相交：AB 基線長 (${d.toFixed(3)} m) 小於兩觀測距離之差 (${Math.abs(r1 - r2).toFixed(3)} m)`,
    };
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = Math.max(0, r1 * r1 - a * a);
  const h = Math.sqrt(hSq);
  const isTangent = h < 1e-4;

  const mn = nA + (a * dn) / d;
  const me = eA + (a * de) / d;

  // Unit perpendicular vector in (N, E): (-de/d, dn/d)
  const pn = -de / d;
  const pe = dn / d;

  const s1n = mn + h * pn;
  const s1e = me + h * pe;
  const s2n = mn - h * pn;
  const s2e = me - h * pe;

  const inv1A = inverseCalculation(nA, eA, s1n, s1e);
  const inv1B = inverseCalculation(nB, eB, s1n, s1e);
  const inv2A = inverseCalculation(nA, eA, s2n, s2e);
  const inv2B = inverseCalculation(nB, eB, s2n, s2e);

  return {
    ok: true,
    baseDistance: d,
    solutions: [
      { n: s1n, e: s1e, azFromADeg: inv1A.azimuthDeg, azFromBDeg: inv1B.azimuthDeg },
      { n: s2n, e: s2e, azFromADeg: inv2A.azimuthDeg, azFromBDeg: inv2B.azimuthDeg },
    ],
    isTangent,
  };
}

/**
 * 3. Three-Point Resection (後方交會法 - Tienstra / 雙圓交會幾何法)
 * alphaDeg = clockwise horizontal angle from PA to PB (Hz_B - Hz_A)
 * betaDeg  = clockwise horizontal angle from PB to PC (Hz_C - Hz_B)
 */
export function computeThreePointResection(params: {
  nA: number;
  eA: number;
  nB: number;
  eB: number;
  nC: number;
  eC: number;
  alphaDeg: number;
  betaDeg: number;
}):
  | {
      ok: true;
      nP: number;
      eP: number;
      dangerCircle: boolean;
      dangerWarning?: string;
      strengthScore: number; // 0..100 geometric strength indicator
      circumcenter: { n: number; e: number } | null;
      circumradius: number | null;
      checkAlphaDeg: number;
      checkBetaDeg: number;
    }
  | { ok: false; error: string } {
  const { nA, eA, nB, eB, nC, eC, alphaDeg, betaDeg } = params;

  const aNorm = normalizeDeg(alphaDeg);
  const bNorm = normalizeDeg(betaDeg);

  if (aNorm < 1e-4 || Math.abs(aNorm - 180) < 1e-4 || aNorm > 359.9999) {
    return { ok: false, error: '水平夾角 α 不可為 0° 或 180°' };
  }
  if (bNorm < 1e-4 || Math.abs(bNorm - 180) < 1e-4 || bNorm > 359.9999) {
    return { ok: false, error: '水平夾角 β 不可為 0° 或 180°' };
  }

  const dAB = Math.hypot(nB - nA, eB - eA);
  const dBC = Math.hypot(nC - nB, eC - eB);
  const dAC = Math.hypot(nC - nA, eC - eA);
  if (dAB < 1e-4 || dBC < 1e-4 || dAC < 1e-4) {
    return { ok: false, error: '已知控制點 A、B、C 之間不可重合' };
  }

  const cotA = 1 / Math.tan(aNorm * DEG_TO_RAD);
  const cotB = 1 / Math.tan(bNorm * DEG_TO_RAD);

  // Circle 1 through A, B with clockwise inscribed angle alpha:
  // O1 = M_AB + (cot(alpha)/2) * CW90(B - A)
  const mABn = (nA + nB) / 2;
  const mABe = (eA + eB) / 2;
  const o1n = mABn + (cotA / 2) * -(eB - eA);
  const o1e = mABe + (cotA / 2) * (nB - nA);

  // Circle 2 through B, C with clockwise inscribed angle beta:
  // O2 = M_BC + (cot(beta)/2) * CW90(C - B)
  const mBCn = (nB + nC) / 2;
  const mBCe = (eB + eC) / 2;
  const o2n = mBCn + (cotB / 2) * -(eC - eB);
  const o2e = mBCe + (cotB / 2) * (nC - nB);

  const dnO = o2n - o1n;
  const deO = o2e - o1e;
  const distCenters = Math.hypot(dnO, deO);

  const scaleRef = (dAB + dBC + dAC) / 3;

  if (distCenters < 1e-5 * scaleRef) {
    return {
      ok: false,
      error: '危險圓警告：測站與三已知點 A、B、C 完全共圓，圓心重合，幾何無解！',
    };
  }

  // P is the exact reflection of B across line O1-O2
  const ux = dnO / distCenters;
  const uy = deO / distCenters;
  const proj = (nB - o1n) * ux + (eB - o1e) * uy;
  const footN = o1n + proj * ux;
  const footE = o1e + proj * uy;

  const nP = 2 * footN - nB;
  const eP = 2 * footE - eB;

  // Verify observed angles from computed P
  const azPA = inverseCalculation(nP, eP, nA, eA).azimuthDeg;
  const azPB = inverseCalculation(nP, eP, nB, eB).azimuthDeg;
  const azPC = inverseCalculation(nP, eP, nC, eC).azimuthDeg;
  const checkAlphaDeg = normalizeDeg(azPB - azPA);
  const checkBetaDeg = normalizeDeg(azPC - azPB);

  // Evaluate circumcircle of A, B, C for Danger Circle check
  const detTri = 2 * (eA * (nB - nC) + eB * (nC - nA) + eC * (nA - nB));
  let circumcenter: { n: number; e: number } | null = null;
  let circumradius: number | null = null;
  let dangerCircle = false;
  let dangerWarning: string | undefined;

  // Intersection angle between Circle 1 and Circle 2 at P (= angle between O1P and O2P)
  const v1n = nP - o1n;
  const v1e = eP - o1e;
  const v2n = nP - o2n;
  const v2e = eP - o2e;
  const r1 = Math.hypot(v1n, v1e);
  const r2 = Math.hypot(v2n, v2e);
  const cosTheta = Math.max(-1, Math.min(1, (v1n * v2n + v1e * v2e) / (r1 * r2)));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const circleIntersectDeg = Math.asin(sinTheta) * RAD_TO_DEG;

  if (Math.abs(detTri) > 1e-4) {
    const a2 = eA * eA + nA * nA;
    const b2 = eB * eB + nB * nB;
    const c2 = eC * eC + nC * nC;
    const ccE = (a2 * (nB - nC) + b2 * (nC - nA) + c2 * (nA - nB)) / detTri;
    const ccN = (a2 * (eC - eB) + b2 * (eA - eC) + c2 * (eB - eA)) / detTri;
    const ccR = Math.hypot(nA - ccN, eA - ccE);
    circumcenter = { n: ccN, e: ccE };
    circumradius = ccR;

    const distToCircum = Math.abs(Math.hypot(nP - ccN, eP - ccE) - ccR);
    const relativeOffset = distToCircum / ccR;

    if (relativeOffset < 0.08 || circleIntersectDeg < 12) {
      dangerCircle = true;
      dangerWarning = `危險圓警告：測站極接近 A-B-C 外接圓（圓交會角 ${circleIntersectDeg.toFixed(1)}°，距圓周比 ${(relativeOffset * 100).toFixed(1)}%），坐標誤差將大幅放大！`;
    }
  } else if (circleIntersectDeg < 12) {
    dangerCircle = true;
    dangerWarning = `幾何強度極弱警告：兩輔助圓交會角僅 ${circleIntersectDeg.toFixed(1)}°，建議改選其他控制點。`;
  }

  const strengthScore = Math.round(Math.min(100, sinTheta * 100));

  return {
    ok: true,
    nP,
    eP,
    dangerCircle,
    dangerWarning,
    strengthScore,
    circumcenter,
    circumradius,
    checkAlphaDeg,
    checkBetaDeg,
  };
}

/**
 * 4. Point to Line Segment Perpendicular Distance (點到地籍線垂距檢核)
 */
export function computePointToLineOffset(
  p: { n: number; e: number },
  a: { n: number; e: number },
  b: { n: number; e: number }
): {
  perpendicularDist: number;
  signedOffset: number;
  foot: { n: number; e: number };
  t: number;
  onSegment: boolean;
  segmentLength: number;
} {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  const lenSq = dn * dn + de * de;
  const len = Math.sqrt(lenSq);

  if (len < 1e-8) {
    const dist = Math.hypot(p.n - a.n, p.e - a.e);
    return {
      perpendicularDist: dist,
      signedOffset: dist,
      foot: { n: a.n, e: a.e },
      t: 0,
      onSegment: true,
      segmentLength: 0,
    };
  }

  const t = ((p.n - a.n) * dn + (p.e - a.e) * de) / lenSq;
  const foot = {
    n: a.n + t * dn,
    e: a.e + t * de,
  };
  const perpendicularDist = Math.hypot(p.n - foot.n, p.e - foot.e);
  // Signed offset (+ right of A->B, - left of A->B)
  const cross = dn * (p.e - a.e) - de * (p.n - a.n);
  const signedOffset = cross / len;

  return {
    perpendicularDist,
    signedOffset,
    foot,
    t,
    onSegment: t >= -1e-6 && t <= 1 + 1e-6,
    segmentLength: len,
  };
}

/**
 * 5. Shoelace Polygon Area (高斯面積公式)
 */
export function computeShoelaceArea(vertices: { n: number; e: number }[]): {
  areaSqm: number;
  areaPing: number;
  perimeter: number;
} {
  if (vertices.length < 3) {
    return { areaSqm: 0, areaPing: 0, perimeter: 0 };
  }
  let sum = 0;
  let perimeter = 0;
  for (let i = 0; i < vertices.length; i++) {
    const cur = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    sum += cur.e * next.n - next.e * cur.n;
    perimeter += Math.hypot(next.n - cur.n, next.e - cur.e);
  }
  const areaSqm = Math.abs(sum) / 2;
  return {
    areaSqm,
    areaPing: areaSqm * 0.3025,
    perimeter,
  };
}

function pointToSegmentDistSq(
  pn: number,
  pe: number,
  an: number,
  ae: number,
  bn: number,
  be: number
): number {
  let e = ae;
  let n = an;
  let de = be - ae;
  let dn = bn - an;
  if (de !== 0 || dn !== 0) {
    const t = ((pe - ae) * de + (pn - an) * dn) / (de * de + dn * dn);
    if (t > 1) {
      e = be;
      n = bn;
    } else if (t > 0) {
      e += de * t;
      n += dn * t;
    }
  }
  de = pe - e;
  dn = pn - n;
  return de * de + dn * dn;
}

function signedPointToPolygonDist(
  pn: number,
  pe: number,
  ring: { n: number; e: number }[]
): number {
  let inside = false;
  let minDistSq = Infinity;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.n > pn !== b.n > pn &&
      pe < ((b.e - a.e) * (pn - a.n)) / (b.n - a.n) + a.e
    ) {
      inside = !inside;
    }
    const dSq = pointToSegmentDistSq(pn, pe, a.n, a.e, b.n, b.e);
    if (dSq < minDistSq) minDistSq = dSq;
  }

  const dist = Math.sqrt(minDistSq);
  return inside ? dist : -dist;
}

function computeAreaCentroid(ring: { n: number; e: number }[]): { n: number; e: number } {
  let area2 = 0;
  let ce = 0;
  let cn = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const f = a.e * b.n - b.e * a.n;
    ce += (a.e + b.e) * f;
    cn += (a.n + b.n) * f;
    area2 += f;
  }

  if (Math.abs(area2) < 1e-9) {
    const n = ring.reduce((s, v) => s + v.n, 0) / ring.length;
    const e = ring.reduce((s, v) => s + v.e, 0) / ring.length;
    return { n, e };
  }

  return {
    e: ce / (3 * area2),
    n: cn / (3 * area2),
  };
}

/**
 * 6. Pole of Inaccessibility (Polylabel)
 * Finds the visual center guaranteed to lie inside any simple polygon (including concave, L/U/C shapes).
 */
export function computePolygonVisualCenter(
  vertices: { n: number; e: number }[]
): { n: number; e: number } {
  if (vertices.length === 0) return { n: 0, e: 0 };
  if (vertices.length < 3) {
    return {
      n: vertices.reduce((s, v) => s + v.n, 0) / vertices.length,
      e: vertices.reduce((s, v) => s + v.e, 0) / vertices.length,
    };
  }

  // Strip duplicate closing vertex if present
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const ring =
    vertices.length > 3 && Math.hypot(first.n - last.n, first.e - last.e) < 1e-6
      ? vertices.slice(0, -1)
      : vertices;

  let minN = Infinity;
  let minE = Infinity;
  let maxN = -Infinity;
  let maxE = -Infinity;
  for (const v of ring) {
    if (v.n < minN) minN = v.n;
    if (v.e < minE) minE = v.e;
    if (v.n > maxN) maxN = v.n;
    if (v.e > maxE) maxE = v.e;
  }

  const width = maxE - minE;
  const height = maxN - minN;
  const cellSize = Math.min(width, height);
  if (cellSize < 1e-6) {
    return { n: (minN + maxN) / 2, e: (minE + maxE) / 2 };
  }

  const precision = Math.max(0.01, cellSize * 0.005);

  interface PolylabelCell {
    n: number;
    e: number;
    h: number;
    dist: number;
    max: number;
  }

  const makeCell = (n: number, e: number, h: number): PolylabelCell => {
    const dist = signedPointToPolygonDist(n, e, ring);
    return { n, e, h, dist, max: dist + h * Math.SQRT2 };
  };

  const queue: PolylabelCell[] = [];
  const hInit = cellSize / 2;
  for (let e = minE; e < maxE; e += cellSize) {
    for (let n = minN; n < maxN; n += cellSize) {
      queue.push(makeCell(n + hInit, e + hInit, hInit));
    }
  }

  const areaCentroid = computeAreaCentroid(ring);
  let bestCell = makeCell(areaCentroid.n, areaCentroid.e, 0);
  const bboxCenterCell = makeCell(minN + height / 2, minE + width / 2, 0);
  if (bboxCenterCell.dist > bestCell.dist) {
    bestCell = bboxCenterCell;
  }

  queue.sort((a, b) => a.max - b.max);

  let iterations = 0;
  while (queue.length > 0 && iterations < 1200) {
    iterations++;
    const cell = queue.pop()!;
    if (cell.dist > bestCell.dist) {
      bestCell = cell;
    }
    if (cell.max - bestCell.dist <= precision) continue;

    const h2 = cell.h / 2;
    const children = [
      makeCell(cell.n - h2, cell.e - h2, h2),
      makeCell(cell.n - h2, cell.e + h2, h2),
      makeCell(cell.n + h2, cell.e - h2, h2),
      makeCell(cell.n + h2, cell.e + h2, h2),
    ];
    for (const child of children) {
      if (child.max > bestCell.dist) {
        // Binary insert descending/ascending (keep largest at end for O(1) pop)
        let lo = 0;
        let hi = queue.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (queue[mid].max < child.max) lo = mid + 1;
          else hi = mid;
        }
        queue.splice(lo, 0, child);
      }
    }
  }

  if (bestCell.dist > 0) {
    return { n: bestCell.n, e: bestCell.e };
  }
  return areaCentroid;
}

export interface BoundaryStakeoutGuidance {
  nObs: number;
  eObs: number;
  obsAzDeg: number;
  designHzDeg: number;
  designDist: number;
  /** > 0: move forward toward station; < 0: move backward away from station */
  forwardTowardStation: number;
  /** > 0: move right (from station facing observation); < 0: move left */
  rightFromStation: number;
  totalOffset: number;
}

/**
 * 7. Boundary Stakeout Guidance (界址測量放樣修正)
 * Given station S, backsight azimuth, target boundary point T, and observed (Hz angle, distance):
 * - Computes observed point O
 * - Computes correction offsets to move O -> T:
 *   - Left / Right: from station's viewpoint looking along S -> O
 *   - Forward / Backward: facing station (toward S = forward, away from S = backward)
 */
export function computeBoundaryStakeoutGuidance(params: {
  nSt: number;
  eSt: number;
  backsightAzDeg: number;
  nTarget: number;
  eTarget: number;
  obsHzDeg: number;
  obsDist: number;
}): BoundaryStakeoutGuidance {
  const { nSt, eSt, backsightAzDeg, nTarget, eTarget, obsHzDeg, obsDist } = params;

  const designInv = inverseCalculation(nSt, eSt, nTarget, eTarget);
  const designHzDeg = normalizeDeg(designInv.azimuthDeg - backsightAzDeg);
  const designDist = designInv.distance;

  const rad = computeRadiation({
    n0: nSt,
    e0: eSt,
    backsightAzDeg,
    hzAngleDeg: obsHzDeg,
    distance: obsDist,
  });

  // Sightline unit vector from station S toward observed point O
  let uN: number;
  let uE: number;
  if (obsDist > 1e-6) {
    uN = (rad.nP - nSt) / obsDist;
    uE = (rad.eP - eSt) / obsDist;
  } else {
    const r = rad.targetAzDeg * DEG_TO_RAD;
    uN = Math.cos(r);
    uE = Math.sin(r);
  }

  // Right unit vector (90° clockwise from u in (N, E))
  const rN = -uE;
  const rE = uN;

  // Displacement vector from observed point O to target boundary point T
  const dN = nTarget - rad.nP;
  const dE = eTarget - rad.eP;

  // Forward = toward station (-u); Backward = away from station (+u)
  const forwardTowardStation = -(dN * uN + dE * uE);
  const rightFromStation = dN * rN + dE * rE;
  const totalOffset = Math.hypot(dN, dE);

  return {
    nObs: rad.nP,
    eObs: rad.eP,
    obsAzDeg: rad.targetAzDeg,
    designHzDeg,
    designDist,
    forwardTowardStation,
    rightFromStation,
    totalOffset,
  };
}

/**
 * Ray-casting point-in-polygon test in planar TM2 coordinates.
 */
export function isPointInPolygon(
  pn: number,
  pe: number,
  vertices: { n: number; e: number }[]
): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    const intersect =
      a.n > pn !== b.n > pn &&
      pe < ((b.e - a.e) * (pn - a.n)) / (b.n - a.n) + a.e;
    if (intersect) inside = !inside;
  }
  return inside;
}

