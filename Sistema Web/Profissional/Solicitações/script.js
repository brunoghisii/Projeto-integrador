function gerenciarMenuMobile() {
  const openBtn = document.getElementById('open-menu-btn');
  const closeBtn = document.getElementById('close-menu-btn');
  const sidebar = document.getElementById('mobile-sidebar');
  const backdrop = document.getElementById('menu-backdrop');
  if (!openBtn || !sidebar || !backdrop) return;
  openBtn.addEventListener('click', () => { sidebar.classList.add('open'); backdrop.classList.add('active'); });
  const fechar = () => { sidebar.classList.remove('open'); backdrop.classList.remove('active'); };
  if (closeBtn) closeBtn.addEventListener('click', fechar);
  backdrop.addEventListener('click', fechar);
}

function formatarDataBR(dataString) {
  if (!dataString) return '--/--/----';
  const p = String(dataString).substring(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function formatarHorario(h) {
  return h ? String(h).substring(0, 5) : '--';
}

let solicitacoesLista = [];
let solicitacaoSelecionada = null;

function renderizarSolicitacoes(lista) {
  const tbody = document.getElementById('requests-rows');
  const empty = document.getElementById('requests-empty');
  const wrapper = document.getElementById('requests-table-wrapper');

  if (!tbody) return;
  tbody.innerHTML = '';

  if (!lista || lista.length === 0) {
    if (wrapper) wrapper.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (wrapper) wrapper.style.display = 'block';
  if (empty) empty.style.display = 'none';

  lista.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${s.nome_paciente || '--'}</strong><br>
        <small style="color:#6B7280;">${formatarDataBR(s.data_consulta)} às ${formatarHorario(s.horario)}</small>
      </td>
      <td style="text-align:right;padding-right:25px;">
        <button class="btn-gerenciar btn-analisar" data-id="${s.id_solicitacao}">Analisar</button>
      </td>
    `;
    tr.querySelector('.btn-analisar').addEventListener('click', () => abrirModal(s));
    tbody.appendChild(tr);
  });
}

function formatarBytes(bytes) {
  if (!bytes) return '';
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

async function downloadDocumento(docMeta) {
  try {
    const doc = await apiRequest('GET', `/documentos/${docMeta.id_documento}/download`);
    if (!doc || !doc.conteudo_base64) { showNotification('Arquivo sem conteúdo.', 'error'); return; }
    const link = document.createElement('a');
    link.href = `data:${doc.tipo_arquivo || 'application/octet-stream'};base64,${doc.conteudo_base64}`;
    link.download = doc.nome_arquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch {
    showNotification('Erro ao baixar arquivo.', 'error');
  }
}

async function carregarDocumentosModal(agendamentoId, pacienteId) {
  const docEl = document.getElementById('detalhe-documento');
  if (!docEl) return;
  docEl.innerHTML = '<small style="color:#9CA3AF;">Carregando documentos...</small>';
  try {
    const docs = await apiRequest('GET', `/documentos/agendamento/${agendamentoId}?pacienteId=${pacienteId}`) || [];
    if (docs.length === 0) {
      docEl.innerHTML = '<small style="color:#9CA3AF;">Nenhum documento enviado pelo paciente.</small>';
      return;
    }
    docEl.innerHTML = '';
    docs.forEach(d => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#F0FDF4;border:1px solid #D1FAE5;border-radius:10px;gap:10px;';
      item.innerHTML = `
        <span style="font-size:0.82rem;color:#374151;font-weight:500;">📎 ${d.nome_arquivo} <small style="color:#9CA3AF;font-weight:400;">${formatarBytes(d.tamanho_bytes)}</small></span>
        <button style="background:#046C4E;color:white;border:none;padding:5px 14px;border-radius:8px;font-size:0.75rem;cursor:pointer;font-weight:700;font-family:Poppins,sans-serif;white-space:nowrap;">⬇ Baixar</button>
      `;
      item.querySelector('button').addEventListener('click', () => downloadDocumento(d));
      docEl.appendChild(item);
    });
    carregarAnaliseLaudo(agendamentoId);
  } catch {
    docEl.innerHTML = '<small style="color:#ef4444;">Erro ao carregar documentos.</small>';
  }
}

// ─── Análise do laudo pela IA (resumo + o que validar com o paciente) ───
function elTexto(tag, cls, texto) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

// Markdown mínimo e seguro (sem innerHTML): títulos, listas e **negrito**.
function markdownLaudo(texto) {
  const frag = document.createDocumentFragment();
  const inline = (alvo, t) => t.split(/(\*\*[^*]+\*\*)/g).forEach((p) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) alvo.append(elTexto('b', null, p.slice(2, -2)));
    else if (p) alvo.append(p);
  });
  let lista = null;
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) { lista = null; continue; }
    const titulo = linha.match(/^#{1,6}\s+(.*)$/);
    const item = linha.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (titulo) {
      lista = null;
      const h = elTexto('h4', 'laudo-ia-titulo');
      inline(h, titulo[1].replace(/\*\*/g, ''));
      if (/aten[çc][ãa]o/i.test(titulo[1])) h.classList.add('atencao');
      frag.append(h);
    } else if (item) {
      if (!lista) { lista = elTexto('ul', 'laudo-ia-lista'); frag.append(lista); }
      const li = elTexto('li');
      inline(li, item[1]);
      lista.append(li);
    } else {
      lista = null;
      const p = elTexto('p');
      inline(p, linha);
      frag.append(p);
    }
  }
  return frag;
}

async function carregarAnaliseLaudo(agendamentoId) {
  const box = document.getElementById('detalhe-laudo-ia');
  if (!box) return;
  box.hidden = false;
  box.replaceChildren();
  const topo = elTexto('div', 'laudo-ia-topo');
  topo.append(elTexto('span', 'material-symbols-outlined', 'neurology'), elTexto('strong', null, 'Análise do laudo'), elTexto('span', 'laudo-ia-selo', 'IA'));
  const corpo = elTexto('div', 'laudo-ia-corpo');
  const carregando = elTexto('div', 'laudo-ia-carregando');
  carregando.append(elTexto('span'), elTexto('span'), elTexto('span'), elTexto('small', null, 'Lendo o laudo e preparando o resumo…'));
  corpo.append(carregando);
  box.append(topo, corpo);

  let r;
  try {
    r = await apiRequest('GET', `/copiloto/agendamentos/${agendamentoId}/laudo`);
  } catch (err) {
    r = { erro: err.message || 'Falha de conexão.' };
  }
  // A profissional pode ter aberto outra solicitação enquanto a IA respondia
  if (!solicitacaoSelecionada || solicitacaoSelecionada.id_solicitacao !== agendamentoId) return;
  if (!r) { box.hidden = true; return; }
  if (r.iaHabilitada === false) { box.hidden = true; return; }

  corpo.replaceChildren();
  (r.alertas || []).forEach((a) => {
    const al = elTexto('div', `laudo-ia-alerta sev-${String(a.severidade).toLowerCase()}`);
    al.append(elTexto('strong', null, `⚠️ ${a.descricao}`), elTexto('p', null, a.conduta));
    corpo.append(al);
  });
  if (r.analise) corpo.append(markdownLaudo(r.analise));
  if (r.erro) {
    const erro = elTexto('div', 'laudo-ia-erro');
    erro.append(elTexto('p', null, `Não consegui analisar o laudo: ${r.erro}`));
    const tentar = elTexto('button', 'laudo-ia-tentar', 'Tentar novamente');
    tentar.type = 'button';
    tentar.addEventListener('click', () => carregarAnaliseLaudo(agendamentoId));
    erro.append(tentar);
    corpo.append(erro);
  }
  box.append(elTexto('p', 'laudo-ia-aviso', 'Gerado por IA (Google Gemini) a partir do laudo. Confira o documento original: não substitui a sua avaliação.'));
}

function abrirModal(solicitacao) {
  solicitacaoSelecionada = solicitacao;
  const modal = document.getElementById('modal-analisar');
  if (!modal) return;

  const nomeEl = document.getElementById('detalhe-nome');
  const servicoEl = document.getElementById('detalhe-servico');
  const dataEl = document.getElementById('detalhe-data');
  const horaEl = document.getElementById('detalhe-hora');
  const docEl = document.getElementById('detalhe-documento');
  const obsEl = document.getElementById('detalhe-observacoes');

  if (nomeEl) nomeEl.textContent = solicitacao.nome_paciente || '--';
  if (servicoEl) servicoEl.textContent = 'Consulta';
  if (dataEl) dataEl.textContent = formatarDataBR(solicitacao.data_consulta);
  if (horaEl) horaEl.textContent = formatarHorario(solicitacao.horario);
  if (docEl) docEl.innerHTML = '<small style="color:#9CA3AF;">Carregando...</small>';
  const laudoBox = document.getElementById('detalhe-laudo-ia');
  if (laudoBox) { laudoBox.hidden = true; laudoBox.replaceChildren(); }
  if (obsEl) obsEl.textContent = solicitacao.descricao || 'Sem observações.';

  modal.classList.add('active');

  // Carrega documentos do paciente para este agendamento
  if (solicitacao.id_solicitacao && solicitacao.id_paciente) {
    carregarDocumentosModal(solicitacao.id_solicitacao, solicitacao.id_paciente);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!verificarAutenticacao()) return;
  gerenciarMenuMobile();

  const dropdownBody = document.getElementById('dropdown-body');
  if (dropdownBody) dropdownBody.innerHTML = '<div class="dropdown-item" style="text-align:center;color:#9ca3af;">Nenhuma notificação.</div>';

  const bell = document.getElementById('bell-button');
  const notiDropdown = document.getElementById('noti-dropdown');
  if (bell && notiDropdown) {
    bell.addEventListener('click', (e) => { e.stopPropagation(); notiDropdown.classList.toggle('show'); });
    document.addEventListener('click', () => notiDropdown.classList.remove('show'));
  }

  try {
    solicitacoesLista = await listarSolicitacoes() || [];
    renderizarSolicitacoes(solicitacoesLista);
  } catch (err) {
    showNotification(err.message || 'Erro ao carregar solicitações.', 'error');
  }

  const modalAnalisar = document.getElementById('modal-analisar');
  const modalCancelarSub = document.getElementById('modal-justificativa-cancelar');
  const modalPendenteSub = document.getElementById('modal-dados-pendentes');

  document.getElementById('close-modal-analisar')?.addEventListener('click', () => modalAnalisar?.classList.remove('active'));

  // Confirmar → Aprovado
  document.getElementById('btn-modal-confirmar')?.addEventListener('click', async () => {
    if (!solicitacaoSelecionada) return;
    const btn = document.getElementById('btn-modal-confirmar');
    btn.disabled = true;
    try {
      await responderSolicitacao(solicitacaoSelecionada.id_solicitacao, { status: 'Aprovado' });
      showNotification('Agendamento confirmado com sucesso!');
      modalAnalisar?.classList.remove('active');
      solicitacoesLista = solicitacoesLista.filter(s => s.id_solicitacao !== solicitacaoSelecionada.id_solicitacao);
      renderizarSolicitacoes(solicitacoesLista);
    } catch (err) {
      showNotification(err.message || 'Erro ao confirmar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Pendente → abre sub-modal
  document.getElementById('btn-modal-pendente')?.addEventListener('click', () => {
    modalAnalisar?.classList.remove('active');
    const txt = document.getElementById('texto-pendente');
    if (txt) txt.value = '';
    modalPendenteSub?.classList.add('active');
  });

  document.getElementById('btn-voltar-pendente')?.addEventListener('click', () => {
    modalPendenteSub?.classList.remove('active');
    modalAnalisar?.classList.add('active');
  });

  document.getElementById('btn-concluir-pendente')?.addEventListener('click', async () => {
    if (!solicitacaoSelecionada) return;
    const motivo = document.getElementById('texto-pendente')?.value?.trim();
    if (!motivo) { showNotification('Escreva o que está pendente para o paciente.', 'error'); return; }
    const btn = document.getElementById('btn-concluir-pendente');
    btn.disabled = true;
    try {
      await responderSolicitacao(solicitacaoSelecionada.id_solicitacao, { status: 'Pendente', motivo });
      showNotification('Paciente notificado sobre as informações pendentes.');
      modalPendenteSub?.classList.remove('active');
      solicitacoesLista = solicitacoesLista.filter(s => s.id_solicitacao !== solicitacaoSelecionada.id_solicitacao);
      renderizarSolicitacoes(solicitacoesLista);
    } catch (err) {
      showNotification(err.message || 'Erro ao registrar pendência.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Cancelar → abre sub-modal
  document.getElementById('btn-modal-cancelar')?.addEventListener('click', () => {
    modalAnalisar?.classList.remove('active');
    const txt = document.getElementById('texto-cancelar');
    if (txt) txt.value = '';
    modalCancelarSub?.classList.add('active');
  });

  document.getElementById('btn-voltar-cancelar')?.addEventListener('click', () => {
    modalCancelarSub?.classList.remove('active');
    modalAnalisar?.classList.add('active');
  });

  document.getElementById('btn-concluir-cancelar')?.addEventListener('click', async () => {
    if (!solicitacaoSelecionada) return;
    const btn = document.getElementById('btn-concluir-cancelar');
    btn.disabled = true;
    try {
      await responderSolicitacao(solicitacaoSelecionada.id_solicitacao, { status: 'Cancelado' });
      showNotification('Solicitação cancelada.');
      modalCancelarSub?.classList.remove('active');
      solicitacoesLista = solicitacoesLista.filter(s => s.id_solicitacao !== solicitacaoSelecionada.id_solicitacao);
      renderizarSolicitacoes(solicitacoesLista);
    } catch (err) {
      showNotification(err.message || 'Erro ao cancelar.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
});
