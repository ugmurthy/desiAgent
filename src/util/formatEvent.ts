/**
 * Format ExecutionEvent into a human-readable line for CLI display.
 *
 * Format: `HH:MM:SS  [icon] [state] [taskId] message…`
 * Lines are truncated to `maxLen` characters.
 */

import type { ExecutionEvent } from '../types/execution.js';
import { ExecutionEventType } from '../types/execution.js';

const TOOL_ICONS: Record<string, string> = {
  writeFile: '📄',
  readFile: '📖',
  inference: '✨',
  webSearch: '🔎',
  fetchURLs: '🌐',
  fetchPage: '🌐',
  readEmail: '📧',
  sendEmail: '✉️',
  default: '🛠️',
};

function ts(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

function fitLine(line: string, maxLen: number): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 1) + '…';
}

export function formatEvent(event: ExecutionEvent, maxLen = 100): string {
  const time = ts(event.ts);
  const d = event.data ?? {};

  switch (event.type) {
    // ── Lifecycle ──
    case ExecutionEventType.Started:
      return fitLine(`${time}  🚀 Execution started (${d.total} tasks)`, maxLen);

    case ExecutionEventType.Completed:
      return fitLine(
        `${time}  🏁 Execution ${d.status} — ${d.completedTasks} done, ${d.failedTasks} failed (${(d.durationMs / 1000).toFixed(1)}s)`,
        maxLen,
      );

    case ExecutionEventType.Failed:
      return fitLine(
        `${time}  💥 Execution failed — ${event.error?.message ?? 'unknown error'}`,
        maxLen,
      );

    case ExecutionEventType.Suspended:
      return fitLine(
        `${time}  ⏸️  Execution suspended — ${event.error?.message ?? ''}`,
        maxLen,
      );

    // ── Wave ──
    case ExecutionEventType.WaveStarted:
      return fitLine(
        `${time}  🌊 Wave ${d.wave} ── ${d.parallel} task${d.parallel > 1 ? 's' : ''} in parallel`,
        maxLen,
      );

    case ExecutionEventType.WaveCompleted:
      return fitLine(
        `${time}  🌊 Wave ${d.wave} done ── ${d.completedTasks}/${d.totalTasks} tasks (${(d.durationMs / 1000).toFixed(1)}s)`,
        maxLen,
      );

    // ── Task ──
    case ExecutionEventType.TaskStarted: {
      const icon = TOOL_ICONS[d.tool] ?? TOOL_ICONS.default;
      const desc = d.thought || d.description || d.tool || '';
      return fitLine(`${time}  ${icon} ⟳ ${d.taskId} ${desc}`, maxLen);
    }

    case ExecutionEventType.TaskProgress: {
      const msg = d.message ?? '';
      // Extract URL from fetchPage progress messages
      const urlMatch = msg.match(/url["']?\s*:\s*["']?(https?:\/\/[^\s"'}\]]+)/i);
      const progressMsg = urlMatch ? `Fetching ${extractDomain(urlMatch[1])}` : msg;
      return fitLine(`${time}  ⏳ ⟳ ${d.taskId} ${progressMsg}`, maxLen);
    }

    case ExecutionEventType.TaskCompleted: {
      return fitLine(
        `${time}  ✅ ✔ ${d.taskId} completed (${(d.durationMs / 1000).toFixed(1)}s)`,
        maxLen,
      );
    }

    case ExecutionEventType.TaskFailed: {
      const errMsg = event.error?.message ?? 'unknown error';
      return fitLine(
        `${time}  ❌ ✘ ${d.taskId} failed: ${errMsg}`,
        maxLen,
      );
    }

    // ── Synthesis ──
    case ExecutionEventType.SynthesisStarted:
      return fitLine(`${time}  🧪 ⟳ Synthesising final result…`, maxLen);

    case ExecutionEventType.SynthesisCompleted:
      return fitLine(
        `${time}  🧪 ✔ Synthesis done (${(d.durationMs / 1000).toFixed(1)}s)`,
        maxLen,
      );

    default:
      return fitLine(`${time}  ❓ ${event.type}`, maxLen);
  }
}
