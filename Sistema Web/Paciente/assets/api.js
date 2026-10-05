const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';

function getPacienteToken() {
  return localStorage.getItem('paciente_token');
}

function getPaciente() {
  const data = localStorage.getItem('paciente');
  try { return data ? JSON.parse(data) : null; } catch { return null; }
}

async function apiRequest(method, endpoint, body = null) {
  const token = getPacienteToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const result = await response.json();

    if (!result.success) {
      if (response.status === 401) {
        localStorage.removeItem('paciente_token');
        localStorage.removeItem('paciente');
        window.location.href = '../login/index.html';
        return null;
      }
      throw new Error(result.message || 'Erro na requisicao');
    }

    return result.data;
  } catch (err) {
    if (err.message === 'Failed to fetch') throw new Error('Servidor offline. Verifique se o backend está rodando.');
    throw err;
  }
}

function verificarAutenticacaoPaciente() {
  const token = getPacienteToken();
  if (!token) {
    window.location.href = '../login/index.html';
    return false;
  }
  return true;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

async function loginPaciente(email, senha) {
  return apiRequest('POST', '/paciente/auth/login', { email, senha });
}

async function cadastrarPaciente(dados) {
  return apiRequest('POST', '/paciente/auth/register', dados);
}

// ─── PERFIL ───────────────────────────────────────────────────────────────────

async function obterPerfilPaciente() {
  return apiRequest('GET', '/paciente/me');
}

async function atualizarPerfilPaciente(dados) {
  return apiRequest('PUT', '/paciente/me', dados);
}

async function excluirContaPaciente(motivo) {
  return apiRequest('DELETE', '/paciente/me', { motivo });
}

async function revelarCpfPaciente(senha) {
  return apiRequest('POST', '/paciente/me/cpf', { senha });
}

// ─── DISPONIBILIDADE ─────────────────────────────────────────────────────────

async function obterDisponibilidade() {
  return apiRequest('GET', '/paciente/disponibilidade');
}

// ─── AGENDAMENTOS ────────────────────────────────────────────────────────────

async function listarAgendamentosPaciente() {
  return apiRequest('GET', '/paciente/agendamentos');
}

async function criarAgendamentoPaciente(dados) {
  return apiRequest('POST', '/paciente/agendamentos', dados);
}

async function cancelarAgendamentoPaciente(id) {
  return apiRequest('DELETE', `/paciente/agendamentos/${id}`);
}

async function reenviarSolicitacaoPaciente(id, observacoes) {
  return apiRequest('PUT', `/paciente/agendamentos/${id}/reenviar`, { observacoes });
}

// ─── HISTÓRICO ────────────────────────────────────────────────────────────────

async function obterHistoricoPaciente() {
  return apiRequest('GET', '/paciente/historico');
}

// ─── FINANCEIRO ───────────────────────────────────────────────────────────────

async function obterFinanceiroPaciente() {
  return apiRequest('GET', '/paciente/financeiro');
}

// ─── DOCUMENTOS ──────────────────────────────────────────────────────────────

async function uploadDocumentoPaciente(dados) {
  return apiRequest('POST', '/paciente/documentos', dados);
}

async function listarDocumentosPaciente() {
  return apiRequest('GET', '/paciente/documentos');
}

async function deletarDocumentoPaciente(id) {
  return apiRequest('DELETE', `/paciente/documentos/${id}`);
}

// ─── SESSÕES ─────────────────────────────────────────────────────────────────

async function listarSessoesPaciente() {
  return (await apiRequest('GET', '/paciente/sessoes')) || [];
}

// ─── NOTIFICAÇÕES ────────────────────────────────────────────────────────────

function formatarTelefone(tel) {
  if (!tel) return '';
  const n = String(tel).replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return tel;
}

function formatarCpf(cpf) {
  if (!cpf) return '';
  const n = String(cpf).replace(/\D/g, '');
  if (n.length === 11) return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
  return cpf;
}

function showNotification(message, type = 'success') {
  document.querySelectorAll('.api-toast').forEach(t => t.remove());
  const bg = type === 'success' ? '#046C4E' : type === 'warning' ? '#D97706' : '#DC2626';
  const toast = document.createElement('div');
  toast.className = 'api-toast';
  toast.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;background:${bg};color:#fff;padding:12px 16px;border-radius:10px;font-family:'Poppins',sans-serif;font-size:0.85rem;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.2);display:flex;align-items:center;gap:10px;max-width:360px;animation:slideIn .2s ease;`;
  const span = document.createElement('span');
  span.style.flex = '1';
  span.textContent = message;
  const btn = document.createElement('button');
  btn.textContent = '×';
  btn.style.cssText = 'background:none;border:none;color:#fff;font-size:1.3rem;cursor:pointer;padding:0;line-height:1;flex-shrink:0;';
  btn.onclick = () => toast.remove();
  toast.appendChild(span);
  toast.appendChild(btn);
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
}

const styleTag = document.createElement('style');
styleTag.textContent = '@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(styleTag);

// ─── DADOS DA CLÍNICA ─────────────────────────────────────────────────────────

async function obterDadosClinica() {
  // Agora essa rota existe no backend e está protegida com o token do paciente!
  return apiRequest('GET', '/paciente/clinica'); 
}

window.obterDadosClinica = obterDadosClinica;