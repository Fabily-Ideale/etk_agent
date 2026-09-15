import { Request, Response } from 'express';
import {
  memory_rate_limiter,
  extract_client_ip,
  create_ip_rate_limiter,
  create_phone_rate_limiter,
} from '../security/rate_limiter';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

function run_limiter_unit_tests(): void {
  const limiter = new memory_rate_limiter();

  const first_req = limiter.consume('user_1', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: primeira requisicao permitida com saldo correto',
    passed: first_req.allowed === true && first_req.remaining === 2,
  });

  const second_req = limiter.consume('user_1', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: segunda requisicao permitida',
    passed: second_req.allowed === true && second_req.remaining === 1,
  });

  const third_req = limiter.consume('user_1', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: terceira requisicao no teto maximo permitida',
    passed: third_req.allowed === true && third_req.remaining === 0,
  });

  const fourth_req = limiter.consume('user_1', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: quarta requisicao bloqueada com retry_after',
    passed: fourth_req.allowed === false && fourth_req.retry_after_seconds > 0,
  });

  const diff_user_req = limiter.consume('user_2', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: usuario diferente possui cota isolada',
    passed: diff_user_req.allowed === true && diff_user_req.remaining === 2,
  });

  limiter.reset('user_1');
  const after_reset_req = limiter.consume('user_1', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: reset por chave reinicia contagem com sucesso',
    passed: after_reset_req.allowed === true && after_reset_req.remaining === 2,
  });

  limiter.reset();
  const after_full_reset_req = limiter.consume('user_2', 3, 5000);
  test_results.push({
    name: 'memory_rate_limiter: reset global limpa todos os registros',
    passed: after_full_reset_req.allowed === true && after_full_reset_req.remaining === 2,
  });

  const invalid_params_req = limiter.consume('user_edge', 0, -100);
  test_results.push({
    name: 'memory_rate_limiter: parametros invalidos (max=0, window=-100) tratados de forma segura',
    passed: invalid_params_req.allowed === true && invalid_params_req.total_limit === 1,
  });

  limiter.destroy();
}

function run_ip_extraction_tests(): void {
  const req_single_ip = {
    headers: { 'x-forwarded-for': '203.0.113.195' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: extrai IP simples de x-forwarded-for',
    passed: extract_client_ip(req_single_ip) === '203.0.113.195',
  });

  const req_multi_ip = {
    headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: extrai primeiro IP da cadeia de proxies em x-forwarded-for',
    passed: extract_client_ip(req_multi_ip) === '203.0.113.195',
  });

  const req_array_ip = {
    headers: { 'x-forwarded-for': ['198.51.100.22', '10.0.0.1'] },
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: extrai IP quando x-forwarded-for e array de strings',
    passed: extract_client_ip(req_array_ip) === '198.51.100.22',
  });

  const req_ipv6 = {
    headers: { 'x-forwarded-for': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: suporta formato IPv6 em x-forwarded-for',
    passed: extract_client_ip(req_ipv6) === '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
  });

  const req_express_ip = {
    headers: {},
    ip: '192.168.1.50',
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: fallback para req.ip na ausencia de proxy headers',
    passed: extract_client_ip(req_express_ip) === '192.168.1.50',
  });

  const req_socket_ip = {
    headers: {},
    socket: { remoteAddress: '10.0.1.99' },
  } as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: fallback para socket.remoteAddress na ausencia de req.ip',
    passed: extract_client_ip(req_socket_ip) === '10.0.1.99',
  });

  const req_empty = {} as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: retorna unknown_ip para requisicao sem dados de rede sem crash',
    passed: extract_client_ip(req_empty) === 'unknown_ip',
  });

  const req_null = null as unknown as Request;
  test_results.push({
    name: 'extract_client_ip: retorna unknown_ip para requisicao nula',
    passed: extract_client_ip(req_null) === 'unknown_ip',
  });
}

function run_ip_middleware_tests(): void {
  const custom_limiter = new memory_rate_limiter();
  const middleware = create_ip_rate_limiter(2, 5000, custom_limiter);

  let next_count = 0;
  let response_code: number | null = null;
  const headers: Record<string, string> = {};

  const create_mock_response = () => {
    const res: Partial<Response> = {
      setHeader: (key: string, value: string | number) => {
        headers[key.toLowerCase()] = String(value);
        return res as Response;
      },
      status: (code: number) => {
        response_code = code;
        return res as Response;
      },
      json: () => res as Response,
    };
    return res as Response;
  };

  const req_ip1 = {
    headers: { 'x-forwarded-for': '192.168.1.100' },
  } as unknown as Request;

  middleware(req_ip1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'ip_rate_limiter: primeira chamada do IP passa',
    passed: next_count === 1 && headers['x-ratelimit-remaining'] === '1',
  });

  middleware(req_ip1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'ip_rate_limiter: segunda chamada do IP passa no limite',
    passed: next_count === 2 && headers['x-ratelimit-remaining'] === '0',
  });

  response_code = null;
  middleware(req_ip1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'ip_rate_limiter: terceira chamada do IP recebe 429',
    passed: next_count === 2 && response_code === 429 && Boolean(headers['retry-after']),
  });

  const req_ip2 = {
    headers: { 'x-forwarded-for': '192.168.1.200' },
  } as unknown as Request;
  response_code = null;
  middleware(req_ip2, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'ip_rate_limiter: IP distinto nao sofre bloqueio',
    passed: next_count === 3 && response_code === null,
  });

  custom_limiter.destroy();
}

function run_phone_middleware_tests(): void {
  const custom_limiter = new memory_rate_limiter();
  const middleware = create_phone_rate_limiter(2, 5000, custom_limiter);

  let next_count = 0;
  let response_code: number | null = null;
  const headers: Record<string, string> = {};

  const create_mock_response = () => {
    const res: Partial<Response> = {
      setHeader: (key: string, value: string | number) => {
        headers[key.toLowerCase()] = String(value);
        return res as Response;
      },
      status: (code: number) => {
        response_code = code;
        return res as Response;
      },
      json: () => res as Response,
    };
    return res as Response;
  };

  const req_phone1 = {
    body: { from: '5511999990001' },
    headers: {},
  } as unknown as Request;

  middleware(req_phone1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: primeira mensagem do numero passa',
    passed: next_count === 1,
  });

  middleware(req_phone1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: segunda mensagem do numero passa',
    passed: next_count === 2,
  });

  response_code = null;
  middleware(req_phone1, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: terceira mensagem do mesmo numero recebe 429',
    passed: next_count === 2 && response_code === 429 && Boolean(headers['retry-after']),
  });

  const req_phone1_formatted = {
    body: { from: '+55 (11) 99999-0001' },
    headers: {},
  } as unknown as Request;
  response_code = null;
  middleware(req_phone1_formatted, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: numero com mascara normalizado compartilha saldo e continua em 429',
    passed: next_count === 2 && response_code === 429,
  });

  const req_phone_numeric = {
    body: { from: 5511999990002 },
    headers: {},
  } as unknown as Request;
  response_code = null;
  middleware(req_phone_numeric, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: numero fornecido como tipo numerico no body e processado e passa',
    passed: next_count === 3 && response_code === null,
  });

  const req_phone_header = {
    body: {},
    headers: { 'x-phone-number': '5511999990003' },
  } as unknown as Request;
  response_code = null;
  middleware(req_phone_header, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: telefone fornecido via cabecalho x-phone-number e processado',
    passed: next_count === 4 && response_code === null,
  });

  const req_no_phone = {
    body: {},
    headers: {},
  } as unknown as Request;
  middleware(req_no_phone, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: corpo sem numero prossegue sem bloquear',
    passed: next_count === 5,
  });

  const req_object_phone = {
    body: { from: { attack: true } },
    headers: {},
  } as unknown as Request;
  middleware(req_object_phone, create_mock_response(), () => {
    next_count++;
  });
  test_results.push({
    name: 'phone_rate_limiter: corpo com telefone em formato objeto tratado com seguranca sem crash',
    passed: next_count === 6,
  });

  custom_limiter.destroy();
}

run_limiter_unit_tests();
run_ip_extraction_tests();
run_ip_middleware_tests();
run_phone_middleware_tests();

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
  console.error(`Total de falhas no teste de rate limiter: ${failed_count}`);
  process.exit(1);
} else {
  console.log(`Todos os ${test_results.length} testes de rate limiter passaram com exito.`);
  process.exit(0);
}
