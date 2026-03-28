import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/client.js';
import { type PolicyArtifact, policyArtifacts } from '../../db/schema.js';
import type { PolicyMode, PolicyOutcome } from './types.js';

export interface PolicyArtifactFilter {
  dagId?: string;
  executionId?: string;
  outcome?: PolicyOutcome;
  mode?: PolicyMode;
  policyVersion?: string;
  rulePackId?: string;
  rulePackVersion?: string;
  violationCode?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface PolicyAuditSummary {
  total: number;
  byOutcome: Record<PolicyOutcome, number>;
  byMode: Record<PolicyMode, number>;
  byPolicyVersion: Array<{ policyVersion: string; count: number }>;
  byRulePack: Array<{ rulePackId: string; rulePackVersion: string; count: number }>;
  topViolationCodes: Array<{ code: string; count: number }>;
}

export class PolicyRepository {
  private readonly db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async get(id: string): Promise<PolicyArtifact | null> {
    const rows = await this.db.select().from(policyArtifacts).where(eq(policyArtifacts.id, id)).limit(1);
    return rows[0] || null;
  }

  async list(filter: PolicyArtifactFilter = {}): Promise<PolicyArtifact[]> {
    const conditions = [];

    if (filter.dagId) {
      conditions.push(eq(policyArtifacts.dagId, filter.dagId));
    }
    if (filter.executionId) {
      conditions.push(eq(policyArtifacts.executionId, filter.executionId));
    }
    if (filter.outcome) {
      conditions.push(eq(policyArtifacts.outcome, filter.outcome));
    }
    if (filter.mode) {
      conditions.push(eq(policyArtifacts.mode, filter.mode));
    }
    if (filter.policyVersion) {
      conditions.push(eq(policyArtifacts.policyVersion, filter.policyVersion));
    }
    if (filter.rulePackId) {
      conditions.push(eq(policyArtifacts.rulePackId, filter.rulePackId));
    }
    if (filter.rulePackVersion) {
      conditions.push(eq(policyArtifacts.rulePackVersion, filter.rulePackVersion));
    }
    if (filter.createdAfter) {
      conditions.push(gte(policyArtifacts.createdAt, filter.createdAfter));
    }
    if (filter.createdBefore) {
      conditions.push(lte(policyArtifacts.createdAt, filter.createdBefore));
    }

    const query = this.db
      .select()
      .from(policyArtifacts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(policyArtifacts.createdAt));

    const requiresViolationFilter = typeof filter.violationCode === 'string' && filter.violationCode.trim().length > 0;
    const sanitizedLimit = filter.limit === 0 ? null : Math.max(1, Math.min(filter.limit ?? 100, 5000));
    const sanitizedOffset = Math.max(0, filter.offset ?? 0);

    const rows = requiresViolationFilter
      ? await query
      : sanitizedLimit === null
      ? await query.offset(sanitizedOffset)
      : await query.limit(sanitizedLimit).offset(sanitizedOffset);

    let filtered = rows;
    if (requiresViolationFilter) {
      const violationCode = filter.violationCode!.trim().toLowerCase();
      filtered = rows.filter((artifact) =>
        (artifact.violations || []).some((violation) => String((violation as any)?.code || '').toLowerCase() === violationCode)
      );
      filtered = filtered.slice(
        sanitizedOffset,
        sanitizedLimit === null ? undefined : sanitizedOffset + sanitizedLimit,
      );
    }

    return filtered;
  }

  async summarize(filter: Omit<PolicyArtifactFilter, 'limit' | 'offset'> = {}): Promise<PolicyAuditSummary> {
    const artifacts = await this.list({ ...filter, limit: 0, offset: 0 });

    const byOutcome: Record<PolicyOutcome, number> = {
      allow: 0,
      deny: 0,
      needs_clarification: 0,
      rewrite: 0,
    };
    const byMode: Record<PolicyMode, number> = {
      lenient: 0,
      strict: 0,
    };

    const policyVersionCounts = new Map<string, number>();
    const rulePackCounts = new Map<string, { rulePackId: string; rulePackVersion: string; count: number }>();
    const violationCounts = new Map<string, number>();

    for (const artifact of artifacts) {
      byOutcome[artifact.outcome] += 1;
      byMode[artifact.mode] += 1;

      policyVersionCounts.set(
        artifact.policyVersion,
        (policyVersionCounts.get(artifact.policyVersion) || 0) + 1,
      );

      const rulePackKey = `${artifact.rulePackId}:${artifact.rulePackVersion}`;
      rulePackCounts.set(rulePackKey, {
        rulePackId: artifact.rulePackId,
        rulePackVersion: artifact.rulePackVersion,
        count: (rulePackCounts.get(rulePackKey)?.count || 0) + 1,
      });

      for (const violation of artifact.violations || []) {
        const code = String((violation as any)?.code || '').trim();
        if (!code) continue;
        violationCounts.set(code, (violationCounts.get(code) || 0) + 1);
      }
    }

    return {
      total: artifacts.length,
      byOutcome,
      byMode,
      byPolicyVersion: Array.from(policyVersionCounts.entries())
        .map(([policyVersion, count]) => ({ policyVersion, count }))
        .sort((a, b) => b.count - a.count),
      byRulePack: Array.from(rulePackCounts.values()).sort((a, b) => b.count - a.count),
      topViolationCodes: Array.from(violationCounts.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }
}
