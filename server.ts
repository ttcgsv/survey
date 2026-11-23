import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  CrsId,
  FieldPoint,
  FieldPointKind,
  FieldPointSource,
  SectionDataBundle,
} from './src/types/cadastral.ts';

const PORT = 3000;
const SRC_DATA_DIR = path.resolve(process.cwd(), 'src', 'data');
const CSV_DATA_DIR = path.resolve(process.cwd(), 'data');
const SUPPORTED_EXTS = new Set(['COA', 'BNP', 'PAR', 'CTL', 'UPN', 'RCO', 'MAP', 'DIS']);
const VALID_SOURCES = new Set<FieldPointSource>([
  'radiation',
  'intersection_dir',
  'intersection_dist',
  'resection',
  'manual',
]);
const KIND_TO_LABEL: Record<FieldPointKind, string> = {
  control: '圖根點',
  urban: '都計樁',
  ref: '參考點',
  field: '實測點',
};

function parsePointKind(raw?: string): FieldPointKind {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (clean === 'control' || clean === '圖根點') return 'control';
  if (clean === 'urban' || clean === '都計樁') return 'urban';
  if (clean === 'ref' || clean === '參考點') return 'ref';
  return 'field';
}

function validateSectionCode(raw: string): string | null {
  const clean = raw.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(clean)) return null;
  if (clean === 'INDEX') return null;
  return clean;
}

function confinePath(baseDir: string, fileName: string): string {
  const resolved = path.resolve(baseDir, fileName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Path escapes allowed directory');
  }
  return resolved;
}

function decodeBufferAuto(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('big5').decode(buffer);
  }
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

function escapeCsvCell(val: string): string {
  const cleaned = val.replace(/[\r\n]+/g, ' ');
  if (/[",]/.test(cleaned)) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

function sanitizeTextCell(val: string): string {
  const trimmed = val.trim();
  if (/^[=+\t@]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

function parseCsvFieldPoints(text: string, defaultCrs: CrsId): FieldPoint[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
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
      if (cols[4] && VALID_SOURCES.has(cols[4] as FieldPointSource)) {
        source = cols[4] as FieldPointSource;
      }
      note = cols[5] ?? '';
      if (cols[6]) createdAt = cols[6];
      if (cols[7]) pointKind = parsePointKind(cols[7]);
    } else if (cols.length >= 4) {
      // Tolerant Notepad manual edit format: 點號, N, E, 備註
      note = cols[3] ?? '';
    }

    points.push({
      uid: `csv-${i}-${id}-${Math.round(n * 1000)}`,
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

function serializeFieldPointsCsv(points: FieldPoint[]): string {
  const header = '點號,縱坐標N,橫坐標E,坐標系統,來源,備註,建立時間,點位類別';
  const rows = points.map((p) => {
    const safeId = escapeCsvCell(sanitizeTextCell(p.id));
    const safeN = Number(p.n).toFixed(3);
    const safeE = Number(p.e).toFixed(3);
    const safeCrs = p.crs === 'EPSG:3828' ? 'EPSG:3828' : 'EPSG:3826';
    const safeSource = VALID_SOURCES.has(p.source) ? p.source : 'manual';
    const safeNote = escapeCsvCell(sanitizeTextCell(p.note || ''));
    const safeTime = escapeCsvCell(p.createdAt || new Date().toISOString());
    const safeKind = KIND_TO_LABEL[parsePointKind(p.pointKind)];
    return `${safeId},${safeN},${safeE},${safeCrs},${safeSource},${safeNote},${safeTime},${safeKind}`;
  });
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

async function readSectionBundlesFromDisk(): Promise<SectionDataBundle[]> {
  await fs.mkdir(SRC_DATA_DIR, { recursive: true });
  const entries = await fs.readdir(SRC_DATA_DIR, { withFileTypes: true });
  const bundles: SectionDataBundle[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name === 'index.ts') {
      continue;
    }
    const filePath = confinePath(SRC_DATA_DIR, entry.name);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // Fast JSON extraction for generated bundles
      const marker = 'const sectionBundle: SectionDataBundle = ';
      const markerIdx = content.indexOf(marker);
      const exportIdx = content.lastIndexOf('export default sectionBundle');
      if (markerIdx >= 0 && exportIdx > markerIdx) {
        const rawBlock = content
          .slice(markerIdx + marker.length, exportIdx)
          .trim()
          .replace(/;\s*$/, '');
        if (rawBlock.startsWith('{') && !rawBlock.includes('`')) {
          const parsed = JSON.parse(rawBlock) as SectionDataBundle;
          if (parsed?.code && Array.isArray(parsed.files)) {
            bundles.push(parsed);
            continue;
          }
        }
      }

      // Dynamic ESM import fallback for template-literal TS modules
      const modUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
      const mod = (await import(modUrl)) as { default?: SectionDataBundle };
      if (mod?.default?.code && Array.isArray(mod.default.files)) {
        bundles.push(mod.default);
      }
    } catch (err) {
      console.error(`Failed reading section TS file ${entry.name}:`, err);
    }
  }

  bundles.sort((a, b) => a.code.localeCompare(b.code));
  return bundles;
}

async function startServer() {
  await fs.mkdir(SRC_DATA_DIR, { recursive: true });
  await fs.mkdir(CSV_DATA_DIR, { recursive: true });

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // 1. Read all *.ts section bundles from src/data/ on disk
  app.get('/api/sections/disk', async (_req, res) => {
    try {
      const bundles = await readSectionBundlesFromDisk();
      res.json({ bundles });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: '無法掃描 src/data 地段檔案' });
    }
  });

  // 2. Write converted *.ts module into src/data/{CODE}.ts (with overwrite check)
  app.post('/api/sections/import-ts', async (req, res) => {
    try {
      const body = req.body as {
        code?: string;
        label?: string;
        crs?: string;
        files?: { name: string; encoding?: 'UTF-8' | 'Big5'; text: string }[];
        overwrite?: boolean;
      };

      const code = validateSectionCode(String(body.code ?? ''));
      if (!code) {
        res.status(400).json({ error: '段代碼格式無效（需為 2~24 碼英數、底線或連字號）' });
        return;
      }

      const label = String(body.label ?? '').trim() || `${code} 地段`;
      const crs: CrsId = body.crs === 'EPSG:3828' ? 'EPSG:3828' : 'EPSG:3826';

      if (!Array.isArray(body.files) || body.files.length === 0) {
        res.status(400).json({ error: '未包含任何有效交換檔內容' });
        return;
      }

      const sanitizedFiles = body.files
        .filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string')
        .map((f) => {
          const base = path.basename(f.name).toUpperCase();
          const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
          return { base, ext, encoding: f.encoding === 'Big5' ? ('Big5' as const) : ('UTF-8' as const), text: f.text };
        })
        .filter((f) => SUPPORTED_EXTS.has(f.ext))
        .map((f) => ({
          name: f.base,
          encoding: f.encoding,
          text: f.text,
        }));

      if (sanitizedFiles.length === 0) {
        res.status(400).json({ error: '未偵測到支援的 8 類地籍交換檔' });
        return;
      }

      // Check existing *.ts in src/data/ (case-insensitive)
      const existingBundles = await readSectionBundlesFromDisk();
      const collisionByCode = existingBundles.find((b) => b.code.toUpperCase() === code);
      const targetTsName = `${code}.ts`;
      const targetTsPath = confinePath(SRC_DATA_DIR, targetTsName);

      if (collisionByCode && !body.overwrite) {
        res.status(409).json({
          exists: true,
          code,
          existingLabel: collisionByCode.label,
          message: `src/data/${targetTsName} 已存在`,
        });
        return;
      }

      const bundle: SectionDataBundle = {
        code,
        label,
        crs,
        files: sanitizedFiles,
      };

      const tsOutput = [
        "import type { SectionDataBundle } from '../types/cadastral';",
        '',
        `const sectionBundle: SectionDataBundle = ${JSON.stringify(bundle, null, 2)};`,
        '',
        'export default sectionBundle;',
        '',
      ].join('\n');

      await fs.writeFile(targetTsPath, tsOutput, 'utf-8');

      // Ensure data/{CODE}.csv exists without wiping existing user field points if overwriting
      const csvPath = confinePath(CSV_DATA_DIR, `${code}.csv`);
      try {
        await fs.access(csvPath);
      } catch {
        await fs.writeFile(csvPath, serializeFieldPointsCsv([]), 'utf-8');
      }

      res.json({ ok: true, bundle });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: '寫入 .ts 地段模組失敗' });
    }
  });

  // 3. Read section field points from data/{CODE}.csv
  app.get('/api/field-points/:code', async (req, res) => {
    try {
      const code = validateSectionCode(req.params.code);
      if (!code) {
        res.status(400).json({ error: '段代碼無效' });
        return;
      }

      const defaultCrs: CrsId = req.query.crs === 'EPSG:3828' ? 'EPSG:3828' : 'EPSG:3826';
      const csvPath = confinePath(CSV_DATA_DIR, `${code}.csv`);

      try {
        const buffer = await fs.readFile(csvPath);
        const text = decodeBufferAuto(buffer);
        const points = parseCsvFieldPoints(text, defaultCrs);
        res.json({ code, fileName: `${code}.csv`, exists: true, points });
      } catch {
        res.json({ code, fileName: `${code}.csv`, exists: false, points: [] });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: '讀取 CSV 實測點庫失敗' });
    }
  });

  // 4. Write section field points to data/{CODE}.csv (UTF-8 BOM)
  app.put('/api/field-points/:code', async (req, res) => {
    try {
      const code = validateSectionCode(req.params.code);
      if (!code) {
        res.status(400).json({ error: '段代碼無效' });
        return;
      }

      const rawPoints = (req.body as { points?: unknown[] })?.points;
      if (!Array.isArray(rawPoints)) {
        res.status(400).json({ error: 'points 必須為陣列' });
        return;
      }

      const validPoints: FieldPoint[] = [];
      for (let i = 0; i < rawPoints.length; i++) {
        const item = rawPoints[i] as Partial<FieldPoint>;
        const n = Number(item?.n);
        const e = Number(item?.e);
        const id = String(item?.id ?? '').trim();
        if (!id || !Number.isFinite(n) || !Number.isFinite(e)) {
          res.status(400).json({ error: `第 ${i + 1} 筆實測點資料格式無效` });
          return;
        }
        validPoints.push({
          uid: String(item.uid || `fp-${i}`),
          id: id.slice(0, 32),
          note: String(item.note ?? '').slice(0, 200),
          n,
          e,
          crs: item.crs === 'EPSG:3828' ? 'EPSG:3828' : 'EPSG:3826',
          source: VALID_SOURCES.has(item.source as FieldPointSource)
            ? (item.source as FieldPointSource)
            : 'manual',
          pointKind: parsePointKind(item.pointKind),
          createdAt: String(item.createdAt || new Date().toISOString()),
        });
      }

      const csvPath = confinePath(CSV_DATA_DIR, `${code}.csv`);
      const csvContent = serializeFieldPointsCsv(validPoints);
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      res.json({ ok: true, code, fileName: `${code}.csv`, count: validPoints.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: '寫入 CSV 實測點庫失敗' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
