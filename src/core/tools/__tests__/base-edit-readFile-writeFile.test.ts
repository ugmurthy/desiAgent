/**
 * Tests for BaseTool, EditTool, ReadFileTool, WriteFileTool
 */

import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import { z } from 'zod';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BaseTool, type ToolContext } from '../base.js';
import { EditTool } from '../edit.js';
import { ReadFileTool } from '../readFile.js';
import { WriteFileTool } from '../writeFile.js';

// ---------- helpers ----------

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

// Concrete subclass to expose protected BaseTool methods
class ConcreteTool extends BaseTool<{ input: string }, string> {
  name = 'concrete';
  description = 'test';
  inputSchema = z.object({ input: z.string() });
  async execute(input: { input: string }) {
    return input.input;
  }
  public testWithTimeout<T>(promise: Promise<T>, timeoutMs: number, msg?: string) {
    return this.withTimeout(promise, timeoutMs, msg);
  }
  public testRetry<T>(fn: () => Promise<T>, maxAttempts?: number, delayMs?: number) {
    return this.retry(fn, maxAttempts, delayMs);
  }
}

// Mock Bun.file / Bun.write for EditTool
const mockBunFile = (content: string | null) => {
  (globalThis as any).Bun = {
    file: vi.fn().mockReturnValue({
      exists: () => Promise.resolve(content !== null),
      text: () => Promise.resolve(content ?? ''),
    }),
    write: vi.fn().mockResolvedValue(undefined),
  };
};

// ============================================================
// BaseTool
// ============================================================
describe('BaseTool', () => {
  let tool: ConcreteTool;

  beforeEach(() => {
    tool = new ConcreteTool();
  });

  describe('withTimeout', () => {
    it('resolves when promise finishes before timeout', async () => {
      const result = await tool.testWithTimeout(Promise.resolve('ok'), 1000);
      expect(result).toBe('ok');
    });

    it('rejects with timeout message when promise exceeds timeout', async () => {
      const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));
      await expect(tool.testWithTimeout(slow, 50, 'too slow')).rejects.toThrow('too slow');
    });
  });

  describe('retry', () => {
    it('succeeds on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('done');
      const result = await tool.testRetry(fn, 3, 0);
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('succeeds on second attempt after first failure', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');
      const result = await tool.testRetry(fn, 3, 0);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after maxAttempts exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fail'));
      await expect(tool.testRetry(fn, 2, 0)).rejects.toThrow('always fail');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('toJSONSchema', () => {
    it('returns correct shape', () => {
      const schema = tool.toJSONSchema();
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBe('concrete');
      expect(schema.function.description).toBe('test');
      expect(schema.function.parameters).toBeDefined();
      expect(schema.function.parameters).not.toHaveProperty('$schema');
    });
  });
});

// ============================================================
// EditTool
// ============================================================
describe('EditTool', () => {
  let tool: EditTool;

  beforeEach(() => {
    tool = new EditTool();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).Bun;
  });

  it('replaces text in a file (single replacement)', async () => {
    mockBunFile('hello world hello');
    const ctx = makeCtx({ artifactsDir: '/tmp/arts' });

    const result = await tool.execute(
      { path: 'file.txt', oldText: 'hello', newText: 'hi', replaceAll: false },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
    const written = (globalThis as any).Bun.write.mock.calls[0][1];
    expect(written).toBe('hi world hello');
  });

  it('replaces all occurrences with replaceAll: true', async () => {
    mockBunFile('aaa bbb aaa');
    const ctx = makeCtx({ artifactsDir: '/tmp/arts' });

    const result = await tool.execute(
      { path: 'file.txt', oldText: 'aaa', newText: 'ccc', replaceAll: true },
      ctx
    );

    expect(result.replacements).toBe(2);
    const written = (globalThis as any).Bun.write.mock.calls[0][1];
    expect(written).toBe('ccc bbb ccc');
  });

  it('throws when file not found', async () => {
    mockBunFile(null);
    const ctx = makeCtx({ artifactsDir: '/tmp/arts' });

    await expect(
      tool.execute({ path: 'nope.txt', oldText: 'x', newText: 'y', replaceAll: false }, ctx)
    ).rejects.toThrow('File not found');
  });

  it('throws when oldText not found in file', async () => {
    mockBunFile('some content');
    const ctx = makeCtx({ artifactsDir: '/tmp/arts' });

    await expect(
      tool.execute({ path: 'file.txt', oldText: 'missing', newText: 'y', replaceAll: false }, ctx)
    ).rejects.toThrow('Text not found');
  });

  it('throws when path escapes artifacts directory', async () => {
    mockBunFile('content');
    const ctx = makeCtx({ artifactsDir: '/tmp/arts' });

    await expect(
      tool.execute({ path: '../../etc/passwd', oldText: 'x', newText: 'y', replaceAll: false }, ctx)
    ).rejects.toThrow('Invalid path');
  });

  it('emits event on completion', async () => {
    mockBunFile('foo bar');
    const completed = vi.fn();
    const ctx = makeCtx({
      artifactsDir: '/tmp/arts',
      emitEvent: { completed },
    });

    await tool.execute(
      { path: 'file.txt', oldText: 'foo', newText: 'baz', replaceAll: false },
      ctx
    );

    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][0]).toContain('1 replacement');
  });
});

// ============================================================
// ReadFileTool
// ============================================================
describe('ReadFileTool', () => {
  let tool: ReadFileTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new ReadFileTool();
    tmpDir = await mkdtemp(join(tmpdir(), 'readfile-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a text file', async () => {
    const filePath = join(tmpDir, 'hello.txt');
    await writeFile(filePath, 'hello world', 'utf-8');

    const ctx = makeCtx({ artifactsDir: tmpDir });
    const result = await tool.execute({ path: 'hello.txt', maxLength: 50000 }, ctx);

    expect(result.content).toBe('hello world');
    expect(result.truncated).toBe(false);
    expect(result.size).toBe(11);
  });

  it('truncates content exceeding maxLength', async () => {
    const filePath = join(tmpDir, 'big.txt');
    const bigContent = 'x'.repeat(1000);
    await writeFile(filePath, bigContent, 'utf-8');

    const ctx = makeCtx({ artifactsDir: tmpDir });
    const result = await tool.execute({ path: 'big.txt', maxLength: 100 }, ctx);

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(100);
  });

  it('throws on non-existent file', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    await expect(
      tool.execute({ path: 'no-such-file.txt', maxLength: 50000 }, ctx)
    ).rejects.toThrow();
  });

  it('strips ".." from path for security', async () => {
    const filePath = join(tmpDir, 'safe.txt');
    await writeFile(filePath, 'safe', 'utf-8');

    const ctx = makeCtx({ artifactsDir: tmpDir });
    // "../safe.txt" should become "safe.txt" after stripping ".."
    const result = await tool.execute({ path: '../safe.txt', maxLength: 50000 }, ctx);
    expect(result.content).toBe('safe');
  });

  it('throws when path is outside artifacts directory', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    // A path that resolves outside even after ".." stripping is hard to construct,
    // so we test the guard directly with a path that won't resolve inside.
    await expect(
      tool.execute({ path: '/etc/passwd', maxLength: 50000 }, ctx)
    ).rejects.toThrow();
  });

  it('calls onEvent when provided', async () => {
    const filePath = join(tmpDir, 'event.txt');
    await writeFile(filePath, 'data', 'utf-8');

    const onEvent = vi.fn();
    const ctx = makeCtx({ artifactsDir: tmpDir, onEvent });

    await tool.execute({ path: 'event.txt', maxLength: 50000 }, ctx);

    expect(onEvent).toHaveBeenCalledWith('tool:readFile:completed', expect.objectContaining({
      path: 'event.txt',
      truncated: false,
    }));
  });
});

// ============================================================
// WriteFileTool
// ============================================================
describe('WriteFileTool', () => {
  let tool: WriteFileTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new WriteFileTool();
    tmpDir = await mkdtemp(join(tmpdir(), 'writefile-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes new file content', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    const result = await tool.execute(
      { path: 'out.txt', content: 'hello', mode: 'overwrite' },
      ctx
    );

    expect(result.mode).toBe('overwrite');
    const written = await readFile(join(tmpDir, 'out.txt'), 'utf-8');
    expect(written).toBe('hello');
  });

  it('strips outermost code fences from content', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    const fenced = '```js\nconsole.log("hi");\n```';
    await tool.execute({ path: 'fenced.js', content: fenced, mode: 'overwrite' }, ctx);

    const written = await readFile(join(tmpDir, 'fenced.js'), 'utf-8');
    expect(written).toBe('console.log("hi");');
  });

  it('appends to existing file', async () => {
    const filePath = join(tmpDir, 'append.txt');
    await writeFile(filePath, 'first', 'utf-8');

    const ctx = makeCtx({ artifactsDir: tmpDir });
    await tool.execute({ path: 'append.txt', content: 'second', mode: 'append' }, ctx);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('firstsecond');
  });

  it('creates parent directories if needed', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    await tool.execute(
      { path: 'sub/deep/file.txt', content: 'nested', mode: 'overwrite' },
      ctx
    );

    const content = await readFile(join(tmpDir, 'sub/deep/file.txt'), 'utf-8');
    expect(content).toBe('nested');
  });

  it('throws when path escapes artifacts directory', async () => {
    const ctx = makeCtx({ artifactsDir: tmpDir });
    await expect(
      tool.execute({ path: '../../etc/evil.txt', content: 'bad', mode: 'overwrite' }, ctx)
    ).rejects.toThrow('Invalid path');
  });

  it('calls onEvent when provided', async () => {
    const onEvent = vi.fn();
    const ctx = makeCtx({ artifactsDir: tmpDir, onEvent });

    await tool.execute({ path: 'ev.txt', content: 'data', mode: 'overwrite' }, ctx);

    expect(onEvent).toHaveBeenCalledWith('tool:writeFile:completed', expect.objectContaining({
      mode: 'overwrite',
    }));
  });
});
