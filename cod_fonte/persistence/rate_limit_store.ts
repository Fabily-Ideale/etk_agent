import { prisma } from '../config/prisma';

export interface rate_limit_result {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  total_limit: number;
}

export interface rate_limit_store {
  consume(
    key: string,
    max_requests: number,
    window_ms: number
  ): Promise<rate_limit_result>;

  reset(key?: string): Promise<void>;

  destroy?(): void;
}

export class prisma_rate_limit_store implements rate_limit_store {
  private cleanup_interval_id?: NodeJS.Timeout;

  constructor(cleanup_interval_ms: number = 60000) {
    this.start_cleanup(cleanup_interval_ms);
  }

  private start_cleanup(interval_ms: number): void {
    const timer = setInterval(() => {
      void this.purge_expired();
    }, interval_ms);

    if (timer.unref) {
      timer.unref();
    }

    this.cleanup_interval_id = timer;
  }

  public async purge_expired(): Promise<void> {
    try {
      await prisma.rate_limit_counter.deleteMany({
        where: {
          reset_at: {
            lte: new Date(),
          },
        },
      });
    } catch {
      return;
    }
  }

  public async consume(
    key: string,
    max_requests: number,
    window_ms: number
  ): Promise<rate_limit_result> {
    const safe_key = typeof key === 'string' && key.trim().length > 0 ? key.trim() : 'default_key';
    const safe_max = max_requests > 0 ? max_requests : 1;
    const safe_window = window_ms > 0 ? window_ms : 1000;

    const now = Date.now();
    const new_reset_at = new Date(now + safe_window);

    const rows = await prisma.$queryRaw<Array<{ hit_count: number | bigint; reset_at: Date }>>`
      INSERT INTO rate_limit_counter (limit_key, hit_count, reset_at)
      VALUES (${safe_key}, 1, ${new_reset_at})
      ON CONFLICT (limit_key)
      DO UPDATE SET
        hit_count = CASE
          WHEN rate_limit_counter.reset_at <= NOW() THEN 1
          ELSE rate_limit_counter.hit_count + 1
        END,
        reset_at = CASE
          WHEN rate_limit_counter.reset_at <= NOW() THEN ${new_reset_at}
          ELSE rate_limit_counter.reset_at
        END
      RETURNING hit_count, reset_at
    `;

    const record = rows[0];
    const hit_count = Number(record.hit_count);
    const reset_epoch = new Date(record.reset_at).getTime();
    const current_epoch = Date.now();

    const allowed = hit_count <= safe_max;
    const remaining = Math.max(0, safe_max - hit_count);
    const retry_after_seconds = Math.max(1, Math.ceil((reset_epoch - current_epoch) / 1000));

    return {
      allowed,
      remaining,
      retry_after_seconds,
      total_limit: safe_max,
    };
  }

  public async reset(key?: string): Promise<void> {
    if (key) {
      await prisma.rate_limit_counter.deleteMany({
        where: { limit_key: key },
      });
    } else {
      await prisma.rate_limit_counter.deleteMany();
    }
  }

  public destroy(): void {
    if (this.cleanup_interval_id) {
      clearInterval(this.cleanup_interval_id);
      this.cleanup_interval_id = undefined;
    }
  }
}

interface memory_rate_limit_entry {
  count: number;
  reset_at: number;
}

export class memory_rate_limit_store implements rate_limit_store {
  private storage: Map<string, memory_rate_limit_entry>;
  private cleanup_interval_id?: NodeJS.Timeout;

  constructor(cleanup_interval_ms: number = 60000) {
    this.storage = new Map<string, memory_rate_limit_entry>();
    this.start_cleanup(cleanup_interval_ms);
  }

  private start_cleanup(interval_ms: number): void {
    const timer = setInterval(() => {
      this.purge_expired();
    }, interval_ms);

    if (timer.unref) {
      timer.unref();
    }

    this.cleanup_interval_id = timer;
  }

  public purge_expired(): void {
    const now = Date.now();
    for (const [key, entry] of this.storage.entries()) {
      if (entry.reset_at <= now) {
        this.storage.delete(key);
      }
    }
  }

  public async consume(
    key: string,
    max_requests: number,
    window_ms: number
  ): Promise<rate_limit_result> {
    const safe_key = typeof key === 'string' && key.trim().length > 0 ? key.trim() : 'default_key';
    const safe_max = max_requests > 0 ? max_requests : 1;
    const safe_window = window_ms > 0 ? window_ms : 1000;

    const now = Date.now();
    const existing = this.storage.get(safe_key);

    if (existing && existing.reset_at > now) {
      if (existing.count >= safe_max) {
        const retry_after_seconds = Math.max(1, Math.ceil((existing.reset_at - now) / 1000));
        return {
          allowed: false,
          remaining: 0,
          retry_after_seconds,
          total_limit: safe_max,
        };
      }

      existing.count += 1;
      const remaining = safe_max - existing.count;
      const retry_after_seconds = Math.max(1, Math.ceil((existing.reset_at - now) / 1000));

      return {
        allowed: true,
        remaining,
        retry_after_seconds,
        total_limit: safe_max,
      };
    }

    const reset_at = now + safe_window;
    this.storage.set(safe_key, {
      count: 1,
      reset_at,
    });

    return {
      allowed: true,
      remaining: Math.max(0, safe_max - 1),
      retry_after_seconds: Math.ceil(safe_window / 1000),
      total_limit: safe_max,
    };
  }

  public async reset(key?: string): Promise<void> {
    if (key) {
      this.storage.delete(key);
    } else {
      this.storage.clear();
    }
  }

  public destroy(): void {
    if (this.cleanup_interval_id) {
      clearInterval(this.cleanup_interval_id);
      this.cleanup_interval_id = undefined;
    }
    this.storage.clear();
  }
}
