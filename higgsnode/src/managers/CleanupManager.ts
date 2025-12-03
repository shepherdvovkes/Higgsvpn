import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export type CleanupTask = () => Promise<void> | void;

export class CleanupManager extends EventEmitter {
  private tasks: Map<string, CleanupTask> = new Map();
  private executed = false;

  /**
   * Регистрирует задачу очистки
   */
  register(name: string, task: CleanupTask): void {
    if (this.executed) {
      logger.warn('Cannot register cleanup task after cleanup has been executed', { name });
      return;
    }
    this.tasks.set(name, task);
    logger.debug('Cleanup task registered', { name });
  }

  /**
   * Удаляет задачу очистки
   */
  unregister(name: string): void {
    this.tasks.delete(name);
    logger.debug('Cleanup task unregistered', { name });
  }

  /**
   * Выполняет все зарегистрированные задачи очистки
   */
  async execute(): Promise<void> {
    if (this.executed) {
      logger.warn('Cleanup already executed');
      return;
    }

    this.executed = true;
    logger.info('Starting cleanup', { taskCount: this.tasks.size });

    const errors: Array<{ name: string; error: any }> = [];

    // Выполнить задачи в обратном порядке регистрации
    const taskArray = Array.from(this.tasks.entries()).reverse();

    for (const [name, task] of taskArray) {
      try {
        logger.debug('Executing cleanup task', { name });
        await task();
        logger.debug('Cleanup task completed', { name });
      } catch (error) {
        logger.error('Cleanup task failed', { name, error });
        errors.push({ name, error });
      }
    }

    if (errors.length > 0) {
      logger.error('Some cleanup tasks failed', { errors });
      this.emit('cleanupErrors', errors);
    } else {
      logger.info('All cleanup tasks completed successfully');
      this.emit('cleanupComplete');
    }
  }

  /**
   * Проверяет, был ли выполнен cleanup
   */
  isExecuted(): boolean {
    return this.executed;
  }
}

