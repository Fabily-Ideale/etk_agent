import fs from 'fs';
import path from 'path';

const pdf_parse = require('pdf-parse');

export interface converted_document {
  filename_source: string;
  filename_target: string;
  source_path: string;
  target_path: string;
  content: string;
  extension_source: string;
}

export interface document_chunk {
  id: string;
  source_file: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, any>;
}

export interface chunking_options {
  chunk_size?: number;
  chunk_overlap?: number;
}

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

function parse_csv_content(csv_text: string): { headers: string[]; rows: string[][] } {
  const lines = csv_text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parse_csv_line(lines[0]);
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const parsed_row = parse_csv_line(lines[i]);
    if (parsed_row.some(val => val.length > 0)) {
      rows.push(parsed_row);
    }
  }

  return { headers, rows };
}

export async function copy_markdown_file(
  source_path: string,
  target_path: string
): Promise<converted_document> {
  const content = fs.readFileSync(source_path, 'utf-8');
  fs.writeFileSync(target_path, content, 'utf-8');

  return {
    filename_source: path.basename(source_path),
    filename_target: path.basename(target_path),
    source_path,
    target_path,
    content,
    extension_source: '.md',
  };
}

export async function convert_csv_to_markdown(
  source_path: string,
  target_path: string
): Promise<converted_document> {
  const raw_csv = fs.readFileSync(source_path, 'utf-8');
  const { headers, rows } = parse_csv_content(raw_csv);

  let markdown_content = `# Documento: ${path.basename(source_path, '.csv')}\n\n`;

  rows.forEach((row, index) => {
    const title_field = row[0] && row[0].length > 0 ? row[0] : `Registro ${index + 1}`;
    markdown_content += `## ${title_field}\n\n`;

    headers.forEach((header, col_idx) => {
      const value = row[col_idx];
      if (value && value.length > 0) {
        markdown_content += `- **${header}**: ${value}\n`;
      }
    });

    markdown_content += '\n';
  });

  fs.writeFileSync(target_path, markdown_content, 'utf-8');

  return {
    filename_source: path.basename(source_path),
    filename_target: path.basename(target_path),
    source_path,
    target_path,
    content: markdown_content,
    extension_source: '.csv',
  };
}

export async function convert_pdf_to_markdown(
  source_path: string,
  target_path: string
): Promise<converted_document> {
  const data_buffer = fs.readFileSync(source_path);
  const pdf_data = await pdf_parse(data_buffer);

  const clean_text = pdf_data.text.replace(/\r\n/g, '\n').trim();
  const title = path.basename(source_path, '.pdf');
  const markdown_content = `# Documento: ${title}\n\n${clean_text}\n`;

  fs.writeFileSync(target_path, markdown_content, 'utf-8');

  return {
    filename_source: path.basename(source_path),
    filename_target: path.basename(target_path),
    source_path,
    target_path,
    content: markdown_content,
    extension_source: '.pdf',
  };
}

export async function convert_single_document(
  source_path: string,
  target_dir: string
): Promise<converted_document | null> {
  const filename = path.basename(source_path);

  if (filename.startsWith('.')) {
    return null;
  }

  const extension = path.extname(source_path).toLowerCase();

  if (!fs.existsSync(target_dir)) {
    fs.mkdirSync(target_dir, { recursive: true });
  }

  const base_name = path.basename(source_path, extension);
  const target_path = path.join(target_dir, `${base_name}.md`);

  if (extension === '.md') {
    return copy_markdown_file(source_path, target_path);
  }

  if (extension === '.csv') {
    return convert_csv_to_markdown(source_path, target_path);
  }

  if (extension === '.pdf') {
    return convert_pdf_to_markdown(source_path, target_path);
  }

  console.warn(
    `[AVISO] O arquivo "${filename}" possui extensão não suportada ("${extension}"). Extensões aceitas: .md, .pdf, .csv.`
  );
  return null;
}

export async function process_directory_documents(
  source_dir: string,
  target_dir: string
): Promise<converted_document[]> {
  if (!fs.existsSync(source_dir)) {
    console.error(`[ERRO] O diretório de origem "${source_dir}" não existe.`);
    return [];
  }

  const files = fs.readdirSync(source_dir);
  const results: converted_document[] = [];

  for (const file of files) {
    if (file.startsWith('.')) {
      continue;
    }
    const full_source_path = path.join(source_dir, file);
    const stat = fs.statSync(full_source_path);

    if (stat.isFile()) {
      const converted = await convert_single_document(full_source_path, target_dir);
      if (converted) {
        results.push(converted);
      }
    }
  }

  return results;
}

export function prepare_chunks(
  doc: converted_document,
  options?: chunking_options
): document_chunk[] {
  const text = doc.content;
  const chunks: document_chunk[] = [];

  // Verificação de seções Markdown com '## '
  const has_heading_sections = /(^|\n)##\s+/.test(text);

  if (has_heading_sections) {
    const raw_sections = text.split(/(?=(?:^|\n)##\s+)/g);
    let chunk_counter = 0;

    for (const raw_section of raw_sections) {
      const section = raw_section.trim();
      if (!section || (section.startsWith('# ') && !section.includes('## '))) {
        continue;
      }

      chunks.push({
        id: `${doc.filename_target}_chunk_${chunk_counter}`,
        source_file: doc.target_path,
        chunk_index: chunk_counter,
        content: section,
        metadata: {
          source_original: doc.source_path,
          filename_source: doc.filename_source,
          extension_source: doc.extension_source,
        },
      });
      chunk_counter++;
    }

    if (chunks.length > 0) {
      return chunks;
    }
  }

  // Fallback: chunkenização baseada em tamanho de caracteres
  const chunk_size = options?.chunk_size ?? 1000;
  const chunk_overlap = options?.chunk_overlap ?? 200;

  let start_index = 0;
  let chunk_counter = 0;

  while (start_index < text.length) {
    const end_index = Math.min(start_index + chunk_size, text.length);
    const chunk_content = text.slice(start_index, end_index);

    chunks.push({
      id: `${doc.filename_target}_chunk_${chunk_counter}`,
      source_file: doc.target_path,
      chunk_index: chunk_counter,
      content: chunk_content,
      metadata: {
        source_original: doc.source_path,
        filename_source: doc.filename_source,
        extension_source: doc.extension_source,
      },
    });

    chunk_counter++;
    if (end_index === text.length) {
      break;
    }
    start_index += chunk_size - chunk_overlap;
  }

  return chunks;
}

if (require.main === module) {
  const default_source = path.join(__dirname, 'doc_bruto');
  const default_target = path.join(__dirname, 'doc_markdown');

  console.log(`Iniciando conversão de documentos de "${default_source}" para "${default_target}"...`);

  process_directory_documents(default_source, default_target)
    .then(docs => {
      console.log(`Conversão concluída. Total de documentos convertidos: ${docs.length}`);
      docs.forEach(doc => {
        console.log(` - [${doc.extension_source}] ${doc.filename_source} -> ${doc.filename_target}`);
      });
    })
    .catch(error => {
      console.error('Erro na execução do conversor de documentos:', error);
    });
}
