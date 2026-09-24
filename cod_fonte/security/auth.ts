import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

export function safe_compare_tokens(provided_token: string, expected_token: string): boolean {
  if (typeof provided_token !== 'string' || typeof expected_token !== 'string') {
    return false;
  }

  const provided_buffer = Buffer.from(provided_token, 'utf8');
  const expected_buffer = Buffer.from(expected_token, 'utf8');

  if (provided_buffer.length !== expected_buffer.length) {
    return false;
  }

  return timingSafeEqual(provided_buffer, expected_buffer);
}

export function extract_token_from_request(req: Request): string | null {
  if (!req || !req.headers) {
    return null;
  }

  const x_api_key = req.headers['x-api-key'];
  if (typeof x_api_key === 'string' && x_api_key.trim().length > 0) {
    return x_api_key.trim();
  }

  if (Array.isArray(x_api_key) && x_api_key.length > 0 && typeof x_api_key[0] === 'string' && x_api_key[0].trim().length > 0) {
    return x_api_key[0].trim();
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

  if (Array.isArray(x_verify_token) && x_verify_token.length > 0 && typeof x_verify_token[0] === 'string' && x_verify_token[0].trim().length > 0) {
    return x_verify_token[0].trim();
  }

  return null;
}
