import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { jwtConfig } from '../config/jwt.js';
import { isValidEmail, isStrongPassword } from '../utils/validators.js';

interface RegisterData {
  nome: string;
  cpf: string;
  nascimento: string;
  email: string;
  telefone: string;
  senha: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  estado?: string;
}

function generateToken(id: number, email: string): string {
  return jwt.sign({ id, email }, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn,
  } as jwt.SignOptions);
}

export async function register(data: RegisterData) {
  if (!isValidEmail(data.email)) throw new Error('Email invalido');
  if (!isStrongPassword(data.senha)) throw new Error('Senha deve ter no minimo 8 caracteres');

  const exists = await pool.query(
    'SELECT id_profissional FROM profissional WHERE email = $1 OR cpf = $2',
    [data.email, data.cpf]
  );
  if ((exists.rowCount ?? 0) > 0) throw new Error('Email ou CPF ja cadastrado');

  const hash = await bcrypt.hash(data.senha, 12);

  const result = await pool.query(
    `INSERT INTO profissional
      (nome, cpf, nascimento, email, telefone, senha, cep, logradouro, numero, bairro, complemento, cidade, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id_profissional, nome, email`,
    [
      data.nome, data.cpf, data.nascimento, data.email, data.telefone, hash,
      data.cep ?? null, data.logradouro ?? null, data.numero ?? null,
      data.bairro ?? null, data.complemento ?? null, data.cidade ?? null, data.estado ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error('Erro ao criar profissional');

  const token = generateToken(row.id_profissional as number, row.email as string);
  return { profissional: { id: row.id_profissional, nome: row.nome, email: row.email }, token };
}

export async function login(email: string, senha: string) {
  if (!email || !senha) throw new Error('Email e senha sao obrigatorios');

  const result = await pool.query(
    'SELECT id_profissional, nome, email, senha FROM profissional WHERE email = $1',
    [email]
  );

  const row = result.rows[0];
  if (!row) throw new Error('Credenciais invalidas');

  const valid = await bcrypt.compare(senha, row.senha as string);
  if (!valid) throw new Error('Credenciais invalidas');

  const token = generateToken(row.id_profissional as number, row.email as string);
  return { profissional: { id: row.id_profissional, nome: row.nome, email: row.email }, token };
}

export async function verifyToken(token: string) {
  const decoded = jwt.verify(token, jwtConfig.secret) as { id: number; email: string };
  const result = await pool.query(
    'SELECT id_profissional, nome, email FROM profissional WHERE id_profissional = $1',
    [decoded.id]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Profissional nao encontrado');
  return { id: row.id_profissional, nome: row.nome, email: row.email };
}

export async function forgotPassword(email: string) {
  const result = await pool.query(
    'SELECT id_profissional FROM profissional WHERE email = $1',
    [email]
  );
  if ((result.rowCount ?? 0) === 0) throw new Error('Email nao encontrado');
  const row = result.rows[0];
  if (!row) throw new Error('Email nao encontrado');
  const resetToken = generateToken(row.id_profissional as number, email);
  return { resetToken };
}

export async function resetPassword(token: string, novaSenha: string) {
  if (!isStrongPassword(novaSenha)) throw new Error('Senha deve ter no minimo 8 caracteres');

  const decoded = jwt.verify(token, jwtConfig.secret) as { id: number; tipo?: string };
  if (decoded.tipo !== undefined) throw new Error('Token invalido');
  const hash = await bcrypt.hash(novaSenha, 12);

  await pool.query(
    'UPDATE profissional SET senha = $1 WHERE id_profissional = $2',
    [hash, decoded.id]
  );
}

export async function gerarTokenParaProfissional(profissionalId: number) {
  if (!profissionalId || profissionalId <= 0) throw new Error('ID do profissional invalido');

  const result = await pool.query(
    'SELECT id_profissional, nome, email FROM profissional WHERE id_profissional = $1',
    [profissionalId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Profissional nao encontrado');

  const token = generateToken(row.id_profissional as number, row.email as string);
  return { profissional: { id: row.id_profissional, nome: row.nome, email: row.email }, token };
}


