// Coverage semantics found by auditing reports on 86 real repos: a dev-only config import is noise,
// a bare specifier that names a local directory is not a package, and a cut README hides mentions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../lib/pipeline.js';

const noJev = new Proxy({}, { get: () => ({ choice: 'not_a_claim', confidence: 1 }) });
const readme = '# Demo\n\nNothing to see here.\n';
const run = (snapshot, opts = {}) => runPipeline({
  readme, repo: { owner: 'demo', name: 'demo' }, snapshot, jev: { labels: noJev, names: noJev }, ...opts,
});
const missingNames = (snapshot, opts) => run(snapshot, opts).findings.filter((f) => f.bucket === 'missing').map((f) => f.name);

// A lint/test tool imported only from its own config says nothing about what the package ships.
const configOnly = {
  pkg: { name: 'demo', devDependencies: { jest: '^29.0.0' } },
  workspaces: [],
  files: ['package.json', 'jest.config.js', 'src/index.js'],
  sources: { 'jest.config.js': "import { run } from 'jest';\n", 'src/index.js': 'export const x = 1;\n' },
};

test('coverage: strict R5 drops a devDependency imported only from a config file', () => {
  assert.ok(missingNames(configOnly).includes('jest'), 'the finding must exist before the filter');
  assert.ok(!missingNames(configOnly, { strictR5: true }).includes('jest'));
});

test('coverage: strict R5 keeps a runtime dependency, even when only a config imports it', () => {
  const runtime = {
    pkg: { name: 'demo', dependencies: { lodash: '4.17.21' }, devDependencies: { jest: '^29.0.0' } },
    workspaces: [],
    files: ['package.json', 'jest.config.js', 'src/index.js'],
    sources: { 'jest.config.js': "import _ from 'lodash';\nimport { run } from 'jest';\n", 'src/index.js': 'export const x = 1;\n' },
  };
  const names = missingNames(runtime, { strictR5: true });
  assert.ok(names.includes('lodash'), 'a runtime field must block the drop');
  assert.ok(!names.includes('jest'));
});

// jellyfin-web resolves "scripts/browser" to src/scripts/browser.js through a webpack alias the
// tsconfig map cannot see, so the bare first segment must not be reported as a package.
const localAlias = {
  pkg: { name: 'demo' },
  workspaces: [],
  files: ['package.json', 'src/RootApp.tsx', 'src/scripts/browser.js'],
  sources: { 'src/RootApp.tsx': "import browser from 'scripts/browser';\nimport pad from 'left-pad';\n" },
};

test('coverage: an undeclared name that is also a local directory is not Missing', () => {
  const names = missingNames(localAlias);
  assert.ok(!names.includes('scripts'), `scripts was reported: ${JSON.stringify(names)}`);
  // Control: a name with no matching directory is still reported, so the rule is not "drop everything".
  assert.ok(names.includes('left-pad'));
});

// A README cut at the 50 KB cap can hide the mention that would have kept a package out of Missing.
const undeclared = {
  pkg: { name: 'demo' },
  workspaces: [],
  files: ['package.json', 'src/index.js'],
  sources: { 'src/index.js': "import pad from 'left-pad';\n" },
};
const caveat = (opts) => run(undeclared, opts).findings.find((f) => f.name === 'left-pad');

test('coverage: a truncated README keeps the Missing bucket and adds the caveat', () => {
  const plain = caveat({ truncated: false });
  assert.equal(plain.bucket, 'missing');
  assert.ok(!/cut at the 50 KB cap/.test(plain.evidence.detail));

  const cut = caveat({ truncated: true });
  assert.equal(cut.bucket, 'missing', 'the bucket must not change');
  assert.match(cut.evidence.detail, /cut at the 50 KB cap/);
});

// The real scan path must carry the flag too, or the caveat would only exist in unit tests.
test('coverage: scan forwards the truncation flag to the pipeline', async () => {
  const { scan } = await import('../lib/pipeline.js');
  const ask = async (requests) => ({
    answers: Object.fromEntries(requests.flatMap((r) => Object.keys(r.questions)
      .map((id) => [id, { type: 'choice', choice: 'not_a_claim', confidence: 1, probabilities: {} }]))),
    calls: [],
  });
  const args = { readme, repo: { owner: 'demo', name: 'demo' }, snapshot: undeclared, ask };

  const plain = await scan(args);
  const plainFinding = plain.report.findings.find((f) => f.name === 'left-pad');
  assert.ok(!/cut at the 50 KB cap/.test(plainFinding.evidence.detail));

  const cut = await scan({ ...args, truncated: true });
  const cutFinding = cut.report.findings.find((f) => f.name === 'left-pad');
  assert.match(cutFinding.evidence.detail, /cut at the 50 KB cap/);
});
