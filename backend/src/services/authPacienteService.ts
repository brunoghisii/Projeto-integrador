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
  return jwt.sign({ id, email, tipo: 'paciente' }, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn,
  } as jwt.SignOptions);
}

export async function register(data: RegisterData) {
  if (!isValidEmail(data.email)) throw new Error('Email invalido');
  if (!isStrongPassword(data.senha)) throw new Error('Senha deve ter no minimo 8 caracteres');

  const exists = await pool.query(
    'SELECT id_paciente FROM paciente WHERE email = $1 OR cpf = $2',
    [data.email, data.cpf]
  );
  if ((exists.rowCount ?? 0) > 0) throw new Error('Email ou CPF ja cadastrado');

  const hash = await bcrypt.hash(data.senha, 12);

  const result = await pool.query(
    `INSERT INTO paciente (nome, cpf, nascimento, email, telefone, senha, cep, logradouro, numero, bairro, complemento, cidade, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id_paciente, nome, email`,
    [
      data.nome, data.cpf, data.nascimento, data.email, data.telefone, hash,
      data.cep ?? null, data.logradouro ?? null, data.numero ?? null,
      data.bairro ?? null, data.complemento ?? null, data.cidade ?? null, data.estado ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error('Erro ao criar paciente');

  const token = generateToken(row.id_paciente as number, row.email as string);
  return { paciente: { id: row.id_paciente, nome: row.nome, email: row.email }, token };
}

export async function login(email: string, senha: string) {
  if (!email || !senha) throw new Error('Email e senha sao obrigatorios');

  const result = await pool.query(
    'SELECT id_paciente, nome, email, senha FROM paciente WHERE email = $1',
    [email]
  );

  const row = result.rows[0];
  if (!row) throw new Error('Credenciais invalidas');

  const valid = await bcrypt.compare(senha, row.senha as string);
  if (!valid) throw new Error('Credenciais invalidas');

  const token = generateToken(row.id_paciente as number, row.email as string);
  return { paciente: { id: row.id_paciente, nome: row.nome, email: row.email }, token };
}

// ─── Recuperação de senha ───────────────────────────────────────
// O token de redefinição tem tipo próprio (não serve para login) e carrega um pedaço
// do hash da senha atual: depois que a senha muda, o link deixa de valer (uso único).

const RESET_EXPIRA = '30m';

function marcaSenha(hash: string): string {
  return hash.slice(-12);
}

/** Gera o link de redefinição. Retorna null se o e-mail não existir (a rota responde igual nos dois casos). */
export async function solicitarRedefinicaoSenha(email: string) {
  if (!email || !isValidEmail(email)) throw new Error('Email invalido');
  const r = await pool.query('SELECT id_paciente, nome, email, senha FROM paciente WHERE email = $1', [email.trim()]);
  const row = r.rows[0];
  if (!row) return null;
  const token = jwt.sign(
    { id: row.id_paciente, tipo: 'reset-paciente', v: marcaSenha(row.senha as string) },
    jwtConfig.secret,
    { expiresIn: RESET_EXPIRA } as jwt.SignOptions,
  );
  return { token, nome: String(row.nome).split(' ')[0] ?? '', email: row.email as string };
}

export async function redefinirSenha(token: string, novaSenha: string) {
  if (!token) throw new Error('Link invalido ou expirado');
  if (!novaSenha || !isStrongPassword(novaSenha)) throw new Error('Senha deve ter no minimo 8 caracteres');

  let decoded: { id: number; tipo: string; v: string };
  try {
    decoded = jwt.verify(token, jwtConfig.secret) as typeof decoded;
  } catch {
    throw new Error('Link invalido ou expirado');
  }
  if (decoded.tipo !== 'reset-paciente') throw new Error('Link invalido ou expirado');

  const r = await pool.query('SELECT senha FROM paciente WHERE id_paciente = $1', [decoded.id]);
  const row = r.rows[0];
  if (!row || marcaSenha(row.senha as string) !== decoded.v) throw new Error('Link invalido ou expirado');

  const hash = await bcrypt.hash(novaSenha, 12);
  await pool.query('UPDATE paciente SET senha = $1 WHERE id_paciente = $2', [hash, decoded.id]);
}
