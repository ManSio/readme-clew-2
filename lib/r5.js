// Strict R5: drop a coverage Missing finding only when the package is a devDependency somewhere,
// absent from every runtime field, and every import site is outside shipped source.
const NON_SHIPPED_DIR = /(^|\/)(?:tests?|__tests__|__benchmarks__|__performance_tests__|spec|e2e|fixtures|examples?|demos?|benchmarks?|benches|bench|docs?|scripts|tools)\//i;
const NON_SHIPPED_FILE = /(^|\/)(?:gulpfile\.[cm]?[jt]s|gruntfile\.[cm]?[jt]s|herebyfile\.[cm]?[jt]s|makefile(?:\.[a-z]+)?\.[cm]?[jt]s|makefile|[^/]*\.(?:config|workspace)\.[^/]*\.[cm]?[jt]s|[^/]*\.(?:config|workspace)\.[cm]?[jt]s|[^/]*\.(?:test|spec)\.[cm]?[jt]s|\.[^/]*rc(?:\.[^/]*)?\.[cm]?[jt]s|test\.[cm]?[jt]s|[^/]*\.setup\.[cm]?[jt]s|[^/]*\.jest\.[^/]*\.[cm]?[jt]s|[^/]*\.jest\.[cm]?[jt]s|[^/]*\.fatherrc\.[cm]?[jt]s|[^/]*\.dumirc\.[cm]?[jt]s)$/i;

const shipped = (p) => !NON_SHIPPED_DIR.test(p) && !NON_SHIPPED_FILE.test(p);

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
