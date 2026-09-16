import fs from 'fs';
import path from 'path';
import {
  rotating_file_logger,
  log_standard_event,
  log_error_event,
  log_guardrail_violation_event,
  standard_log_payload,
  error_log_payload,
  guardrail_log_payload,
} from '../logging/logger';

interface test_case_result {
  name: string;
  passed: boolean;
  error_message?: string;
}

const results: test_case_result[] = [];
const test_dir = path.join(__dirname, '../../test_logs_tmp');

function clean_test_dir(): void {
  if (fs.existsSync(test_dir)) {
    fs.rmSync(test_dir, { recursive: true, force: true });
  }
}

function assert_test(name: string, assertion: boolean, error_message?: string): void {
  if (assertion) {
    results.push({ name, passed: true });
    console.log(`SUCESSO: [${name}]`);
  } else {
    results.push({ name, passed: false, error_message: error_message || 'Assercao falhou' });
    console.error(`FALHA: [${name}] -> ${error_message || 'Assercao falhou'}`);
  }
}

function run_all_tests(): void {
  clean_test_dir();

  const custom_logger = new rotating_file_logger(test_dir, 3, 1);

  custom_logger.log_standard('5511999990001', 'request_received');
  custom_logger.log_standard('5511999990001', 'response_sent', { duration_ms: 120, status: 'success' });

  const standard_file = path.join(test_dir, 'standard.log');
  const error_file = path.join(test_dir, 'error.log');
  const guardrails_file = path.join(test_dir, 'guardrails.log');

  assert_test('standard.log foi criado apos evento padrao', fs.existsSync(standard_file));
  assert_test('error.log nao foi criado apos apenas eventos padrao', !fs.existsSync(error_file));
  assert_test('guardrails.log nao foi criado apos apenas eventos padrao', !fs.existsSync(guardrails_file));

  const standard_raw = fs.readFileSync(standard_file, 'utf8');
  const standard_lines = standard_raw.trim().split('\n');

  assert_test('standard.log possui 2 linhas registradas', standard_lines.length === 2);

  const parsed_standard_1: standard_log_payload = JSON.parse(standard_lines[0]);
  const parsed_standard_2: standard_log_payload = JSON.parse(standard_lines[1]);

  assert_test(
    'Timestamp ISO presente nos eventos standard',
    Boolean(parsed_standard_1.timestamp && !Number.isNaN(Date.parse(parsed_standard_1.timestamp)))
  );
  assert_test(
    'Omissao do conteudo textual da mensagem no log padrao',
    (parsed_standard_1 as any).text === undefined && (parsed_standard_1 as any).message === undefined
  );
  assert_test('Evento de envio de resposta contem duracao em ms', parsed_standard_2.duration_ms === 120);
  assert_test('Usuario registrado corretamente no standard log', parsed_standard_1.user === '5511999990001');

  custom_logger.log_error('DATABASE_CONNECTION_ERROR', 'Conexao recusada na porta 5432', 'Error: Conexao recusada', { attempt: 1 });

  assert_test('error.log criado apos log_error', fs.existsSync(error_file));

  const error_raw = fs.readFileSync(error_file, 'utf8');
  const error_lines = error_raw.trim().split('\n');
  assert_test('error.log contem 1 linha', error_lines.length === 1);

  const parsed_error: error_log_payload = JSON.parse(error_lines[0]);
  assert_test('error.log contem timestamp ISO', Boolean(parsed_error.timestamp && !Number.isNaN(Date.parse(parsed_error.timestamp))));
  assert_test('error.log contem error_code e message', parsed_error.error_code === 'DATABASE_CONNECTION_ERROR' && parsed_error.message === 'Conexao recusada na porta 5432');
  assert_test('error.log contem stack trace', parsed_error.stack === 'Error: Conexao recusada');

  custom_logger.log_guardrail_violation('5511999990002', 'jailbreak_attempt', 'blocked', 'ignore instructions');

  assert_test('guardrails.log criado apos infracao de seguranca', fs.existsSync(guardrails_file));

  const guardrails_raw = fs.readFileSync(guardrails_file, 'utf8');
  const guardrails_lines = guardrails_raw.trim().split('\n');
  assert_test('guardrails.log contem 1 linha', guardrails_lines.length === 1);

  const parsed_guardrail: guardrail_log_payload = JSON.parse(guardrails_lines[0]);
  assert_test('guardrails.log contem timestamp ISO', Boolean(parsed_guardrail.timestamp && !Number.isNaN(Date.parse(parsed_guardrail.timestamp))));
  assert_test('guardrails.log contem usuario infrator e reason_code', parsed_guardrail.user === '5511999990002' && parsed_guardrail.reason_code === 'jailbreak_attempt');
  assert_test('guardrails.log contem acao aplicada', parsed_guardrail.action === 'blocked');

  custom_logger.log_standard('5511999990003', 'request_received');
  custom_logger.log_standard('5511999990003', 'response_sent');

  const rotated_standard_file = path.join(test_dir, 'standard.log.1');
  assert_test('Rotacao de arquivo standard.log gerou standard.log.1', fs.existsSync(rotated_standard_file));

  const rotated_content = fs.readFileSync(rotated_standard_file, 'utf8');
  const rotated_lines = rotated_content.trim().split('\n');
  assert_test('standard.log.1 possui 3 linhas historicas', rotated_lines.length === 3);

  const current_content = fs.readFileSync(standard_file, 'utf8');
  const current_lines = current_content.trim().split('\n');
  assert_test('standard.log atual contem 1 linha apos rotacao', current_lines.length === 1);

  const default_standard = log_standard_event('5511000000000', 'request_received');
  assert_test('Helper global log_standard_event gera payload compativel', default_standard.user === '5511000000000' && default_standard.event === 'request_received');

  const default_error = log_error_event('SYSTEM_TEST_ERR', 'Teste de erro global');
  assert_test('Helper global log_error_event gera payload compativel', default_error.error_code === 'SYSTEM_TEST_ERR');

  const default_guardrail = log_guardrail_violation_event('5511000000000', 'prompt_leak_attempt');
  assert_test('Helper global log_guardrail_violation_event gera payload compativel', default_guardrail.reason_code === 'prompt_leak_attempt');

  clean_test_dir();

  const failed_count = results.filter((r) => !r.passed).length;
  console.log('\n================ RESUMO DA SUITE DE LOGS ================');
  console.log(`Total de testes executados: ${results.length}`);
  console.log(`Testes aprovados: ${results.length - failed_count}`);
  console.log(`Testes reprovados: ${failed_count}`);
  console.log('==========================================================');

  if (failed_count > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run_all_tests();
