import type { CadastralSection, SectionDataBundle } from '../types/cadastral';
import { parseCadastralBatch } from '../utils/cadastralParser';

const moduleEntries = import.meta.glob<{ default?: SectionDataBundle }>(['./*.ts', '!./index.ts'], {
  eager: true,
});

export function getStaticSectionBundles(): SectionDataBundle[] {
  const bundles: SectionDataBundle[] = [];
  for (const mod of Object.values(moduleEntries)) {
    if (mod?.default && mod.default.code && Array.isArray(mod.default.files)) {
      bundles.push(mod.default);
    }
  }
  bundles.sort((a, b) => a.code.localeCompare(b.code));
  return bundles;
}

export function bundleToCadastralSection(
  bundle: SectionDataBundle,
  source: 'demo' | 'local' = 'demo'
): CadastralSection | null {
  const parsed = parseCadastralBatch(
    bundle.files.map((f) => ({
      name: f.name,
      encoding: f.encoding ?? 'UTF-8',
      text: f.text,
    })),
    {
      source,
      defaultCrs: bundle.crs,
      labelOverrides: {
        [bundle.code]: bundle.label,
      },
    }
  );
  if (parsed.length === 0) return null;
  return {
    ...parsed[0],
    source,
    code: bundle.code,
    label: bundle.label,
    crs: bundle.crs,
  };
}

export function loadStaticSections(): CadastralSection[] {
  const sections: CadastralSection[] = [];
  for (const bundle of getStaticSectionBundles()) {
    const sec = bundleToCadastralSection(bundle);
    if (sec) sections.push(sec);
  }
  return sections;
}
