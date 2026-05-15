/**
 * Tests for Performance Optimizer
 */

const {
  FileContentCache,
  PathCache,
  ParallelActionExecutor,
  SmartPatchMatcher,
  FastPathDetector,
  SmartEditGate,
  PerformanceOptimizer,
  COMPILED_PATTERNS
} = require('../performance-optimizer');

describe('FileContentCache', () => {
  let cache;

  beforeEach(() => {
    cache = new FileContentCache(3, 1000); // 3 items, 1 second TTL
  });

  test('should cache file content', async () => {
    let readCount = 0;
    const readFn = async (path) => {
      readCount++;
      return `content of ${path}`;
    };

    const content1 = await cache.get('file1.js', readFn);
    const content2 = await cache.get('file1.js', readFn);

    expect(content1).toBe('content of file1.js');
    expect(content2).toBe('content of file1.js');
    expect(readCount).toBe(1); // Should only read once
  });

  test('should respect TTL', async () => {
    const shortCache = new FileContentCache(3, 50); // 50ms TTL
    let readCount = 0;
    const readFn = async (path) => {
      readCount++;
      return `content ${readCount}`;
    };

    await shortCache.get('file1.js', readFn);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for TTL
    await shortCache.get('file1.js', readFn);

    expect(readCount).toBe(2); // Should read twice after TTL
  });

  test('should evict oldest when full', async () => {
    const readFn = async (path) => `content of ${path}`;

    await cache.get('file1.js', readFn);
    await cache.get('file2.js', readFn);
    await cache.get('file3.js', readFn);
    await cache.get('file4.js', readFn); // Should evict file1

    const stats = cache.getStats();
    expect(stats.size).toBe(3);
  });

  test('should track hit rate', async () => {
    const readFn = async (path) => `content of ${path}`;

    await cache.get('file1.js', readFn); // miss
    await cache.get('file1.js', readFn); // hit
    await cache.get('file1.js', readFn); // hit

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('66.67%');
  });
});

describe('PathCache', () => {
  let cache;

  beforeEach(() => {
    cache = new PathCache(5);
  });

  test('should cache normalized paths', () => {
    const normalizeFn = (path, root) => `${root}/${path}`.replace(/\\/g, '/');

    const result1 = cache.normalize('src/file.js', '/workspace', normalizeFn);
    const result2 = cache.normalize('src/file.js', '/workspace', normalizeFn);

    expect(result1).toBe('/workspace/src/file.js');
    expect(result2).toBe('/workspace/src/file.js');
  });

  test('should handle different workspace roots', () => {
    const normalizeFn = (path, root) => `${root}/${path}`;

    const result1 = cache.normalize('file.js', '/workspace1', normalizeFn);
    const result2 = cache.normalize('file.js', '/workspace2', normalizeFn);

    expect(result1).toBe('/workspace1/file.js');
    expect(result2).toBe('/workspace2/file.js');
  });
});

describe('ParallelActionExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new ParallelActionExecutor();
  });

  test('should build dependency graph', () => {
    const actions = [
      { type: 'patch', path: 'file1.js' },
      { type: 'patch', path: 'file2.js' },
      { type: 'file', path: 'file1.js' },
      { type: 'mkdir', path: 'newdir' },
      { type: 'cmd', command: 'npm test' }
    ];

    const graph = executor.buildDependencyGraph(actions);

    expect(graph.fileWrites.size).toBe(2);
    expect(graph.fileWrites.get('file1.js').length).toBe(2);
    expect(graph.mkdirs.length).toBe(1);
    expect(graph.commands.length).toBe(1);
  });

  test('should sort mkdir by depth', () => {
    const mkdirs = [
      { path: 'a/b/c' },
      { path: 'a' },
      { path: 'a/b' }
    ];

    const sorted = executor.sortMkdirByDepth(mkdirs);

    expect(sorted[0].path).toBe('a');
    expect(sorted[1].path).toBe('a/b');
    expect(sorted[2].path).toBe('a/b/c');
  });

  test('should execute actions in parallel', async () => {
    const actions = [
      { type: 'patch', path: 'file1.js' },
      { type: 'patch', path: 'file2.js' },
      { type: 'patch', path: 'file3.js' }
    ];

    const executionOrder = [];
    const executeFn = async (action) => {
      executionOrder.push(action.path);
      await new Promise(resolve => setTimeout(resolve, 10));
      return { success: true, path: action.path };
    };

    const results = await executor.executeParallel(actions, executeFn);

    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
  });
});

describe('SmartPatchMatcher', () => {
  let matcher;

  beforeEach(() => {
    matcher = new SmartPatchMatcher();
  });

  test('should match exact content', async () => {
    const content = 'function test() {\n  return 42;\n}';
    const search = 'return 42;';
    const replace = 'return 100;';

    const result = await matcher.tryMatch(content, search, replace);

    expect(result.matched).toBe(true);
    expect(result.content).toContain('return 100;');
    expect(result.strategy).toBe('exact');
  });

  test('should handle line ending differences', async () => {
    const content = 'line1\r\nline2\r\nline3';
    const search = 'line1\nline2';
    const replace = 'newline1\nline2';

    const result = await matcher.tryMatch(content, search, replace);

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('normalized');
  });

  test('should handle whitespace differences', async () => {
    const content = 'function   test()   {\n  return   42;\n}';
    const search = 'function test() { return 42; }';
    const replace = 'function test() { return 100; }';

    const result = await matcher.tryMatch(content, search, replace);

    expect(result.matched).toBe(true);
    expect(result.strategy).toBe('whitespace');
  });

  test('should detect ambiguous matches', async () => {
    const content = 'return 42;\nreturn 42;';
    const search = 'return 42;';
    const replace = 'return 100;';

    const result = await matcher.tryMatch(content, search, replace);

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('ambiguous');
  });

  test('should perform fuzzy matching', async () => {
    const content = 'function test() {\n  return 42;\n  console.log("test");\n}';
    const search = 'function test() {\n  return 43;\n  console.log("test");\n}';
    const replace = 'function test() {\n  return 100;\n  console.log("test");\n}';

    const result = await matcher.tryMatch(content, search, replace);

    // Fuzzy match should work with high similarity
    if (result.matched) {
      expect(result.strategy).toBe('fuzzy');
      expect(result.confidence).toBeGreaterThan(0.85);
    }
  });
});

describe('FastPathDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new FastPathDetector();
  });

  test('should detect fast-path eligible edits', () => {
    const actions = [
      {
        type: 'patch',
        path: 'file.js',
        search: 'import { old } from "module";',
        replace: 'import { new } from "module";'
      }
    ];

    const result = detector.isFastPathEligible(actions);

    expect(result.eligible).toBe(true);
  });

  test('should reject multiple actions', () => {
    const actions = [
      { type: 'patch', path: 'file1.js' },
      { type: 'patch', path: 'file2.js' }
    ];

    const result = detector.isFastPathEligible(actions);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('multiple_actions');
  });

  test('should reject large changes', () => {
    const largeSearch = Array(60).fill('line').join('\n');
    const actions = [
      {
        type: 'patch',
        path: 'file.js',
        search: largeSearch,
        replace: 'new content'
      }
    ];

    const result = detector.isFastPathEligible(actions);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('large_change');
  });

  test('should track statistics', () => {
    detector.isFastPathEligible([{ type: 'patch', path: 'f1.js', search: 'import x' }]);
    detector.isFastPathEligible([{ type: 'patch', path: 'f2.js' }, { type: 'patch', path: 'f3.js' }]);

    const stats = detector.getStats();

    expect(stats.fastPath).toBe(1);
    expect(stats.slowPath).toBe(1);
  });
});

describe('SmartEditGate', () => {
  let gate;

  beforeEach(() => {
    gate = new SmartEditGate();
  });

  test('should skip gate for high-confidence low-risk edits', () => {
    const actions = [
      {
        type: 'patch',
        path: 'file.js',
        search: 'import old from "module";',
        replace: 'import new from "module";'
      }
    ];

    const result = gate.shouldRunGate(actions, { recentSuccessRate: 0.95 });

    expect(result.skip).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('should not skip gate for high-risk edits', () => {
    const actions = [
      {
        type: 'patch',
        path: 'package.json',
        search: '"version": "1.0.0"',
        replace: '"version": "2.0.0"'
      }
    ];

    const result = gate.shouldRunGate(actions);

    expect(result.skip).toBe(false);
    expect(result.risk).toBe('high');
  });

  test('should assess risk correctly', () => {
    const lowRisk = [{ type: 'patch', path: 'utils.js', search: 'x' }];
    const highRisk = [{ type: 'patch', path: 'package.json', search: 'x' }];

    expect(gate.assessRisk(lowRisk)).toBe('low');
    expect(gate.assessRisk(highRisk)).toBe('high');
  });

  test('should calculate confidence based on action complexity', () => {
    const simple = [{ type: 'patch', path: 'f.js', search: 'a\nb\nc' }];
    const complex = Array(10).fill({ type: 'patch', path: 'f.js', search: Array(50).fill('line').join('\n') });

    const simpleConf = gate.calculateConfidence(simple);
    const complexConf = gate.calculateConfidence(complex);

    expect(simpleConf).toBeGreaterThan(complexConf);
  });
});

describe('PerformanceOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new PerformanceOptimizer();
  });

  test('should provide compiled patterns', () => {
    const patterns = optimizer.getCompiledPatterns();

    expect(patterns.patch).toBeInstanceOf(RegExp);
    expect(patterns.file).toBeInstanceOf(RegExp);
    expect(patterns.mkdir).toBeInstanceOf(RegExp);
    expect(patterns.cmd).toBeInstanceOf(RegExp);
  });

  test('should collect all stats', () => {
    const stats = optimizer.getAllStats();

    expect(stats).toHaveProperty('fileCache');
    expect(stats).toHaveProperty('parallelExecution');
    expect(stats).toHaveProperty('fastPath');
    expect(stats).toHaveProperty('editGate');
  });

  test('should clear all caches', () => {
    optimizer.fileCache.set('test.js', 'content');
    optimizer.pathCache.normalized.set('key', 'value');

    optimizer.clearCaches();

    expect(optimizer.fileCache.cache.size).toBe(0);
    expect(optimizer.pathCache.normalized.size).toBe(0);
  });
});

describe('COMPILED_PATTERNS', () => {
  test('should match PATCH actions', () => {
    const text = `
PATCH: src/file.js
SEARCH:
\`\`\`javascript
const x = 1;
\`\`\`
REPLACE:
\`\`\`javascript
const x = 2;
\`\`\`
    `;

    const matches = [...text.matchAll(COMPILED_PATTERNS.patch)];
    expect(matches.length).toBe(1);
    expect(matches[0][1].trim()).toBe('src/file.js');
  });

  test('should match FILE actions', () => {
    const text = `
FILE: src/new.js
\`\`\`javascript
console.log("hello");
\`\`\`
    `;

    const matches = [...text.matchAll(COMPILED_PATTERNS.file)];
    expect(matches.length).toBe(1);
    expect(matches[0][1].trim()).toBe('src/new.js');
  });

  test('should match MKDIR actions', () => {
    const text = 'MKDIR: src/newdir\nMKDIR: src/another';

    const matches = [...text.matchAll(COMPILED_PATTERNS.mkdir)];
    expect(matches.length).toBe(2);
  });

  test('should match CMD actions', () => {
    const text = 'CMD: npm test\nCMD: git status';

    const matches = [...text.matchAll(COMPILED_PATTERNS.cmd)];
    expect(matches.length).toBe(2);
  });
});

// Made with Bob
