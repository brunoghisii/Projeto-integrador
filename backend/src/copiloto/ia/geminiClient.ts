// Cliente da Gemini API (REST) para o Auxiliar de Casos.
//
// Termos de uso: https://ai.google.dev/gemini-api/terms — não enviar dados pessoais/sensíveis
// nos serviços não pagos (por isso o texto é anonimizado antes do envio).
// A IA só é ligada com COPILOTO_IA_HABILITADA=true e GEMINI_API_KEY configurada.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = Number(process.env['GEMINI_TIMEOUT_MS']) || 30_000;

export interface ConfigIA {
  habilitada: boolean;
  modelo: string;
  motivoDesabilitada?: string;
}

export function configIA(): ConfigIA {
  // Aliases "-latest" apontam para a versão estável mais recente (versões fixas são descontinuadas).
  // Flash-Lite como principal: mais rápido e com cota maior no plano gratuito.
  const modelo = process.env['GEMINI_MODEL'] || 'gemini-flash-lite-latest';
  if (process.env['COPILOTO_IA_HABILITADA'] !== 'true') {
    return { habilitada: false, modelo, motivoDesabilitada: 'COPILOTO_IA_HABILITADA não está ativo no backend/.env.' };
  }
  if (!process.env['GEMINI_API_KEY']) {
    return { habilitada: false, modelo, motivoDesabilitada: 'GEMINI_API_KEY não configurada no backend/.env.' };
  }
  return { habilitada: true, modelo };
}

/** Remove identificadores antes de enviar para fora (CPF, telefone, e-mail, datas de nascimento). */
export function anonimizar(texto: string): string {
  return texto
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[TELEFONE]')
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, '[DATA]');
}

/** Texto ou arquivo embutido (PDF/imagem de laudo, em base64). */
export type ParteConteudo = { text: string } | { inlineData: { mimeType: string; data: string } };
export interface Conteudo { role: 'user' | 'model'; parts: ParteConteudo[] }

export interface RespostaIA {
  texto: string;
  modelo: string;
}

export class ErroIA extends Error {}

export async function gerarResposta(instrucaoSistema: string, conteudos: Conteudo[]): Promise<RespostaIA> {
  const cfg = configIA();
  if (!cfg.habilitada) throw new ErroIA(cfg.motivoDesabilitada ?? 'IA desabilitada');

  // Nível de raciocínio ("thinking") por modelo. Medições: Flash padrão ≈ 10 s, Flash "low" ≈ 2,7 s,
  // Flash-Lite sem thinking ≈ 1,7 s. Vazio = não envia o parâmetro (padrão do modelo).
  const nivelPrincipal = process.env['GEMINI_THINKING_LEVEL'] ?? '';
  const nivelReserva = process.env['GEMINI_THINKING_LEVEL_RESERVA'] ?? 'low';

  const chamar = (modelo: string, nivel: string) => fetch(`${API_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env['GEMINI_API_KEY']!,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instrucaoSistema }] },
      contents: conteudos,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        ...(nivel ? { thinkingConfig: { thinkingLevel: nivel } } : {}),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // Ordem de tentativas: principal → reserva → principal de novo.
  // Sobrecarga (503) ou limite por minuto (429) passa para a próxima tentativa rapidamente.
  const reserva = process.env['GEMINI_MODEL_RESERVA'] || 'gemini-flash-latest';
  const tentativas: { modelo: string; nivel: string; espera: number }[] = [
    { modelo: cfg.modelo, nivel: nivelPrincipal, espera: 0 },
    { modelo: reserva, nivel: nivelReserva, espera: 300 },
    { modelo: cfg.modelo, nivel: nivelPrincipal, espera: 1500 },
  ];
  const sobrecarga = (s: number) => s === 503 || s === 429;

  let resp!: Response;
  let modeloUsado = cfg.modelo;
  try {
    for (const t of tentativas) {
      modeloUsado = t.modelo;
      if (t.espera) await new Promise((r) => setTimeout(r, t.espera));
      resp = await chamar(t.modelo, t.nivel);
      // Modelo que não aceita thinkingConfig responde 400: repete sem o parâmetro.
      if (resp.status === 400 && t.nivel) resp = await chamar(t.modelo, '');
      if (!sobrecarga(resp.status)) break;
    }
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de conexão';
    throw new ErroIA(`Gemini indisponível (${msg}).`);
  }

  const corpo = (await resp.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; status?: string };
  } | null;

  if (!resp.ok) {
    // Não repassa a mensagem crua (pode conter detalhes da chave/conta); só o status.
    const status = corpo?.error?.status ?? resp.status;
    const dica: Record<string, string> = {
      NOT_FOUND: ' Modelo indisponível: ajuste GEMINI_MODEL no .env.',
      UNAVAILABLE: ' O Google está com alta demanda; tente de novo em instantes.',
      RESOURCE_EXHAUSTED: ' Limite do plano gratuito atingido; aguarde alguns minutos.',
      PERMISSION_DENIED: ' Verifique a GEMINI_API_KEY.',
    };
    throw new ErroIA(`Gemini retornou erro (${status}).${dica[String(status)] ?? ''}`);
  }
  if (corpo?.promptFeedback?.blockReason) {
    throw new ErroIA(`Gemini bloqueou a solicitação (${corpo.promptFeedback.blockReason}).`);
  }
  const texto = corpo?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!texto) throw new ErroIA('Gemini não retornou texto.');
  return { texto, modelo: modeloUsado };
}
