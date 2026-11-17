// Strict R5: drop a coverage Missing finding only when the package is a devDependency somewhere,
// absent from every runtime field, and every import site is outside shipped source.
// The path policy lives in lib/path-kind.js: tooling folders, config files and hidden directories
// are not shipped. Found live: a jsdom import inside .dumi/theme looked like shipped source.
import { isShippedSource } from './path-kind.js';

const shipped = isShippedSource;

function sitesFor(sources) {
  const map = new Map();
  for (const [file, text] of Object.entries(sources ?? {})) {
    if (!/\.(?:[cm]?js|[cm]?ts|jsx|tsx|mts|cts)$/.test(file)) continue;
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g)) {
      const spec = m[1];
      if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/.test(spec)) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(file);
    }
  }
  return map;
}

export function strictR5Drop(snapshot, name) {
  const pkgs = [snapshot.pkg, ...(snapshot.workspaces ?? []).map((w) => w.pkg)].filter(Boolean);
  const dev = pkgs.some((p) => p.devDependencies?.[name]);
  const runtime = pkgs.some((p) => p.dependencies?.[name] || p.peerDependencies?.[name] || p.optionalDependencies?.[name]);
  if (!dev || runtime) return false;
  const sites = [...(sitesFor(snapshot.sources).get(name) ?? [])];
  return sites.length > 0 && sites.every((p) => !shipped(p));
}
