declare module 'node-cron' {
  export interface ScheduleOptions {
    timezone?: string;
    scheduled?: boolean;
    recoverMissedExecutions?: boolean;
    name?: string;
  }

  export interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy?(): void;
  }

  export function schedule(
    expression: string,
    callback: () => void,
    options?: ScheduleOptions
  ): ScheduledTask;

  const cron: {
    schedule: typeof schedule;
  };

  export default cron;
}
