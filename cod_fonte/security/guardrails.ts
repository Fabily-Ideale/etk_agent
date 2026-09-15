export interface guardrail_validation_result {
  is_valid: boolean;
  reason_code?: string;
  sanitized_text: string;
}

const max_message_length = 600;

const zero_width_regex = /[\u200B-\u200D\uFEFF\u00AD\u2060]/g;
const excessive_spaces_regex = /\s+/g;
const char_flood_regex = /(.)\1{14,}/;

const delimiter_injection_patterns = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[system\]/i,
  /\[\/system\]/i,
  /\[inst\]/i,
  /\[\/inst\]/i,
  /###\s*(instruction|system|human|assistant)/i,
  /<\/?(?:mensagem_cliente|system|context|instruction|prompt)>/i,
  /<script\b/i,
  /<iframe\b/i,
  /javascript:/i,
];

const jailbreak_patterns = [
  /\b(ignore|desconsidere|esqueca)\s+(?:[a-z_]+\s+){0,3}(instrucoes|diretrizes|regras|comandos|orientacoes)/i,
  /\b(ignore|forget|bypass)\s+(?:[a-z_]+\s+){0,3}(instructions|directions|rules|commands|constraints)/i,
  /\besqueca\s+(?:[a-z_]+\s+){0,3}quem voce e/i,
  /\b(modo\s+dan|dan\s+mode|developer\s+mode|modo\s+desenvolvedor)\b/i,
  /\b(sem\s+restricoes|unrestricted\s+mode|jailbreak|bypass\s+rules)\b/i,
  /\b(voce\s+agora\s+e|you\s+are\s+now|a\s+partir\s+de\s+agora\s+voce\s+e)\b/i,
  /\b(finja\s+que\s+nao\s+ha\s+regras|pretend\s+you\s+have\s+no\s+rules)\b/i,
  /\b(aja\s+como\s+uma\s+ia\s+sem\s+filtros|act\s+as\s+an\s+unfiltered\s+ai)\b/i,
  /\b(decodifique\s+em\s+base64|decode\s+base64|hex\s+decode)\b/i,
];

const staff_impersonation_patterns = [
  /\bsou\s+(?:o\s+|a\s+|um\s+|uma\s+)?(?:novo\s+|atual\s+)?(administrador|administradora|adm|gerente|diretor|diretora|dono|dona|tecnico|tecnica|funcionario|funcionaria|colaborador|colaboradora|desenvolvedor|desenvolvedora|dev|supervisor|supervisora|suporte)\b/i,
  /\baqui\s+e\s+(?:o\s+|a\s+)?(?:o\s+|a\s+)?(administrador|administradora|adm|gerente|diretor|diretora|dono|dona|tecnico|tecnica|funcionario|funcionaria|colaborador|colaboradora|desenvolvedor|dev|equipe\s+de\s+ti|suporte\s+interno)\b/i,
  /\b(ordem|solicitacao|autorizacao)\s+(do|da)\s+(gerente|diretor|diretoria|dono|administracao|adm)\b/i,
  /\bcomando\s+(root|sudo|admin|administrador|de\s+manutencao|do\s+sistema)\b/i,
  /\bsudo\s+[a-z_]+/i,
  /\bmodo\s+(admin|administrador|manutencao|interno|colaborador|funcionario)\b/i,
  /\b(libere|forneca|passe)\s+(?:[a-z_]+\s+){0,2}(acesso\s+root|privilegios|painel\s+de\s+controle|senha|credenciais|token)\b/i,
  /\b(trabalho\s+na\s+isso-tek|sou\s+da\s+equipe\s+interna|sou\s+funcionario\s+da\s+isso-tek|sou\s+colega\s+de\s+trabalho)\b/i,
  /\b(suporte\s+da\s+meta|suporte\s+tecnico\s+do\s+whatsapp|equipe\s+do\s+whatsapp)\b/i,
];

const prompt_leaking_patterns = [
  /\b(repita|mostre|qual\s+e|revele|exiba|imprima)\s+(?:[a-z_]+\s+){0,3}(prompt|instrucoes|system\s+prompt|texto\s+inicial|diretrizes|regras\s+internas)/i,
  /\b(print|output|display)\s+(?:[a-z_]+\s+){0,3}(system\s+prompt|instructions|initial\s+prompt)\b/i,
];

export function normalize_text(raw_text: string): string {
  return raw_text
    .normalize('NFKC')
    .replace(zero_width_regex, '')
    .replace(excessive_spaces_regex, ' ')
    .trim();
}

function strip_diacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function validate_security_guardrails(raw_text: string): guardrail_validation_result {
  if (!raw_text || typeof raw_text !== 'string') {
    return {
      is_valid: false,
      reason_code: 'empty_input',
      sanitized_text: '',
    };
  }

  const sanitized_text = normalize_text(raw_text);

  if (sanitized_text.length === 0) {
    return {
      is_valid: false,
      reason_code: 'empty_input',
      sanitized_text: '',
    };
  }

  if (sanitized_text.length > max_message_length) {
    return {
      is_valid: false,
      reason_code: 'payload_too_large',
      sanitized_text,
    };
  }

  if (char_flood_regex.test(sanitized_text)) {
    return {
      is_valid: false,
      reason_code: 'character_flood',
      sanitized_text,
    };
  }

  for (const pattern of delimiter_injection_patterns) {
    if (pattern.test(sanitized_text)) {
      return {
        is_valid: false,
        reason_code: 'delimiter_injection',
        sanitized_text,
      };
    }
  }

  const searchable_text = strip_diacritics(sanitized_text);

  for (const pattern of jailbreak_patterns) {
    if (pattern.test(searchable_text)) {
      return {
        is_valid: false,
        reason_code: 'jailbreak_attempt',
        sanitized_text,
      };
    }
  }

  for (const pattern of staff_impersonation_patterns) {
    if (pattern.test(searchable_text)) {
      return {
        is_valid: false,
        reason_code: 'staff_impersonation',
        sanitized_text,
      };
    }
  }

  for (const pattern of prompt_leaking_patterns) {
    if (pattern.test(searchable_text)) {
      return {
        is_valid: false,
        reason_code: 'prompt_leak_attempt',
        sanitized_text,
      };
    }
  }

  return {
    is_valid: true,
    sanitized_text,
  };
}
