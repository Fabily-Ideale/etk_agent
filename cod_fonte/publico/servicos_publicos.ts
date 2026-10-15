import fs from 'fs';
import { Router, Request, Response } from 'express';
import { memory_rate_limiter, create_ip_rate_limiter } from '../security/rate_limiter';
import { default_services_csv_path, parse_services_csv, service_item } from '../rag/tools/services_tool';

export interface servico_publico {
  nome: string;
  descricao: string;
  categoria: string;
}

export interface servicos_publicos_options {
  max_requests: number;
  window_ms: number;
  csv_path?: string;
  limiter?: memory_rate_limiter;
}

const cache_control_publico = 'public, max-age=300';
const corpo_vazio = '[]';

function to_servico_publico(item: service_item): servico_publico {
  return {
    nome: item.nome,
    descricao: item.descricao,
    categoria: item.categoria,
  };
}

export function create_servicos_publicos_router(options: servicos_publicos_options): Router {
  const csv_path = options.csv_path ?? default_services_csv_path;
  const router = Router();

  let cached_mtime_ms = -1;
  let cached_body = corpo_vazio;

  async function read_body(): Promise<string> {
    let mtime_ms: number;

    try {
      mtime_ms = (await fs.promises.stat(csv_path)).mtimeMs;
    } catch {
      cached_mtime_ms = -1;
      cached_body = corpo_vazio;
      return cached_body;
    }

    if (mtime_ms === cached_mtime_ms) {
      return cached_body;
    }

    const raw_content = await fs.promises.readFile(csv_path, 'utf-8');
    cached_body = JSON.stringify(parse_services_csv(raw_content).map(to_servico_publico));
    cached_mtime_ms = mtime_ms;
    return cached_body;
  }

  const ip_limiter = create_ip_rate_limiter(options.max_requests, options.window_ms, options.limiter);

  router.get('/servicos.json', ip_limiter, async (_req: Request, res: Response): Promise<void> => {
    try {
      const body = await read_body();
      res.setHeader('Cache-Control', cache_control_publico);
      res.type('application/json').send(body);
    } catch {
      res.status(500).json({ error: 'falha_leitura_servicos' });
    }
  });

  return router;
}
