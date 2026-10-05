import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { inserirTramite } from './tramiteService.js';

export async function getMe(pacienteId: number) {
  const result = await pool.query(
    `SELECT id_paciente, nome, cpf, nascimento, email, telefone, cep, logradouro, numero, bairro, complemento, cidade, estado, foto_base64
     FROM paciente WHERE id_paciente = $1`,
    [pacienteId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Paciente nao encontrado');
  return row;
}

export async function updateMe(pacienteId: number, data: Record<string, unknown>) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed = ['nome', 'telefone', 'cep', 'logradouro', 'numero', 'bairro', 'complemento', 'cidade', 'estado', 'foto_base64'];
  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (data.novaSenha && typeof data.novaSenha === 'string') {
    const hash = await bcrypt.hash(data.novaSenha, 12);
    fields.push(`senha = $${idx++}`);
    values.push(hash);
  }

  if (fields.length === 0) throw new Error('Nenhum campo para atualizar');

  values.push(pacienteId);
  const result = await pool.query(
    `UPDATE paciente SET ${fields.join(', ')} WHERE id_paciente = $${idx} RETURNING id_paciente, nome, email`,
    values
  );
  return result.rows[0];
}

export async function deleteMe(pacienteId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const agendamentos = await client.query(
      'SELECT id_agendamento FROM agendamento WHERE id_paciente = $1',
      [pacienteId]
    );

    for (const ag of agendamentos.rows as { id_agendamento: number }[]) {
      const consultas = await client.query(
        'SELECT id_consulta FROM consulta WHERE id_agendamento = $1',
        [ag.id_agendamento]
      );
      for (const c of consultas.rows as { id_consulta: number }[]) {
        await client.query('DELETE FROM historico WHERE id_consulta = $1', [c.id_consulta]);
        await client.query('DELETE FROM financeiro WHERE id_consulta = $1', [c.id_consulta]);
        await client.query('DELETE FROM consulta WHERE id_consulta = $1', [c.id_consulta]);
      }
    }

    await client.query('DELETE FROM historico WHERE id_paciente = $1', [pacienteId]);
    await client.query('DELETE FROM agendamento WHERE id_paciente = $1', [pacienteId]);
    await client.query('DELETE FROM paciente WHERE id_paciente = $1', [pacienteId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function verificarSenhaEObterCpf(pacienteId: number, senha: string): Promise<string> {
  const result = await pool.query(
    'SELECT cpf, senha FROM paciente WHERE id_paciente = $1',
    [pacienteId]
  );
  const row = result.rows[0] as { cpf: string; senha: string } | undefined;
  if (!row) throw new Error('Paciente nao encontrado');
  const valido = await bcrypt.compare(senha, row.senha);
  if (!valido) throw new Error('Senha incorreta');
  return row.cpf;
}

// Horários liberados por TODOS os profissionais. Cada slot diz de quem é, para o
// agendamento ser criado com o profissional que liberou aquele horário.
export async function getDisponibilidade() {
  const result = await pool.query(
    `SELECT da.id_disponibilidade, da.id_profissional, p.nome AS profissional_nome,
            da.data_disponivel, da.horario, da.vagas, da.servico,
            COUNT(a.id_agendamento) FILTER (WHERE a.status NOT IN ('Cancelado')) AS ocupacoes,
            COUNT(a.id_agendamento) FILTER (WHERE a.status NOT IN ('Cancelado')) >= da.vagas AS ocupado
     FROM disponibilidade_agenda da
     JOIN profissional p ON p.id_profissional = da.id_profissional
     LEFT JOIN agendamento a
       ON a.id_profissional = da.id_profissional
      AND a.data_consulta = da.data_disponivel
      AND substring(a.horario::text, 1, 5) = substring(da.horario::text, 1, 5)
     WHERE da.data_disponivel >= CURRENT_DATE AND da.vagas > 0
     GROUP BY da.id_disponibilidade, p.nome
     ORDER BY da.data_disponivel, da.horario, p.nome`
  );
  return result.rows;
}

export async function getAgendamentos(pacienteId: number) {
  const result = await pool.query(
    `SELECT id_agendamento, data_consulta, horario, status, observacoes, motivo_pendencia
     FROM agendamento
     WHERE id_paciente = $1
     ORDER BY data_consulta DESC, horario ASC`,
    [pacienteId]
  );
  return result.rows;
}

export async function reenviarSolicitacao(agendamentoId: number, pacienteId: number, observacoes?: string) {
  const result = await pool.query(
    `UPDATE agendamento
     SET status = 'Agendado', motivo_pendencia = NULL, observacoes = COALESCE($3, observacoes)
     WHERE id_agendamento = $1 AND id_paciente = $2 AND status = 'Pendente'
     RETURNING id_agendamento`,
    [agendamentoId, pacienteId, observacoes ?? null]
  );
  if ((result.rowCount ?? 0) === 0) throw new Error('Agendamento não encontrado ou não está pendente');
  return result.rows[0];
}

export async function createAgendamento(
  pacienteId: number,
  data: { data_consulta: string; horario: string; observacoes?: string; id_profissional?: number },
) {
  const horarioLimpo = data.horario.substring(0, 5);
  const dataHora = new Date(`${data.data_consulta}T${horarioLimpo}`);
  if (dataHora <= new Date()) throw new Error('Data e horario devem ser no futuro');

  // Profissional do horário: o informado pela tela; senão, quem liberou esse horário
  // (e ainda tem vaga); sem horário liberado, o primeiro profissional (comportamento antigo).
  const idInformado = Number(data.id_profissional);
  const profResult = Number.isInteger(idInformado) && idInformado > 0
    ? await pool.query('SELECT id_profissional FROM profissional WHERE id_profissional = $1', [idInformado])
    : await pool.query(
      `SELECT da.id_profissional
         FROM disponibilidade_agenda da
         LEFT JOIN agendamento a
           ON a.id_profissional = da.id_profissional AND a.data_consulta = da.data_disponivel
          AND substring(a.horario::text, 1, 5) = $2 AND a.status != 'Cancelado'
        WHERE da.data_disponivel = $1 AND substring(da.horario::text, 1, 5) = $2
        GROUP BY da.id_disponibilidade
       HAVING COUNT(a.id_agendamento) < da.vagas
        ORDER BY da.id_profissional
        LIMIT 1`,
      [data.data_consulta, horarioLimpo],
    );
  const prof = (profResult.rows[0]
    ?? (await pool.query('SELECT id_profissional FROM profissional ORDER BY id_profissional LIMIT 1')).rows[0]
  ) as { id_profissional: number } | undefined;
  if (!prof) throw new Error('Nenhum profissional encontrado');

  // 1. Busca o número máximo de vagas estipulado na agenda para esse horário
  const slotInfo = await pool.query(
    `SELECT vagas FROM disponibilidade_agenda 
     WHERE id_profissional = $1 AND data_disponivel = $2 AND horario::text LIKE $3`,
    [prof.id_profissional, data.data_consulta, `${horarioLimpo}%`]
  );
  const limiteVagas = slotInfo.rows[0] ? Number(slotInfo.rows[0].vagas) : 1;

  // 2. Calcula a ocupação global real do horário (quantas linhas ativas existem ali)
  const ocupacoes = await pool.query(
    `SELECT COUNT(id_agendamento) as total FROM agendamento
     WHERE id_profissional = $1 AND data_consulta = $2 AND horario::text LIKE $3 AND status != 'Cancelado'`,
    [prof.id_profissional, data.data_consulta, `${horarioLimpo}%`]
  );
  const totalOcupado = Number(ocupacoes.rows[0]?.total || 0);

  // 3. Se as vagas já acabaram, bloqueia
  if (totalOcupado >= limiteVagas) {
    throw new Error('Horario indisponivel. Escolha outro horario.');
  }

  // 4. Se o limite permite, cria uma NOVA LINHA exclusiva para você (com seu id_paciente!)
  const result = await pool.query(
    `INSERT INTO agendamento (id_paciente, id_profissional, data_consulta, horario, status, observacoes)
     VALUES ($1,$2,$3,$4,'Agendado',$5)
     RETURNING *`,
    [pacienteId, prof.id_profissional, data.data_consulta, `${horarioLimpo}:00`, data.observacoes ?? null]
  );
  
  const row = result.rows[0] as { id_agendamento: number; data_consulta: string; horario: string } | undefined;
  if (!row) throw new Error('Erro ao criar agendamento');

  const dp = String(row.data_consulta).substring(0, 10).split('-');
  const dataFmt = `${dp[2]}/${dp[1]}/${dp[0]}`;
  const hora = String(row.horario).substring(0, 5);
  try {
    await inserirTramite(row.id_agendamento, 'sistema', `Solicitação de agendamento realizada pelo paciente para ${dataFmt} às ${hora}`);
  } catch { /* silencioso */ }

  return row;
}

export async function cancelarAgendamento(id: number, pacienteId: number) {
  const result = await pool.query(
    `UPDATE agendamento SET status = 'Cancelado'
     WHERE id_agendamento = $1 AND id_paciente = $2 AND status = 'Agendado'
     RETURNING id_agendamento`,
    [id, pacienteId]
  );
  if ((result.rowCount ?? 0) === 0) throw new Error('Agendamento nao encontrado ou nao pode ser cancelado');
}

export async function getHistorico(pacienteId: number) {
  const result = await pool.query(
    `SELECT h.id_historico, h.descricao, h.data_registro,
            c.diagnostico, c.prescricao, c.observacoes AS obs_consulta,
            a.data_consulta, a.horario,
            COALESCE(f.valor, 0) AS valor, f.forma_pagamento, f.status_pagamento
     FROM historico h
     JOIN consulta c ON h.id_consulta = c.id_consulta
     JOIN agendamento a ON c.id_agendamento = a.id_agendamento
     LEFT JOIN financeiro f ON f.id_consulta = c.id_consulta
     WHERE h.id_paciente = $1
     ORDER BY h.data_registro DESC`,
    [pacienteId]
  );
  return result.rows;
}

export async function getFinanceiro(pacienteId: number) {
  const result = await pool.query(
    `SELECT f.id_financeiro, f.valor, f.forma_pagamento, f.status_pagamento, f.data_pagamento,
            a.data_consulta, a.horario, c.diagnostico
     FROM financeiro f
     JOIN consulta c ON f.id_consulta = c.id_consulta
     JOIN agendamento a ON c.id_agendamento = a.id_agendamento
     WHERE a.id_paciente = $1
     ORDER BY f.data_pagamento DESC`,
    [pacienteId]
  );
  return result.rows;
}