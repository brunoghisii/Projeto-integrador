import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { redFlagsMiddleware } from '../middleware/redFlags.js';
import { errorResponse, successResponse } from '../utils/helpers.js';
import { analisarConsulta } from '../copiloto/raciocinio/raciocinioEngine.js';
import type { AnamneseInput, ContextoPaciente } from '../copiloto/redFlags/types.js';
import { configIA } from '../copiloto/ia/geminiClient.js';
import {
  ConversaNaoEncontrada,
  PacienteNaoEncontrado,
  enviarMensagem,
  excluirConversa,
  gerarRespostaIA,
  iniciarAtendimentoPaciente,
  listarConversas,
  obterConversa,
  obterResumoPaciente,
} from '../copiloto/historico/historicoService.js';
import { gerarPlano, obterPlano } from '../copiloto/historico/planoService.js';
import { AgendamentoNaoEncontrado, analisarLaudosAgendamento } from '../copiloto/historico/laudoService.js';

const router = Router();

router.use(authMiddleware);

// Triagem pura: sempre retorna 200 com o resultado (a UI decide como exibir).
router.post('/anamnese/triagem', redFlagsMiddleware('anotar'), (req, res) => {
  const r = req.triagemRedFlags!;
  const mensagem =
    r.status === 'LIBERADO' ? 'Nenhuma red flag detectada' : `${r.totalAlertas} alerta(s) detectado(s)`;
  res.status(200).json(successResponse(r, mensagem));
});

// Análise completa: red flags + possíveis causas + procedimentos do dataset + próximos passos.
// Usa o modo "anotar": com red flag crítica a análise ainda responde, mas já prioriza o encaminhamento.
router.post('/analise', redFlagsMiddleware('anotar'), async (req, res, next) => {
  try {
    const analise = await analisarConsulta(req.body as AnamneseInput);
    res.status(200).json(successResponse(analise, 'Analise realizada'));
  } catch (err) {
    next(err);
  }
});

// Estado da IA generativa, para a tela exibir o selo do Auxiliar de Casos.
router.get('/status', (_req, res) => {
  const cfg = configIA();
  res.json(successResponse({
    ia: { habilitada: cfg.habilitada, provedor: 'Google Gemini', modelo: cfg.modelo, motivo: cfg.motivoDesabilitada ?? null },
  }));
});

// ─── Histórico de conversas ────────────────────────────────────────

function tratarErroConversa(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof ConversaNaoEncontrada) {
    res.status(404).json(errorResponse(err.message, 'CONVERSA_NAO_ENCONTRADA'));
    return;
  }
  if (err instanceof PacienteNaoEncontrado) {
    res.status(404).json(errorResponse(err.message, 'PACIENTE_NAO_ENCONTRADO'));
    return;
  }
  if (err instanceof Error && /Mensagem (vazia|excede)/.test(err.message)) {
    res.status(400).json(errorResponse(err.message, 'MENSAGEM_INVALIDA'));
    return;
  }
  next(err);
}

function idParam(req: Request): number | null {
  const id = Number(req.params['id']);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/conversas', async (req, res, next) => {
  try {
    res.json(successResponse(await listarConversas(req.profissional!.id)));
  } catch (err) { next(err); }
});

router.get('/conversas/:id', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    const conversa = await obterConversa(id, req.profissional!.id);
    const paciente = conversa.id_paciente ? await obterResumoPaciente(conversa.id_paciente) : null;
    res.json(successResponse({ ...conversa, paciente }));
  } catch (err) { tratarErroConversa(err, res, next); }
});

// Abre um atendimento para um paciente cadastrado e devolve a orientação inicial da ficha.
router.post('/pacientes/:id/atendimento', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    res.json(successResponse(await iniciarAtendimentoPaciente(req.profissional!.id, id), 'Atendimento iniciado'));
  } catch (err) { tratarErroConversa(err, res, next); }
});

// Orientação de conduta do paciente (anotações da profissional + laudos + histórico).
router.get('/pacientes/:id/plano', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    res.json(successResponse(await obterPlano(id)));
  } catch (err) { tratarErroConversa(err, res, next); }
});

router.post('/pacientes/:id/plano', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  const { anotacoes } = (req.body ?? {}) as { anotacoes?: unknown };
  if (anotacoes !== undefined && anotacoes !== null && typeof anotacoes !== 'string') {
    res.status(400).json(errorResponse('Campo "anotacoes" deve ser texto', 'ANOTACOES_INVALIDAS'));
    return;
  }
  try {
    res.json(successResponse(await gerarPlano(req.profissional!.id, id, anotacoes ?? undefined), 'Orientacao gerada'));
  } catch (err) { tratarErroConversa(err, res, next); }
});

// Resumo do(s) laudo(s) anexado(s) a um pedido de agendamento + o que validar com o paciente.
router.get('/agendamentos/:id/laudo', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    res.json(successResponse(await analisarLaudosAgendamento(req.profissional!.id, id)));
  } catch (err) {
    if (err instanceof AgendamentoNaoEncontrado) { res.status(404).json(errorResponse(err.message, 'AGENDAMENTO_NAO_ENCONTRADO')); return; }
    next(err);
  }
});

// Etapa 2 da resposta: IA generativa para uma mensagem já analisada.
router.post('/conversas/:id/mensagens/:mid/ia', async (req, res, next) => {
  const id = idParam(req);
  const mid = Number(req.params['mid']);
  if (!id || !Number.isInteger(mid) || mid <= 0) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    res.json(successResponse(await gerarRespostaIA(req.profissional!.id, id, mid)));
  } catch (err) { tratarErroConversa(err, res, next); }
});

router.delete('/conversas/:id', async (req, res, next) => {
  const id = idParam(req);
  if (!id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  try {
    await excluirConversa(id, req.profissional!.id);
    res.json(successResponse(null, 'Conversa excluida'));
  } catch (err) { tratarErroConversa(err, res, next); }
});

// Envia mensagem. Sem :id cria uma conversa nova; com :id continua a existente.
async function handlerMensagem(req: Request, res: Response, next: NextFunction) {
  const id = req.params['id'] === undefined ? null : idParam(req);
  if (req.params['id'] !== undefined && !id) { res.status(400).json(errorResponse('Id invalido', 'ID_INVALIDO')); return; }
  const { texto, contexto } = (req.body ?? {}) as { texto?: unknown; contexto?: unknown };
  if (typeof texto !== 'string') { res.status(400).json(errorResponse('Campo "texto" obrigatorio', 'MENSAGEM_INVALIDA')); return; }
  if (contexto !== undefined && (typeof contexto !== 'object' || contexto === null)) {
    res.status(400).json(errorResponse('Campo "contexto" deve ser um objeto', 'MENSAGEM_INVALIDA'));
    return;
  }
  try {
    const r = await enviarMensagem(req.profissional!.id, id, texto, (contexto ?? {}) as ContextoPaciente);
    res.json(successResponse(r, 'Mensagem analisada'));
  } catch (err) { tratarErroConversa(err, res, next); }
}
router.post('/conversas/mensagens', handlerMensagem);
router.post('/conversas/:id/mensagens', handlerMensagem);

// Exemplo de rota protegida pelo gate: só chega aqui sem red flag crítica
// (ou com o alerta reconhecido). Aqui entrará a chamada ao microserviço Python (RAG).
router.post('/sugestoes', redFlagsMiddleware('gate'), (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Integracao com o motor RAG ainda nao implementada',
    error: 'NOT_IMPLEMENTED',
    data: { triagem: req.triagemRedFlags },
    timestamp: new Date().toISOString(),
  });
});

export default router;
