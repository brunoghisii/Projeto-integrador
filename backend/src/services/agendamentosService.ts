import pool from '../config/database.js';
import { inserirTramite } from './tramiteService.js';

interface AgendamentoData {
  id_paciente: number;
  data_consulta: string;
  horario: string;
  observacoes?: string;
  exame_anexo?: string;
}

interface FinalizarData {
  diagnostico?: string;
  prescricao?: string;
  observacoes?: string;
  valor?: number;
  forma_pagamento?: string;
}

export async function findAll(profissionalId: number, data?: string, status?: string) {
  const conditions: string[] = ['a.id_profissional = $1'];
  const values: unknown[] = [profissionalId];
  let idx = 2;

  if (data) {
    conditions.push(`a.data_consulta = $${idx++}`);
    values.push(data);
  }
  if (status) {
    conditions.push(`a.status = $${idx++}`);
    values.push(status);
  }

  const result = await pool.query(
    `SELECT a.id_agendamento, a.data_consulta, a.horario, a.status, a.observacoes,
            p.id_paciente, p.nome AS nome_paciente, p.telefone AS telefone_paciente,
            COUNT(d.id_documento) AS num_documentos
     FROM agendamento a
     JOIN paciente p ON a.id_paciente = p.id_paciente
     LEFT JOIN documento d ON d.id_agendamento = a.id_agendamento
     WHERE ${conditions.join(' AND ')}
     GROUP BY a.id_agendamento, a.data_consulta, a.horario, a.status, a.observacoes,
              p.id_paciente, p.nome, p.telefone
     ORDER BY a.data_consulta DESC, a.horario ASC`,
    values
  );
  return result.rows;
}

export async function findById(id: number, profissionalId: number) {
  const result = await pool.query(
    `SELECT a.id_agendamento, a.data_consulta, a.horario, a.status, a.observacoes, a.exame_anexo,
            p.id_paciente, p.nome AS nome_paciente, p.telefone AS telefone_paciente, p.email AS email_paciente
     FROM agendamento a
     JOIN paciente p ON a.id_paciente = p.id_paciente
     WHERE a.id_agendamento = $1 AND a.id_profissional = $2`,
    [id, profissionalId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Agendamento nao encontrado');
  return row;
}

// ─── FUNÇÃO CREATE REVISADA COM COMPATIBILIDADE DE SEGUNDOS DINÂMICOS ───
export async function create(data: AgendamentoData, profissionalId: number) {
  const dataHora = new Date(`${data.data_consulta}T${data.horario.substring(0, 5)}`);
  if (dataHora <= new Date()) throw new Error('Data e horario devem ser no futuro');

  const paciente = await pool.query(
    'SELECT id_paciente FROM paciente WHERE id_paciente = $1',
    [data.id_paciente]
  );
  if ((paciente.rowCount ?? 0) === 0) throw new Error('Paciente nao encontrado');

  const horarioBase = data.horario.substring(0, 5);

  // 1. Busca se o slot de vagas foi configurado pela Luana
  const slotInfo = await pool.query(
    `SELECT vagas FROM disponibilidade_agenda 
     WHERE id_profissional = $1 AND data_disponivel = $2 AND horario LIKE $3`,
    [profissionalId, data.data_consulta, `${horarioBase}%`]
  );
  const limiteVagas = slotInfo.rows[0] ? Number(slotInfo.rows[0].vagas) : 1;

  // 2. Conta quantas pessoas estão agendadas ativamente neste minuto
  const ocupacoes = await pool.query(
    `SELECT COUNT(id_agendamento) as total FROM agendamento
     WHERE id_profissional = $1 AND data_consulta = $2 AND horario LIKE $3 AND status NOT IN ('Cancelado')`,
    [profissionalId, data.data_consulta, `${horarioBase}%`]
  );
  const totalOcupado = Number(ocupacoes.rows[0]?.total || 0);

  // 3. Valida se existem vagas livres
  if (totalOcupado >= limiteVagas) {
    throw new Error('Horario indisponivel');
  }

  // 4. MICRO-DIFERENCIAÇÃO DE SEGUNDOS: Evita conflito direto com Unique Constraints do banco de dados
  const segundosDinamicos = String(totalOcupado).padStart(2, '0');
  const horarioFinalComSegundos = `${horarioBase}:${segundosDinamicos}`;

  const result = await pool.query(
    `INSERT INTO agendamento (id_paciente, id_profissional, data_consulta, horario, status, observacoes, exame_anexo)
     VALUES ($1,$2,$3,$4,'Agendado',$5,$6)
     RETURNING *`,
    [
      data.id_paciente, profissionalId, data.data_consulta, horarioFinalComSegundos,
      data.observacoes ?? null, data.exame_anexo ?? null,
    ]
  );
  
  const row = result.rows[0];
  if (!row) throw new Error('Erro ao criar agendamento');
  return row;
}

export async function update(id: number, data: Record<string, unknown>, profissionalId: number) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed = ['data_consulta', 'horario', 'status', 'observacoes', 'exame_anexo'];
  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) throw new Error('Nenhum campo valido para atualizar');

  values.push(id, profissionalId);
  const result = await pool.query(
    `UPDATE agendamento SET ${fields.join(', ')}
     WHERE id_agendamento = $${idx} AND id_profissional = $${idx + 1}
     RETURNING *`,
    values
  );
  const row = result.rows[0];
  if (!row) throw new Error('Agendamento nao encontrado');
  return row;
}

export async function cancelar(id: number, profesionalId: number) {
  const result = await pool.query(
    `UPDATE agendamento SET status = 'Cancelado'
     WHERE id_agendamento = $1 AND id_profissional = $2
     RETURNING id_agendamento`,
    [id, profesionalId]
  );
  if ((result.rowCount ?? 0) === 0) throw new Error('Agendamento nao encontrado');
}

export async function getCalendario(profissionalId: number, mes?: string, ano?: string) {
  const conditions: string[] = ["a.id_profissional = $1", "a.status != 'Cancelado'"];
  const values: unknown[] = [profissionalId];
  let idx = 2;

  if (mes && ano) {
    conditions.push(`EXTRACT(MONTH FROM a.data_consulta) = $${idx++}`);
    conditions.push(`EXTRACT(YEAR FROM a.data_consulta) = $${idx++}`);
    values.push(mes, ano);
  }

  const result = await pool.query(
    `SELECT a.id_agendamento, a.data_consulta, a.horario, a.status,
            p.nome AS nome_paciente
     FROM agendamento a
     JOIN paciente p ON a.id_paciente = p.id_paciente
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.data_consulta, a.horario`,
    values
  );
  return result.rows;
}

export async function confirmar(id: number, profissionalId: number) {
  const agInfo = await pool.query(
    `SELECT id_agendamento, data_consulta, horario FROM agendamento
     WHERE id_agendamento = $1 AND id_profissional = $2 AND status = 'Agendado'`,
    [id, profissionalId]
  );
  const ag = agInfo.rows[0] as { id_agendamento: number; data_consulta: string; horario: string } | undefined;
  if (!ag) throw new Error('Agendamento nao encontrado ou ja confirmado');

  await pool.query(
    `UPDATE agendamento SET status = 'Confirmado' WHERE id_agendamento = $1`,
    [id]
  );

  const dp = String(ag.data_consulta).substring(0, 10).split('-');
  const dataFmt = `${dp[2]}/${dp[1]}/${dp[0]}`;
  const hora = String(ag.horario).substring(0, 5);
  try {
    await inserirTramite(id, 'sistema', `Agendamento confirmado pela profissional para ${dataFmt} às ${hora}`);
  } catch { /* erro silencioso */ }
}

export async function limparSlotsExpirados() {
  await pool.query(`DELETE FROM disponibilidade_agenda WHERE data_disponivel < CURRENT_DATE`);
}

export async function getDisponibilidade(profissionalId: number) {
  await limparSlotsExpirados();
  const result = await pool.query(
    `SELECT id_disponibilidade, data_disponivel, horario, vagas, servico
     FROM disponibilidade_agenda
     WHERE id_profissional = $1 AND data_disponivel >= CURRENT_DATE
     ORDER BY data_disponivel, horario`,
    [profissionalId]
  );
  return result.rows;
}

export async function addDisponibilidade(profissionalId: number, data: { data: string; horario: string; vagas: number; servico?: string }) {
  const servico = typeof data.servico === 'string' && data.servico.trim() ? data.servico.trim().slice(0, 120) : null;
  const result = await pool.query(
    `INSERT INTO disponibilidade_agenda (id_profissional, data_disponivel, horario, vagas, servico)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [profissionalId, data.data, data.horario, data.vagas, servico]
  );
  return result.rows[0];
}

export async function removeDisponibilidade(id: number, profissionalId: number) {
  const result = await pool.query(
    `DELETE FROM disponibilidade_agenda WHERE id_disponibilidade = $1 AND id_profissional = $2
     RETURNING id_disponibilidade`,
    [id, profissionalId]
  );
  if ((result.rowCount ?? 0) === 0) throw new Error('Horario nao encontrado');
}

export async function getSlotsParaData(profissionalId: number, data: string) {
  const result = await pool.query(
    `SELECT
        da.horario,
        da.vagas,
        COUNT(a.id_agendamento) FILTER (
          WHERE a.status NOT IN ('Cancelado','Finalizado')
        ) AS ocupacoes
     FROM disponibilidade_agenda da
     LEFT JOIN agendamento a
       ON a.id_profissional = da.id_profissional
      AND a.data_consulta = da.data_disponivel
      AND a.horario LIKE da.horario || '%'
     WHERE da.id_profissional = $1 AND da.data_disponivel = $2
     GROUP BY da.horario, da.vagas
     ORDER BY da.horario`,
    [profissionalId, data]
  );
  return result.rows.map(r => ({
    horario: String(r.horario).substring(0, 5),
    vagas: Number(r.vagas),
    ocupacoes: Number(r.ocupacoes),
    ocupado: Number(r.ocupacoes) >= Number(r.vagas),
  }));
}

export async function reagendar(
  dados: { id_paciente: number; data_consulta: string; horario: string; observacoes?: string; id_agendamento_original?: number },
  profissionalId: number
) {
  const horarioBase = dados.horario.substring(0, 5);

  const slotInfo = await pool.query(
    `SELECT vagas FROM disponibilidade_agenda 
     WHERE id_profissional = $1 AND data_disponivel = $2 AND horario LIKE $3`,
    [profissionalId, dados.data_consulta, `${horarioBase}%`]
  );
  const limiteVagas = slotInfo.rows[0] ? Number(slotInfo.rows[0].vagas) : 1;

  const ocupacoes = await pool.query(
    `SELECT COUNT(id_agendamento) as total FROM agendamento
     WHERE id_profissional = $1 AND data_consulta = $2 AND horario LIKE $3 AND status NOT IN ('Cancelado','Finalizado')`,
    [profissionalId, dados.data_consulta, `${horarioBase}%`]
  );
  const totalOcupado = Number(ocupacoes.rows[0]?.total || 0);

  if (totalOcupado >= limiteVagas) {
    throw new Error('Já existe um agendamento ativo neste horário');
  }

  const segundosDinamicos = String(totalOcupado).padStart(2, '0');
  const horarioFinalComSegundos = `${horarioBase}:${segundosDinamicos}`;

  const result = await pool.query(
    `INSERT INTO agendamento (id_paciente, id_profissional, data_consulta, horario, status, observacoes, id_reagendado_de)
     VALUES ($1,$2,$3,$4,'Confirmado',$5,$6)
     RETURNING *`,
    [dados.id_paciente, profissionalId, dados.data_consulta, horarioFinalComSegundos, dados.observacoes ?? null, dados.id_agendamento_original ?? null]
  );
  const row = result.rows[0] as { id_agendamento: number; data_consulta: string; horario: string } | undefined;
  if (!row) throw new Error('Erro ao criar reagendamento');

  const dp = String(row.data_consulta).substring(0, 10).split('-');
  const dataFmt = `${dp[2]}/${dp[1]}/${dp[0]}`;
  const hora = String(row.horario).substring(0, 5);
  const origemTxt = dados.id_agendamento_original
    ? ` — originado da consulta CON-${String(dados.id_agendamento_original).padStart(4, '0')}`
    : '';

  try {
    await inserirTramite(row.id_agendamento, 'sistema', `Consulta reagendada para ${dataFmt} às ${hora}${origemTxt}`);

    if (dados.id_agendamento_original) {
      const novoCode = `CON-${String(row.id_agendamento).padStart(4, '0')}`;
      await inserirTramite(
        dados.id_agendamento_original,
        'sistema',
        `Consulta reagendada — nova consulta criada: ${novoCode} para ${dataFmt} às ${hora}`
      );
    }
  } catch { /* falha silenciosa */ }

  return row;
}

export async function finalizar(id: number, data: FinalizarData, profissionalId: number) {
  const agendamento = await pool.query(
    `SELECT id_agendamento, id_paciente FROM agendamento
     WHERE id_agendamento = $1 AND id_profissional = $2 AND status != 'Cancelado'`,
    [id, profissionalId]
  );
  const ag = agendamento.rows[0];
  if (!ag) throw new Error('Agendamento nao encontrado');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      "UPDATE agendamento SET status = 'Finalizado' WHERE id_agendamento = $1",
      [id]
    );

    const consultaResult = await client.query(
      `INSERT INTO consulta (id_agendamento, diagnostico, prescricao, observacoes, data_finalizacao)
       VALUES ($1,$2,$3,$4,NOW()) RETURNING id_consulta`,
      [id, data.diagnostico ?? null, data.prescricao ?? null, data.observacoes ?? null]
    );
    const consulta = consultaResult.rows[0] as { id_consulta: number } | undefined;
    if (!consulta) throw new Error('Erro ao registrar consulta');

    if (data.valor) {
      await client.query(
        `INSERT INTO financeiro (id_consulta, valor, forma_pagamento, status_pagamento, data_pagamento)
         VALUES ($1,$2,$3,'Pago',NOW())`,
         [consulta.id_consulta, data.valor, data.forma_pagamento ?? 'Dinheiro']
      );
    }

    await client.query(
      `INSERT INTO historico (id_paciente, id_consulta, descricao, data_registro)
       VALUES ($1,$2,$3,NOW())`,
      [ag.id_paciente, consulta.id_consulta, data.diagnostico ?? 'Consulta finalizada']
    );

    await client.query('COMMIT');
    return { id_consulta: consulta.id_consulta };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}