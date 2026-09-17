import { Request, Response, NextFunction } from 'express';

export interface rate_limit_entry {
  count: number;
  reset_at: number;
}

export interface rate_limit_result {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  total_limit: number;
}

export class memory_rate_limiter {
  private storage: Map<string, rate_limit_entry>;
  private cleanup_interval_id?: NodeJS.Timeout;

  constructor(cleanup_interval_ms: number = 60000) {
    this.storage = new Map<string, rate_limit_entry>();
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

  public consume(key: string, max_requests: number, window_ms: number): rate_limit_result {
    const safe_key = typeof key === 'string' && key.trim().length > 0 ? key.trim() : 'default_key';
    const safe_max = max_requests > 0 ? max_requests : 1;
    const safe_window = window_ms > 0 ? window_ms : 1000;

    const now = Date.now();
    const existing_entry = this.storage.get(safe_key);

    if (existing_entry && existing_entry.reset_at > now) {
      if (existing_entry.count >= safe_max) {
        const retry_after_seconds = Math.max(1, Math.ceil((existing_entry.reset_at - now) / 1000));
        return {
          allowed: false,
          remaining: 0,
          retry_after_seconds,
          total_limit: safe_max,
        };
      }

      existing_entry.count += 1;
      const remaining = safe_max - existing_entry.count;
      const retry_after_seconds = Math.max(1, Math.ceil((existing_entry.reset_at - now) / 1000));

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

  public reset(key?: string): void {
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

export function extract_client_ip(req: Request): string {
  if (!req) {
    return 'unknown_ip';
  }

  const forwarded_for = req.headers ? req.headers['x-forwarded-for'] : undefined;
  if (typeof forwarded_for === 'string') {
    const first_ip = forwarded_for.split(',')[0].trim();
    if (first_ip.length > 0) {
      return first_ip;
    }
  }

  if (Array.isArray(forwarded_for) && forwarded_for.length > 0 && typeof forwarded_for[0] === 'string') {
    const first_ip = forwarded_for[0].split(',')[0].trim();
    if (first_ip.length > 0) {
      return first_ip;
    }
  }

  return req.ip || req.socket?.remoteAddress || 'unknown_ip';
}

export function create_ip_rate_limiter(
  max_requests: number,
  window_ms: number,
  custom_limiter?: memory_rate_limiter
) {
  const limiter = custom_limiter || new memory_rate_limiter();

  return (req: Request, res: Response, next: NextFunction): void => {
    const client_ip = extract_client_ip(req);
    const key = `ip:${client_ip}`;
    const result = limiter.consume(key, max_requests, window_ms);

    if (res?.setHeader) {
      res.setHeader('X-RateLimit-Limit', String(result.total_limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    }

    if (!result.allowed) {
      if (res?.setHeader) {
        res.setHeader('Retry-After', String(result.retry_after_seconds));
      }
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Limite de requisicoes por IP atingido. Tente novamente mais tarde.',
        retry_after_seconds: result.retry_after_seconds,
      });
      return;
    }

    next();
  };
}

export function create_phone_rate_limiter(
  max_requests: number,
  window_ms: number,
  custom_limiter?: memory_rate_limiter
) {
  const limiter = custom_limiter || new memory_rate_limiter();

  return (req: Request, res: Response, next: NextFunction): void => {
    const from_field = req?.body?.from;
    const phone_from_body = typeof from_field === 'number' ? String(from_field) : from_field;
    const phone_from_header = req?.headers ? req.headers['x-phone-number'] : undefined;
    const raw_phone = phone_from_body || phone_from_header;

    if (!raw_phone || typeof raw_phone !== 'string') {
      next();
      return;
    }

    const sanitized_phone = raw_phone.replace(/\D/g, '');
    const key = `phone:${sanitized_phone.length > 0 ? sanitized_phone : raw_phone.trim()}`;
    const result = limiter.consume(key, max_requests, window_ms);

    if (!result.allowed) {
      if (res?.setHeader) {
        res.setHeader('Retry-After', String(result.retry_after_seconds));
      }
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Limite de requisicoes para este numero de telefone atingido. Tente novamente mais tarde.',
        retry_after_seconds: result.retry_after_seconds,
      });
      return;
    }

    next();
  };
}
