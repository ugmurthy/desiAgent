import { access } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

export type ExecutableSkillHandler = (params: Record<string, unknown>) => Promise<unknown>;

const EXECUTABLE_HANDLER_CANDIDATES = [
  'handler.js',
  'handler.mjs',
  'handler.cjs',
  'handler.mts',
  'handler.cts',
] as const;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutableSkillHandlerPath(skillDefinitionPath: string): Promise<string | null> {
  const skillDir = resolve(skillDefinitionPath, '..');

  for (const candidate of EXECUTABLE_HANDLER_CANDIDATES) {
    const candidatePath = resolve(skillDir, candidate);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function formatImportError(skillName: string, handlerPath: string, error: unknown): Error {
  const reason = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);

  const runtimeHint = handlerPath.endsWith('.ts') || handlerPath.endsWith('.mts') || handlerPath.endsWith('.cts')
    ? ' This runtime may not support importing TypeScript skill handlers directly. Provide handler.js/handler.mjs or run with Bun/tsx.'
    : '';

  return new Error(
    `Failed to import executable skill "${skillName}" handler at "${handlerPath}".${runtimeHint} Root cause: ${reason}`,
  );
}

export async function loadExecutableSkillHandler(
  skillName: string,
  skillDefinitionPath: string,
): Promise<{ handler: ExecutableSkillHandler; handlerPath: string }> {
  const handlerPath = await resolveExecutableSkillHandlerPath(skillDefinitionPath);

  if (!handlerPath) {
    throw new Error(
      `Executable skill "${skillName}" is missing a handler file. Expected one of: ${EXECUTABLE_HANDLER_CANDIDATES.join(', ')}`,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(handlerPath).href);
  } catch (error) {
    throw formatImportError(skillName, handlerPath, error);
  }

  let handler = mod.default ?? mod.handler;
  if (typeof handler !== 'function') {
    handler = (handler as any)?.default;
  }
  if (typeof handler !== 'function') {
    throw new Error(
      `Executable skill "${skillName}" handler at "${handlerPath}" must export a function as default export or named "handler".`,
    );
  }

  return {
    handler: handler as ExecutableSkillHandler,
    handlerPath,
  };
}
