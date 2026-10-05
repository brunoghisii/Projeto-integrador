/* ============================================================
   api.js — Hub central de integração Front ↔ Backend
   Sistema de Clínica - Área Profissional (Luana)
   Backend: http://localhost:3000/api
   ============================================================ */

const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';

// ─── UTILITÁRIOS DE AUTH ────────────────────────────────────

function getToken() {
  return localStorage.getItem('token');
}

function getUsuario() {
  try { return JSON.parse(localStorage.getItem('profissional') || 'null'); } catch { return null; }
}

function setUsuario(data) {
  localStorage.setItem('profissional', JSON.stringify(data));
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('profissional');
  window.location.href = '../login/index.html';
}

function verificarAutenticacao() {
  if (!getToken()) {
    window.location.href = '../login/index.html';
    return false;
  }
  return true;
}

function verificarProfissional() {
  return verificarAutenticacao();
}

// ─── FORMATADORES BRASILEIROS ──────────────────────────────

function formatarTelefone(tel) {
  if (!tel) return '--';
  const n = String(tel).replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return tel;
}

function formatarCpf(cpf) {
  if (!cpf) return '--';
  const n = String(cpf).replace(/\D/g, '');
  if (n.length === 11) return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
  return cpf;
}

// ─── NOTIFICAÇÕES TOAST ────────────────────────────────────

function showNotification(message, type = 'success') {
  document.querySelectorAll('.api-toast').forEach(t => t.remove());

  const bg = type === 'success' ? '#046C4E' : type === 'warning' ? '#D97706' : '#DC2626';
  const duracao = 2000;

  const toast = document.createElement('div');
  toast.className = 'api-toast';
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:99999;
    background:${bg}; color:#fff; padding:14px 20px 14px 20px;
    border-radius:12px; font-size:.875rem; font-weight:500;
    max-width:400px; box-shadow:0 8px 24px rgba(0,0,0,.18);
    font-family:'Poppins',sans-serif; opacity:1;
    transition:opacity .35s ease;
    display:flex; align-items:flex-start; gap:12px;
  `;

  const texto = document.createElement('span');
  texto.style.flex = '1';
  texto.textContent = message;

  const fechar = document.createElement('button');
  fechar.textContent = '×';
  fechar.style.cssText = 'background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;padding:0;line-height:1;opacity:0.8;flex-shrink:0;margin-top:-2px;';
  fechar.addEventListener('click', () => toast.remove());

  toast.appendChild(texto);
  toast.appendChild(fechar);
  document.body.appendChild(toast);

  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 350); }, duracao);
}

// ─── REQUISIÇÃO HTTP CORE ──────────────────────────────────

async function apiRequest(method, endpoint, data = null) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = { method, headers };
  if (data && method !== 'GET') config.body = JSON.stringify(data);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);

    if (response.status === 401) { logout(); return null; }

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Erro na requisição');

    return result.data !== undefined ? result.data : result;
  } catch (err) {
    if (err.message && err.message.includes('fetch')) {
      throw new Error('Servidor offline. Verifique se o backend está rodando em http://localhost:3000');
    }
    throw err;
  }
}

// ─── AUTENTICAÇÃO ──────────────────────────────────────────

async function loginProfissional(email, senha) {
  const data = await apiRequest('POST', '/auth/login', { email, senha });
  if (data && data.token) {
    localStorage.setItem('token', data.token);
    setUsuario(data.profissional);
  }
  return data;
}

async function cadastroProfissional(dados) {
  const data = await apiRequest('POST', '/auth/register', dados);
  if (data && data.token) {
    localStorage.setItem('token', data.token);
    setUsuario(data.profissional);
  }
  return data;
}

// ─── PROFISSIONAL ──────────────────────────────────────────

async function obterProfissional(id) {
  return await apiRequest('GET', `/profissional/${id}`);
}

async function atualizarProfissional(id, dados) {
  return await apiRequest('PUT', `/profissional/${id}`, dados);
}

async function revelarCpfProfissional(id, senha) {
  return await apiRequest('POST', `/profissional/${id}/cpf`, { senha });
}

async function obterDashboard(id) {
  return await apiRequest('GET', `/profissional/${id}/dashboard`);
}

// ─── PACIENTES ─────────────────────────────────────────────

async function listarPacientes() {
  return (await apiRequest('GET', '/pacientes')) || [];
}

async function buscarPaciente(id) {
  return await apiRequest('GET', `/pacientes/${id}`);
}

async function criarPaciente(dados) {
  return await apiRequest('POST', '/pacientes', dados);
}

async function atualizarPaciente(id, dados) {
  return await apiRequest('PUT', `/pacientes/${id}`, dados);
}

async function deletarPaciente(id) {
  return await apiRequest('DELETE', `/pacientes/${id}`);
}

// ─── AGENDAMENTOS ──────────────────────────────────────────

async function listarAgendamentos(params = {}) {
  const q = new URLSearchParams(params).toString();
  return (await apiRequest('GET', `/agendamentos${q ? '?' + q : ''}`)) || [];
}

async function buscarAgendamento(id) {
  return await apiRequest('GET', `/agendamentos/${id}`);
}

async function criarAgendamento(dados) {
  return await apiRequest('POST', '/agendamentos', dados);
}

async function atualizarAgendamento(id, dados) {
  return await apiRequest('PUT', `/agendamentos/${id}`, dados);
}

async function cancelarAgendamento(id) {
  return await apiRequest('DELETE', `/agendamentos/${id}`);
}

async function confirmarAgendamento(id) {
  invalidarCacheNotificacoes();
  return await apiRequest('POST', `/agendamentos/${id}/confirmar`);
}

async function reagendarConsulta(dados) {
  return await apiRequest('POST', '/agendamentos/reagendar', dados);
}

async function getSlotsReagendar(data) {
  return (await apiRequest('GET', `/agendamentos/slots?data=${data}`)) || [];
}

async function finalizarAgendamento(id, dados) {
  return await apiRequest('POST', `/agendamentos/${id}/finalizar`, dados);
}

async function listarCalendario(mes, ano) {
  const q = mes && ano ? `?mes=${mes}&ano=${ano}` : '';
  return (await apiRequest('GET', `/agendamentos/agenda/calendario${q}`)) || [];
}

// ─── FINANCEIRO ────────────────────────────────────────────

async function obterFinanceiro() {
  return await apiRequest('GET', '/financeiro');
}

async function listarReceitas() {
  return (await apiRequest('GET', '/financeiro/receitas')) || [];
}

async function listarPendentes() {
  return (await apiRequest('GET', '/financeiro/despesas')) || [];
}

async function obterSaldo() {
  return await apiRequest('GET', '/financeiro/saldo');
}

async function registrarTransacao(dados) {
  return await apiRequest('POST', '/financeiro/registrar', dados);
}

// ─── RELATÓRIOS ────────────────────────────────────────────

async function relatorioAgendamentos(params = {}) {
  const q = new URLSearchParams(params).toString();
  return await apiRequest('GET', `/relatorios/agendamentos${q ? '?' + q : ''}`);
}

async function relatorioPacientes() {
  return (await apiRequest('GET', '/relatorios/pacientes')) || [];
}

async function relatorioFinanceiro(params = {}) {
  const q = new URLSearchParams(params).toString();
  return await apiRequest('GET', `/relatorios/financeiro${q ? '?' + q : ''}`);
}

// ─── SOLICITAÇÕES ──────────────────────────────────────────

async function listarSolicitacoes() {
  return (await apiRequest('GET', '/solicitacoes')) || [];
}

async function criarSolicitacao(dados) {
  return await apiRequest('POST', '/solicitacoes', dados);
}

async function atualizarSolicitacao(id, dados) {
  return await apiRequest('PUT', `/solicitacoes/${id}`, dados);
}

async function deletarSolicitacao(id) {
  return await apiRequest('DELETE', `/solicitacoes/${id}`);
}

async function responderSolicitacao(id, dados) {
  invalidarCacheNotificacoes();
  return await apiRequest('POST', `/solicitacoes/${id}/responder`, dados);
}

// ─── HISTÓRICO ─────────────────────────────────────────────

async function listarHistorico() {
  return (await apiRequest('GET', '/historico')) || [];
}

async function historicoDoPaciente(id) {
  return (await apiRequest('GET', `/historico/paciente/${id}`)) || [];
}

// ─── SESSÕES ───────────────────────────────────────────────

async function criarSessao(dados) {
  return await apiRequest('POST', '/sessao', dados);
}

async function listarSessoesProfissional(params = {}) {
  const q = new URLSearchParams(params).toString();
  return (await apiRequest('GET', `/sessao${q ? '?' + q : ''}`)) || [];
}

async function listarSessoesPaciente(pacienteId) {
  return (await apiRequest('GET', `/sessao/paciente/${pacienteId}`)) || [];
}

async function dashboardSessoes(mes) {
  const q = mes ? `?mes=${mes}` : '';
  return await apiRequest('GET', `/sessao/dashboard${q}`);
}

async function confirmarPagamentoSessao(id, dados = {}) {
  return await apiRequest('POST', `/sessao/${id}/pagamento`, dados);
}

async function atualizarSessao(id, dados) {
  return await apiRequest('PUT', `/sessao/${id}`, dados);
}

// ─── TRÂMITES ──────────────────────────────────────────────────────

async function listarTramites(idAgendamento) {
  return (await apiRequest('GET', `/tramites/agendamento/${idAgendamento}`)) || [];
}

async function criarTramite(idAgendamento, dados) {
  return await apiRequest('POST', `/tramites/agendamento/${idAgendamento}`, dados);
}

// ─── HISTÓRICO / CONSULTAS ─────────────────────────────────────────

async function listarConsultas(params = {}) {
  const q = new URLSearchParams(params).toString();
  return (await apiRequest('GET', `/historico/consultas${q ? '?' + q : ''}`)) || [];
}

// ─── COPILOTO CLÍNICO ──────────────────────────────────────────────

async function triagemRedFlags(anamnese) {
  return await apiRequest('POST', '/copiloto/anamnese/triagem', anamnese);
}

async function analisarConsultaCopiloto(anamnese) {
  return await apiRequest('POST', '/copiloto/analise', anamnese);
}

// Histórico: sem conversaId cria uma conversa nova; retorna { conversaId, analise }.
async function enviarMensagemCopiloto(conversaId, texto, contexto) {
  const url = conversaId ? `/copiloto/conversas/${conversaId}/mensagens` : '/copiloto/conversas/mensagens';
  return await apiRequest('POST', url, { texto, contexto });
}

// Abre atendimento para paciente cadastrado: { conversaId, mensagemId, analise, paciente, iaPendente }.
async function iniciarAtendimentoCopiloto(idPaciente) {
  return await apiRequest('POST', `/copiloto/pacientes/${idPaciente}/atendimento`);
}

// Etapa 2 da resposta: IA generativa para uma mensagem já analisada.
async function gerarIACopiloto(conversaId, mensagemId) {
  return await apiRequest('POST', `/copiloto/conversas/${conversaId}/mensagens/${mensagemId}/ia`);
}

// Orientação de conduta do paciente: { plano, laudos, iaHabilitada }.
async function obterOrientacaoPaciente(idPaciente) {
  return await apiRequest('GET', `/copiloto/pacientes/${idPaciente}/plano`);
}

async function gerarOrientacaoPaciente(idPaciente, anotacoes) {
  return await apiRequest('POST', `/copiloto/pacientes/${idPaciente}/plano`, { anotacoes });
}

async function obterStatusCopiloto() {
  return await apiRequest('GET', '/copiloto/status');
}

async function listarConversasCopiloto() {
  return (await apiRequest('GET', '/copiloto/conversas')) || [];
}

async function obterConversaCopiloto(id) {
  return await apiRequest('GET', `/copiloto/conversas/${id}`);
}

async function excluirConversaCopiloto(id) {
  return await apiRequest('DELETE', `/copiloto/conversas/${id}`);
}

// ─── NOTIFICAÇÕES GLOBAIS (auto-executa em todas as páginas) ──────

const _NOTIF_CACHE_TTL = 90 * 1000; // 90 segundos entre re-buscas
let _notifEmAndamento = false;

function _formatarDataBRNotif(dataString) {
  if (!dataString) return '';
  const p = String(dataString).substring(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function _aplicarNotificacoesUI(solicitacoes) {
  const total = solicitacoes.length;

  const badgeSolic = document.getElementById('badge-solicitacoes');
  if (badgeSolic) {
    badgeSolic.textContent = total;
    badgeSolic.style.display = total > 0 ? 'flex' : 'none';
  }

  const notiBadge = document.getElementById('noti-badge');
  if (notiBadge) {
    notiBadge.textContent = total;
    notiBadge.style.display = total > 0 ? 'block' : 'none';
  }

  const dropdownBody = document.getElementById('dropdown-body');
  if (!dropdownBody) return;

  if (total === 0) {
    dropdownBody.innerHTML = '<div class="dropdown-item" style="text-align:center;color:#9ca3af;">Nenhuma solicitação pendente.</div>';
    return;
  }

  dropdownBody.innerHTML = '';
  solicitacoes.forEach(s => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.style.cssText = 'cursor:pointer;border-left:3px solid #10B981;padding-left:10px;';
    item.innerHTML = `
      <strong style="color:#065F46;font-size:0.83rem;">Nova solicitação</strong><br>
      <span style="font-size:0.78rem;color:#374151;">${s.nome_paciente || 'Paciente'} — ${_formatarDataBRNotif(s.data_consulta)} às ${s.horario ? String(s.horario).substring(0,5) : '--'}</span>
    `;
    item.addEventListener('click', () => { window.location.href = '../solicitações/index.html'; });
    dropdownBody.appendChild(item);
  });
}

async function carregarNotificacoesProfissional() {
  if (!getToken()) return;
  if (_notifEmAndamento) return; // evita chamadas paralelas

  // Usar cache do localStorage se ainda dentro do TTL
  try {
    const tsUltimo = Number(localStorage.getItem('_notif_ts') || 0);
    const cached = localStorage.getItem('_notif_data');
    if (cached && Date.now() - tsUltimo < _NOTIF_CACHE_TTL) {
      _aplicarNotificacoesUI(JSON.parse(cached));
      return;
    }
  } catch { /* cache corrompido — ignora e vai buscar */ }

  _notifEmAndamento = true;
  try {
    const solicitacoes = await listarSolicitacoes();
    localStorage.setItem('_notif_data', JSON.stringify(solicitacoes));
    localStorage.setItem('_notif_ts', String(Date.now()));
    _aplicarNotificacoesUI(solicitacoes);
  } catch { /* silencia — não bloqueia a página */ } finally {
    _notifEmAndamento = false;
  }
}

// Invalida o cache quando nova solicitação é criada/atualizada
function invalidarCacheNotificacoes() {
  localStorage.removeItem('_notif_ts');
  localStorage.removeItem('_notif_data');
}

document.addEventListener('DOMContentLoaded', carregarNotificacoesProfissional);
