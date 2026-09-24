import { spawnSync } from 'child_process';
import path from 'path';

interface suite_definition {
  name: string;
  file_path: string;
}

interface suite_execution_result {
  name: string;
  success: boolean;
  duration_ms: number;
  stdout: string;
  stderr: string;
}

const suites: suite_definition[] = [
  {
    name: 'Seguranca e Comparacao Segura de Tokens',
    file_path: path.join(__dirname, 'test_auth.ts'),
  },
  {
    name: 'Guardrails de Conteudo e Protecao contra Injecao',
    file_path: path.join(__dirname, 'test_guardrails.ts'),
  },
  {
    name: 'Rate Limiting (IP e Telefone)',
    file_path: path.join(__dirname, 'test_rate_limiter.ts'),
  },
  {
    name: 'Webhook do Chatwoot (Ingestao de Eventos de Mensagem)',
    file_path: path.join(__dirname, 'test_webhook.ts'),
  },
  {
    name: 'API Chat Direta (Validacao de Requisicoes HTTP / Postman)',
    file_path: path.join(__dirname, 'test_api_chat.ts'),
  },
  {
    name: 'Logs e Monitoramento Segregado (Padrao, Erros e Guardrails)',
    file_path: path.join(__dirname, 'test_logging.ts'),
  },
];

function run_single_suite(suite: suite_definition): suite_execution_result {
  const start_time = Date.now();
  const is_windows = process.platform === 'win32';
  const command = is_windows ? 'npx.cmd' : 'npx';

  const execution = spawnSync(command, ['ts-node', suite.file_path], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    shell: is_windows,
  });

  const duration_ms = Date.now() - start_time;
  const success = execution.status === 0;

  return {
    name: suite.name,
    success,
    duration_ms,
    stdout: execution.stdout || '',
    stderr: execution.stderr || '',
  };
}

function main(): void {
  console.log('Iniciando execucao consolidada da suite de testes do etk_agent...\n');

  const results: suite_execution_result[] = [];
  let total_failed = 0;

  for (const suite of suites) {
    console.log(`[EXEC] Executando: ${suite.name}...`);
    const result = run_single_suite(suite);
    results.push(result);

    if (result.success) {
      console.log(`[SUCESSO] ${suite.name} (${result.duration_ms}ms)`);
    } else {
      total_failed++;
      console.error(`[FALHA] ${suite.name} (${result.duration_ms}ms)`);
      if (result.stdout) {
        console.error(result.stdout);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }
    }
  }

  console.log('\n================ RESUMO GERAL DA SUITE DE TESTES ================');
  for (const res of results) {
    const status_label = res.success ? 'APROVADO' : 'REPROVADO';
    console.log(`- [${status_label}] ${res.name} em ${res.duration_ms}ms`);
  }
  console.log(`\nTotal de suites executadas: ${results.length}`);
  console.log(`Suites aprovadas: ${results.length - total_failed}`);
  console.log(`Suites reprovadas: ${total_failed}`);
  console.log('==================================================================');

  if (total_failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
