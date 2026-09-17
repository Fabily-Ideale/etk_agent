import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

export interface standard_log_payload {
  timestamp: string;
  level: 'INFO';
  user: string;
  event: 'request_received' | 'response_sent';
  duration_ms?: number;
  status?: string;
}

export interface error_log_payload {
  timestamp: string;
  level: 'ERROR';
  error_code: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface guardrail_log_payload {
  timestamp: string;
  level: 'WARN';
  user: string;
  reason_code: string;
  action: string;
  details?: string;
}

export class rotating_file_logger {
  private base_dir: string;
  private max_lines: number;
  private max_files: number;
  private line_counts: Map<string, number>;

  constructor(base_dir: string = env.LOG_DIR, max_lines: number = env.LOG_MAX_LINES, max_files: number = env.LOG_MAX_FILES) {
    this.base_dir = path.resolve(base_dir);
    this.max_lines = max_lines > 0 ? max_lines : 10000;
    this.max_files = max_files >= 0 ? max_files : 1;
    this.line_counts = new Map<string, number>();
    this.ensure_directory_exists();
  }

  private ensure_directory_exists(): void {
    if (!fs.existsSync(this.base_dir)) {
      fs.mkdirSync(this.base_dir, { recursive: true });
    }
  }

  private count_file_lines(file_path: string): number {
    if (!fs.existsSync(file_path)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(file_path, 'utf8');
      if (content.length === 0) {
        return 0;
      }
      return content.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  private get_line_count(category: string, file_path: string): number {
    const cached = this.line_counts.get(category);
    if (typeof cached === 'number') {
      return cached;
    }

    const counted = this.count_file_lines(file_path);
    this.line_counts.set(category, counted);
    return counted;
  }

  private rotate_file(file_path: string): void {
    if (!fs.existsSync(file_path)) {
      return;
    }

    if (this.max_files === 0) {
      try {
        fs.unlinkSync(file_path);
      } catch {}
      return;
    }

    for (let index = this.max_files; index >= 1; index--) {
      const source = index === 1 ? file_path : `${file_path}.${index - 1}`;
      const destination = `${file_path}.${index}`;

      if (fs.existsSync(destination)) {
        try {
          fs.unlinkSync(destination);
        } catch {}
      }

      if (fs.existsSync(source)) {
        try {
          fs.renameSync(source, destination);
        } catch {}
      }
    }
  }

  public write_line(category: string, serialized_payload: string): void {
    this.ensure_directory_exists();
    const file_name = `${category}.log`;
    const target_path = path.join(this.base_dir, file_name);

    let current_lines = this.get_line_count(category, target_path);

    if (current_lines >= this.max_lines) {
      this.rotate_file(target_path);
      current_lines = 0;
      this.line_counts.set(category, 0);
    }

    fs.appendFileSync(target_path, serialized_payload + '\n', 'utf8');
    this.line_counts.set(category, current_lines + 1);
  }

  public log_standard(user: string, event: 'request_received' | 'response_sent', metadata?: { duration_ms?: number; status?: string }): standard_log_payload {
    const payload: standard_log_payload = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      user,
      event,
      ...(metadata?.duration_ms !== undefined ? { duration_ms: metadata.duration_ms } : {}),
      ...(metadata?.status ? { status: metadata.status } : {}),
    };

    this.write_line('standard', JSON.stringify(payload));
    return payload;
  }

  public log_error(error_code: string, message: string, stack?: string, context?: Record<string, unknown>): error_log_payload {
    const payload: error_log_payload = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      error_code,
      message,
      ...(stack ? { stack } : {}),
      ...(context ? { context } : {}),
    };

    this.write_line('error', JSON.stringify(payload));
    return payload;
  }

  public log_guardrail_violation(user: string, reason_code: string, action: string = 'blocked', details?: string): guardrail_log_payload {
    const payload: guardrail_log_payload = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      user,
      reason_code,
      action,
      ...(details ? { details } : {}),
    };

    this.write_line('guardrails', JSON.stringify(payload));
    return payload;
  }

  public get_log_path(category: string): string {
    return path.join(this.base_dir, `${category}.log`);
  }
}

export const default_logger = new rotating_file_logger();

export function log_standard_event(user: string, event: 'request_received' | 'response_sent', metadata?: { duration_ms?: number; status?: string }): standard_log_payload {
  return default_logger.log_standard(user, event, metadata);
}

export function log_error_event(error_code: string, message: string, stack?: string, context?: Record<string, unknown>): error_log_payload {
  return default_logger.log_error(error_code, message, stack, context);
}

export function log_guardrail_violation_event(user: string, reason_code: string, action: string = 'blocked', details?: string): guardrail_log_payload {
  return default_logger.log_guardrail_violation(user, reason_code, action, details);
}
