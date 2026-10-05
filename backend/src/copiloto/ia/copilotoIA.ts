import type { ResultadoAnalise } from '../raciocinio/raciocinioEngine.js';
import { anonimizar, configIA, ErroIA, gerarResposta, type Conteudo } from './geminiClient.js';

export interface ResultadoIA {
  resposta?: string;
  modelo?: string;
  erro?: string;
}

/** Uma mensagem da fisioterapeuta e, se já houver, a resposta que a IA deu a ela. */
export interface TurnoConversa {
  texto: string;
  resposta?: string;
}

const INSTRUCAO_SISTEMA = `Você é o Auxiliar de Casos: um colega fisioterapeuta experiente que conversa com a fisioterapeuta responsável sobre os casos dela, num chat.

Tom e estilo:
- Acolhedor e colegial, como numa conversa entre colegas de clínica. Se souber o nome dela, use o primeiro nome de vez em quando (sem exagero, não em toda resposta).
- Linguagem clara, frases curtas, sem soar robótico e sem jargão desnecessário.
- Seja objetivo: em geral até ~180 palavras. Vá direto ao ponto e acrescente raciocínio; não repita a análise inteira.
- Formate em Markdown simples: **negrito** para o essencial, listas curtas com "-", e títulos "### " só quando a resposta tiver mais de uma parte.
- É uma conversa contínua: use o que já foi dito nas mensagens anteriores. Perguntas de acompanhamento (ex.: "e se ela tiver hérnia?") se referem ao mesmo caso; não peça para repetir o caso.
- Quando fizer sentido, termine com UMA pergunta curta de acompanhamento (ex.: "Quer que eu sugira uma progressão para a próxima sessão?").

Regras obrigatórias (rigor técnico e segurança):
1. A seção ANÁLISE DO SISTEMA foi gerada por regras de segurança e pelos datasets validados da clínica. Ela TEM PRIORIDADE sobre você.
   - Nunca sugira um procedimento marcado como CONTRAINDICADO e nunca minimize uma red flag.
   - Se houver red flag CRÍTICA, comece a resposta reforçando o encaminhamento, com clareza e sem alarmismo.
2. Só cite procedimentos do catálogo fornecido, pelo nome e código (ex.: P008). Se algo útil não estiver no catálogo, diga que "não consta no dataset".
3. Use a CBDF (sistemas D01–D10, qualificadores 0–4, 8, 9) ao falar de diagnóstico fisioterapêutico.
4. Não dê diagnóstico médico, não prescreva medicamentos e não invente dados do paciente. Se faltar informação, pergunte.
5. Se houver FICHA DO PACIENTE, use-a (idade, observações, consultas e sessões anteriores) para personalizar a orientação.
6. Você é apoio à decisão clínica: a decisão final é sempre da fisioterapeuta. Deixe isso claro de forma natural quando a resposta envolver conduta (uma frase curta basta, não repita em toda mensagem).`;

function resumoAnalise(a: ResultadoAnalise): string {
  const linhas: string[] = [];
  linhas.push(`Status de triagem: ${a.triagem.status}`);
  for (const al of a.triagem.alertas) {
    linhas.push(`RED FLAG [${al.severidade}] ${al.descricao} — conduta: ${al.conduta}`);
  }
  if (a.triagem.termosNegados.length) {
    linhas.push(`Negado pelo paciente: ${[...new Set(a.triagem.termosNegados.map((t) => t.termo))].join(', ')}`);
  }
  for (const c of a.condicoesClinicas) {
    linhas.push(`CONDIÇÃO ${c.id} ${c.nome} (CID ${c.cid10}). Avaliação: ${c.avaliacao.join('; ')}. ` +
      `Precauções: ${c.precaucoes.join('; ')}. Metas: ${c.metas.join('; ')}. Encaminhar se: ${c.encaminharSe.join('; ')}.`);
  }
  for (const q of a.quadros) {
    const causas = q.possiveisCausas.map((c) => `${c.causa}${c.sustentada ? ' [sustentada pelo relato]' : ''}`).join('; ');
    linhas.push(`QUADRO ${q.nome} (CBDF: ${q.sistemaCbdf}). Possíveis causas: ${causas}. ` +
      `Perguntas pendentes: ${q.perguntasPendentes.join('; ') || 'nenhuma'}. Testes: ${q.testes.join('; ')}.`);
  }
  if (a.condicoesDetectadas.length) linhas.push(`Condições que afetam contraindicações: ${a.condicoesDetectadas.join(', ')}`);
  linhas.push('CATÁLOGO DE PROCEDIMENTOS RELEVANTES:');
  for (const p of a.procedimentos) {
    linhas.push(`- ${p.id} ${p.nome} → ${p.status}${p.motivos.length ? ` (${p.motivos.join('; ')})` : ''}. Escalas: ${p.escalas.join(', ')}.`);
  }
  return linhas.join('\n');
}

/**
 * Monta os turnos anteriores como conversa real (user/model), para o Gemini entender
 * perguntas de acompanhamento. Mensagens seguidas sem resposta viram um único turno.
 */
function turnosAnteriores(anteriores: TurnoConversa[]): Conteudo[] {
  const conteudos: Conteudo[] = [];
  for (const t of anteriores) {
    const texto = anonimizar(t.texto);
    const ultimo = conteudos[conteudos.length - 1];
    if (ultimo && ultimo.role === 'user') ultimo.parts.push({ text: texto });
    else conteudos.push({ role: 'user', parts: [{ text: texto }] });
    if (t.resposta) conteudos.push({ role: 'model', parts: [{ text: t.resposta }] });
  }
  return conteudos;
}

/**
 * Gera a resposta da IA para a conversa. Nunca lança: em falha, retorna { erro },
 * e o copiloto por regras continua funcionando normalmente.
 * `mensagens` aceita só os textos (sem respostas) ou os turnos com as respostas anteriores.
 */
export async function responderComIA(
  mensagens: Array<string | TurnoConversa>,
  analise: ResultadoAnalise,
  fichaPaciente?: string,
  pedidoPersonalizado?: string,
  nomeProfissional?: string,
): Promise<ResultadoIA | undefined> {
  const cfg = configIA();
  if (!cfg.habilitada) return undefined;

  const turnos = mensagens.map((m) => (typeof m === 'string' ? { texto: m } : m));
  const atual = turnos.length ? anonimizar(turnos[turnos.length - 1]!.texto) : '';
  const pedido = pedidoPersonalizado
    ?? (atual
      ? `NOVA MENSAGEM DA FISIOTERAPEUTA:\n${atual}`
      : 'NOVA SOLICITAÇÃO: o paciente acabou de ser encaminhado para atendimento. Com base na ficha e na análise, ' +
        'dê a orientação inicial: o que priorizar na avaliação de hoje, cuidados e como seguir.');
  const prompt =
    (nomeProfissional ? `Você está conversando com a fisioterapeuta ${nomeProfissional}.\n\n` : '') +
    (fichaPaciente ? `FICHA DO PACIENTE (sem identificação):\n${anonimizar(fichaPaciente)}\n\n` : '') +
    `${pedido}\n\n` +
    `ANÁLISE DO SISTEMA (regras + datasets, prioridade máxima — considera a conversa inteira):\n${resumoAnalise(analise)}`;

  const conteudos = turnosAnteriores(turnos.slice(0, -1));
  const ultimo = conteudos[conteudos.length - 1];
  // A API exige alternância: se o último turno anterior ficou sem resposta, junta ao pedido atual.
  if (ultimo && ultimo.role === 'user') ultimo.parts.push({ text: prompt });
  else conteudos.push({ role: 'user', parts: [{ text: prompt }] });

  try {
    const r = await gerarResposta(INSTRUCAO_SISTEMA, conteudos);
    return { resposta: r.texto, modelo: r.modelo };
  } catch (err) {
    const msg = err instanceof ErroIA ? err.message : 'Falha inesperada ao consultar a IA.';
    if (!(err instanceof ErroIA)) console.error('[Copiloto IA]', err);
    return { erro: msg };
  }
}
