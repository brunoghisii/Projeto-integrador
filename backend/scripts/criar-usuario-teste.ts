// Cria (ou atualiza a senha de) um profissional e um paciente de teste.
// Usa as mesmas tabelas e o mesmo hash (bcrypt, custo 12) do cadastro/login.
//
// Uso: npm run criar-usuarios -- <senha> [email-profissional] [email-paciente]
//   ou: TESTE_SENHA=... npm run criar-usuarios

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../src/config/database.js';

const senha = process.argv[2] ?? process.env['TESTE_SENHA'];
const emailProfissional = process.argv[3] ?? process.env['TESTE_EMAIL_PROFISSIONAL'] ?? 'profissional.teste@clinica.local';
const emailPaciente = process.argv[4] ?? process.env['TESTE_EMAIL_PACIENTE'] ?? 'paciente.teste@clinica.local';

if (!senha || senha.length < 8) {
  console.error('Informe uma senha com no minimo 8 caracteres: npm run criar-usuarios -- <senha>');
  process.exit(1);
}

// CPFs validos de teste (nao pertencem a ninguem)
const usuarios = [
  { tabela: 'profissional', id: 'id_profissional', nome: 'Profissional Teste', cpf: '52998224725', email: emailProfissional },
  { tabela: 'paciente', id: 'id_paciente', nome: 'Paciente Teste', cpf: '11144477735', email: emailPaciente },
] as const;

const hash = await bcrypt.hash(senha, 12);

try {
  for (const u of usuarios) {
    const existe = await pool.query(`SELECT ${u.id} FROM ${u.tabela} WHERE email = $1`, [u.email]);
    if ((existe.rowCount ?? 0) > 0) {
      await pool.query(`UPDATE ${u.tabela} SET senha = $1 WHERE email = $2`, [hash, u.email]);
      console.log(`✓ ${u.tabela}: senha atualizada (${u.email})`);
    } else {
      await pool.query(
        `INSERT INTO ${u.tabela} (nome, cpf, nascimento, email, telefone, senha) VALUES ($1, $2, $3, $4, $5, $6)`,
        [u.nome, u.cpf, '1990-01-01', u.email, '11999999999', hash]
      );
      console.log(`✓ ${u.tabela}: criado (${u.email})`);
    }
  }
} catch (err) {
  console.error('Erro:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
