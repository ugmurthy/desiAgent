# Environment Variables and Constants

## Environment Variables Used

| Variable | Default | Usage |
|----------|---------|-------|
| `OPENAI_API_KEY` | - | OpenAI provider API key |
| `OPENROUTER_API_KEY` | - | OpenRouter provider API key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `LLM_PROVIDER` | - | LLM provider selection |
| `LLM_MODEL` | - | Model name selection |
| `ARTIFACTS_DIR` | `./artifacts` | Output directory for files |
| `LOG_DEST` | `file` | Logging destination (`file` or `console`) |
| `LOG_DIR` | `~/.desiAgent/logs` | Log file directory |
| `HOME` / `USERPROFILE` | - | User home directory (system) |
| `SMTP_HOST` | - | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | - | Email sender address |

## Files Using Environment Variables

| File | Line | Variable |
|------|------|----------|
| src/index.ts | 77 | `OPENAI_API_KEY` |
| src/types/config.ts | 19 | `HOME`, `USERPROFILE` |
| src/types/config.ts | 32 | `HOME`, `USERPROFILE` |
| src/util/logger.ts | 12 | `LOG_DEST` |
| src/util/logger.ts | 20 | `LOG_DIR` |
| src/core/providers/factory.ts | 42 | `OPENROUTER_API_KEY` |
| src/core/tools/writeFile.ts | 42 | `ARTIFACTS_DIR` |
| src/core/tools/edit.ts | 32 | `ARTIFACTS_DIR` |
| src/core/tools/grep.ts | 48 | `ARTIFACTS_DIR` |
| src/core/tools/glob.ts | 41 | `ARTIFACTS_DIR` |
| src/core/tools/readFile.ts | 46 | `ARTIFACTS_DIR` |
| src/core/tools/sendEmail.ts | 56 | `ARTIFACTS_DIR` |
| src/core/tools/sendEmail.ts | 65-69 | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| src/core/tools/sendEmail.ts | 103 | `SMTP_FROM` |
| examples/create-dag.ts | 16-18 | `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `LLM_MODEL` |
| examples/execute-dag.ts | 18 | `OPENROUTER_API_KEY` |
| examples/list-dags.ts | 17 | `OPENROUTER_API_KEY` |
| examples/list-tools.ts | 19 | `OPENROUTER_API_KEY` |
| examples/execute-exec-id.ts | 16 | `OPENROUTER_API_KEY` |
| examples/execute-bg-dag-id.ts | 18 | `OPENROUTER_API_KEY` |
| examples/execute-trading-strategies.ts | 18 | `OPENROUTER_API_KEY` |
| examples/execute-bg.ts | 18 | `OPENROUTER_API_KEY` |

## String Constants

| File | Line | Variable | Value |
|------|------|----------|-------|
| src/core/providers/openrouter.ts | 19 | `BASE_URL` | `'https://openrouter.ai/api/v1'` |
| src/core/execution/__tests__/dags.test.ts | 16 | `dbPath` | `':memory:'` |
| src/core/execution/__tests__/agents.test.ts | 16 | `dbPath` | `':memory:'` |
| src/core/providers/__tests__/ollama.test.ts | 103 | `expectedContent` | `'Test response content'` |
| src/core/orchestration/__tests__/planner.test.ts | 261 | `customPrompt` | `'You are a custom agent'` |

## Integer Constants

| File | Line | Variable | Value |
|------|------|----------|-------|
| src/core/execution/dagExecutor.ts | 131 | `MAX_DEP_LENGTH` | `2000` |
| src/core/providers/openrouter.ts | 20 | `DEFAULT_TIMEOUT_MS` | `60000` |
| src/core/execution/dags.ts | 210 | `maxAttempts` | `3` |
| src/core/execution/dags.ts | 243 | `MAX_RESPONSE_SIZE` | `100_000` |
