import type {
  CrsId,
  FieldPoint,
  FieldPointKind,
  FieldPointSource,
  SectionDataBundle,
} from '../types/cadastral';

const DB_NAME = 'tw_cadastral_workspace_v1';
const DB_VERSION = 1;

const STORE_SECTIONS = 'localSections';
const STORE_FIELD_POINTS = 'fieldPoints';
const STORE_PREFS = 'sectionPrefs';

const LS_ACTIVE_SECTION = 'tw_cadastral_active_section_v1';
const LS_FALLBACK_CRS = 'tw_cadastral_crs_prefs_v1';
const LS_FALLBACK_POINTS_PREFIX = 'tw_cadastral_fp_v1_';

interface StoredSectionRecord extends SectionDataBundle {
  updatedAt: string;
}

interface StoredFieldPointsRecord {
  sectionCode: string;
  points: FieldPoint[];
  updatedAt: string;
}

interface StoredSectionPrefRecord {
  code: string;
  crs: CrsId;
  updatedAt: string;
}

const VALID_SOURCES = new Set<FieldPointSource>([
  'radiation',
  'intersection_dir',
  'intersection_dist',
  'resection',
  'manual',
]);

function parsePointKind(raw?: string): FieldPointKind {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (clean === 'control' || clean === '圖根點') return 'control';
  if (clean === 'urban' || clean === '都計樁') return 'urban';
  if (clean === 'ref' || clean === '參考點') return 'ref';
  return 'field';
}

function parseSourceLabel(raw?: string): FieldPointSource {
  const clean = String(raw ?? '').trim();
  if (VALID_SOURCES.has(clean as FieldPointSource)) {
    return clean as FieldPointSource;
  }
  switch (clean) {
    case '光線法':
      return 'radiation';
    case '夾角交會':
      return 'intersection_dir';
    case '距離交會':
      return 'intersection_dist';
    case '後方交會':
      return 'resection';
    default:
      return 'manual';
  }
}

function openWorkspaceDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SECTIONS)) {
          db.createObjectStore(STORE_SECTIONS, { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains(STORE_FIELD_POINTS)) {
          db.createObjectStore(STORE_FIELD_POINTS, { keyPath: 'sectionCode' });
        }
        if (!db.objectStoreNames.contains(STORE_PREFS)) {
          db.createObjectStore(STORE_PREFS, { keyPath: 'code' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openWorkspaceDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = executor(store);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch {
        db.close();
        resolve(null);
      }
    });
  });
}

export function getSavedActiveSectionCode(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE_SECTION);
  } catch {
    return null;
  }
}

export function saveActiveSectionCode(code: string): void {
  try {
    localStorage.setItem(LS_ACTIVE_SECTION, code);
  } catch {
    // Ignore storage quota errors
  }
}

export async function loadAllLocalSections(): Promise<SectionDataBundle[]> {
  const result = await runTx<StoredSectionRecord[]>(STORE_SECTIONS, 'readonly', (store) =>
    store.getAll()
  );
  if (!Array.isArray(result)) return [];
  return result
    .filter((item) => item && item.code && Array.isArray(item.files))
    .map((item) => ({
      code: item.code.toUpperCase(),
      label: item.label,
      crs: item.crs,
      files: item.files,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function saveLocalSection(bundle: SectionDataBundle): Promise<boolean> {
  const record: StoredSectionRecord = {
    code: bundle.code.toUpperCase(),
    label: bundle.label,
    crs: bundle.crs,
    files: bundle.files,
    updatedAt: new Date().toISOString(),
  };
  const db = await openWorkspaceDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SECTIONS, 'readwrite');
      tx.objectStore(STORE_SECTIONS).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function deleteLocalSection(code: string): Promise<boolean> {
  const cleanCode = code.trim().toUpperCase();
  const db = await openWorkspaceDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SECTIONS, 'readwrite');
      tx.objectStore(STORE_SECTIONS).delete(cleanCode);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function loadLocalFieldPoints(sectionCode: string): Promise<FieldPoint[] | null> {
  const cleanCode = sectionCode.trim().toUpperCase();
  const record = await runTx<StoredFieldPointsRecord | undefined>(
    STORE_FIELD_POINTS,
    'readonly',
    (store) => store.get(cleanCode)
  );
  if (record && Array.isArray(record.points)) {
    return record.points;
  }

  try {
    const raw = localStorage.getItem(`${LS_FALLBACK_POINTS_PREFIX}${cleanCode}`);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as FieldPoint[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export async function saveLocalFieldPoints(
  sectionCode: string,
  points: FieldPoint[]
): Promise<boolean> {
  const cleanCode = sectionCode.trim().toUpperCase();
  const record: StoredFieldPointsRecord = {
    sectionCode: cleanCode,
    points,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`${LS_FALLBACK_POINTS_PREFIX}${cleanCode}`, JSON.stringify(points));
  } catch {
    // Ignore localStorage fallback failure if payload is large
  }

  const db = await openWorkspaceDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_FIELD_POINTS, 'readwrite');
      tx.objectStore(STORE_FIELD_POINTS).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function loadSectionCrsMap(): Promise<Record<string, CrsId>> {
  const map: Record<string, CrsId> = {};
  try {
    const raw = localStorage.getItem(LS_FALLBACK_CRS);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, CrsId>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'EPSG:3826' || v === 'EPSG:3828') {
          map[k.toUpperCase()] = v;
        }
      }
    }
  } catch {
    // Ignore localStorage errors
  }

  const records = await runTx<StoredSectionPrefRecord[]>(STORE_PREFS, 'readonly', (store) =>
    store.getAll()
  );
  if (Array.isArray(records)) {
    for (const rec of records) {
      if (rec?.code && (rec.crs === 'EPSG:3826' || rec.crs === 'EPSG:3828')) {
        map[rec.code.toUpperCase()] = rec.crs;
      }
    }
  }
  return map;
}

export async function saveSectionCrsPref(code: string, crs: CrsId): Promise<void> {
  const cleanCode = code.trim().toUpperCase();
  try {
    const raw = localStorage.getItem(LS_FALLBACK_CRS);
    const parsed = raw ? (JSON.parse(raw) as Record<string, CrsId>) : {};
    parsed[cleanCode] = crs;
    localStorage.setItem(LS_FALLBACK_CRS, JSON.stringify(parsed));
  } catch {
    // Ignore localStorage errors
  }

  const db = await openWorkspaceDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_PREFS, 'readwrite');
      tx.objectStore(STORE_PREFS).put({
        code: cleanCode,
        crs,
        updatedAt: new Date().toISOString(),
      } satisfies StoredSectionPrefRecord);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export function parseCsvFieldPointsText(text: string, defaultCrs: CrsId): FieldPoint[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const points: FieldPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const cols = parseCsvLine(raw).map((c) => c.trim());
    if (cols.length < 3) continue;

    const firstLower = cols[0].toLowerCase();
    if (i === 0 && (cols[0] === '點號' || firstLower === 'id' || firstLower === 'point_id')) {
      continue;
    }

    const id = cols[0];
    const n = parseFloat(cols[1]);
    const e = parseFloat(cols[2]);
    if (!id || !Number.isFinite(n) || !Number.isFinite(e)) continue;

    let crs: CrsId = defaultCrs;
    let source: FieldPointSource = 'manual';
    let note = '';
    let createdAt = new Date().toISOString();
    let pointKind: FieldPointKind = 'field';

    if (cols.length >= 4 && (cols[3] === 'EPSG:3826' || cols[3] === 'EPSG:3828')) {
      crs = cols[3];
      if (cols[4]) source = parseSourceLabel(cols[4]);
      note = cols[5] ?? '';
      if (cols[6]) createdAt = cols[6];
      if (cols[7]) pointKind = parsePointKind(cols[7]);
    } else if (cols.length >= 4) {
      note = cols[3] ?? '';
    }

    points.push({
      uid: `csv-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      id,
      n,
      e,
      crs,
      source,
      pointKind,
      note,
      createdAt,
    });
  }

  return points;
}
