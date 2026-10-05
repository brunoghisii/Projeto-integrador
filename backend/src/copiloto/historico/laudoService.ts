import pool from '../../config/database.js';
import { anonimizar, configIA, ErroIA, gerarResposta } from '../ia/geminiClient.js';
import { analisarConsulta } from '../raciocinio/raciocinioEngine.js';

// Leitura de laudos pela IA: extrai os ACHADOS CLÍNICOS de cada documento enviado na ficha
// (PDF, imagem ou texto) e guarda o resultado. Cada laudo é lido uma única vez.

const TIPOS_SUPORTADOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'text/plain'];
const MAX_LAUDOS_POR_PACIENTE = 3;

const INSTRUCAO_EXTRACAO = `Você lê laudos e documentos clínicos para uma fisioterapeuta.
Extraia SOMENTE informações clínicas úteis para a fisioterapia, em português do Brasil, em tópicos curtos:
- Tipo de documento/exame e data (se houver)
- Diagnóstico ou hipótese diagnóstica (com CID se constar)
- Achados relevantes (ex.: imagem, testes, força, amplitude)
- Restrições, contraindicações ou recomendações médicas (ex.: carga permitida, repouso, cirurgia)
- Medicamentos citados
NÃO transcreva nome do paciente, CPF, RG, endereço, telefone, nome ou CRM de médicos.
Se o documento não tiver conteúdo clínico legível, responda apenas: "Sem conteúdo clínico legível."
No máximo 200 palavras.`;

export interface LaudoResumo {
  idDocumento: number;
  nomeArquivo: string;
  dataUpload: string;
  resumo?: string;
  erro?: string;
}

async function extrairUm(idDocumento: number, mime: string, base64: string): Promise<{ resumo?: string; erro?: string; modelo?: string }> {
  if (!TIPOS_SUPORTADOS.includes(mime)) return { erro: `Formato não suportado para leitura (${mime}).` };
  if (!base64) return { erro: 'Arquivo vazio.' };
  try {
    const parte = mime === 'text/plain'
      ? { text: Buffer.from(base64, 'base64').toString('utf8').slice(0, 20000) }
      : { inlineData: { mimeType: mime, data: base64 } };
    const r = await gerarResposta(INSTRUCAO_EXTRACAO, [{ role: 'user', parts: [parte, { text: 'Extraia os achados clínicos deste laudo.' }] }]);
    return { resumo: r.texto, modelo: r.modelo };
  } catch (err) {
    return { erro: err instanceof ErroIA ? err.message : 'Falha ao ler o laudo.' };
  }
}

/**
 * Garante que os laudos mais recentes do paciente foram lidos (lê os pendentes em paralelo)
 * e devolve os resumos. Sem IA habilitada, devolve apenas a lista de documentos.
 */
export async function lerLaudosPaciente(idPaciente: number): Promise<LaudoResumo[]> {
  const docs = await pool.query(
    `SELECT d.id_documento, d.nome_arquivo, d.tipo_arquivo, d.data_upload,
            e.resumo, e.erro, (e.id_documento IS NOT NULL) AS extraido
       FROM documento d
       LEFT JOIN copiloto_laudo_extracao e ON e.id_documento = d.id_documento
      WHERE d.id_paciente = $1
      ORDER BY d.data_upload DESC NULLS LAST, d.id_documento DESC
      LIMIT $2`,
    [idPaciente, MAX_LAUDOS_POR_PACIENTE],
  );
  const linhas = docs.rows as LinhaLaudo[];

  await garantirExtracoes(linhas);
  return paraResumo(linhas);
}

type LinhaLaudo = {
  id_documento: number; nome_arquivo: string; tipo_arquivo: string; data_upload: string;
  resumo: string | null; erro: string | null; extraido: boolean;
};

/** Lê com a IA (em paralelo) os laudos ainda não lidos, ou que falharam, e guarda o resultado. */
async function garantirExtracoes(linhas: LinhaLaudo[]): Promise<void> {
  if (!configIA().habilitada) return;
  const pendentes = linhas.filter((l) => !l.extraido || (l.erro && !l.resumo));
  await Promise.all(pendentes.map(async (l) => {
    const arq = await pool.query('SELECT conteudo_base64 FROM documento WHERE id_documento = $1', [l.id_documento]);
    const r = await extrairUm(l.id_documento, (l.tipo_arquivo || '').toLowerCase(), arq.rows[0]?.conteudo_base64 ?? '');
    await pool.query(
      `INSERT INTO copiloto_laudo_extracao (id_documento, resumo, erro, modelo, extraido_em)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id_documento) DO UPDATE SET resumo = EXCLUDED.resumo, erro = EXCLUDED.erro,
         modelo = EXCLUDED.modelo, extraido_em = NOW()`,
      [l.id_documento, r.resumo ?? null, r.erro ?? null, r.modelo ?? null],
    );
    l.resumo = r.resumo ?? null;
    l.erro = r.erro ?? null;
  }));
}

function paraResumo(linhas: LinhaLaudo[]): LaudoResumo[] {
  return linhas.map((l) => ({
    idDocumento: l.id_documento,
    nomeArquivo: l.nome_arquivo,
    dataUpload: l.data_upload ? new Date(l.data_upload).toLocaleDateString('pt-BR') : '',
    ...(l.resumo ? { resumo: l.resumo } : {}),
    ...(l.erro && !l.resumo ? { erro: l.erro } : {}),
  }));
}

// ─── Análise do laudo na solicitação de agendamento ─────────────
// Na triagem do pedido, a profissional vê um resumo do(s) laudo(s) anexado(s) e o que
// confirmar com o paciente antes da consulta. Laudos lidos ficam em cache (tabela);
// a análise final fica em memória enquanto os documentos do agendamento não mudarem.

const INSTRUCAO_ANALISE_AGENDAMENTO = `Você é um colega fisioterapeuta experiente ajudando a fisioterapeuta a avaliar um PEDIDO DE AGENDAMENTO, antes de confirmar a consulta.
Você recebe os achados extraídos do(s) laudo(s) anexado(s) pelo paciente, a observação que ele escreveu e alertas das regras de segurança da clínica.

Responda em português do Brasil, em Markdown simples, com exatamente estas seções:
### Resumo do laudo
3 a 5 tópicos curtos: tipo de documento, diagnóstico/hipótese (com CID se houver), achados principais e restrições médicas.
### Validar com o paciente
3 a 5 perguntas objetivas para confirmar antes ou no início da consulta (ex.: sintomas atuais, liberação médica, carga permitida, data da cirurgia, medicamentos, exames que faltam).
### Atenção
Só inclua esta seção se houver restrição, contraindicação, red flag ou algo que impeça/adiar o atendimento; caso contrário, omita.

Regras: não dê diagnóstico médico nem prescreva; não invente dados; os alertas das regras de segurança têm prioridade e devem aparecer em "Atenção". Não cite nome, CPF ou dados pessoais. No máximo 170 palavras.`;

const cacheAnalise = new Map<string, string>();

export class AgendamentoNaoEncontrado extends Error {}

export async function analisarLaudosAgendamento(idProfissional: number, idAgendamento: number) {
  const ag = await pool.query(
    'SELECT id_agendamento, id_paciente, observacoes FROM agendamento WHERE id_agendamento = $1 AND id_profissional = $2',
    [idAgendamento, idProfissional],
  );
  const agendamento = ag.rows[0] as { id_paciente: number; observacoes: string | null } | undefined;
  if (!agendamento) throw new AgendamentoNaoEncontrado('Agendamento nao encontrado');

  const docs = await pool.query(
    `SELECT d.id_documento, d.nome_arquivo, d.tipo_arquivo, d.data_upload,
            e.resumo, e.erro, (e.id_documento IS NOT NULL) AS extraido
       FROM documento d
       LEFT JOIN copiloto_laudo_extracao e ON e.id_documento = d.id_documento
      WHERE d.id_agendamento = $1 AND d.id_paciente = $2
      ORDER BY d.id_documento`,
    [idAgendamento, agendamento.id_paciente],
  );
  const linhas = docs.rows as LinhaLaudo[];
  const ia = configIA();
  if (!linhas.length || !ia.habilitada) {
    return { iaHabilitada: ia.habilitada, documentos: paraResumo(linhas), alertas: [] as unknown[] };
  }

  await garantirExtracoes(linhas);
  const lidos = linhas.filter((l) => l.resumo && !/^Sem conteúdo clínico legível/i.test(l.resumo));
  const observacao = (agendamento.observacoes ?? '').replace(/^\[Atendimento:[^\]]*\]\s*/, '').trim();

  // Regras de segurança sobre o conteúdo dos laudos + observação do paciente
  const regras = await analisarConsulta({
    ...(lidos.length ? { hfp: lidos.map((l) => l.resumo).join('\n') } : {}),
    ...(observacao ? { hfa: observacao } : {}),
  });
  const alertas = regras.triagem.alertas.map((a) => ({ severidade: a.severidade, descricao: a.descricao, conduta: a.conduta }));

  if (!lidos.length) {
    return { iaHabilitada: true, documentos: paraResumo(linhas), alertas, erro: 'Não consegui ler conteúdo clínico nos documentos anexados.' };
  }

  const chave = `${idAgendamento}:${linhas.map((l) => `${l.id_documento}-${l.resumo?.length ?? 0}`).join(',')}`;
  let analise = cacheAnalise.get(chave);
  let erro: string | undefined;
  if (!analise) {
    const prompt =
      `ACHADOS EXTRAÍDOS DO(S) LAUDO(S):\n${lidos.map((l) => `[${l.nome_arquivo}]\n${l.resumo}`).join('\n\n')}\n\n` +
      `OBSERVAÇÃO DO PACIENTE NO PEDIDO: ${observacao ? anonimizar(observacao) : '(nenhuma)'}\n\n` +
      `ALERTAS DAS REGRAS DE SEGURANÇA: ${alertas.length ? alertas.map((a) => `[${a.severidade}] ${a.descricao} — ${a.conduta}`).join('; ') : 'nenhum'}`;
    try {
      const r = await gerarResposta(INSTRUCAO_ANALISE_AGENDAMENTO, [{ role: 'user', parts: [{ text: prompt }] }]);
      analise = r.texto;
      cacheAnalise.set(chave, analise);
      if (cacheAnalise.size > 200) cacheAnalise.delete(cacheAnalise.keys().next().value!);
    } catch (err) {
      erro = err instanceof ErroIA ? err.message : 'Falha ao analisar o laudo.';
    }
  }
  return { iaHabilitada: true, documentos: paraResumo(linhas), alertas, ...(analise ? { analise } : {}), ...(erro ? { erro } : {}) };
}
