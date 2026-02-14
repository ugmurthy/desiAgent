# desiAgent Client SDK API (Concise)

All calls are local SDK methods on the `DesiAgentClient` instance. Auth headers are included for hosted deployments; the local SDK uses config/env keys, so set `authHeaders` to `{}` unless your wrapper injects them.

## Standard Error Shape

Most errors derive from `DesiAgentError` with the following shape:

```json
{
  "error": {
    "name": "DesiAgentError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Resource not found",
    "resourceType": "DAG",
    "resourceId": "dag_...",
    "field": "cronSchedule",
    "value": "* * *",
    "cause": {
      "message": "Underlying error"
    }
  }
}
```

Only the fields relevant to a given error type appear. Error codes include `NOT_FOUND`, `VALIDATION_ERROR`, `LLM_PROVIDER_ERROR`, `DATABASE_ERROR`, `INIT_ERROR`, and `CONFIG_ERROR`.

## API Calls (JSON I/O)

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
    "description": "Analyst agent",
    "systemPrompt": "You are an analyst.",
    "provider": "openai",
    "model": "gpt-4o",
    "isActive": false,
    "constraints": null,
    "metadata": {
      "description": "Analyst agent"
    },
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

### `client.agents.list(filter?)`
List agents, optionally filtered by name and active state.

**Input**
```json
{
  "authHeaders": {},
  "filter": {
    "name": "Analyst",
    "active": true
  }
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "agent_...",
      "name": "Analyst",
      "version": "1.0.0",
      "systemPrompt": "You are an analyst.",
      "provider": "openai",
      "model": "gpt-4o",
      "isActive": true,
      "createdAt": "2026-02-14T10:00:00.000Z",
      "updatedAt": "2026-02-14T10:00:00.000Z"
    }
  ]
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.agents.get(id)`
Fetch a single agent by ID.

**Input**
```json
{
  "authHeaders": {},
  "id": "agent_..."
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
    "isActive": true,
    "createdAt": "2026-02-14T10:00:00.000Z",
    "updatedAt": "2026-02-14T10:00:00.000Z"
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Agent not found: agent_...",
    "resourceType": "Agent",
    "resourceId": "agent_..."
  }
}
```

### `client.agents.update(id, updates)`
Update mutable fields on an existing agent.

**Input**
```json
{
  "authHeaders": {},
  "id": "agent_...",
  "updates": {
    "name": "Analyst",
    "version": "1.0.1",
    "systemPrompt": "Updated prompt.",
    "metadata": {
      "description": "Updated"
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
    "version": "1.0.1",
    "systemPrompt": "Updated prompt.",
    "provider": "openai",
    "model": "gpt-4o",
    "isActive": false,
    "metadata": {
      "description": "Updated"
    },
    "createdAt": "2026-02-14T10:00:00.000Z",
    "updatedAt": "2026-02-14T10:10:00.000Z"
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
    "message": "Agent with name and version already exists",
    "field": "name_version"
  }
}
```

### `client.agents.delete(id)`
Delete an agent by ID (cannot delete active agents).

**Input**
```json
{
  "authHeaders": {},
  "id": "agent_..."
}
```

**Success Output**
```json
{
  "result": "ok"
}
```

**Error Output (ValidationError: active agent)**
```json
{
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "message": "Cannot delete active agent. Activate another version first.",
    "field": "active",
    "value": true
  }
}
```

### `client.agents.activate(id)`
Activate an agent version (deactivates others with the same name).

**Input**
```json
{
  "authHeaders": {},
  "id": "agent_..."
}
```

**Success Output**
```json
{
  "result": {
    "id": "agent_...",
    "name": "Analyst",
    "version": "1.0.0",
    "isActive": true,
    "updatedAt": "2026-02-14T10:15:00.000Z"
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Agent not found: agent_...",
    "resourceType": "Agent",
    "resourceId": "agent_..."
  }
}
```

### `client.agents.resolve(name)`
Resolve the active agent by name (returns null if none active).

**Input**
```json
{
  "authHeaders": {},
  "name": "Analyst"
}
```

**Success Output**
```json
{
  "result": {
    "id": "agent_...",
    "name": "Analyst",
    "version": "1.0.0",
    "isActive": true
  }
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.dags.createFromGoal(options)`
Plan a DAG from a goal, returning success, clarification, or validation status.

**Input**
```json
{
  "authHeaders": {},
  "options": {
    "goalText": "Analyze the document",
    "agentName": "Analyst",
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.2,
    "maxTokens": 2000,
    "seed": 42,
    "cronSchedule": "0 9 * * 1",
    "scheduleActive": true,
    "timezone": "UTC",
    "abortSignal": "AbortSignal"
  }
}
```

**Success Output**
```json
{
  "result": {
    "status": "success",
    "dagId": "dag_..."
  }
}
```

**Error Output (NotFoundError: agent)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Agent not found: Analyst",
    "resourceType": "Agent",
    "resourceId": "Analyst"
  }
}
```

### `client.dags.createAndExecuteFromGoal(options)`
Plan a DAG and immediately start execution if planning succeeds.

**Input**
```json
{
  "authHeaders": {},
  "options": {
    "goalText": "Analyze the document",
    "agentName": "Analyst",
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

**Success Output**
```json
{
  "result": {
    "status": "running",
    "dagId": "dag_...",
    "executionId": "exec_..."
  }
}
```

**Error Output (ValidationError)**
```json
{
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "message": "Validation error"
  }
}
```

### `client.dags.resumeFromClarification(dagId, userResponse)`
Continue planning after the user answers clarification questions.

**Input**
```json
{
  "authHeaders": {},
  "dagId": "dag_...",
  "userResponse": "Use the Q4 dataset"
}
```

**Success Output**
```json
{
  "result": {
    "status": "success",
    "dagId": "dag_..."
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG not found: dag_...",
    "resourceType": "DAG",
    "resourceId": "dag_..."
  }
}
```

### `client.dags.execute(dagId, options?)`
Start executing a planned DAG.

**Input**
```json
{
  "authHeaders": {},
  "dagId": "dag_...",
  "options": {
    "provider": "openai",
    "model": "gpt-4o",
    "executionConfig": {
      "skipEvents": false,
      "batchDbUpdates": true,
      "abortSignal": "AbortSignal"
    }
  }
}
```

**Success Output**
```json
{
  "result": {
    "id": "exec_...",
    "status": "running"
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG not found: dag_...",
    "resourceType": "DAG",
    "resourceId": "dag_..."
  }
}
```

### `client.dags.resume(executionId, executionConfig?)`
Resume a suspended execution.

**Input**
```json
{
  "authHeaders": {},
  "executionId": "exec_...",
  "executionConfig": {
    "skipEvents": false,
    "batchDbUpdates": true
  }
}
```

**Success Output**
```json
{
  "result": {
    "id": "exec_...",
    "status": "running",
    "retryCount": 1
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG Execution not found: exec_...",
    "resourceType": "DAG Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.dags.redoInference(executionId, params?)`
Re-run inference steps for an execution using optional provider/model overrides.

**Input**
```json
{
  "authHeaders": {},
  "executionId": "exec_...",
  "params": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

**Success Output**
```json
{
  "result": {
    "id": "exec_...",
    "rerunCount": 1
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG Execution not found: exec_...",
    "resourceType": "DAG Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.dags.get(id)`
Retrieve a DAG by ID.

**Input**
```json
{
  "authHeaders": {},
  "id": "dag_..."
}
```

**Success Output**
```json
{
  "result": {
    "id": "dag_...",
    "dagTitle": "Analyze customer churn",
    "status": "completed",
    "createdAt": "2026-02-01T12:00:00.000Z",
    "updatedAt": "2026-02-01T12:10:00.000Z",
    "metadata": {
      "agentName": "Analyst",
      "result": "Summary...",
      "planningTotalCostUsd": "0.18"
    }
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG not found: dag_...",
    "resourceType": "DAG",
    "resourceId": "dag_..."
  }
}
```

### `client.dags.list(filter?)`
List DAGs with optional status/date filters and pagination.

**Input**
```json
{
  "authHeaders": {},
  "filter": {
    "status": "completed",
    "createdAfter": "2026-01-01T00:00:00.000Z",
    "createdBefore": "2026-02-01T00:00:00.000Z",
    "limit": 100,
    "offset": 0
  }
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "dag_...",
      "dagTitle": "Analyze customer churn",
      "status": "completed",
      "createdAt": "2026-02-01T12:00:00.000Z",
      "updatedAt": "2026-02-01T12:10:00.000Z",
      "metadata": {
        "agentName": "Analyst",
        "planningTotalCostUsd": "0.18"
      }
    }
  ]
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.dags.listScheduled()`
List DAGs with cron schedules configured.

**Input**
```json
{
  "authHeaders": {}
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "dag_...",
      "dagTitle": "Weekly summary",
      "cronSchedule": "0 9 * * 1",
      "scheduleDescription": "At 09:00 AM, only on Monday",
      "scheduleActive": true
    }
  ]
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.dags.update(id, updates)`
Update DAG fields like status, metadata params, and scheduling.

**Input**
```json
{
  "authHeaders": {},
  "id": "dag_...",
  "updates": {
    "status": "completed",
    "cronSchedule": "0 9 * * 1",
    "scheduleActive": true,
    "timezone": "UTC",
    "dagTitle": "Weekly summary"
  }
}
```

**Success Output**
```json
{
  "result": {
    "id": "dag_...",
    "dagTitle": "Weekly summary",
    "status": "completed",
    "updatedAt": "2026-02-14T10:20:00.000Z"
  }
}
```

**Error Output (ValidationError: invalid cron)**
```json
{
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "message": "Invalid cron expression: ...",
    "field": "cronSchedule",
    "value": "0 9 * * 1"
  }
}
```

### `client.dags.safeDelete(id)`
Delete a DAG only if it has no executions.

**Input**
```json
{
  "authHeaders": {},
  "id": "dag_..."
}
```

**Success Output**
```json
{
  "result": "ok"
}
```

**Error Output (ValidationError: existing executions)**
```json
{
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "message": "Cannot delete DAG: 2 execution(s) exist for this DAG",
    "field": "executions",
    "value": 2
  }
}
```

### `client.dags.runExperiments(input)`
Run multiple planning experiments across model/temperature combinations.

**Input**
```json
{
  "authHeaders": {},
  "input": {
    "goalText": "Summarize Q4 performance",
    "agentName": "Analyst",
    "provider": "openai",
    "models": ["gpt-4o", "gpt-4.1"],
    "temperatures": [0.2, 0.5],
    "seed": 7
  }
}
```

**Success Output**
```json
{
  "result": {
    "status": "completed",
    "totalExperiments": 4,
    "successCount": 3,
    "failureCount": 1,
    "results": [
      {
        "model": "gpt-4o",
        "temperature": 0.2,
        "dagId": "dag_...",
        "success": true
      }
    ]
  }
}
```

**Error Output (LLMProviderError)**
```json
{
  "error": {
    "name": "LLMProviderError",
    "code": "LLM_PROVIDER_ERROR",
    "statusCode": 502,
    "message": "Provider request failed",
    "provider": "openai"
  }
}
```

### `client.dags.getSubSteps(executionId)`
Fetch sub-steps for an execution from the DAGs service.

**Input**
```json
{
  "authHeaders": {},
  "executionId": "exec_..."
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "substep_...",
      "executionId": "exec_...",
      "taskId": "1",
      "description": "Collect data",
      "actionType": "tool",
      "status": "completed",
      "result": {
        "items": []
      }
    }
  ]
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG Execution not found: exec_...",
    "resourceType": "DAG Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.executions.list(filter?)`
List executions with optional filters for DAG ID and status.

**Input**
```json
{
  "authHeaders": {},
  "filter": {
    "dagId": "dag_...",
    "status": "completed",
    "limit": 50,
    "offset": 0
  }
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "exec_...",
      "dagId": "dag_...",
      "status": "completed",
      "totalTasks": 5,
      "completedTasks": 5,
      "createdAt": "2026-02-14T10:30:00.000Z",
      "updatedAt": "2026-02-14T10:40:00.000Z"
    }
  ]
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.executions.get(id)`
Fetch a single execution by ID.

**Input**
```json
{
  "authHeaders": {},
  "id": "exec_..."
}
```

**Success Output**
```json
{
  "result": {
    "id": "exec_...",
    "dagId": "dag_...",
    "status": "running",
    "totalTasks": 5,
    "completedTasks": 2,
    "createdAt": "2026-02-14T10:30:00.000Z",
    "updatedAt": "2026-02-14T10:35:00.000Z"
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.executions.getWithSubSteps(id)`
Fetch an execution and include its sub-steps.

**Input**
```json
{
  "authHeaders": {},
  "id": "exec_..."
}
```

**Success Output**
```json
{
  "result": {
    "id": "exec_...",
    "dagId": "dag_...",
    "status": "running",
    "subSteps": [
      {
        "id": "substep_...",
        "taskId": "1",
        "status": "completed"
      }
    ]
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.executions.listForDag(dagId, opts?)`
List executions for a DAG with pagination and optional status filter.

**Input**
```json
{
  "authHeaders": {},
  "dagId": "dag_...",
  "opts": {
    "status": "completed",
    "limit": 50,
    "offset": 0
  }
}
```

**Success Output**
```json
{
  "result": {
    "executions": [
      {
        "id": "exec_...",
        "status": "completed"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

**Error Output (NotFoundError: DAG)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG not found: dag_...",
    "resourceType": "DAG",
    "resourceId": "dag_..."
  }
}
```

### `client.executions.getSubSteps(id)`
Fetch sub-steps for an execution from the Executions service.

**Input**
```json
{
  "authHeaders": {},
  "id": "exec_..."
}
```

**Success Output**
```json
{
  "result": [
    {
      "id": "substep_...",
      "taskId": "1",
      "status": "completed"
    }
  ]
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.executions.delete(id)`
Delete an execution and its sub-steps.

**Input**
```json
{
  "authHeaders": {},
  "id": "exec_..."
}
```

**Success Output**
```json
{
  "result": "ok"
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.executions.streamEvents(id)`
Stream execution events as an async iterator until completion or failure.

**Input**
```json
{
  "authHeaders": {},
  "id": "exec_..."
}
```

**Success Output**
```json
{
  "result": {
    "type": "execution:task_completed",
    "executionId": "exec_...",
    "ts": 1739510400000,
    "data": {
      "taskId": "1"
    }
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.tools.list(filter?)`
List tool definitions available to agents (restricted tools excluded by default).

**Input**
```json
{
  "authHeaders": {},
  "filter": {
    "name": "readFile"
  }
}
```

**Success Output**
```json
{
  "result": [
    {
      "type": "function",
      "function": {
        "name": "readFile",
        "description": "Read a file",
        "parameters": {
          "type": "object"
        }
      }
    }
  ]
}
```

**Error Output (none)**
```json
{
  "result": []
}
```

### `client.artifacts.list()`
List artifact filenames stored in the artifacts directory.

**Input**
```json
{
  "authHeaders": {}
}
```

**Success Output**
```json
{
  "result": ["report.pdf", "summary.txt"]
}
```

**Error Output (none, returns empty list on failure)**
```json
{
  "result": []
}
```

### `client.artifacts.get(filename)`
Read a single artifact file by filename.

**Input**
```json
{
  "authHeaders": {},
  "filename": "summary.txt"
}
```

**Success Output**
```json
{
  "result": {
    "encoding": "base64",
    "data": "SGVsbG8gd29ybGQ="
  }
}
```

**Error Output (NotFoundError)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Artifact not found: summary.txt",
    "resourceType": "Artifact",
    "resourceId": "summary.txt"
  }
}
```

### `client.costs.getExecutionCosts(executionId)`
Get planning and execution cost breakdown for a specific execution.

**Input**
```json
{
  "authHeaders": {},
  "executionId": "exec_..."
}
```

**Success Output**
```json
{
  "result": {
    "dagId": "dag_...",
    "executionId": "exec_...",
    "planning": {
      "totalUsage": {
        "promptTokens": 100,
        "completionTokens": 50,
        "totalTokens": 150
      },
      "totalCostUsd": "0.02",
      "attempts": []
    },
    "execution": {
      "totalUsage": {
        "promptTokens": 200,
        "completionTokens": 100,
        "totalTokens": 300
      },
      "totalCostUsd": "0.06",
      "subSteps": [
        {
          "id": "substep_...",
          "taskId": "1",
          "actionType": "tool",
          "toolOrPromptName": "readFile",
          "usage": {
            "promptTokens": 10,
            "completionTokens": 5,
            "totalTokens": 15
          },
          "costUsd": "0.001"
        }
      ],
      "synthesis": {
        "usage": {
          "promptTokens": 20,
          "completionTokens": 10,
          "totalTokens": 30
        },
        "costUsd": "0.003"
      }
    },
    "totals": {
      "planningCostUsd": "0.02",
      "executionCostUsd": "0.06",
      "grandTotalCostUsd": "0.08"
    }
  }
}
```

**Error Output (NotFoundError: Execution)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "Execution not found: exec_...",
    "resourceType": "Execution",
    "resourceId": "exec_..."
  }
}
```

### `client.costs.getDagCosts(dagId)`
Get planning and execution cost totals for a DAG.

**Input**
```json
{
  "authHeaders": {},
  "dagId": "dag_..."
}
```

**Success Output**
```json
{
  "result": {
    "dagId": "dag_...",
    "planning": {
      "totalUsage": {
        "promptTokens": 100,
        "completionTokens": 50,
        "totalTokens": 150
      },
      "totalCostUsd": "0.02",
      "attempts": []
    },
    "executions": [
      {
        "executionId": "exec_...",
        "status": "completed",
        "totalCostUsd": "0.06",
        "startedAt": "2026-02-14T10:30:00.000Z",
        "completedAt": "2026-02-14T10:40:00.000Z"
      }
    ],
    "totals": {
      "planningCostUsd": "0.02",
      "executionsCostUsd": "0.06",
      "grandTotalCostUsd": "0.08"
    }
  }
}
```

**Error Output (NotFoundError: DAG)**
```json
{
  "error": {
    "name": "NotFoundError",
    "code": "NOT_FOUND",
    "statusCode": 404,
    "message": "DAG not found: dag_...",
    "resourceType": "DAG",
    "resourceId": "dag_..."
  }
}
```

### `client.costs.getCostSummary(opts?)`
Summarize costs by day/week/month over a date range.

**Input**
```json
{
  "authHeaders": {},
  "opts": {
    "from": "2026-01-01T00:00:00.000Z",
    "to": "2026-02-01T00:00:00.000Z",
    "groupBy": "week"
  }
}
```

**Success Output**
```json
{
  "result": {
    "dateRange": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-02-01T00:00:00.000Z",
      "groupBy": "week"
    },
    "summary": [
      {
        "date": "2026-01-05",
        "planningCostUsd": "0.02",
        "executionCostUsd": "0.06",
        "totalCostUsd": "0.08"
      }
    ],
    "totals": {
      "planningCostUsd": "0.02",
      "executionCostUsd": "0.06",
      "totalCostUsd": "0.08"
    }
  }
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```

### `client.executeTask(agent, task, files?)`
Placeholder for future orchestration (currently throws).

**Input**
```json
{
  "authHeaders": {},
  "agent": {
    "id": "agent_...",
    "name": "Analyst",
    "version": "1.0.0"
  },
  "task": "Analyze this",
  "files": []
}
```

**Error Output (Error: not implemented)**
```json
{
  "error": {
    "name": "Error",
    "message": "Task execution not yet implemented"
  }
}
```

### `client.shutdown()`
Close the SDK and database handles.

**Input**
```json
{
  "authHeaders": {}
}
```

**Success Output**
```json
{
  "result": "ok"
}
```

**Error Output (DatabaseError)**
```json
{
  "error": {
    "name": "DatabaseError",
    "code": "DATABASE_ERROR",
    "statusCode": 500,
    "message": "Database operation failed"
  }
}
```
