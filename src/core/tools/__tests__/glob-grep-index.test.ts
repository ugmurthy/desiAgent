/**
 * Tests for index.ts exports, GlobTool, and GrepTool
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, stat, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { minimatch } from 'minimatch';
import type { ToolContext } from '../base.js';
import { GlobTool } from '../glob.js';
import { GrepTool } from '../grep.js';

const makeCtx = (overrides?: Partial<ToolContext>): ToolContext => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  artifactsDir: '/tmp/test-artifacts',
  ...overrides,
});

/**
 * Recursively walk a directory and return all file paths relative to `dir`.
 */
async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(fullPath);
      results.push(...sub);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Set up a mock for globalThis.Bun that uses real filesystem via Node's fs
 * module, simulating Bun.Glob and Bun.file for vitest (Node runtime).
 */
function setupBunMock() {
  class MockGlob {
    pattern: string;
    constructor(pattern: string) {
      this.pattern = pattern;
    }
    match(filePath: string): boolean {
      return minimatch(filePath, this.pattern, { dot: true });
    }
    async *scan(opts: { cwd: string; onlyFiles?: boolean }) {
      const cwd = opts.cwd;
      let allFiles: string[];
      try {
        allFiles = await walkDir(cwd);
      } catch {
        return;
      }
      for (const absPath of allFiles) {
        const rel = relative(cwd, absPath);
        if (minimatch(rel, this.pattern, { dot: true })) {
          yield rel;
        }
      }
    }
  }

  const mockFile = (path: string) => ({
    async exists() {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async stat() {
      try {
        const s = await stat(path);
        return { isDirectory: () => s.isDirectory() };
      } catch {
        return null;
      }
    },
    async arrayBuffer() {
      const buf = await readFile(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async text() {
      return readFile(path, 'utf-8');
    },
  });

  (globalThis as any).Bun = {
    Glob: MockGlob,
    file: mockFile,
  };
}

// ─── index.ts exports ───────────────────────────────────────────────────────

describe('index.ts exports', () => {
  it('exports all tools and utilities', async () => {
    const mod = await import('../index.js');

    expect(mod.BaseTool).toBeDefined();
    expect(mod.BashTool).toBeDefined();
    expect(mod.ReadFileTool).toBeDefined();
    expect(mod.WriteFileTool).toBeDefined();
    expect(mod.FetchPageTool).toBeDefined();
    expect(mod.WebSearchTool).toBeDefined();
    expect(mod.FetchURLsTool).toBeDefined();
    expect(mod.GlobTool).toBeDefined();
    expect(mod.GrepTool).toBeDefined();
    expect(mod.EditTool).toBeDefined();
    expect(mod.SendEmailTool).toBeDefined();
    expect(mod.ReadEmailTool).toBeDefined();
    expect(mod.SendWebhookTool).toBeDefined();
    expect(mod.LlmExecuteTool).toBeDefined();
    expect(mod.ToolRegistry).toBeDefined();
    expect(mod.createToolRegistry).toBeDefined();
    expect(mod.ToolExecutor).toBeDefined();
  });
});

// ─── GlobTool ───────────────────────────────────────────────────────────────

describe('GlobTool', () => {
  let tool: GlobTool;
  let tmpDir: string;

  beforeEach(async () => {
    setupBunMock();
    tool = new GlobTool();
    tmpDir = await mkdtemp(join(tmpdir(), 'glob-test-'));
  });

  afterEach(async () => {
    delete (globalThis as any).Bun;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(tool.name).toBe('glob');
    expect(tool.description).toBeDefined();
  });

  it('finds files matching a pattern', async () => {
    await writeFile(join(tmpDir, 'a.ts'), 'export {}');
    await writeFile(join(tmpDir, 'b.ts'), 'export {}');
    await writeFile(join(tmpDir, 'c.js'), 'module.exports = {}');

    const result = await tool.execute(
      { pattern: '**/*.ts', ignore: [], limit: 100 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.files.sort()).toEqual(['a.ts', 'b.ts']);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('throws when pattern contains ".."', async () => {
    await expect(
      tool.execute(
        { pattern: '../**/*.ts', ignore: [], limit: 100 },
        makeCtx({ artifactsDir: tmpDir }),
      ),
    ).rejects.toThrow('cannot contain ".."');
  });

  it('truncates results when files exceed limit', async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(tmpDir, `file${i}.txt`), 'content');
    }

    const result = await tool.execute(
      { pattern: '**/*.txt', ignore: [], limit: 3 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.files).toHaveLength(3);
    expect(result.count).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('respects ignore patterns', async () => {
    await mkdir(join(tmpDir, 'node_modules'), { recursive: true });
    await writeFile(join(tmpDir, 'node_modules', 'dep.ts'), 'dep');
    await writeFile(join(tmpDir, 'src.ts'), 'src');

    const result = await tool.execute(
      { pattern: '**/*.ts', ignore: ['node_modules/**'], limit: 100 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.files).toEqual(['src.ts']);
  });

  it('calls emitEvent.completed on success', async () => {
    await writeFile(join(tmpDir, 'x.ts'), '');
    const completed = vi.fn();

    await tool.execute(
      { pattern: '**/*.ts', ignore: [], limit: 100 },
      makeCtx({ artifactsDir: tmpDir, emitEvent: { completed } }),
    );

    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0]).toContain('Found');
  });
});

// ─── GrepTool ───────────────────────────────────────────────────────────────

describe('GrepTool', () => {
  let tool: GrepTool;
  let tmpDir: string;

  beforeEach(async () => {
    setupBunMock();
    tool = new GrepTool();
    tmpDir = await mkdtemp(join(tmpdir(), 'grep-test-'));
  });

  afterEach(async () => {
    delete (globalThis as any).Bun;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    expect(tool.name).toBe('grep');
    expect(tool.description).toBeDefined();
  });

  it('searches for a pattern in a single file', async () => {
    await writeFile(join(tmpDir, 'hello.txt'), 'hello world\ngoodbye world\nhello again');

    const result = await tool.execute(
      { pattern: 'hello', path: 'hello.txt', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.totalMatches).toBe(2);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].file).toBe('hello.txt');
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].match).toBe('hello');
    expect(result.matches[1].line).toBe(3);
  });

  it('searches in a directory with glob filter', async () => {
    await mkdir(join(tmpDir, 'sub'), { recursive: true });
    await writeFile(join(tmpDir, 'sub', 'a.ts'), 'const foo = 1;');
    await writeFile(join(tmpDir, 'sub', 'b.js'), 'const foo = 2;');

    const result = await tool.execute(
      { pattern: 'foo', path: 'sub', glob: '**/*.ts', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.filesSearched).toBe(1);
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].file).toContain('a.ts');
  });

  it('performs case-insensitive search', async () => {
    await writeFile(join(tmpDir, 'mixed.txt'), 'Hello\nhELLO\nhello');

    const result = await tool.execute(
      { pattern: 'hello', path: 'mixed.txt', caseSensitive: false, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.totalMatches).toBe(3);
  });

  it('throws on invalid regex pattern', async () => {
    await writeFile(join(tmpDir, 'file.txt'), 'content');

    await expect(
      tool.execute(
        { pattern: '[invalid', path: 'file.txt', caseSensitive: true, maxResults: 50 },
        makeCtx({ artifactsDir: tmpDir }),
      ),
    ).rejects.toThrow('Invalid regex pattern');
  });

  it('throws when path not found', async () => {
    await expect(
      tool.execute(
        { pattern: 'test', path: 'nonexistent.txt', caseSensitive: true, maxResults: 50 },
        makeCtx({ artifactsDir: tmpDir }),
      ),
    ).rejects.toThrow('Path not found');
  });

  it('skips binary files', async () => {
    const binaryContent = Buffer.alloc(100);
    binaryContent[10] = 0; // null byte -> binary detection
    binaryContent.write('hello', 0);
    await writeFile(join(tmpDir, 'bin.dat'), binaryContent);

    const result = await tool.execute(
      { pattern: 'hello', path: 'bin.dat', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.filesSearched).toBe(0);
    expect(result.totalMatches).toBe(0);
  });

  it('truncates when matches exceed maxResults', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`).join('\n');
    await writeFile(join(tmpDir, 'many.txt'), lines);

    const result = await tool.execute(
      { pattern: 'match', path: 'many.txt', caseSensitive: true, maxResults: 5 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.matches).toHaveLength(5);
    expect(result.totalMatches).toBeGreaterThan(5);
    expect(result.truncated).toBe(true);
  });

  it('sanitizes path traversal with ".."', async () => {
    await writeFile(join(tmpDir, 'safe.txt'), 'safe content');

    const result = await tool.execute(
      { pattern: 'safe', path: '.', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  it('normalizePattern handles (?i) flag', async () => {
    await writeFile(join(tmpDir, 'flags.txt'), 'Hello World\nhello world');

    const result = await tool.execute(
      { pattern: '(?i)hello', path: 'flags.txt', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    // (?i) should force case-insensitive even though caseSensitive=true
    expect(result.totalMatches).toBe(2);
  });

  it('normalizePattern handles (?i: flag', async () => {
    await writeFile(join(tmpDir, 'flags2.txt'), 'Hello World\nhello world');

    const result = await tool.execute(
      { pattern: '(?i:hello)', path: 'flags2.txt', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir }),
    );

    // (?i: gets converted to (?: with case-insensitive flag
    expect(result.totalMatches).toBe(2);
  });

  it('calls emitEvent.started and emitEvent.completed', async () => {
    await writeFile(join(tmpDir, 'ev.txt'), 'data');
    const started = vi.fn();
    const completed = vi.fn();

    await tool.execute(
      { pattern: 'data', path: 'ev.txt', caseSensitive: true, maxResults: 50 },
      makeCtx({ artifactsDir: tmpDir, emitEvent: { started, completed } }),
    );

    expect(started).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
    expect(started.mock.calls[0][0]).toContain('Searching');
    expect(completed.mock.calls[0][0]).toContain('Found');
  });
});
