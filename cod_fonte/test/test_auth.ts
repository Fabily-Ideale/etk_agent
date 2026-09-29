import { Request } from 'express';
import { safe_compare_tokens, extract_token_from_request } from '../security/auth';

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

run_token_comparison_tests();
run_token_extraction_tests();

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
