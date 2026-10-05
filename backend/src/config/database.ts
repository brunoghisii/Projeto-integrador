import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Postgres local (Termux) nao usa SSL; Supabase exige
  ssl: /\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') ? false : { rejectUnauthorized: false },
  max: 3,                     // máx 3 conexões simultâneas (Supabase free tier)
  min: 0,                     // não manter conexões ociosas abertas
  idleTimeoutMillis: 20000,   // libera conexão ociosa após 20s
  connectionTimeoutMillis: 8000, // timeout ao aguardar conexão do pool
});

pool.on('error', (err) => {
  console.error('[Pool] Erro inesperado na conexão:', err.message);
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Erro ao conectar no banco:', err.message);
  } else {
    console.log('Conexao com o banco estabelecida!');
    release();
  }
});

export default pool;
