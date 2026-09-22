Sobre o código
===
> Este projeto é usado comercialmente pela **Это-Тек (@eto_tek)**, mas não possui restrições de uso/cópia — aberto a sugestões de melhoria e parcerias.

Trata-se de um agente de IA integrado com RAG que opera de forma modular, isto é, não está atrelado a nenhum outro sistema e pode ser utilizado em conjunto (como módulo) com outros agentes ou sistemas que necessitem de IA. Um exemplo disso é a aplicação utilizada pela Это-Тек, cuja integração se dá via Chatwoot.

Como executar
---

### 1. Configuracao de Ambiente
Copie o arquivo de exemplo e preencha as credenciais necessarias:
```bash
cp .env_exemplo .env
```

Variaveis essenciais do banco PostgreSQL (obrigatorias no .env):
- `POSTGRES_USER`: Usuario do banco de dados.
- `POSTGRES_PASSWORD`: Senha de acesso do banco de dados.
- `POSTGRES_DB`: Nome da base de dados.

### 2. Inicializacao dos Containers
Execute o build das imagens e inicialize os servicos em background:
```bash
docker compose up -d --build
```

O servico `db` executara a imagem `pgvector/pgvector:pg17` (contêiner `rag_postgres_db`) e o servico `app` (contêiner `rag_agent_app`) aguardara a conclusao do healthcheck antes de iniciar. O script de entrada executara automaticamente a sincronizacao do schema via `prisma db push`.

### 3. Povoamento da Base e Geracao de Embeddings (Seed Opcional)
Para cadastrar o cliente de teste e carregar os documentos vetoriais da base de conhecimento:
```bash
docker compose exec app node cod_result/database/seed.js
```

### 4. Acompanhamento de Logs
Os logs da aplicacao sao persistidos no diretorio local `./logs` do host:
```bash
docker compose logs -f app
```
O arquivo de log persistente pode ser consultado diretamente em `./logs/standard.log`.

### 5. Reinicializacao com Limpeza de Dados (Reset de Volume)
Para remover contêineres e zerar completamente o volume persistente do banco de dados:
```bash
docker compose down -v
```