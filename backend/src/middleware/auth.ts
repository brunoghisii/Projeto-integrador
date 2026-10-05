import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtConfig } from '../config/jwt.js';

export interface JwtPayload {
  id: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      profissional?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Token de autenticacao nao fornecido',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Token invalido',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtConfig.secret) as JwtPayload & { tipo?: string };
    // Tokens de profissional nao tem "tipo"; os de paciente (e de redefinicao de senha) tem.
    if (decoded.tipo !== undefined) throw new Error('Token nao e de profissional');
    req.profissional = decoded;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Token invalido ou expirado',
      error: 'INVALID_TOKEN',
      timestamp: new Date().toISOString(),
    });
  }
}
