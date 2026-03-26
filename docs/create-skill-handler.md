# Creating a Bundled Handler for Executable Skills

When an executable skill uses npm packages (like `@e2b/code-interpreter`), the handler cannot be dynamically imported as TypeScript because:

1. Node.js cannot import `.ts` files directly at runtime
2. The npm packages may not be resolvable from the skill directory

The solution is to bundle the handler into a self-contained `.js` file using esbuild.

## Step-by-Step Process

### 1. Initialize the Skill Directory

```bash
cd ~/.desiAgent/skills/<skill-name>
npm init -y
```

### 2. Install Dependencies

Install both the packages your handler needs and esbuild for bundling:

```bash
npm install <package1> <package2>
npm install --save-dev esbuild
```

### 3. Write the Handler in TypeScript

Create or update `handler.ts` with your skill logic:

```typescript
import { SomePackage } from 'package-name';

interface HandlerParams {
  param1: string;
  param2?: number;
}

export default async function handler(params: HandlerParams): Promise<string> {
  // Your logic here
  const result = await somePackage.doSomething(params);
  return JSON.stringify(result);
}
```

**Important**: Use npm package names (e.g., `@e2b/code-interpreter`), not bare specifiers.

### 4. Bundle with esbuild

```bash
npx esbuild handler.ts --bundle --format=cjs --outfile=handler.js --platform=node
```

Key flags:
- `--bundle` — Includes all dependencies inline
- `--format=cjs` — Outputs CommonJS (required for Node.js dynamic imports)
- `--outfile=handler.js` — Output filename (picked up first in resolution order)
- `--platform=node` — Targets Node.js environment

### 5. Verify the Bundle

Test that the handler loads correctly:

```bash
node --input-type=module -e "
import { pathToFileURL } from 'url';
const mod = await import(pathToFileURL('./handler.js').href);
const handler = mod.default?.default ?? mod.default;
console.log('Handler is function:', typeof handler === 'function');
"
```

### 6. Clean Up (Optional)

Remove intermediate files to keep the skill directory clean:

```bash
rm handler.mjs handler.cjs 2>/dev/null
```

## Handler Resolution Order

The skill executor looks for handlers in this order:

1. `handler.js` ← Use this (bundled CJS)
2. `handler.mjs` (ESM)
3. `handler.cjs` (CJS)
4. `handler.ts` (TypeScript — requires Bun/tsx)
5. `handler.mts` / `handler.cts`

## Troubleshooting

### "Dynamic require of 'crypto' is not supported"

This happens when bundling ESM-only packages. Try `--format=cjs` instead of `--format=esm`.

### "Cannot find package 'xyz'"

- Ensure the package is installed in the skill directory
- Verify the import path matches the npm package name exactly

### Handler returns "not a function"

CJS bundles may wrap the handler as `mod.default.default`. The executor handles this automatically, but if testing manually:

```javascript
const handler = mod.default?.default ?? mod.default;
```

## Example: E2B Execute Skill

```bash
cd ~/.desiAgent/skills/e2b-execute
npm init -y
npm install @e2b/code-interpreter
npm install --save-dev esbuild
# Fix import in handler.ts: 'e2b-code-interpreter' -> '@e2b/code-interpreter'
npx esbuild handler.ts --bundle --format=cjs --outfile=handler.js --platform=node
```
