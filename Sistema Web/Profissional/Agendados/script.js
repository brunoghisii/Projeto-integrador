function gerenciarMenuMobile() {
  const openBtn = document.getElementById('open-menu-btn');
  const closeBtn = document.getElementById('close-menu-btn');
  const sidebar = document.getElementById('mobile-sidebar');
  const backdrop = document.getElementById('menu-backdrop');
  if (!openBtn || !sidebar || !backdrop) return;

  openBtn.addEventListener('click', () => {
    sidebar.classList.add('open'); 
    backdrop.classList.add('active'); 
  });
  
  const fechar = () => { 
    sidebar.classList.remove('open'); 
    backdrop.classList.remove('active'); 
  };
  
  if (closeBtn) closeBtn.addEventListener('click', fechar);
  backdrop.addEventListener('click', fechar);
}

let agendamentosLista = [];
let agendamentoSelecionado = null;
let horarioReagendarEscolhido = null;

// Recupera os atendimentos definidos localmente
function obterAtendimentosConfigurados() {
  const salvos = localStorage.getItem('agenda_atendimentos');
  return salvos ? JSON.parse(salvos) : ['Fisioterapia Geral', 'Avaliação Inicial', 'Pilates Solo'];
}

// Extrai o nome real do atendimento mesmo se ele estiver embutido nas observações
function extrairServicoReal(agendamento) {
  if (agendamento.servico) return agendamento.servico;
  if (agendamento.especialidade) return agendamento.especialidade;
  if (agendamento.tipo) return agendamento.tipo;
  if (agendamento.tipo_atendimento) return agendamento.tipo_atendimento;
  
  // Tenta quebrar a string padrão "[Atendimento: Pilates Solo]" das observações
  if (agendamento.observacoes && agendamento.observacoes.includes('[Atendimento:')) {
    const match = agendamento.observacoes.match(/\[Atendimento:\s*([^\]]+)\]/);
    if (match && match[1]) return match[1].trim();
  }
  
  return 'Fisioterapia Geral'; // Fallback padrão caso esteja vazio
}

function formatarDataBR(dataString) {
  if (!dataString) return '--/--/----';
  const p = String(dataString).substring(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

// CORREÇÃO DA TABELA (IMAGEM image_af68a4.png): Mostra o nome correto do Atendimento na coluna correspondente
function renderizarTabela(lista) {
  const wrapper = document.getElementById('appointments-table-wrapper');
  const empty = document.getElementById('appointments-empty');
  const tbody = document.getElementById('appointments-rows');
  if (!tbody) return;
  
  tbody.innerHTML = "";

  if (!lista || lista.length === 0) {
    if (wrapper) wrapper.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (wrapper) wrapper.style.display = 'block';
  if (empty) empty.style.display = 'none';

  lista.forEach(a => {
    const temDoc = Number(a.num_documentos) > 0;
    const tr = document.createElement('tr');
    
    // Obtém o nome limpo e preenchido do serviço cadastrado
    const servicoExibido = extrairServicoReal(a);
    
    tr.innerHTML = `
      <td>
        <strong>${a.nome_paciente || '--'}</strong>
        ${temDoc ? `<span class="badge-doc-novo" title="Novo documento encaminhado"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">attach_file</span> Novo doc.</span>` : ''}
      </td>
      <td>${formatarDataBR(a.data_consulta)}</td>
      <td>${a.horario ? a.horario.substring(0,5) : '--'}</td>
      <td style="color: #374151; font-weight: 500;">${servicoExibido}</td>
      <td style="text-align:right;padding-right:25px;">
        <button class="btn-gerenciar" data-id="${a.id_agendamento}">Gerenciar</button>
      </td>
    `;
    
    tr.querySelector('.btn-gerenciar').addEventListener('click', () => abrirModalGerenciar(a));
    tbody.appendChild(tr);
  });
}

function formatarBytes(bytes) {
  if (!bytes) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

async function downloadDocumento(docMeta) {
  try {
    const doc = await apiRequest('GET', `/documentos/${docMeta.id_documento}/download`);
    if (!doc || !doc.conteudo_base64) { 
      if (typeof showNotification === "function") showNotification('Arquivo sem conteúdo.', 'error');
      return; 
    }
    const link = document.createElement('a');
    link.href = `data:${doc.tipo_arquivo || 'application/octet-stream'};base64,${doc.conteudo_base64}`;
    link.download = doc.nome_arquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch {
    if (typeof showNotification === "function") showNotification('Erro ao baixar arquivo.', 'error');
  }
}

async function carregarDocsAgendamento(agendamentoId, pacienteId) {
  const container = document.getElementById('docs-agendamento-lista');
  if (!container) return;
  container.innerHTML = '<small style="color:#9CA3AF;">Carregando...</small>';
  
  try {
    const docs = await apiRequest('GET', `/documentos/agendamento/${agendamentoId}?pacienteId=${pacienteId}`) || [];
    if (docs.length === 0) {
      container.innerHTML = '<small style="color:#9CA3AF;">Nenhum documento enviado pelo paciente.</small>';
      return;
    }
    container.innerHTML = "";
    docs.forEach(d => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex; justify-content:space-between; align-items:center;padding:7px 0;border-bottom:1px solid #f3f4f6;';
      item.innerHTML = `
        <span style="font-size:0.82rem;color:#374151;">
          <strong>${d.nome_arquivo}</strong> <small style="color:#9CA3AF;">${formatarBytes(d.tamanho_bytes)}</small>
        </span>
        <button style="background:#10B981;color:white; border:none; padding:4px 12px;border-radius:8px;font-size:0.75rem;cursor:pointer;font-weight:600;">Download</button>
      `;
      item.querySelector('button').addEventListener('click', () => downloadDocumento(d));
      container.appendChild(item);
    });
  } catch {
    container.innerHTML = '<small style="color:#ef4444;">Erro ao carregar documentos.</small>';
  }
}

function abrirModalGerenciar(agendamento) {
  agendamentoSelecionado = agendamento;
  const info = document.getElementById('modificar-info-paciente');
  const servicoAtual = extrairServicoReal(agendamento);

  if (info) {
    info.innerHTML = `<strong>Paciente:</strong> ${agendamento.nome_paciente || '--'}<br>
                      <strong>Serviço Atual:</strong> <span style="color:#046C4E;font-weight:600;">${servicoAtual}</span><br>
                      <strong>Horário:</strong> ${formatarDataBR(agendamento.data_consulta)} às ${agendamento.horario ? agendamento.horario.substring(0,5) : '--'}`;
  }
  
  const obsContainer = document.getElementById('obs-paciente-container');
  const obsTexto = document.getElementById('obs-paciente-texto');
  
  if (agendamento.observacoes) {
    if (obsContainer) obsContainer.style.display = 'block';
    if (obsTexto) obsTexto.textContent = agendamento.observacoes;
  } else {
    if (obsContainer) obsContainer.style.display = 'none';
  }
  
  if (agendamento.id_agendamento && agendamento.id_paciente) {
    carregarDocsAgendamento(agendamento.id_agendamento, agendamento.id_paciente);
  }
  
  document.getElementById('modal-modificar').classList.add('active');
}

async function carregarAgendamentos() {
  try {
    agendamentosLista = await apiRequest('GET', '/agendamentos?status=Confirmado') || [];
  } catch (err) {
    if (typeof showNotification === "function") showNotification(err.message || 'Erro ao carregar agendamentos.', 'error');
    agendamentosLista = [];
  }
}

function popularDropdownReagendamento() {
  const select = document.getElementById('reagendar-servico-select');
  if (!select) return;
  const atendimentos = obterAtendimentosConfigurados();
  select.innerHTML = '<option value="" disabled selected>Selecione o tipo de atendimento</option>';
  atendimentos.forEach(atend => {
    const opt = document.createElement('option');
    opt.value = atend;
    opt.textContent = atend;
    select.appendChild(opt);
  });
}

// Resgata o tipo de atendimento associado localmente ao slot (Data + Hora) para dar o match de filtro do backend
function obterAtendimentoDoSlot(data, horario) {
  const mapa = JSON.parse(localStorage.getItem('mapa_atendimentos_slots') || '{}');
  const dataLimpa = String(data).substring(0, 10);
  const horaLimpa = String(horario).substring(0, 5);
  return mapa[`${dataLimpa}_${horaLimpa}`];
}

// ─── HORÁRIOS PARA REAGENDAR ───
// A profissional pode reagendar para qualquer dia e horário: a agenda liberada
// (Gerenciamento de Agenda) só restringe os pedidos feitos pelos pacientes.
const HORARIOS_REAGENDAR = [
  '07:00','07:30','08:00','08:30','09:00','09:30',
  '10:00','10:30','11:00','11:30','12:00','12:30',
  '13:00','13:30','14:00','14:30','15:00','15:30',
  '16:00','16:30','17:00','17:30','18:00','18:30'
];

async function buscarHorariosLivresReagendar(dataSelecionada) {
  const grid = document.getElementById('reagendar-horarios-grid');
  const btnConcluir = document.getElementById('btn-concluir-reagendamento');
  if (!grid) return;

  horarioReagendarEscolhido = null;
  if (btnConcluir) btnConcluir.disabled = true;

  if (!dataSelecionada) {
    grid.innerHTML = '<p class="reagendar-msg">Escolha uma data para ver os horários.</p>';
    return;
  }

  grid.innerHTML = '<p class="reagendar-msg">Carregando horários...</p>';

  // Consultas já marcadas no dia (para avisar conflito; a consulta sendo reagendada não conta)
  let agendamentosDoDia = [];
  try {
    const todos = await apiRequest('GET', '/agendamentos') || [];
    agendamentosDoDia = todos.filter(a =>
      String(a.data_consulta).substring(0, 10) === dataSelecionada &&
      a.status !== 'Cancelado' &&
      a.id_agendamento !== agendamentoSelecionado?.id_agendamento
    );
  } catch {
    agendamentosDoDia = [];
  }

  const agora = new Date();
  const hojeISO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  grid.innerHTML = '';
  HORARIOS_REAGENDAR.forEach(hora => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-reagendar-btn';
    btn.textContent = hora;

    const [h, m] = hora.split(':').map(Number);
    const passou = dataSelecionada < hojeISO || (dataSelecionada === hojeISO && h * 60 + m <= minutosAgora);
    const ocupados = agendamentosDoDia.filter(a => String(a.horario || '').substring(0, 5) === hora);

    if (passou) {
      btn.disabled = true;
      btn.classList.add('passou');
      btn.title = 'Horário já passou';
    } else {
      if (ocupados.length) {
        btn.classList.add('ocupado');
        const nomes = ocupados.map(a => a.nome_paciente || a.paciente_nome).filter(Boolean).join(', ');
        btn.title = `Já existe consulta neste horário${nomes ? ` (${nomes})` : ''}. Você ainda pode escolher.`;
        btn.append(Object.assign(document.createElement('small'), { textContent: ocupados.length === 1 ? '1 paciente' : `${ocupados.length} pacientes` }));
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('.slot-reagendar-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        horarioReagendarEscolhido = hora;
        if (btnConcluir) btnConcluir.disabled = false;
      });
    }
    grid.appendChild(btn);
  });
}

function toISO(d) { return d.toISOString().substring(0, 10); }

function calcularPeriodo(periodo) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (periodo === 'hoje') return { inicio: toISO(hoje), fim: toISO(hoje) };
  if (periodo === 'semana') {
    const dom = new Date(hoje);
    dom.setDate(hoje.getDate() - hoje.getDay());
    const sab = new Date(dom);
    sab.setDate(dom.getDate() + 6);
    return { inicio: toISO(dom), fim: toISO(sab) };
  }
  if (periodo === 'mes') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    return { inicio: toISO(ini), fim: toISO(fim) };
  }
  if (periodo === 'trimestre') {
    const mesAtual = hoje.getMonth();
    const inicioTrimestre = Math.floor(mesAtual / 3) * 3;
    const ini = new Date(hoje.getFullYear(), inicioTrimestre, 1);
    const fim = new Date(hoje.getFullYear(), inicioTrimestre + 3, 0);
    return { inicio: toISO(ini), fim: toISO(fim) };
  }
  if (periodo === 'ano') {
    const ini = new Date(hoje.getFullYear(), 0, 1);
    const fim = new Date(hoje.getFullYear(), 11, 31);
    return { inicio: toISO(ini), fim: toISO(fim) };
  }
  return { inicio: null, fim: null };
}

function aplicarFiltroRange(inicio, fim) {
  const filtered = agendamentosLista.filter(a => {
    const data = a.data_consulta ? String(a.data_consulta).substring(0, 10) : null;
    if (!data) return false;
    if (inicio && data < inicio) return false;
    if (fim && data > fim) return false;
    return true;
  });
  renderizarTabela(filtered);
  const countTexto = document.getElementById('filtro-count-texto');
  if (countTexto) {
    countTexto.textContent = `${filtered.length} consulta${filtered.length !== 1 ? 's' : ''} em aberto`;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (typeof verificarAutenticacao === "function") {
    if (!verificarAutenticacao()) return;
  }
  gerenciarMenuMobile();
  
  const dropdownBody = document.getElementById('dropdown-body');
  if (dropdownBody) dropdownBody.innerHTML = '<div class="dropdown-item" style="text-align:center;color:#9ca3af;">Nenhuma notificação.</div>';
  
  const bell = document.getElementById('bell-button');
  const notiDropdown = document.getElementById('noti-dropdown');
  if (bell && notiDropdown) {
    bell.addEventListener('click', (e) => { 
      e.stopPropagation();
      notiDropdown.classList.toggle('show'); 
    });
    document.addEventListener('click', () => notiDropdown.classList.remove('show'));
  }

  const inputInicio = document.getElementById('filter-inicio');
  const inputFim = document.getElementById('filter-fim');
  
  document.querySelectorAll('.filtro-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filtro-pill').forEach(p => p.classList.remove('filtro-pill-ativo'));
      pill.classList.add('filtro-pill-ativo');
      const { inicio, fim } = calcularPeriodo(pill.dataset.periodo);
      if (inputInicio) inputInicio.value = inicio || "";
      if (inputFim) inputFim.value = fim || "";
      aplicarFiltroRange(inicio, fim);
    });
  });

  function onRangeManual() {
    document.querySelectorAll('.filtro-pill').forEach(p => p.classList.remove('filtro-pill-ativo'));
    aplicarFiltroRange(inputInicio?.value || null, inputFim?.value || null);
  }

  inputInicio?.addEventListener('change', onRangeManual);
  inputFim?.addEventListener('change', onRangeManual);

  await carregarAgendamentos();

  const periodoInicial = calcularPeriodo('mes');
  if (inputInicio) inputInicio.value = periodoInicial.inicio;
  if (inputFim) inputFim.value = periodoInicial.fim;
  aplicarFiltroRange(periodoInicial.inicio, periodoInicial.fim);

  const modalModificar = document.getElementById('modal-modificar');
  document.getElementById('close-modal-modificar')?.addEventListener('click', () => modalModificar.classList.remove('active'));

  // FINALIZAR ---
  document.getElementById('btn-trigger-finalizar')?.addEventListener('click', () => {
    if (!agendamentoSelecionado) return;
    localStorage.setItem('sessao_agendamento', JSON.stringify(agendamentoSelecionado));
    window.location.href = '../Registrar-Sessao/index.html';
  });

  // REAGENDAR SESSÃO ATUAL ---
  const modalReagendar = document.getElementById('modal-sub-reagendar');
  const dataReagendarInput = document.getElementById('reagendar-data-input');
  const servicoReagendarSelect = document.getElementById('reagendar-servico-select');

  document.getElementById('btn-trigger-reagendar')?.addEventListener('click', () => {
    modalModificar.classList.remove('active');
    popularDropdownReagendamento();
    
    if (dataReagendarInput) dataReagendarInput.value = "";
    if (servicoReagendarSelect) {
      // Já vem com o tipo atual da consulta ("[Atendimento: X]" nas observações)
      const atual = String(agendamentoSelecionado?.observacoes || '').match(/\[Atendimento:\s*([^\]]+)\]/)?.[1]?.trim();
      if (atual && ![...servicoReagendarSelect.options].some(o => o.value === atual)) servicoReagendarSelect.add(new Option(atual, atual));
      servicoReagendarSelect.value = atual || (servicoReagendarSelect.options[1]?.value ?? '');
    }
    
    const hoje = new Date().toISOString().split('T')[0];
    if (dataReagendarInput) dataReagendarInput.min = hoje;
    
    document.getElementById('reagendar-horarios-grid').innerHTML = '<p class="reagendar-msg">Escolha uma data para ver os horários.</p>';
    modalReagendar.classList.add('active');
  });

  const dispararBuscaSlots = () => {
    buscarHorariosLivresReagendar(dataReagendarInput?.value);
  };

  dataReagendarInput?.addEventListener('change', dispararBuscaSlots);

  document.getElementById('btn-voltar-reagendar')?.addEventListener('click', () => {
    modalReagendar.classList.remove('active');
    modalModificar.classList.add('active');
  });

  document.getElementById('btn-concluir-reagendamento')?.addEventListener('click', async () => {
    if (!agendamentoSelecionado || !dataReagendarInput.value || !horarioReagendarEscolhido || !servicoReagendarSelect.value) return;
    const btn = document.getElementById('btn-concluir-reagendamento');
    btn.disabled = true;
    try {
      const observacaoComAtendimento = `[Atendimento: ${servicoReagendarSelect.value}]`;
      
      await apiRequest('PUT', `/agendamentos/${agendamentoSelecionado.id_agendamento}`, {
        data_consulta: dataReagendarInput.value,
        horario: horarioReagendarEscolhido + ':00',
        observacoes: observacaoComAtendimento
      });
      if (typeof showNotification === "function") showNotification('Consulta reagendada com sucesso!');
      modalReagendar.classList.remove('active');
      await carregarAgendamentos();
      aplicarFiltroRange(inputInicio?.value, inputFim?.value);
    } catch (err) {
      if (typeof showNotification === "function") showNotification(err.message || 'Erro ao reagendar consulta.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // CANCELAR ---
  const modalCancelar = document.getElementById('modal-sub-cancelar');
  document.getElementById('btn-trigger-cancelar')?.addEventListener('click', () => {
    modalModificar.classList.remove('active');
    document.getElementById('cancelar-motivo').value = '';
    modalCancelar.classList.add('active');
  });

  document.getElementById('btn-voltar-cancelar')?.addEventListener('click', () => {
    modalCancelar.classList.remove('active');
    modalModificar.classList.add('active');
  });

  document.getElementById('btn-concluir-cancelar-agenda')?.addEventListener('click', async () => {
    if (!agendamentoSelecionado) return;
    const btn = document.getElementById('btn-concluir-cancelar-agenda');
    btn.disabled = true;
    try {
      await apiRequest('DELETE', `/agendamentos/${agendamentoSelecionado.id_agendamento}`);
      if (typeof showNotification === "function") showNotification('Agendamento cancelado.');
      modalCancelar.classList.remove('active');
      agendamentosLista = agendamentosLista.filter(a => a.id_agendamento !== agendamentoSelecionado.id_agendamento);
      aplicarFiltroRange(inputInicio?.value, inputFim?.value);
    } catch (err) {
      if (typeof showNotification === "function") showNotification(err.message || 'Erro ao cancelar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
});