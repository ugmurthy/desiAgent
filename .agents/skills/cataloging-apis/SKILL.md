---
name: cataloging-apis
description: "Documents SDK or backend API surfaces with concise, accurate inputs/outputs and per-endpoint error shapes. Use when asked to create or update API documentation or when a user requests a structured API call reference."
---

# Documenting API

Create concise, accurate API documentation for SDKs or backend services. The output should include one-line explanations per call, JSON inputs, JSON success outputs, and JSON error outputs with per-endpoint differences. Do not trigger automatically; use only when the user explicitly requests this skill.

## Workflow

1. Identify the API surface.
- Prefer SDK service interfaces (`src/types/*.ts`, `src/index.ts`) over internal implementation.
- Cross-check with service implementations (`src/core/*`) for defaults, optional fields, and error conditions.

2. Catalog calls and shapes.
- List every public service method in the client (`client.agents.*`, `client.dags.*`, etc.).
- Record parameter names, optional fields, defaults, and supported enum values.
- Record success payload shapes and any per-endpoint special fields.

3. Capture error conditions.
- Use custom error classes from `src/errors/*` and map to per-endpoint errors.
- Note special validation errors (e.g., invalid cron schedule, duplicate entity constraints, active state constraints).

4. Produce concise output.
- One line narrative per API call.
- Include JSON input, success output, and error output examples.
- Keep examples consistent with actual types and default values.
- If the user provides a template or output format direction, ask whether to override this skill template and follow their preference.

5. Validate against source.
- Ensure errors and fields match the service implementation.
- Remove any outdated endpoints or legacy fields that no longer exist.

## Output Format

- Use Markdown headers for each call.
- Each call must contain:
  - One-line summary
  - **Input** JSON
  - **Success Output** JSON
  - **Error Output** JSON (use the actual error shape for that call)
- Keep outputs concise; avoid unnecessary nested fields unless required for clarity.

## Template Example (From docs/CLIENT-SDK-API.md)

Use this structure by default unless the user supplies their own template or format instructions.

```markdown
### `client.agents.create(name, version, systemPrompt, params?)`
Create a new agent version in the local database.

**Input**
```json
{
  "authHeaders": {},
  "name": "Analyst",
  "version": "1.0.0",
  "systemPrompt": "You are an analyst.",
  "params": {
    "provider": "openai",
    "model": "gpt-4o",
    "metadata": {
      "description": "Analyst agent"
    }
  }
}
```

**Success Output**
```json
{
  "result": {
    "id": "agent_...",
    "name": "Analyst",
    "version": "1.0.0",
    "systemPrompt": "You are an analyst.",
    "provider": "openai",
    "model": "gpt-4o",
    "isActive": false,
    "createdAt": "2026-02-14T10:00:00.000Z",
    "updatedAt": "2026-02-14T10:00:00.000Z"
  }
}
```

**Error Output (ValidationError: duplicate name/version)**
```json
{
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "message": "Agent with name \"Analyst\" and version \"1.0.0\" already exists",
    "field": "name_version",
    "value": {
      "name": "Analyst",
      "version": "1.0.0"
    }
  }
}
```
```
