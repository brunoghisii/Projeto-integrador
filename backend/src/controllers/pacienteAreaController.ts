import type { Request, Response } from 'express';
import * as pacienteAreaService from '../services/pacienteAreaService.js';
import * as documentoService from '../services/documentoService.js';
import * as sessaoService from '../services/sessaoService.js';
import { successResponse, errorResponse } from '../utils/helpers.js';
import * as profissionalService from '../services/profissionalService.js';

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.getMe(id);
    res.status(200).json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(404).json(errorResponse(msg, 'NOT_FOUND'));
  }
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.updateMe(id, req.body as Record<string, unknown>);
    res.status(200).json(successResponse(data, 'Perfil atualizado com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'UPDATE_ERROR'));
  }
}

export async function deleteMe(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    await pacienteAreaService.deleteMe(id);
    res.status(200).json(successResponse(null, 'Conta excluida com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'DELETE_ERROR'));
  }
}

export async function getCpfComSenha(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const { senha } = req.body as { senha?: string };
    if (!senha) {
      res.status(400).json(errorResponse('Senha obrigatoria', 'VALIDATION_ERROR'));
      return;
    }
    const cpf = await pacienteAreaService.verificarSenhaEObterCpf(id, senha);
    res.status(200).json(successResponse({ cpf }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'AUTH_ERROR'));
  }
}

export async function getDisponibilidade(_req: Request, res: Response): Promise<void> {
  try {
    const data = await pacienteAreaService.getDisponibilidade();
    res.status(200).json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function getAgendamentos(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.getAgendamentos(id);
    res.status(200).json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function createAgendamento(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.createAgendamento(id, req.body as { data_consulta: string; horario: string; observacoes?: string; id_profissional?: number });
    res.status(201).json(successResponse(data, 'Solicitacao enviada com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'CREATE_ERROR'));
  }
}

export async function cancelarAgendamento(req: Request, res: Response): Promise<void> {
  try {
    const pacienteId = req.paciente!.id;
    const id = Number(req.params['id']);
    await pacienteAreaService.cancelarAgendamento(id, pacienteId);
    res.status(200).json(successResponse(null, 'Agendamento cancelado'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'CANCEL_ERROR'));
  }
}

export async function getHistorico(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.getHistorico(id);
    res.status(200).json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function getFinanceiro(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const data = await pacienteAreaService.getFinanceiro(id);
    res.status(200).json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function listarDocumentos(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const docs = await documentoService.listarPorPaciente(id);
    res.status(200).json(successResponse(docs));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function uploadDocumento(req: Request, res: Response): Promise<void> {
  try {
    const id = req.paciente!.id;
    const { id_agendamento, nome_arquivo, tipo_arquivo, tamanho_bytes, conteudo_base64 } = req.body as {
      id_agendamento?: number;
      nome_arquivo: string;
      tipo_arquivo: string;
      tamanho_bytes: number;
      conteudo_base64: string;
    };
    if (!nome_arquivo || !conteudo_base64) {
      res.status(400).json(errorResponse('nome_arquivo e conteudo_base64 sao obrigatorios', 'VALIDATION_ERROR'));
      return;
    }
    if (tamanho_bytes > 5 * 1024 * 1024) {
      res.status(400).json(errorResponse('Arquivo muito grande. Maximo 5MB.', 'FILE_TOO_LARGE'));
      return;
    }
    const doc = await documentoService.criar({ id_paciente: id, id_agendamento, nome_arquivo, tipo_arquivo, tamanho_bytes, conteudo_base64 });
    res.status(201).json(successResponse(doc, 'Documento enviado com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'UPLOAD_ERROR'));
  }
}

export async function deletarDocumento(req: Request, res: Response): Promise<void> {
  try {
    const pacienteId = req.paciente!.id;
    const id = Number(req.params['id']);
    const ok = await documentoService.deletar(id, pacienteId);
    if (!ok) {
      res.status(404).json(errorResponse('Documento nao encontrado', 'NOT_FOUND'));
      return;
    }
    res.status(200).json(successResponse(null, 'Documento removido'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'DELETE_ERROR'));
  }
}

export async function reenviarSolicitacao(req: Request, res: Response): Promise<void> {
  try {
    const pacienteId = req.paciente!.id;
    const id = Number(req.params['id']);
    const { observacoes } = req.body as { observacoes?: string };
    const result = await pacienteAreaService.reenviarSolicitacao(id, pacienteId, observacoes);
    res.status(200).json(successResponse(result, 'Solicitação reenviada com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'REENVIO_ERROR'));
  }
}

export async function getSessoes(req: Request, res: Response): Promise<void> {
  try {
    const pacienteId = req.paciente!.id;
    const sessoes = await sessaoService.listarPorPacienteParaPaciente(pacienteId);
    res.status(200).json(successResponse(sessoes));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function getClinica(req: Request, res: Response): Promise<void> {
  try {
    console.log("=== BUSCANDO DADOS DA CLÍNICA DA DRA. LUANA (ID 2) ===");

    // CORRIGIDO: Agora com os dois "s" corretos combinando com o import do topo!
    const profissional = await profissionalService.findById(2);

    // Retorna os dados reais da Luana para o paciente
    res.status(200).json(successResponse(profissional));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao buscar dados da clínica';
    console.error("ERRO NO CONTROLADOR:", msg);
    res.status(404).json(errorResponse(msg, 'NOT_FOUND'));
  }
}