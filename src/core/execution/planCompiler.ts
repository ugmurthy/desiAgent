export interface DagTaskLike {
  id: string;
  dependencies: string[];
}

export interface CompiledExecutionPlan<T extends DagTaskLike> {
  waves: T[][];
  tasksById: Map<string, T>;
  adjacency: Map<string, string[]>;
  indegrees: Map<string, number>;
}

/**
 * Compiles a DAG into deterministic execution waves using Kahn's topological algorithm (O(V + E)).
 */
export class ExecutionPlanCompiler {
  static compile<T extends DagTaskLike>(tasks: T[]): CompiledExecutionPlan<T> {
    const tasksById = new Map<string, T>();
    const duplicateIds: string[] = [];

    for (const task of tasks) {
      if (tasksById.has(task.id)) {
        duplicateIds.push(task.id);
        continue;
      }
      tasksById.set(task.id, task);
    }

    if (duplicateIds.length > 0) {
      throw new Error(`Duplicate task id(s) found: ${duplicateIds.join(', ')}`);
    }

    const adjacency = new Map<string, string[]>();
    const indegrees = new Map<string, number>();

    for (const task of tasks) {
      adjacency.set(task.id, []);
      indegrees.set(task.id, 0);
    }

    for (const task of tasks) {
      const deps = task.dependencies.filter((dep) => dep !== 'none');
      const missingDeps = deps.filter((dep) => !tasksById.has(dep));

      if (missingDeps.length > 0) {
        throw new Error(`Invalid DAG: Task ${task.id} depends on missing task(s): ${missingDeps.join(', ')}`);
      }

      for (const dep of deps) {
        adjacency.get(dep)!.push(task.id);
        indegrees.set(task.id, (indegrees.get(task.id) ?? 0) + 1);
      }
    }

    let readyQueue = Array.from(indegrees.entries())
      .filter(([, indegree]) => indegree === 0)
      .map(([taskId]) => taskId)
      .sort();

    const waves: T[][] = [];
    let processedCount = 0;

    while (readyQueue.length > 0) {
      const currentWaveIds = readyQueue;
      readyQueue = [];

      const currentWave: T[] = [];
      for (const taskId of currentWaveIds) {
        const task = tasksById.get(taskId)!;
        currentWave.push(task);
        processedCount++;

        for (const childTaskId of adjacency.get(taskId) ?? []) {
          const nextInDegree = (indegrees.get(childTaskId) ?? 0) - 1;
          indegrees.set(childTaskId, nextInDegree);
          if (nextInDegree === 0) {
            readyQueue.push(childTaskId);
          }
        }
      }

      readyQueue.sort();
      waves.push(currentWave);
    }

    if (processedCount !== tasks.length) {
      const remaining = Array.from(indegrees.entries())
        .filter(([, indegree]) => indegree > 0)
        .map(([taskId]) => taskId)
        .sort();
      throw new Error(`DAG execution deadlock. Remaining tasks: ${remaining.join(', ')}`);
    }

    return {
      waves,
      tasksById,
      adjacency,
      indegrees,
    };
  }
}
