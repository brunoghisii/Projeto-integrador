import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import mfaRoutes from './routes/mfa.js';
import authPacienteRoutes from './routes/authPaciente.js';
import pacienteAreaRoutes from './routes/pacienteArea.js';
import profesionalRoutes from './routes/profissional.js';
import pacientesRoutes from './routes/pacientes.js';
import agendamentosRoutes from './routes/agendamentos.js';
import financeiroRoutes from './routes/financeiro.js';
import relatoriosRoutes from './routes/relatorios.js';
import solicitacoesRoutes from './routes/solicitacoes.js';
import historicoRoutes from './routes/historico.js';
import documentosRoutes from './routes/documentos.js';
import consultasRoutes from './routes/consultas.js';
import sessaoRoutes from './routes/sessao.js';
import tramitesRoutes from './routes/tramites.js';
import copilotoRoutes from './routes/copiloto.js';
import { errorHandler } from './middleware/errorHandler.js';
import { runMigrations } from './config/migrations.js';
import { sincronizarDataset } from './copiloto/procedimentos/procedimentosRepo.js';
import { limparSlotsExpirados } from './services/agendamentosService.js';

const app = express();
// Atras do tunel Cloudflare: confia no X-Forwarded-For do primeiro proxy (exigido pelo express-rate-limit)
app.set('trust proxy', 1);

const corsOrigins = process.env['CORS_ORIGIN']?.split(',').map((o) => o.trim()).filter(Boolean)
  ?? ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));

// Frontend estatico servido pelo proprio backend (mesma origem que a API).
// Resolve caminhos sem diferenciar maiusculas/acentos, pois os links do front
// foram escritos no Windows (ex.: ../login/ -> Login/) e o Linux/Android diferencia.
const FRONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Sistema Web');
const normalizar = (s: string) => s.normalize('NFC').toLowerCase();
function resolverCaminho(urlPath: string): string | null {
  let atual = FRONT_DIR;
  for (const parte of urlPath.split('/').filter(Boolean)) {
    if (parte === '..' || parte === '.') return null;
    if (!fs.existsSync(atual) || !fs.statSync(atual).isDirectory()) return null;
    const achado = fs.readdirSync(atual).find((n) => normalizar(n) === normalizar(parte));
    if (!achado) return null;
    atual = path.join(atual, achado);
  }
  if (fs.existsSync(atual) && fs.statSync(atual).isDirectory()) atual = path.join(atual, 'index.html');
  return fs.existsSync(atual) ? atual : null;
}
app.get('/', (_req, res) => res.redirect('/Paciente/Login/'));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  let decodificado: string;
  try { decodificado = decodeURIComponent(req.path); } catch { return next(); }
  const arquivo = resolverCaminho(decodificado);
  if (!arquivo) return next();
  // Garante barra final em pastas para os caminhos relativos (../x) funcionarem
  if (arquivo.endsWith('index.html') && !decodificado.endsWith('/') && !decodificado.endsWith('.html')) {
    return res.redirect(req.path + '/');
  }
  res.sendFile(arquivo);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check antes do rate limiter para nunca ser bloqueado
app.get('/api/health', (_req, res) => {
  res.status(200).json({ success: true, message: 'API funcionando', timestamp: new Date().toISOString() });
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env['NODE_ENV'] === 'production' ? 300 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas requisicoes. Tente novamente em 15 minutos.', error: 'RATE_LIMIT' },
  skip: (req) => req.path === '/api/health',
});
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/paciente/auth', authPacienteRoutes);
app.use('/api/paciente', pacienteAreaRoutes);
app.use('/api/profissional', profesionalRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/solicitacoes', solicitacoesRoutes);
app.use('/api/historico', historicoRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/consultas', consultasRoutes);
app.use('/api/sessao', sessaoRoutes);
app.use('/api/tramites', tramitesRoutes);
app.use('/api/copiloto', copilotoRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Rota nao encontrada', error: 'NOT_FOUND', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

const PORT = Number(process.env['SERVER_PORT'] ?? 3000);
// 127.0.0.1: so aceita conexoes locais (o tunel Cloudflare conecta por localhost).
// Use SERVER_HOST=0.0.0.0 para acessar pela rede Wi-Fi.
const HOST = process.env['SERVER_HOST'] ?? '127.0.0.1';
app.listen(PORT, HOST, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  try {
    await runMigrations();
    await sincronizarDataset().catch((err) =>
      console.error('[Copiloto] Falha ao sincronizar dataset de procedimentos:', err instanceof Error ? err.message : err));
    await limparSlotsExpirados();
    console.log('Slots expirados removidos da agenda.');
  } catch (err) {
    console.error('Falha ao inicializar o banco (verifique DATABASE_URL):', (err as Error).message);
  }

  // ─── DESBLOQUEIO AUTOMÁTICO DE MULTI-VAGAS NO POSTGRES ───
  try {
    const { default: pool } = await import('./config/database.js');
    // Remove os índices/constraints restritivos que geravam o erro 400 por duplicidade
    await pool.query(`ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS agendamento_id_profissional_data_consulta_horario_key;`);
    await pool.query(`ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS uq_profissional_data_hora;`);
    await pool.query(`DROP INDEX IF EXISTS idx_agendamento_unico;`);
    await pool.query(`DROP INDEX IF EXISTS agendamento_profissional_data_horario_idx;`);
    console.log('✅ [Postgres] Restrições de unicidade de horário removidas com sucesso.');
  } catch (dbErr) {
    console.log('⚠️ [Postgres] Aviso ao processar índices:', dbErr instanceof Error ? dbErr.message : dbErr);
  }
});

export default app;