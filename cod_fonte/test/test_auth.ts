import { Request, Response } from 'express';
import { safe_compare_tokens, extract_token_from_request, validate_api_key } from '../security/auth';
import { env } from '../config/env';

interface test_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_result[] = [];

function run_token_comparison_tests(): void {
  const token_a = 'super_secret_token_12345';
  const token_b = 'super_secret_token_12345';
  const token_c = 'wrong_secret_token_12345';
  const token_d = 'short_token';

  const identical_match = safe_compare_tokens(token_a, token_b);
  test_results.push({
    name: 'safe_compare_tokens: tokens identicos retornam true',
    passed: identical_match === true,
  });

  const mismatch_same_len = safe_compare_tokens(token_a, token_c);
  test_results.push({
    name: 'safe_compare_tokens: tokens diferentes de mesmo tamanho retornam false',
    passed: mismatch_same_len === false,
  });

  const mismatch_diff_len = safe_compare_tokens(token_a, token_d);
  test_results.push({
    name: 'safe_compare_tokens: tokens de comprimentos distintos retornam false',
    passed: mismatch_diff_len === false,
  });
}

function run_token_extraction_tests(): void {
  const req_x_api_key = {
    headers: { 'x-api-key': 'chave_via_header' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de x-api-key',
    passed: extract_token_from_request(req_x_api_key) === 'chave_via_header',
  });

  const req_bearer = {
    headers: { authorization: 'Bearer token_bearer_123' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de Authorization Bearer',
    passed: extract_token_from_request(req_bearer) === 'token_bearer_123',
  });

  const req_x_verify = {
    headers: { 'x-verify-token': 'token_verify_fallback' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de x-verify-token',
    passed: extract_token_from_request(req_x_verify) === 'token_verify_fallback',
  });

  const req_empty = {
    headers: {},
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: retorna null para requisicao sem cabecalhos de auth',
    passed: extract_token_from_request(req_empty) === null,
  });
}

function test_middleware_request(headers: Record<string, string | undefined>): { next_called: boolean; status_code: number | null } {
  let next_called = false;
  let status_code: number | null = null;

  const res: Partial<Response> = {
    status: (code: number) => {
      status_code = code;
      return res as Response;
    },
    json: () => res as Response,
  };

  const req = { headers } as unknown as Request;
  validate_api_key(req, res as Response, () => {
    next_called = true;
  });

  return { next_called, status_code };
}

function run_middleware_tests(): void {
  const current_env_token = env.VERIFY_TOKEN;
  if (!current_env_token) {
    test_results.push({
      name: 'validate_api_key: configuracao de ambiente possui VERIFY_TOKEN',
      passed: false,
      details: 'VERIFY_TOKEN ausente nas variaveis de ambiente',
    });
    return;
  }

  const result_x_api_key = test_middleware_request({ 'x-api-key': current_env_token });
  test_results.push({
    name: 'validate_api_key: requisicao com x-api-key valida prossegue',
    passed: result_x_api_key.next_called === true && result_x_api_key.status_code === null,
  });

  const result_bearer = test_middleware_request({ authorization: `Bearer ${current_env_token}` });
  test_results.push({
    name: 'validate_api_key: requisicao com Bearer token valido prossegue',
    passed: result_bearer.next_called === true && result_bearer.status_code === null,
  });

  const result_missing = test_middleware_request({});
  test_results.push({
    name: 'validate_api_key: requisicao sem token retorna 401',
    passed: result_missing.next_called === false && result_missing.status_code === 401,
  });

  const result_invalid = test_middleware_request({ 'x-api-key': 'chave_completamente_incorreta' });
  test_results.push({
    name: 'validate_api_key: requisicao com token invalido retorna 401',
    passed: result_invalid.next_called === false && result_invalid.status_code === 401,
  });
}

run_token_comparison_tests();
run_token_extraction_tests();
run_middleware_tests();

let failed_count = 0;
for (const res of test_results) {
  if (res.passed) {
    console.log(`SUCESSO: [${res.name}]`);
  } else {
    failed_count++;
    console.error(`FALHA: [${res.name}] - ${res.details || 'Resultado inesperado'}`);
  }
}

if (failed_count > 0) {
  console.error(`Total de falhas no teste de autenticacao: ${failed_count}`);
  process.exit(1);
} else {
  console.log(`Todos os ${test_results.length} testes de autenticacao passaram com exito.`);
  process.exit(0);
}
