import pool from '../../config/database.js';
import { analisarConsulta, type ResultadoAnalise } from '../raciocinio/raciocinioEngine.js';
import type { AnamneseInput, ContextoPaciente } from '../redFlags/types.js';
import { responderComIA, type ResultadoIA } from '../ia/copilotoIA.js';
import { configIA } from '../ia/geminiClient.js';
import { carregarFichaPaciente, type FichaPaciente } from './fichaPaciente.js';

// Cada conversa guarda as mensagens da profissional e a análise retornada em cada uma.
// A anamnese é SEMPRE remontada no servidor (ficha do paciente + mensagens), então reabrir
// um atendimento reproduz exatamente o que foi analisado.
//
// Resposta em duas etapas, para ser rápida:
//   1. análise por regras + datasets → devolvida na hora (dezenas de ms);
//   2. IA generativa → chamada separada (gerarRespostaIA), exibida quando chegar.

export class ConversaNaoEncontrada extends Error {}
export class PacienteNaoEncontrado extends Error {}

const TAMANHO_MAX_MENSAGEM = 5000;
const TEXTO_FICHA = 'Ficha do paciente carregada';

function tituloDe(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > 80 ? `${limpo.slice(0, 77)}…` : limpo;
}

interface ConversaDb {
  id_conversa: number;
  contexto: ContextoPaciente;
  id_paciente: number | null;
}

async function garantirDono(idConversa: number, idProfissional: number): Promise<ConversaDb> {
  const r = await pool.query(
    'SELECT id_conversa, contexto, id_paciente FROM copiloto_conversa WHERE id_conversa = $1 AND id_profissional = $2',
    [idConversa, idProfissional],
  );
  if (!r.rowCount) throw new ConversaNaoEncontrada('Conversa nao encontrada');
  return r.rows[0] as ConversaDb;
}

function montarAnamnese(relatos: string[], ficha: FichaPaciente | null, ctx: ContextoPaciente): AnamneseInput {
  const contexto: ContextoPaciente = { ...(ficha?.idade !== undefined ? { idade: ficha.idade } : {}), ...ctx };
  return {
    ...(relatos.length ? { hfa: relatos.join('\n') } : {}),
    ...(ficha ? { hfp: ficha.resumo } : {}),
    ...(Object.keys(contexto).length ? { contexto } : {}),
  };
}

function resumoFicha(ficha: FichaPaciente) {
  return {
    id: ficha.idPaciente,
    nome: ficha.nome,
    idade: ficha.idade ?? null,
    totalSessoes: ficha.totalSessoes,
    ultimaSessao: ficha.ultimaSessao ?? null,
  };
}

export async function listarConversas(idProfissional: number, limite = 50) {
  const r = await pool.query(
    `SELECT c.id_conversa AS id, c.titulo, c.status_triagem AS status, c.quadros,
            c.id_paciente, p.nome AS paciente_nome,
            c.criado_em, c.atualizado_em, COUNT(m.id_mensagem)::int AS total_mensagens
       FROM copiloto_conversa c
       LEFT JOIN copiloto_mensagem m ON m.id_conversa = c.id_conversa
       LEFT JOIN paciente p ON p.id_paciente = c.id_paciente
      WHERE c.id_profissional = $1
      GROUP BY c.id_conversa, p.nome
      ORDER BY c.atualizado_em DESC
      LIMIT $2`,
    [idProfissional, limite],
  );
  return r.rows;
}

export async function obterConversa(idConversa: number, idProfissional: number) {
  const c = await pool.query(
    `SELECT c.id_conversa AS id, c.titulo, c.status_triagem AS status, c.quadros, c.contexto,
            c.id_paciente, p.nome AS paciente_nome, c.criado_em, c.atualizado_em
       FROM copiloto_conversa c
       LEFT JOIN paciente p ON p.id_paciente = c.id_paciente
      WHERE c.id_conversa = $1 AND c.id_profissional = $2`,
    [idConversa, idProfissional],
  );
  if (!c.rowCount) throw new ConversaNaoEncontrada('Conversa nao encontrada');
  const m = await pool.query(
    'SELECT id_mensagem AS id, tipo, texto, analise, criado_em FROM copiloto_mensagem WHERE id_conversa = $1 ORDER BY id_mensagem',
    [idConversa],
  );
  return { ...c.rows[0], mensagens: m.rows };
}

export async function excluirConversa(idConversa: number, idProfissional: number) {
  const r = await pool.query('DELETE FROM copiloto_conversa WHERE id_conversa = $1 AND id_profissional = $2', [idConversa, idProfissional]);
  if (!r.rowCount) throw new ConversaNaoEncontrada('Conversa nao encontrada');
}

async function gravarMensagem(
  idConversa: number,
  tipo: 'relato' | 'ficha',
  texto: string,
  analise: ResultadoAnalise,
  ctx: ContextoPaciente,
): Promise<number> {
  const quadros = [...analise.condicoesClinicas.map((c) => c.nome), ...analise.quadros.map((q) => q.nome)].join(', ') || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query(
      'INSERT INTO copiloto_mensagem (id_conversa, tipo, texto, analise) VALUES ($1, $2, $3, $4) RETURNING id_mensagem',
      [idConversa, tipo, texto, JSON.stringify(analise)],
    );
    await client.query(
      `UPDATE copiloto_conversa
          SET contexto = $2, status_triagem = $3, quadros = $4, atualizado_em = NOW()
        WHERE id_conversa = $1`,
      [idConversa, JSON.stringify(ctx), analise.triagem.status, quadros],
    );
    await client.query('COMMIT');
    return m.rows[0].id_mensagem as number;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Abre um atendimento para um paciente cadastrado e já devolve a orientação inicial
 * (análise da ficha: condições, red flags, contraindicações e como seguir).
 */
export async function iniciarAtendimentoPaciente(idProfissional: number, idPaciente: number) {
  const ficha = await carregarFichaPaciente(idPaciente);
  if (!ficha) throw new PacienteNaoEncontrado('Paciente nao encontrado');

  const analise = await analisarConsulta(montarAnamnese([], ficha, {}));
  if (!analise.quadros.length && !analise.condicoesClinicas.length && !analise.triagem.alertas.length) {
    const semDados = ficha.totalSessoes === 0 && !/Observações|Consulta/.test(ficha.resumo);
    analise.proximosPassos = [
      semDados
        ? 'A ficha ainda não tem dados clínicos (observações, consultas ou sessões). Descreva aqui a queixa principal para eu orientar.'
        : 'Nenhuma condição do dataset foi reconhecida na ficha. Descreva a queixa atual (região, tempo, o que piora/melhora).',
      ...analise.proximosPassos.filter((p) => !p.startsWith('Descreva a queixa')),
    ];
  }
  const c = await pool.query(
    'INSERT INTO copiloto_conversa (id_profissional, id_paciente, titulo) VALUES ($1, $2, $3) RETURNING id_conversa',
    [idProfissional, idPaciente, tituloDe(`Atendimento — ${ficha.nome}`)],
  );
  const conversaId = c.rows[0].id_conversa as number;
  const mensagemId = await gravarMensagem(conversaId, 'ficha', TEXTO_FICHA, analise, {});
  return { conversaId, mensagemId, analise, paciente: resumoFicha(ficha), iaPendente: configIA().habilitada };
}

/**
 * Registra uma mensagem e devolve a análise por regras imediatamente.
 * Se `idConversa` for nulo, cria uma conversa sem paciente vinculado.
 */
export async function enviarMensagem(
  idProfissional: number,
  idConversa: number | null,
  texto: string,
  contexto: ContextoPaciente = {},
) {
  texto = texto.trim();
  if (!texto) throw new Error('Mensagem vazia');
  if (texto.length > TAMANHO_MAX_MENSAGEM) throw new Error(`Mensagem excede ${TAMANHO_MAX_MENSAGEM} caracteres`);

  let ctxSalvo: ContextoPaciente = {};
  let relatos: string[] = [];
  let ficha: FichaPaciente | null = null;
  if (idConversa) {
    const conv = await garantirDono(idConversa, idProfissional);
    ctxSalvo = conv.contexto ?? {};
    const r = await pool.query(
      "SELECT texto FROM copiloto_mensagem WHERE id_conversa = $1 AND tipo = 'relato' ORDER BY id_mensagem",
      [idConversa],
    );
    relatos = r.rows.map((x: { texto: string }) => x.texto);
    if (conv.id_paciente) ficha = await carregarFichaPaciente(conv.id_paciente);
  }
  const ctx = { ...ctxSalvo, ...contexto };
  const analise = await analisarConsulta(montarAnamnese([...relatos, texto], ficha, ctx));

  if (!idConversa) {
    const c = await pool.query(
      'INSERT INTO copiloto_conversa (id_profissional, titulo) VALUES ($1, $2) RETURNING id_conversa',
      [idProfissional, tituloDe(texto)],
    );
    idConversa = c.rows[0].id_conversa as number;
  }
  const mensagemId = await gravarMensagem(idConversa, 'relato', texto, analise, ctx);
  return { conversaId: idConversa, mensagemId, analise, iaPendente: configIA().habilitada };
}

/**
 * Etapa 2: gera a resposta da IA para uma mensagem já analisada e salva junto dela.
 * Usa a ficha do paciente (sem identificação) + relatos até aquela mensagem.
 */
export async function gerarRespostaIA(idProfissional: number, idConversa: number, idMensagem: number): Promise<ResultadoIA | null> {
  const conv = await garantirDono(idConversa, idProfissional);
  const msg = await pool.query(
    'SELECT analise FROM copiloto_mensagem WHERE id_mensagem = $1 AND id_conversa = $2',
    [idMensagem, idConversa],
  );
  if (!msg.rowCount) throw new ConversaNaoEncontrada('Mensagem nao encontrada');
  const analise = msg.rows[0].analise as ResultadoAnalise;
  if (analise.ia?.resposta) return analise.ia; // já gerada (ex.: reabertura)

  // Turnos anteriores com as respostas que a IA já deu, para o contexto da conversa.
  const [relatos, ficha, prof] = await Promise.all([
    pool.query(
      `SELECT texto, analise->'ia'->>'resposta' AS resposta
         FROM copiloto_mensagem
        WHERE id_conversa = $1 AND tipo = 'relato' AND id_mensagem <= $2
        ORDER BY id_mensagem`,
      [idConversa, idMensagem],
    ),
    conv.id_paciente ? carregarFichaPaciente(conv.id_paciente) : Promise.resolve(null),
    pool.query('SELECT nome FROM profissional WHERE id_profissional = $1', [idProfissional]),
  ]);
  const turnos = relatos.rows.map((x: { texto: string; resposta: string | null }) =>
    ({ texto: x.texto, ...(x.resposta ? { resposta: x.resposta } : {}) }));
  const primeiroNome = String(prof.rows[0]?.nome ?? '').trim().split(/\s+/)[0] || undefined;

  const ia = await responderComIA(turnos, analise, ficha?.resumo, undefined, primeiroNome);
  if (!ia) return null;
  await pool.query(
    "UPDATE copiloto_mensagem SET analise = jsonb_set(analise, '{ia}', $1::jsonb) WHERE id_mensagem = $2",
    [JSON.stringify(ia), idMensagem],
  );
  return ia;
}

/** Ficha resumida para exibir na tela ao reabrir um atendimento. */
export async function obterResumoPaciente(idPaciente: number) {
  const ficha = await carregarFichaPaciente(idPaciente);
  return ficha ? resumoFicha(ficha) : null;
}
