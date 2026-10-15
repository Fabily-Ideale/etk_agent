import { createHmac } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { safe_compare_tokens } from './auth';

export interface raw_body_request extends Request {
  raw_body?: Buffer;
}

const timestamp_pattern = /^\d{1,12}$/;
const default_tolerance_seconds = 300;

export function capture_raw_body(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  (req as unknown as raw_body_request).raw_body = buf;
}

export function compute_webhook_signature(secret: string, timestamp: string, raw_body: Buffer): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(raw_body).digest('hex');
  return `sha256=${digest}`;
}

function read_single_header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function create_webhook_auth(
  secret: string,
  tolerance_seconds: number = default_tolerance_seconds,
  now_ms: () => number = Date.now
): RequestHandler {
  const reject = (res: Response): void => {
    res.status(401).json({ error: 'unauthorized' });
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const timestamp = read_single_header(req, 'x-chatwoot-timestamp');
    const signature = read_single_header(req, 'x-chatwoot-signature');

    if (!timestamp || !signature || !timestamp_pattern.test(timestamp)) {
      reject(res);
      return;
    }

    const skew_seconds = Math.abs(Math.floor(now_ms() / 1000) - Number(timestamp));
    if (skew_seconds > tolerance_seconds) {
      reject(res);
      return;
    }

    const raw_body = (req as raw_body_request).raw_body ?? Buffer.alloc(0);
    const expected_signature = compute_webhook_signature(secret, timestamp, raw_body);

    if (!safe_compare_tokens(signature, expected_signature)) {
      reject(res);
      return;
    }

    next();
  };
}
