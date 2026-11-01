import { Injectable, Logger } from '@nestjs/common';

interface QueueItem {
  fn: () => Promise<unknown>;
  priority: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

@Injectable()
export class TaskQueueService {
  private readonly logger = new Logger(TaskQueueService.name);
  private readonly queue: QueueItem[] = [];
  private activeCount = 0;
  private readonly maxConcurrent = 3;
  private processedCount = 0;
  private failedCount = 0;

  /**
   * Enqueue a task function. Returns a promise that resolves with the task result.
   * Higher priority = processed first (default 0).
   */
  enqueue<T>(taskFn: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: taskFn, priority, resolve, reject });
      // Sort by priority descending (higher = first)
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processNext();
    });
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getStats() {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      processed: this.processedCount,
      failed: this.failedCount,
    };
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift()!;
    this.activeCount++;

    this.executeWithRetry(item.fn, 1)
      .then((result) => {
        this.processedCount++;
        item.resolve(result);
      })
      .catch((error) => {
        this.failedCount++;
        this.logger.error(`Queue task failed after retry: ${error.message || error}`);
        item.reject(error);
      })
      .finally(() => {
        this.activeCount--;
        this.processNext();
      });
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (maxRetries > 0) {
        this.logger.warn(`Queue task failed, retrying (${maxRetries} left)...`);
        return this.executeWithRetry(fn, maxRetries - 1);
      }
      throw error;
    }
  }
}
