import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import { memory_rate_limiter } from '../security/rate_limiter';
import { create_servicos_publicos_router } from '../publico/servicos_publicos';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

interface running_server {
  base_url: string;
  close: () => Promise<void>;
}

const test_results: test_case_result[] = [];

const csv_header = 'nome,descricao,preco_inicial,preco_final,mensalidade,categoria';
const csv_linhas_validas = [
  'Site Basico,"Pagina, institucional",PRECO_INI_111,PRECO_FIM_222,MENSAL_333,Web',
  'Linha malformada,so,cinco,campos,aqui',
  'Chatbot,Atendimento automatizado,PRECO_INI_444,PRECO_FIM_555,MENSAL_666,IA',
];

function start_server(router: express.Router): Promise<running_server> {
  const app = express();
  app.use('/publico', router);

  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base_url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

async function run_content_tests(csv_path: string): Promise<void> {
  const limiter = new memory_rate_limiter();
  const server = await start_server(create_servicos_publicos_router({
    csv_path,
    max_requests: 1000,
    window_ms: 60000,
    limiter,
  }));

  const response = await fetch(`${server.base_url}/publico/servicos.json`);
  const raw_text = await response.text();
  const parsed = JSON.parse(raw_text) as Record<string, string>[];

  test_results.push({
    name: 'servicos_publicos: responde 200 com Content-Type JSON e Cache-Control publico de 300s',
    passed: response.status === 200
      && (response.headers.get('content-type') ?? '').includes('application/json')
      && response.headers.get('cache-control') === 'public, max-age=300',
  });

  test_results.push({
    name: 'servicos_publicos: linhas com menos de 6 campos sao ignoradas',
    passed: parsed.length === 2 && !raw_text.includes('Linha malformada'),
    details: `itens retornados: ${parsed.length}`,
  });

  const keys_ok = parsed.every((item) => Object.keys(item).sort().join(',') === 'categoria,descricao,nome');
  test_results.push({
    name: 'servicos_publicos: cada item contem somente nome, descricao e categoria',
    passed: parsed.length > 0 && keys_ok,
  });

  test_results.push({
    name: 'servicos_publicos: nenhum valor de preco_inicial, preco_final ou mensalidade aparece no corpo',
    passed: !raw_text.includes('PRECO_') && !raw_text.includes('MENSAL_'),
  });

  test_results.push({
    name: 'servicos_publicos: virgula dentro de campo com aspas preservada na descricao',
    passed: parsed[0]?.descricao === 'Pagina, institucional',
  });

  await server.close();
  limiter.destroy();
}

async function run_missing_file_tests(missing_path: string, header_only_path: string): Promise<void> {
  const limiter = new memory_rate_limiter();
  const server = await start_server(create_servicos_publicos_router({
    csv_path: missing_path,
    max_requests: 1000,
    window_ms: 60000,
    limiter,
  }));

  const missing_response = await fetch(`${server.base_url}/publico/servicos.json`);
  const missing_body = await missing_response.json();
  test_results.push({
    name: 'servicos_publicos: CSV ausente retorna 200 com lista vazia',
    passed: missing_response.status === 200 && Array.isArray(missing_body) && missing_body.length === 0,
  });

  await server.close();

  const header_only_server = await start_server(create_servicos_publicos_router({
    csv_path: header_only_path,
    max_requests: 1000,
    window_ms: 60000,
    limiter,
  }));
  const header_only_body = await (await fetch(`${header_only_server.base_url}/publico/servicos.json`)).json();
  test_results.push({
    name: 'servicos_publicos: CSV somente com cabecalho retorna lista vazia',
    passed: Array.isArray(header_only_body) && header_only_body.length === 0,
  });

  await header_only_server.close();
  limiter.destroy();
}

async function run_freshness_tests(csv_path: string): Promise<void> {
  const limiter = new memory_rate_limiter();
  const server = await start_server(create_servicos_publicos_router({
    csv_path,
    max_requests: 1000,
    window_ms: 60000,
    limiter,
  }));

  const before = await (await fetch(`${server.base_url}/publico/servicos.json`)).json() as unknown[];

  const novo_conteudo = [csv_header, ...csv_linhas_validas, 'Consultoria,Analise de processos,PRECO_INI_777,PRECO_FIM_888,MENSAL_999,Servicos'].join('\n');
  fs.writeFileSync(csv_path, novo_conteudo, 'utf-8');
  const future_time = new Date(Date.now() + 10000);
  fs.utimesSync(csv_path, future_time, future_time);

  const after = await (await fetch(`${server.base_url}/publico/servicos.json`)).json() as unknown[];

  test_results.push({
    name: 'servicos_publicos: alteracao do mtime do CSV renova o conteudo sem reinicio',
    passed: before.length === 2 && after.length === 3,
    details: `antes: ${before.length}, depois: ${after.length}`,
  });

  await server.close();
  limiter.destroy();
}

async function run_rate_limit_tests(csv_path: string): Promise<void> {
  const limiter = new memory_rate_limiter();
  const server = await start_server(create_servicos_publicos_router({
    csv_path,
    max_requests: 2,
    window_ms: 60000,
    limiter,
  }));

  const first = await fetch(`${server.base_url}/publico/servicos.json`);
  const second = await fetch(`${server.base_url}/publico/servicos.json`);
  const third = await fetch(`${server.base_url}/publico/servicos.json`);

  test_results.push({
    name: 'servicos_publicos: rate limit libera ate o teto e responde 429 com Retry-After na excedente',
    passed: first.status === 200 && second.status === 200 && third.status === 429 && Boolean(third.headers.get('retry-after')),
    details: `status: ${first.status}, ${second.status}, ${third.status}`,
  });

  await server.close();
  limiter.destroy();
}

async function main(): Promise<void> {
  const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servicos_publicos_'));
  const content_csv = path.join(temp_dir, 'conteudo.csv');
  const freshness_csv = path.join(temp_dir, 'frescor.csv');
  const rate_limit_csv = path.join(temp_dir, 'limite.csv');
  const header_only_csv = path.join(temp_dir, 'cabecalho.csv');
  const missing_csv = path.join(temp_dir, 'inexistente.csv');

  const conteudo_valido = [csv_header, ...csv_linhas_validas].join('\n');
  fs.writeFileSync(content_csv, conteudo_valido, 'utf-8');
  fs.writeFileSync(freshness_csv, conteudo_valido, 'utf-8');
  fs.writeFileSync(rate_limit_csv, conteudo_valido, 'utf-8');
  fs.writeFileSync(header_only_csv, csv_header, 'utf-8');

  try {
    await run_content_tests(content_csv);
    await run_missing_file_tests(missing_csv, header_only_csv);
    await run_freshness_tests(freshness_csv);
    await run_rate_limit_tests(rate_limit_csv);
  } finally {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  }

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
    console.error(`Total de falhas no teste de servicos publicos: ${failed_count}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Todos os ${test_results.length} testes de servicos publicos passaram com exito.`);
}

main().catch((error: unknown) => {
  console.error('Falha inesperada no teste de servicos publicos:', error);
  process.exitCode = 1;
});
