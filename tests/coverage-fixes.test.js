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

test('coverage: strict R5 treats hidden tooling directories as non-shipped', () => {
  const hidden = {
    pkg: { name: 'demo', devDependencies: { '@storybook/react': '^8.0.0' } },
    workspaces: [],
    files: ['package.json', '.storybook/main.ts', 'src/index.js'],
    sources: { '.storybook/main.ts': "import { x } from '@storybook/react';\n", 'src/index.js': 'export const x = 1;\n' },
  };
  assert.ok(missingNames(hidden).includes('@storybook/react'));
  assert.ok(!missingNames(hidden, { strictR5: true }).includes('@storybook/react'));

  // Control: the same package imported from shipped source is kept, hidden dirs or not.
  const used = {
    ...hidden,
    files: [...hidden.files, 'src/story.ts'],
    sources: { ...hidden.sources, 'src/story.ts': "import { y } from '@storybook/react';\n" },
  };
  assert.ok(missingNames(used, { strictR5: true }).includes('@storybook/react'));
});

// scanRepo is the only real caller of scan(). If it drops the flag, the caveat can never reach a
// report, no matter what the pipeline does.
test('coverage: scanRepo carries the truncation flag from the fetched repo into the report', async () => {
  const { scanRepo } = await import('../lib/scan-repo.js');
  const ask = async (requests) => ({
    answers: Object.fromEntries(requests.flatMap((r) => Object.keys(r.questions)
      .map((id) => [id, { type: 'choice', choice: 'not_a_claim', confidence: 1, probabilities: {} }]))),
    calls: [],
  });
  const deps = (truncated) => ({
    fetchRepo: async () => ({ readme, readmePath: 'README.md', truncated, commit: 'a'.repeat(40), snapshot: undeclared }),
    summarize: async () => ({ notes: null, usage: { status: 'skipped' } }),
    ask,
    now: () => 0,
    runId: () => 'scan_test',
  });

  const plain = await scanRepo({ owner: 'demo', name: 'demo' }, deps(false));
  const plainFinding = plain.report.findings.find((f) => f.name === 'left-pad');
  assert.equal(plain.report.meta.readmeTruncated, false);
  assert.ok(!/cut at the 50 KB cap/.test(plainFinding.evidence.detail));

  const cut = await scanRepo({ owner: 'demo', name: 'demo' }, deps(true));
  const cutFinding = cut.report.findings.find((f) => f.name === 'left-pad');
  assert.equal(cut.report.meta.readmeTruncated, true);
  assert.equal(cutFinding.bucket, 'missing', 'the bucket must not change');
  assert.match(cutFinding.evidence.detail, /cut at the 50 KB cap/);
});

// The scan path, not just the pipeline, decides what a reader sees. A dev-only config import must
// not survive it, and a runtime import must.
test('coverage: scanRepo applies strict R5 to the report it returns', async () => {
  const { scanRepo } = await import('../lib/scan-repo.js');
  const ask = async (requests) => ({
    answers: Object.fromEntries(requests.flatMap((r) => Object.keys(r.questions)
      .map((id) => [id, { type: 'choice', choice: 'not_a_claim', confidence: 1, probabilities: {} }]))),
    calls: [],
  });
  const snapshot = {
    pkg: { name: 'demo', devDependencies: { jest: '^29.0.0' }, dependencies: { react: '^18.0.0' } },
    workspaces: [],
    files: ['package.json', 'jest.config.js', 'src/index.js'],
    sources: { 'jest.config.js': "import { run } from 'jest';\n", 'src/index.js': "import react from 'react';\n" },
  };
  const deps = {
    fetchRepo: async () => ({ readme, readmePath: 'README.md', truncated: false, commit: 'a'.repeat(40), snapshot }),
    summarize: async () => ({ notes: null, usage: { status: 'skipped' } }),
    ask,
    now: () => 0,
    runId: () => 'scan_test',
  };
  const { report } = await scanRepo({ owner: 'demo', name: 'demo' }, deps);
  const missing = report.findings.filter((f) => f.bucket === 'missing').map((f) => f.name);
  assert.ok(!missing.includes('jest'), `jest survived: ${JSON.stringify(missing)}`);
  assert.ok(missing.includes('react'), 'a runtime dependency must stay a finding');
});
