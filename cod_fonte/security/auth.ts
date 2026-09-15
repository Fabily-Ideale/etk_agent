import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { env } from '../config/env';

export function safe_compare_tokens(provided_token: string, expected_token: string): boolean {
  const provided_buffer = Buffer.from(provided_token, 'utf8');
  const expected_buffer = Buffer.from(expected_token, 'utf8');

  if (provided_buffer.length !== expected_buffer.length) {
    return false;
  }

  return timingSafeEqual(provided_buffer, expected_buffer);
}

export function extract_token_from_request(req: Request): string | null {
  const x_api_key = req.headers['x-api-key'];
  if (typeof x_api_key === 'string' && x_api_key.trim().length > 0) {
    return x_api_key.trim();
  }

  const authorization_header = req.headers['authorization'];
  if (typeof authorization_header === 'string') {
    const bearer_match = authorization_header.match(/^Bearer\s+(.+)$/i);
    if (bearer_match && bearer_match[1].trim().length > 0) {
      return bearer_match[1].trim();
    }
  }

  const x_verify_token = req.headers['x-verify-token'];
  if (typeof x_verify_token === 'string' && x_verify_token.trim().length > 0) {
    return x_verify_token.trim();
  }

  return null;
}

export function validate_api_key(req: Request, res: Response, next: NextFunction): void {
  const configured_token = env.VERIFY_TOKEN;

  if (!configured_token) {
    res.status(500).json({
      error: 'server_misconfiguration',
      message: 'Token de verificacao nao configurado no servidor.',
    });
    return;
  }

  const provided_token = extract_token_from_request(req);

  if (!provided_token) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Token de autorizacao ausente. Forneca via cabecalho x-api-key ou Authorization Bearer.',
    });
    return;
  }

  const is_valid = safe_compare_tokens(provided_token, configured_token);

  if (!is_valid) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Token de autorizacao invalido.',
    });
    return;
  }

  next();
}
