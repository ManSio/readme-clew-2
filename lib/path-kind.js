// What a repository path is, in one place.
//
// Two policies ask the same question with different answers: coverage.js ignores folders that show
// how to use a package (examples, tests, docs, benchmarks), while r5.js also ignores tooling
// (configs, build scripts, hidden folders). Keeping both here makes the difference explicit instead
// of leaving two regexes to drift apart.
//
// Segment based and case insensitive on purpose: a folder called "src-test" is source, not a test
// folder, and "Tests/" must not slip through because of its capital letter.

// Their imports say nothing about what the package needs.
const NON_SOURCE = new Set([
  'example', 'examples', 'demo', 'demos', 'test', 'tests', '__tests__',
  'fixtures', 'docs', 'benchmark', 'benchmarks', 'benches', 'bench', '@types',
]);

// The wider set: nothing here ends up in the published package.
const NON_SHIPPED = new Set([
  'test', 'tests', '__tests__', '__benchmarks__', '__performance_tests__', 'spec', 'e2e',
  'fixtures', 'example', 'examples', 'demo', 'demos', 'benchmark', 'benchmarks', 'benches', 'bench',
  'doc', 'docs', 'scripts', 'tools',
]);

// Build and test configuration by file name: gulpfile, Herebyfile, Makefile, *.config.*, .*rc*,
// test.js, *.setup.*, *.jest.*, *.fatherrc.*, *.dumirc.*.
const CONFIG_FILE = /(^|\/)(?:gulpfile\.[cm]?[jt]s|gruntfile\.[cm]?[jt]s|herebyfile\.[cm]?[jt]s|makefile(?:\.[a-z]+)?\.[cm]?[jt]s|makefile|[^/]*\.(?:config|workspace)\.[^/]*\.[cm]?[jt]s|[^/]*\.(?:config|workspace)\.[cm]?[jt]s|[^/]*\.(?:test|spec)\.[cm]?[jt]s|\.[^/]*rc(?:\.[^/]*)?\.[cm]?[jt]s|test\.[cm]?[jt]s|[^/]*\.setup\.[cm]?[jt]s|[^/]*\.jest\.[^/]*\.[cm]?[jt]s|[^/]*\.jest\.[cm]?[jt]s|[^/]*\.fatherrc\.[cm]?[jt]s|[^/]*\.dumirc\.[cm]?[jt]s)$/i;

// A .test-d.ts file checks the published types; it does not ship and it is not a dependency.
const TYPE_TEST = /\.test-d\.[cm]?[jt]s$/i;

const folders = (file) => String(file ?? '').toLowerCase().split('/').slice(0, -1);
// Control characters never appear in a GitHub path, but stripping them keeps a hostile string from
// dodging the config rule: "jest.config.js\u0000" would otherwise not match the anchor and count as
// shipped source.
const clean = (file) => String(file ?? '').replace(/[\u0000-\u001F\u007F]/g, '');
const hasFolder = (file, set) => folders(clean(file)).some((s) => set.has(s));

// A folder whose name starts with a dot is tooling: .dumi is a docs build, .storybook a preview
// harness, .github CI actions. A dotfile at the root, such as .eslintrc.js, is not a folder.
export const isHiddenFolder = (file) => folders(clean(file)).some((s) => s.length > 1 && s.startsWith('.'));

// True when the file sits in a folder that only demonstrates or tests the package.
export const isNonSourceImportSite = (file) => hasFolder(file, NON_SOURCE);

// True when the file could end up in the published package.
export const isShippedSource = (file) => !isHiddenFolder(file) && !CONFIG_FILE.test(clean(file)) && !hasFolder(file, NON_SHIPPED);

export const isConfigFile = (file) => CONFIG_FILE.test(clean(file));
export const isTypeTest = (file) => TYPE_TEST.test(clean(file));
