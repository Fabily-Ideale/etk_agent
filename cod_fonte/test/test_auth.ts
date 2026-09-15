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

  test_results.push({
    name: 'safe_compare_tokens: tokens identicos retornam true',
    passed: safe_compare_tokens(token_a, token_b) === true,
  });

  test_results.push({
    name: 'safe_compare_tokens: tokens diferentes de mesmo tamanho retornam false',
    passed: safe_compare_tokens(token_a, token_c) === false,
  });

  test_results.push({
    name: 'safe_compare_tokens: tokens de comprimentos distintos retornam false',
    passed: safe_compare_tokens(token_a, token_d) === false,
  });

  test_results.push({
    name: 'safe_compare_tokens: string vazia contra string vazia retorna true',
    passed: safe_compare_tokens('', '') === true,
  });

  test_results.push({
    name: 'safe_compare_tokens: string vazia contra token existente retorna false',
    passed: safe_compare_tokens('', token_a) === false,
  });

  test_results.push({
    name: 'safe_compare_tokens: caracteres multibyte utf-8 sao comparados corretamente',
    passed: safe_compare_tokens('chave_secreta_çãõ', 'chave_secreta_çãõ') === true,
  });

  test_results.push({
    name: 'safe_compare_tokens: entrada null ou undefined rejeitada com false sem crash',
    passed: safe_compare_tokens(null as unknown as string, token_a) === false &&
      safe_compare_tokens(token_a, undefined as unknown as string) === false,
  });

  test_results.push({
    name: 'safe_compare_tokens: tentativa com caracteres nulos embutidos retorna false contra token limpo',
    passed: safe_compare_tokens('super_secret_token_12345\0extra', token_a) === false,
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

  const req_x_api_key_spaced = {
    headers: { 'x-api-key': '   chave_com_espacos   ' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: remove espacos em branco nas pontas de x-api-key',
    passed: extract_token_from_request(req_x_api_key_spaced) === 'chave_com_espacos',
  });

  const req_x_api_key_empty = {
    headers: { 'x-api-key': '    ' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: x-api-key vazia retorna null',
    passed: extract_token_from_request(req_x_api_key_empty) === null,
  });

  const req_x_api_key_array = {
    headers: { 'x-api-key': ['primeira_chave', 'segunda_chave'] },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai primeiro item se header for array',
    passed: extract_token_from_request(req_x_api_key_array) === 'primeira_chave',
  });

  const req_bearer = {
    headers: { authorization: 'Bearer token_bearer_123' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de Authorization Bearer',
    passed: extract_token_from_request(req_bearer) === 'token_bearer_123',
  });

  const req_bearer_case_insensitive = {
    headers: { authorization: 'bearer token_bearer_case' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai com bearer minusculo',
    passed: extract_token_from_request(req_bearer_case_insensitive) === 'token_bearer_case',
  });

  const req_bearer_extra_spaces = {
    headers: { authorization: 'Bearer    token_multi_espacos   ' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai com espacos multiplos apos Bearer',
    passed: extract_token_from_request(req_bearer_extra_spaces) === 'token_multi_espacos',
  });

  const req_bearer_empty_token = {
    headers: { authorization: 'Bearer   ' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: Bearer sem token retorna null',
    passed: extract_token_from_request(req_bearer_empty_token) === null,
  });

  const req_basic_auth = {
    headers: { authorization: 'Basic dXNlcjpwYXNz' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: Basic auth nao e interpretado como Bearer',
    passed: extract_token_from_request(req_basic_auth) === null,
  });

  const req_x_verify = {
    headers: { 'x-verify-token': 'token_verify_fallback' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de x-verify-token',
    passed: extract_token_from_request(req_x_verify) === 'token_verify_fallback',
  });

  const req_x_verify_array = {
    headers: { 'x-verify-token': ['array_verify_token'] },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: extrai de x-verify-token em array',
    passed: extract_token_from_request(req_x_verify_array) === 'array_verify_token',
  });

  const req_precedence = {
    headers: {
      'x-api-key': 'chave_prioritaria',
      authorization: 'Bearer token_secundario',
      'x-verify-token': 'token_terciario',
    },
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: respeita precedencia de x-api-key sobre bearer e verify-token',
    passed: extract_token_from_request(req_precedence) === 'chave_prioritaria',
  });

  const req_empty_headers = {
    headers: {},
  } as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: retorna null para requisicao com headers vazios',
    passed: extract_token_from_request(req_empty_headers) === null,
  });

  const req_missing_headers = {} as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: requisicao sem objeto headers retorna null sem quebrar',
    passed: extract_token_from_request(req_missing_headers) === null,
  });

  const req_null = null as unknown as Request;
  test_results.push({
    name: 'extract_token_from_request: requisicao nula retorna null com seguranca',
    passed: extract_token_from_request(req_null) === null,
  });
}

function test_middleware_request(
  headers: Record<string, string | string[] | undefined>,
  mock_env_token?: string
): { next_called: boolean; status_code: number | null; response_body: any } {
  let next_called = false;
  let status_code: number | null = null;
  let response_body: any = null;

  const original_env_token = env.VERIFY_TOKEN;
  if (mock_env_token !== undefined) {
    (env as any).VERIFY_TOKEN = mock_env_token;
  }

  const res: Partial<Response> = {
    status: (code: number) => {
      status_code = code;
      return res as Response;
    },
    json: (data: any) => {
      response_body = data;
      return res as Response;
    },
  };

  const req = { headers } as unknown as Request;

  try {
    validate_api_key(req, res as Response, () => {
      next_called = true;
    });
  } finally {
    if (mock_env_token !== undefined) {
      (env as any).VERIFY_TOKEN = original_env_token;
    }
  }

  return { next_called, status_code, response_body };
}

function run_middleware_tests(): void {
  const current_env_token = env.VERIFY_TOKEN || 'token_padrao_teste';

  const result_x_api_key = test_middleware_request({ 'x-api-key': current_env_token }, current_env_token);
  test_results.push({
    name: 'validate_api_key: requisicao com x-api-key valida prossegue',
    passed: result_x_api_key.next_called === true && result_x_api_key.status_code === null,
  });

  const result_bearer = test_middleware_request({ authorization: `Bearer ${current_env_token}` }, current_env_token);
  test_results.push({
    name: 'validate_api_key: requisicao com Bearer token valido prossegue',
    passed: result_bearer.next_called === true && result_bearer.status_code === null,
  });

  const result_verify_token = test_middleware_request({ 'x-verify-token': current_env_token }, current_env_token);
  test_results.push({
    name: 'validate_api_key: requisicao com x-verify-token valido prossegue',
    passed: result_verify_token.next_called === true && result_verify_token.status_code === null,
  });

  const result_missing = test_middleware_request({}, current_env_token);
  test_results.push({
    name: 'validate_api_key: requisicao sem cabecalho de autenticacao retorna 401',
    passed: result_missing.next_called === false &&
      result_missing.status_code === 401 &&
      result_missing.response_body?.error === 'unauthorized',
  });

  const result_invalid = test_middleware_request({ 'x-api-key': 'chave_completamente_incorreta' }, current_env_token);
  test_results.push({
    name: 'validate_api_key: requisicao com token invalido retorna 401',
    passed: result_invalid.next_called === false &&
      result_invalid.status_code === 401 &&
      result_invalid.response_body?.error === 'unauthorized',
  });

  const result_sqli_token = test_middleware_request({ 'x-api-key': "' OR '1'='1" }, current_env_token);
  test_results.push({
    name: 'validate_api_key: token com tentativa de sql injection retorna 401 sem vazar detalhes',
    passed: result_sqli_token.next_called === false && result_sqli_token.status_code === 401,
  });

  const result_null_byte_token = test_middleware_request({ 'x-api-key': `${current_env_token}\0admin` }, current_env_token);
  test_results.push({
    name: 'validate_api_key: token com byte nulo retorna 401',
    passed: result_null_byte_token.next_called === false && result_null_byte_token.status_code === 401,
  });

  const result_misconfig = test_middleware_request({ 'x-api-key': 'qualquer_chave' }, '');
  test_results.push({
    name: 'validate_api_key: servidor sem VERIFY_TOKEN configurado retorna 500 server_misconfiguration',
    passed: result_misconfig.next_called === false &&
      result_misconfig.status_code === 500 &&
      result_misconfig.response_body?.error === 'server_misconfiguration',
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
