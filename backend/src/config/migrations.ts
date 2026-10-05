import pool from './database.js';

export async function runMigrations(): Promise<void> {
  const migrations: string[] = [
    `ALTER TABLE documento ADD COLUMN IF NOT EXISTS id_agendamento INT REFERENCES agendamento(id_agendamento) ON DELETE CASCADE`,
    `ALTER TABLE documento ADD COLUMN IF NOT EXISTS conteudo_base64 TEXT`,
    `ALTER TABLE documento ADD COLUMN IF NOT EXISTS tamanho_bytes INT`,
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS plano_proximo TEXT`,
    // sessao_consulta: tabela central de sessões por atendimento
    `CREATE TABLE IF NOT EXISTS sessao_consulta (
      id_sessao SERIAL PRIMARY KEY,
      id_agendamento INT REFERENCES agendamento(id_agendamento) ON DELETE SET NULL,
      id_paciente INT NOT NULL REFERENCES paciente(id_paciente) ON DELETE CASCADE,
      id_profissional INT NOT NULL REFERENCES profissional(id_profissional),
      numero_sessao INT DEFAULT 1,
      data_sessao DATE NOT NULL,
      hora_sessao TIME,
      descricao_realizada TEXT,
      observacoes_internas TEXT,
      prescricao_texto TEXT,
      medicamentos TEXT,
      orientacoes_paciente TEXT,
      proxima_sessao_data DATE,
      proxima_sessao_hora TIME,
      valor_sessao DECIMAL(10,2) DEFAULT 0,
      forma_pagamento VARCHAR(50),
      status_pagamento VARCHAR(30) DEFAULT 'Pendente',
      pago_na_sessao BOOLEAN DEFAULT FALSE,
      pago_apos_sessao BOOLEAN DEFAULT FALSE,
      data_pagamento TIMESTAMP,
      status VARCHAR(30) DEFAULT 'Realizada',
      data_criacao TIMESTAMP DEFAULT NOW()
    )`,
    // índices de performance
    `CREATE INDEX IF NOT EXISTS idx_sessao_paciente ON sessao_consulta(id_paciente)`,
    `CREATE INDEX IF NOT EXISTS idx_sessao_profissional ON sessao_consulta(id_profissional)`,
    `CREATE INDEX IF NOT EXISTS idx_sessao_agendamento ON sessao_consulta(id_agendamento)`,
    `CREATE INDEX IF NOT EXISTS idx_paciente_nome ON paciente(nome)`,
    // campo de motivo para solicitações pendentes
    `ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS motivo_pendencia TEXT`,
    // Tipo de atendimento de cada horário liberado (antes ficava só no navegador da profissional)
    `ALTER TABLE disponibilidade_agenda ADD COLUMN IF NOT EXISTS servico VARCHAR(120)`,
    // colunas extras em consulta para plano de tratamento
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS id_paciente INT REFERENCES paciente(id_paciente)`,
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS tipo_consulta VARCHAR(50)`,
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS objetivo_tratamento TEXT`,
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS total_sessoes_planejadas INT DEFAULT 0`,
    `ALTER TABLE consulta ADD COLUMN IF NOT EXISTS status_consulta VARCHAR(30) DEFAULT 'Ativa'`,
    // tramite: registro de tramites por agendamento (linha do tempo de processo)
    `CREATE TABLE IF NOT EXISTS tramite (
      id_tramite SERIAL PRIMARY KEY,
      id_agendamento INT NOT NULL REFERENCES agendamento(id_agendamento) ON DELETE CASCADE,
      numero_tramite INT NOT NULL,
      tipo VARCHAR(30) DEFAULT 'informacao',
      descricao TEXT NOT NULL,
      usuario_nome VARCHAR(150) DEFAULT 'Sistema',
      criado_em TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tramite_agendamento ON tramite(id_agendamento)`,
    // rastreamento de reagendamento: id_reagendado_de aponta para o agendamento original
    `ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS id_reagendado_de INT REFERENCES agendamento(id_agendamento)`,
    // observações clínicas do profissional sobre o paciente
    `ALTER TABLE paciente ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    // foto de perfil do paciente (base64)
    `ALTER TABLE paciente ADD COLUMN IF NOT EXISTS foto_base64 TEXT`,
    // copiloto clínico: catálogo de procedimentos (dataset em backend/dados/procedimentos_fisioterapia.json)
    `CREATE TABLE IF NOT EXISTS copiloto_procedimento (
      id VARCHAR(10) PRIMARY KEY,
      codigo_rbpf VARCHAR(30),
      area VARCHAR(80) NOT NULL,
      nome VARCHAR(200) NOT NULL,
      descricao TEXT,
      indicacoes JSONB NOT NULL DEFAULT '[]',
      contraindicacoes_absolutas JSONB NOT NULL DEFAULT '[]',
      contraindicacoes_relativas JSONB NOT NULL DEFAULT '[]',
      pre_requisitos JSONB NOT NULL DEFAULT '[]',
      escalas_sugeridas JSONB NOT NULL DEFAULT '[]',
      regras_validacao JSONB NOT NULL DEFAULT '[]',
      fontes JSONB NOT NULL DEFAULT '[]',
      versao_dataset VARCHAR(20) NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW()
    )`,
    // copiloto clínico: condições clínicas (dataset em backend/dados/condicoes_clinicas_fisioterapia.csv)
    `CREATE TABLE IF NOT EXISTS copiloto_condicao (
      id VARCHAR(10) PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      cid10 VARCHAR(80),
      area VARCHAR(80),
      prevalencia_idosos VARCHAR(80),
      sinais_alerta JSONB NOT NULL DEFAULT '[]',
      avaliacao JSONB NOT NULL DEFAULT '[]',
      procedimentos_recomendados JSONB NOT NULL DEFAULT '[]',
      precaucoes JSONB NOT NULL DEFAULT '[]',
      metas JSONB NOT NULL DEFAULT '[]',
      criterios_encaminhamento JSONB NOT NULL DEFAULT '[]',
      fontes JSONB NOT NULL DEFAULT '[]',
      atualizado_em TIMESTAMP DEFAULT NOW()
    )`,
    // histórico de conversas com o copiloto (uma conversa = um atendimento)
    `CREATE TABLE IF NOT EXISTS copiloto_conversa (
      id_conversa SERIAL PRIMARY KEY,
      id_profissional INT NOT NULL REFERENCES profissional(id_profissional) ON DELETE CASCADE,
      titulo VARCHAR(160) NOT NULL DEFAULT 'Nova consulta',
      contexto JSONB NOT NULL DEFAULT '{}',
      status_triagem VARCHAR(20),
      quadros TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_copiloto_conversa_prof ON copiloto_conversa(id_profissional, atualizado_em DESC)`,
    `CREATE TABLE IF NOT EXISTS copiloto_mensagem (
      id_mensagem SERIAL PRIMARY KEY,
      id_conversa INT NOT NULL REFERENCES copiloto_conversa(id_conversa) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      analise JSONB NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_copiloto_mensagem_conversa ON copiloto_mensagem(id_conversa, id_mensagem)`,
    // conversa vinculada a um paciente cadastrado; mensagem do tipo 'ficha' = orientação inicial da ficha
    `ALTER TABLE copiloto_conversa ADD COLUMN IF NOT EXISTS id_paciente INT REFERENCES paciente(id_paciente) ON DELETE SET NULL`,
    `ALTER TABLE copiloto_mensagem ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'relato'`,
    // achados clínicos extraídos de cada laudo (cache: o laudo só é lido pela IA uma vez)
    `CREATE TABLE IF NOT EXISTS copiloto_laudo_extracao (
      id_documento INT PRIMARY KEY REFERENCES documento(id_documento) ON DELETE CASCADE,
      resumo TEXT,
      erro TEXT,
      modelo VARCHAR(60),
      extraido_em TIMESTAMP DEFAULT NOW()
    )`,
    // orientação de conduta por paciente (anotações da profissional + laudos + histórico)
    `CREATE TABLE IF NOT EXISTS copiloto_plano_paciente (
      id_paciente INT PRIMARY KEY REFERENCES paciente(id_paciente) ON DELETE CASCADE,
      anotacoes_profissional TEXT,
      analise JSONB,
      ia JSONB,
      laudos_considerados INT DEFAULT 0,
      id_profissional INT REFERENCES profissional(id_profissional) ON DELETE SET NULL,
      gerado_em TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS copiloto_regra_geral (
      id VARCHAR(10) PRIMARY KEY,
      tipo VARCHAR(20) NOT NULL,
      regra TEXT NOT NULL,
      fonte TEXT,
      versao_dataset VARCHAR(20) NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW()
    )`,
  ];

  // Executa migrations em série com um único cliente para não abrir múltiplas conexões
  const client = await pool.connect();
  try {
    for (const sql of migrations) {
      try {
        await client.query(sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists')) console.error('Migration error:', msg);
      }
    }
  } finally {
    client.release();
  }
  console.log('[DB] Migrations verificadas.');
}
