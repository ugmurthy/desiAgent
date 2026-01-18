# PRD: desiAgent Backend API

## Overview

A RESTful backend service exposing the desiAgent library functionality via HTTP APIs. Built with Bun 1.3.5 and Fastify, it provides multi-tenant access to autonomous agent workflows.

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Bun | 1.3.5 | Runtime |
| Fastify | ^4.25.2 | HTTP framework |
| @fastify/cors | ^8.5.0 | CORS handling |
| @fastify/env | ^4.3.0 | Environment configuration |
| @fastify/multipart | ^8.3.1 | File uploads |
| @fastify/rate-limit | ^8.1.1 | Rate limiting |
| desiagent | (local) | Core agent library |

---

## Multi-Tenancy Strategy

### ⚠️ Critical Issue

The current desiAgent library was built **without multi-tenancy support**. Database tables (`agents`, `dags`, `dag_executions`, `sub_steps`, etc.) have no `user_id` or `tenant_id` columns.

### Recommended Options

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A. Schema Migration** | Add `tenant_id` to all tables; modify library queries | True isolation; single DB | Requires library changes; migration effort |
| **B. Database-per-Tenant** | Separate SQLite file per tenant | Strong isolation; no library changes | Complex connection management; backup complexity |
| **C. Backend-only Filtering** | Filter results by tenant at API layer | No library changes | Not true isolation; security risk; cannot enforce at DB level |

### Recommendation

**Option B (Database-per-Tenant)** for Phase 1:
- No changes to desiAgent library required
- Path: `~/.desiAgent/tenants/{tenant_id}/agent.db`
- Strong isolation between tenants
- Can migrate to Option A later if needed

---

## Authentication

### OAuth2 Flow

```
┌─────────┐      ┌──────────────┐      ┌─────────────────┐
│ Client  │──1──▶│ Auth Provider│──2──▶│ desiAgent API   │
│         │◀─3───│ (Google/GH)  │      │                 │
│         │──4──────────────────────────▶ Bearer Token   │
└─────────┘      └──────────────┘      └─────────────────┘
```

- **Supported Providers**: Google, GitHub (configurable)
- **Token Format**: JWT with tenant claims
- **Token Storage**: HTTP-only cookies or Authorization header
- **Session**: Stateless (JWT-based)

### API Key Authentication

For programmatic access, API keys are supported as an alternative to OAuth2.

```http
Authorization: Bearer desi_sk_live_xxxxxxxxxxxxxxxxxxxx
```

- **Format**: `desi_sk_{env}_{random}` (e.g., `desi_sk_live_abc123...`)
- **Scopes**: `read`, `write`, `execute`, `admin`
- **Storage**: Hashed in tenant database
- **Rotation**: Keys can be rotated without invalidating existing sessions

### Auth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/auth/login/{provider}` | GET | Initiate OAuth flow |
| `/api/v2/auth/callback/{provider}` | GET | OAuth callback |
| `/api/v2/auth/refresh` | POST | Refresh access token |
| `/api/v2/auth/logout` | POST | Invalidate session |
| `/api/v2/auth/me` | GET | Get current user info |
| `/api/v2/auth/api-keys` | GET | List user's API keys |
| `/api/v2/auth/api-keys` | POST | Create new API key |
| `/api/v2/auth/api-keys/:id` | DELETE | Revoke API key |

---

## User Management

Users are stored **within each tenant's database** (Option B alignment).

### User Schema (per tenant DB)

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  oauthProvider: 'google' | 'github';
  oauthId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
  lastLoginAt: Date;
}

interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;        // bcrypt hash
  keyPrefix: string;      // First 8 chars for identification
  scopes: string[];       // ['read', 'write', 'execute']
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}
```

### User Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/users` | GET | List tenant users (admin only) |
| `/api/v2/users/:id` | GET | Get user by ID |
| `/api/v2/users/:id` | PATCH | Update user role |
| `/api/v2/users/:id` | DELETE | Remove user from tenant |
| `/api/v2/users/invite` | POST | Invite user to tenant |

---

## API Endpoints

Base path: `/api/v2`

### Agents Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents` | POST | Create agent |
| `/agents` | GET | List agents (with filters) |
| `/agents/:id` | GET | Get agent by ID |
| `/agents/:id` | PATCH | Update agent |
| `/agents/:id` | DELETE | Delete agent |
| `/agents/:id/activate` | POST | Activate agent |
| `/agents/resolve/:name` | GET | Resolve agent by name |

### DAGs Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dags` | POST | Create DAG from goal |
| `/dags` | GET | List DAGs (with filters) |
| `/dags/scheduled` | GET | List scheduled DAGs |
| `/dags/:id` | GET | Get DAG by ID |
| `/dags/:id` | PATCH | Update DAG |
| `/dags/:id` | DELETE | Safe delete DAG |
| `/dags/:id/execute` | POST | Execute DAG |
| `/dags/execute-definition` | POST | Execute DAG definition directly |
| `/dags/experiments` | POST | Run experiments |

### Executions Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/executions` | GET | List executions (with filters) |
| `/executions/:id` | GET | Get execution by ID |
| `/executions/:id/details` | GET | Get execution with sub-steps |
| `/executions/:id/sub-steps` | GET | Get sub-steps only |
| `/executions/:id` | DELETE | Delete execution |
| `/executions/:id/resume` | POST | Resume paused execution |
| `/executions/:id/events` | GET | SSE stream of execution events |

### Tools Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tools` | GET | List available tools |

### Artifacts Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/artifacts` | GET | List artifacts (`?scope=shared\|private\|all`) |
| `/artifacts/:id` | GET | Download artifact by ID |
| `/artifacts` | POST | Upload artifact (multipart, `shared: boolean`) |
| `/artifacts/:id` | DELETE | Delete artifact |

#### Artifact Storage Structure

Artifacts are isolated per tenant and user, following Option B (Database-per-Tenant):

```
~/.desiAgent/
├── admin.db                          # Central admin database
└── tenants/
    └── {tenant_id}/
        ├── agent.db                  # Tenant's database
        └── artifacts/
            ├── shared/               # Tenant-wide shared artifacts
            │   └── {artifact_id}/
            │       └── {filename}
            └── users/
                └── {user_id}/
                    └── {artifact_id}/
                        └── {filename}
```

#### Access Control

| Level | Path | Access |
|-------|------|--------|
| Tenant shared | `artifacts/shared/` | All tenant users |
| User private | `artifacts/users/{user_id}/` | Owner only (+ admins) |

#### Artifact Schema (per tenant DB)

```typescript
interface Artifact {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  size: number;
  shared: boolean;
  storagePath: string;       // Relative path within tenant artifacts dir
  createdAt: Date;
}
```

#### Security

- Path validation middleware prevents directory traversal attacks (`../`)
- Artifacts are stored outside the database for efficient streaming
- Metadata tracked in tenant DB for access control and listing

### Costs Service

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/costs/executions/:id` | GET | Get execution cost breakdown |
| `/costs/dags/:id` | GET | Get DAG cost breakdown |
| `/costs/summary` | GET | Get cost summary (with date filters) |

### Billing API (Cost Tracking for Billing)

Cost tracking endpoints for tenant and user-level billing purposes.

#### Tenant Billing (Admin only)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/admin/billing/tenants/:id` | GET | Get tenant billing summary |
| `/api/v2/admin/billing/tenants/:id/usage` | GET | Get detailed usage breakdown |
| `/api/v2/admin/billing/tenants/:id/invoices` | GET | List tenant invoices |
| `/api/v2/admin/billing/tenants/:id/invoices` | POST | Generate invoice for period |
| `/api/v2/admin/billing/report` | GET | Aggregate billing report (all tenants) |

#### User Billing (Within Tenant)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/billing/summary` | GET | Current user's billing summary |
| `/api/v2/billing/users` | GET | All users' billing in tenant (admin) |
| `/api/v2/billing/users/:userId` | GET | Specific user's billing (admin) |
| `/api/v2/billing/usage` | GET | Detailed usage breakdown |
| `/api/v2/billing/export` | GET | Export billing data (CSV/JSON) |

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO date | Start date (default: start of current month) |
| `to` | ISO date | End date (default: now) |
| `groupBy` | string | `day` \| `week` \| `month` (default: `day`) |
| `format` | string | `json` \| `csv` (for export endpoint) |

#### Billing Summary Response

```typescript
interface BillingSummary {
  period: {
    from: string;
    to: string;
  };
  tenant: {
    id: string;
    name: string;
    plan: string;
  };
  usage: {
    totalExecutions: number;
    totalDags: number;
    totalTokens: {
      prompt: number;
      completion: number;
      total: number;
    };
    totalCostUsd: string;
    breakdown: {
      planning: string;
      execution: string;
      synthesis: string;
    };
  };
  byUser: Array<{
    userId: string;
    userName: string;
    email: string;
    executionCount: number;
    tokenCount: number;
    costUsd: string;
  }>;
  byDay: Array<{
    date: string;
    executionCount: number;
    tokenCount: number;
    costUsd: string;
  }>;
  quotaStatus: {
    executionsUsed: number;
    executionsLimit: number;
    storageUsedMb: number;
    storageLimitMb: number;
  };
}
```

#### Invoice Schema

```typescript
interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;        // e.g., "INV-2025-001"
  period: {
    from: string;
    to: string;
  };
  status: 'draft' | 'issued' | 'paid' | 'overdue';
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
  }>;
  subtotal: string;
  tax: string;
  total: string;
  currency: 'USD';
  issuedAt?: Date;
  dueAt?: Date;
  paidAt?: Date;
  createdAt: Date;
}
```

### Health & Meta

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/health/ready` | GET | Readiness check |
| `/meta/version` | GET | API version info |

### Admin API (Tenant Management)

Requires `admin` scope. For system-level tenant operations.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/admin/tenants` | GET | List all tenants |
| `/api/v2/admin/tenants` | POST | Create new tenant |
| `/api/v2/admin/tenants/:id` | GET | Get tenant details |
| `/api/v2/admin/tenants/:id` | PATCH | Update tenant (suspend, quota, etc.) |
| `/api/v2/admin/tenants/:id` | DELETE | Delete tenant and all data |
| `/api/v2/admin/tenants/:id/stats` | GET | Get tenant usage statistics |

#### Tenant Schema

```typescript
interface Tenant {
  id: string;
  name: string;
  slug: string;              // URL-safe identifier
  status: 'active' | 'suspended' | 'pending';
  plan: 'free' | 'pro' | 'enterprise';
  quotas: {
    maxExecutionsPerDay: number;
    maxAgents: number;
    maxStorageMb: number;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

> **Note**: Tenant metadata is stored in a **central admin database** (separate from tenant DBs) at `~/.desiAgent/admin.db`.

---

## Real-Time Events (SSE)

### Endpoint

```
GET /api/v2/executions/:id/events
Accept: text/event-stream
```

### Event Types

```typescript
type ExecutionEventType =
  | 'execution_started'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'tool_called'
  | 'tool_result'
  | 'llm_response'
  | 'execution_completed'
  | 'execution_failed';
```

### Event Format

```
event: task_started
data: {"taskId":"abc123","name":"Fetch data","timestamp":"2025-01-12T10:00:00Z"}

event: execution_completed
data: {"executionId":"xyz789","status":"completed","result":{...}}
```

---

## File Uploads

### Multipart Upload

```http
POST /api/v2/artifacts
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

<binary data>
--boundary--
```

### Constraints

- Max file size: 50MB (configurable)
- Allowed types: Configurable whitelist
- Storage: Local filesystem initially

---

## Rate Limiting

| Tier | Requests | Window |
|------|----------|--------|
| Default | 100 | 1 minute |
| Auth endpoints | 10 | 1 minute |
| Execution create | 20 | 1 minute |
| SSE streams | 5 concurrent | per user |

---

## Environment Variables

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Authentication
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
JWT_SECRET=
JWT_EXPIRES_IN=7d

# LLM Providers
OPENAI_API_KEY=
OPENROUTER_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434

# Database
DATABASE_BASE_PATH=~/.desiAgent/tenants

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# File Uploads
MAX_FILE_SIZE_MB=50
```

---

## Project Structure

```
src/
├── server.ts              # Entry point
├── app.ts                  # Fastify app setup
├── config/
│   └── env.ts             # Environment schema
├── plugins/
│   ├── auth.ts            # OAuth2 + API key auth plugin
│   ├── tenant.ts          # Tenant context plugin
│   └── error-handler.ts   # Global error handling
├── routes/
│   ├── v2/
│   │   ├── agents.ts
│   │   ├── dags.ts
│   │   ├── executions.ts
│   │   ├── tools.ts
│   │   ├── artifacts.ts
│   │   ├── costs.ts
│   │   ├── auth.ts
│   │   ├── users.ts       # User management
│   │   ├── billing.ts     # Billing endpoints
│   │   ├── admin.ts       # Admin/tenant management
│   │   └── health.ts
│   └── index.ts
├── services/
│   ├── tenant-client.ts   # Per-tenant desiAgent client manager
│   ├── api-key.ts         # API key generation & validation
│   ├── admin.ts           # Admin/tenant service
│   └── billing.ts         # Billing & usage tracking service
├── middleware/
│   ├── authenticate.ts    # OAuth2 + API key middleware
│   └── validate.ts
├── db/
│   ├── admin-schema.ts    # Central admin DB schema (tenants, invoices)
│   ├── user-schema.ts     # Per-tenant user/api-key schema
│   └── billing-schema.ts  # Usage tracking & billing records
├── types/
│   └── fastify.d.ts       # Fastify type extensions
└── utils/
    └── sse.ts             # SSE helpers
```

---

## Error Responses

### Standard Format

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": {
    "field": "goalText",
    "issue": "Required field missing"
  }
}
```

### Error Codes

| HTTP Status | Use Case |
|-------------|----------|
| 400 | Validation errors |
| 401 | Missing/invalid authentication |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 409 | Conflict (duplicate, etc.) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Phases

### Phase 1: Core API (MVP)

- [ ] Project setup (Fastify + Bun)
- [ ] Environment configuration
- [ ] Database-per-tenant implementation
- [ ] OAuth2 authentication (Google)
- [ ] All CRUD endpoints for services
- [ ] Basic rate limiting
- [ ] Health checks
- [ ] Error handling

### Phase 2: Real-Time & Files

- [ ] SSE for execution events
- [ ] File upload/download
- [ ] Enhanced rate limiting per endpoint

### Phase 3: Production Ready

- [ ] GitHub OAuth provider
- [ ] Comprehensive logging
- [ ] Metrics endpoint
- [ ] Docker configuration
- [ ] API documentation (OpenAPI/Swagger)

---

## Decisions Log

| Question | Decision |
|----------|----------|
| User Management | Users stored in tenant DBs (Option B alignment) |
| Admin API | Yes, admin endpoints for tenant management included |
| Webhook Support | Not required for current scope |
| API Keys | Supported alongside OAuth2 for programmatic access |

---

## References

- [desiAgent README](./README.md)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [Bun Documentation](https://bun.sh/docs)
