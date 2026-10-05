import type { Request, Response } from 'express';
import * as agendamentosService from '../services/agendamentosService.js';
import { successResponse, errorResponse } from '../utils/helpers.js';

export async function getAll(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const { data, status } = req.query as { data?: string; status?: string };
    const result = await agendamentosService.findAll(profissionalId, data, status);
    res.status(200).json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params['id']);
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.findById(id, profissionalId);
    res.status(200).json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(404).json(errorResponse(msg, 'NOT_FOUND'));
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.create(
      req.body as Parameters<typeof agendamentosService.create>[0],
      profissionalId
    );
    res.status(201).json(successResponse(result, 'Consulta agendada com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'CREATE_ERROR'));
  }
}

export async function updateById(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params['id']);
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.update(id, req.body as Record<string, unknown>, profissionalId);
    res.status(200).json(successResponse(result, 'Agendamento atualizado'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'UPDATE_ERROR'));
  }
}

export async function cancelar(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params['id']);
    const profissionalId = req.profissional!.id;
    await agendamentosService.cancelar(id, profissionalId);
    res.status(200).json(successResponse(null, 'Agendamento cancelado'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(404).json(errorResponse(msg, 'NOT_FOUND'));
  }
}

export async function getCalendario(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const { mes, ano } = req.query as { mes?: string; ano?: string };
    const result = await agendamentosService.getCalendario(profissionalId, mes, ano);
    res.status(200).json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function confirmar(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params['id']);
    const profissionalId = req.profissional!.id;
    await agendamentosService.confirmar(id, profissionalId);
    res.status(200).json(successResponse(null, 'Consulta confirmada'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'CONFIRM_ERROR'));
  }
}

export async function getSlotsParaData(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const { data } = req.query as { data?: string };
    if (!data) { res.status(400).json(errorResponse('Parâmetro data obrigatório', 'VALIDATION')); return; }
    const result = await agendamentosService.getSlotsParaData(profissionalId, data);
    res.status(200).json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function reagendar(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.reagendar(
      req.body as Parameters<typeof agendamentosService.reagendar>[0],
      profissionalId
    );
    res.status(201).json(successResponse(result, 'Consulta reagendada com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'REAGENDAR_ERROR'));
  }
}

export async function finalizar(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params['id']);
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.finalizar(
      id,
      req.body as Parameters<typeof agendamentosService.finalizar>[1],
      profissionalId
    );
    res.status(200).json(successResponse(result, 'Consulta finalizada com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'FINALIZE_ERROR'));
  }
}

export async function getDisponibilidade(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.getDisponibilidade(profissionalId);
    res.status(200).json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(500).json(errorResponse(msg, 'SERVER_ERROR'));
  }
}

export async function addDisponibilidade(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const result = await agendamentosService.addDisponibilidade(
      profissionalId,
      req.body as { data: string; horario: string; vagas: number; servico?: string }
    );
    res.status(201).json(successResponse(result, 'Horario publicado com sucesso'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(400).json(errorResponse(msg, 'CREATE_ERROR'));
  }
}

export async function removeDisponibilidade(req: Request, res: Response): Promise<void> {
  try {
    const profissionalId = req.profissional!.id;
    const id = Number(req.params['id']);
    await agendamentosService.removeDisponibilidade(id, profissionalId);
    res.status(200).json(successResponse(null, 'Horario removido'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    res.status(404).json(errorResponse(msg, 'NOT_FOUND'));
  }
}
