import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export interface service_item {
  nome: string;
  descricao: string;
  preco_inicial: string;
  preco_final: string;
  mensalidade: string;
  categoria: string;
}

let cached_services: service_item[] | null = null;

function parse_csv_line(line: string): string[] {
  const fields: string[] = [];
  let current_field = '';
  let in_quotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next_char = line[i + 1];

    if (char === '"') {
      if (in_quotes && next_char === '"') {
        current_field += '"';
        i++;
      } else {
        in_quotes = !in_quotes;
      }
    } else if (char === ',' && !in_quotes) {
      fields.push(current_field.trim());
      current_field = '';
    } else {
      current_field += char;
    }
  }
  fields.push(current_field.trim());
  return fields;
}

function load_services(): service_item[] {
  if (cached_services) {
    return cached_services;
  }

  const csv_path = path.join(__dirname, '..', 'doc_bruto', 'precos.csv');
  if (!fs.existsSync(csv_path)) {
    return [];
  }

  const raw_content = fs.readFileSync(csv_path, 'utf-8');
  const lines = raw_content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length <= 1) {
    return [];
  }

  const services: service_item[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parse_csv_line(lines[i]);
    if (row.length >= 6) {
      services.push({
        nome: row[0],
        descricao: row[1],
        preco_inicial: row[2],
        preco_final: row[3],
        mensalidade: row[4],
        categoria: row[5],
      });
    }
  }

  cached_services = services;
  return cached_services;
}

function normalize_text(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function format_service_output(service: service_item): string {
  const price_parts: string[] = [];
  if (service.preco_inicial) {
    price_parts.push(`A partir de: ${service.preco_inicial}`);
  }
  if (service.preco_final) {
    price_parts.push(`Ate: ${service.preco_final}`);
  }
  if (service.mensalidade) {
    price_parts.push(`Mensalidade: ${service.mensalidade}`);
  }

  const price_str = price_parts.length > 0 ? price_parts.join(' | ') : 'Sob consulta';

  return `*${service.nome}* (${service.categoria})\n- Descricao: ${service.descricao}\n- Valores: ${price_str}`;
}

export const services_tool = tool(
  async ({ termo, categoria, obter_todos }) => {
    const all_services = load_services();

    if (all_services.length === 0) {
      return 'Nenhum servico cadastrado no catalogo.';
    }

    if (obter_todos && !categoria) {
      const categories = Array.from(new Set(all_services.map(item => item.categoria)));
      return `O catalogo possui varias categorias. Para uma consulta objetiva, selecione uma destas categorias:\n${categories.map(c => `- ${c}`).join('\n')}`;
    }

    let filtered = all_services;

    if (categoria) {
      const normalized_category = normalize_text(categoria);
      filtered = filtered.filter(item =>
        normalize_text(item.categoria).includes(normalized_category)
      );
    }

    if (obter_todos && categoria) {
      if (filtered.length === 0) {
        return `Nenhum servico encontrado para a categoria "${categoria}".`;
      }
      return filtered.map(format_service_output).join('\n\n');
    }

    if (termo) {
      const normalized_term = normalize_text(termo);
      const keywords = normalized_term.split(/\s+/).filter(k => k.length > 2);

      const direct_matches = filtered.filter(item => {
        const item_name = normalize_text(item.nome);
        const item_desc = normalize_text(item.descricao);
        return item_name.includes(normalized_term) || item_desc.includes(normalized_term);
      });

      if (direct_matches.length > 0) {
        return direct_matches.map(format_service_output).join('\n\n');
      }

      const keyword_matches = filtered.filter(item => {
        const item_name = normalize_text(item.nome);
        const item_desc = normalize_text(item.descricao);
        return keywords.some(k => item_name.includes(k) || item_desc.includes(k));
      });

      if (keyword_matches.length > 0) {
        return keyword_matches.map(format_service_output).join('\n\n');
      }

      return `Nenhum servico especifico encontrado para o termo "${termo}".`;
    }

    if (filtered.length > 0) {
      return filtered.map(format_service_output).join('\n\n');
    }

    return 'Nenhum servico encontrado para os criterios informados.';
  },
  {
    name: 'consultar_servicos',
    description:
      'Consulta servicos, precos, valores e descricoes no catalogo oficial da Это-Тек. Se o usuario pedir o catalogo completo ou todos os precos, use obter_todos=true e defina a categoria desejada.',
    schema: z.object({
      termo: z
        .string()
        .optional()
        .describe('Termo de busca ou servico procurado (ex: diagnostico, formatacao, site, rede)'),
      categoria: z
        .string()
        .optional()
        .describe('Categoria do servico (ex: Empresa de Software, Loja de Informática, Serviço de Redes de Computadores, Serviço de Segurança de Computadores, Suporte e Serviços para Computadores)'),
      obter_todos: z
        .boolean()
        .optional()
        .describe('Defina como true para listar os servicos de uma categoria especifica'),
    }),
  }
);
