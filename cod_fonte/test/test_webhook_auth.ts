import http from 'http';
import express, { Request, Response } from 'express';
import { AddressInfo } from 'net';
import { capture_raw_body, compute_webhook_signature, create_webhook_auth } from '../security/webhook_auth';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

const secret_de_teste = 'segredo_de_teste_com_mais_de_16_chars';
const agora_ms = 1_800_000_000_000;
const agora_s = Math.floor(agora_ms / 1000);

function signed_headers(body: string, timestamp: number, secret: string = secret_de_teste): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-chatwoot-timestamp': String(timestamp),
    'x-chatwoot-signature': compute_webhook_signature(secret, String(timestamp), Buffer.from(body, 'utf-8')),
  };
}

async function run_tests(): Promise<void> {
  const app = express();
  app.use(express.json({ verify: capture_raw_body }));

  const handler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'received' });
  };
  app.use('/webhook', create_webhook_auth(secret_de_teste, 300, () => agora_ms), handler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const body = JSON.stringify({ event: 'message_created', content: 'olá, preço?', conversation: { id: 7 } });

  const valid = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: signed_headers(body, agora_s),
    body,
  });
  test_results.push({
    name: 'webhook_auth: POST com assinatura HMAC valida (corpo com caracteres nao ASCII) e aceito',
    passed: valid.status === 200,
    details: `status: ${valid.status}`,
  });

  const no_headers = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  test_results.push({
    name: 'webhook_auth: POST sem cabecalhos de assinatura recebe 401',
    passed: no_headers.status === 401,
  });

  const wrong_secret = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: signed_headers(body, agora_s, 'outro_segredo_totalmente_diferente'),
    body,
  });
  test_results.push({
    name: 'webhook_auth: assinatura gerada com segredo errado recebe 401',
    passed: wrong_secret.status === 401,
  });

  const tampered = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: signed_headers(body, agora_s),
    body: body.replace('7', '8'),
  });
  test_results.push({
    name: 'webhook_auth: corpo alterado apos a assinatura recebe 401',
    passed: tampered.status === 401,
  });

  const expired = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: signed_headers(body, agora_s - 301),
    body,
  });
  test_results.push({
    name: 'webhook_auth: timestamp fora da janela de 300s recebe 401 mesmo com assinatura coerente',
    passed: expired.status === 401,
  });

  const edge = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: signed_headers(body, agora_s - 300),
    body,
  });
  test_results.push({
    name: 'webhook_auth: timestamp exatamente no limite de 300s ainda e aceito',
    passed: edge.status === 200,
  });

  const invalid_timestamp = await fetch(`${base_url}/webhook/chatwoot`, {
    method: 'POST',
    headers: { ...signed_headers(body, agora_s), 'x-chatwoot-timestamp': 'abc' },
    body,
  });
  test_results.push({
    name: 'webhook_auth: timestamp nao numerico recebe 401',
    passed: invalid_timestamp.status === 401,
  });

  const get_no_signature = await fetch(`${base_url}/webhook`);
  test_results.push({
    name: 'webhook_auth: GET sem assinatura tambem recebe 401',
    passed: get_no_signature.status === 401,
  });

  const get_signed = await fetch(`${base_url}/webhook`, {
    headers: {
      'x-chatwoot-timestamp': String(agora_s),
      'x-chatwoot-signature': compute_webhook_signature(secret_de_teste, String(agora_s), Buffer.alloc(0)),
    },
  });
  test_results.push({
    name: 'webhook_auth: GET com assinatura valida sobre corpo vazio e aceito',
    passed: get_signed.status === 200,
  });

  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

run_tests()
  .then(() => {
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
      console.error(`Total de falhas no teste de autenticacao do webhook: ${failed_count}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Todos os ${test_results.length} testes de autenticacao do webhook passaram com exito.`);
  })
  .catch((error: unknown) => {
    console.error('Falha inesperada no teste de autenticacao do webhook:', error);
    process.exitCode = 1;
  });
