/* ============================================================
   copiloto.js — Copiloto Clínico (chat) no Painel
   Cada mensagem é salva no histórico (POST /api/copiloto/conversas/...)
   e o servidor analisa a conversa inteira. O copiloto responde só com
   o que for NOVO desde a última mensagem. Conversas antigas podem ser
   reabertas pelo painel de histórico.
   ============================================================ */

(function () {
  const form = document.getElementById('cop-form');
  if (!form) return;

  const input = document.getElementById('cop-input');
  const mensagensEl = document.getElementById('cop-mensagens');
  const statusEl = document.getElementById('cop-status');

  const ROTULO_STATUS = {
    VAZIO: 'Nova consulta',
    LIBERADO: 'Sem red flags',
    ATENCAO: 'Atenção',
    INTERROMPIDO: 'Red flag crítica',
    ERRO: 'Indisponível',
  };
  const ICONE_SEVERIDADE = { CRITICA: '🔴', ALTA: '🟡', MODERADA: '🔵' };
  const ROTULO_SEVERIDADE = { CRITICA: 'Crítica', ALTA: 'Alta', MODERADA: 'Moderada' };

  const pacienteSelect = document.getElementById('cop-paciente');
  const historicoEl = document.getElementById('cop-historico');
  const historicoListaEl = document.getElementById('cop-historico-lista');
  const historicoBuscaEl = document.getElementById('cop-historico-busca');

  let conversaId = null;
  let conversasCache = [];
  let alertasJaMostrados = new Set();
  let negadosJaMostrados = new Set();
  let quadrosMostrados = new Map();
  let condicoesMostradas = new Set();
  let procStatus = new Map();
  let passosAnteriores = '';
  let enviando = false;

  // ─── Sinais vitais escritos no texto ("SpO2 88%", "FC 130", "75 anos"…) ───
  function extrairContexto(texto) {
    const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(',', '.')) : undefined; };
    const ctx = {
      idade: num(/(\d{1,3})\s*anos/) ?? num(/idade:?\s*(\d{1,3})/),
      saturacaoO2: num(/(?:spo2|sato2|saturacao|sat)\s*:?\s*(?:de\s*)?(\d{2,3})/),
      frequenciaCardiaca: num(/(?:\bfc|frequencia cardiaca)\s*:?\s*(?:de\s*)?(\d{2,3})/),
      pressaoSistolica: num(/(?:\bpa|pressao(?: arterial)?)\s*:?\s*(?:de\s*)?(\d{2,3})\s*(?:x|\/|por)/),
      temperatura: num(/(?:temperatura|temp|\bt)\s*:?\s*(?:de\s*)?(\d{2}(?:[.,]\d)?)\s*(?:°|graus|c\b)?/),
    };
    const negado = (re) => new RegExp(`\\b(nega|sem|nao)\\b[^.;]{0,25}${re.source}`).test(t);
    const flag = (re) => re.test(t) && !negado(re);
    if (flag(/(cancer|tumor|neoplasia|quimioterapia|radioterapia)/)) ctx.historicoCancer = true;
    if (flag(/(caiu|queda|trauma|acidente|batida)/)) ctx.traumaRecente = true;
    if (flag(/(imunossuprimid|hiv|transplantad)/)) ctx.imunossuprimido = true;
    if (flag(/(corticoide|prednisona|dexametasona)/)) ctx.usoCorticoideProlongado = true;
    for (const k of Object.keys(ctx)) if (ctx[k] === undefined) delete ctx[k];
    return ctx;
  }

  // ─── UI ───
  function el(tag, cls, texto) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function rolarParaFim() {
    mensagensEl.scrollTop = mensagensEl.scrollHeight;
  }

  function balao(autor, ...conteudo) {
    const b = el('div', `chat-msg ${autor}`);
    b.append(...conteudo);
    mensagensEl.append(b);
    rolarParaFim();
    return b;
  }

  function setStatus(status) {
    statusEl.dataset.status = status;
    statusEl.textContent = ROTULO_STATUS[status] || status;
  }

  function cartaoAlerta(a) {
    const card = el('div', `chat-alerta sev-${a.severidade.toLowerCase()}`);
    card.append(el('strong', null, `${ICONE_SEVERIDADE[a.severidade] || ''} ${a.descricao}`));

    const trecho = el('p', 'chat-trecho');
    const idx = a.trecho.toLowerCase().indexOf(a.termoDetectado.toLowerCase());
    if (a.campo !== 'contexto' && idx >= 0) {
      trecho.append('“', a.trecho.slice(0, idx), el('mark', null, a.trecho.slice(idx, idx + a.termoDetectado.length)),
        a.trecho.slice(idx + a.termoDetectado.length), '”');
    } else {
      trecho.append(`Detectado: ${a.termoDetectado}`);
    }
    card.append(trecho, el('p', 'chat-conduta', `👉 ${a.conduta}`));
    const rodape = el('span', 'chat-tag', `Gravidade ${ROTULO_SEVERIDADE[a.severidade]}${a.sistemaCbdf ? ` · CBDF ${a.sistemaCbdf}` : ''}`);
    card.append(rodape);
    return card;
  }

  const ICONE_PROC = { INDICADO: '✅', CAUTELA: '⚠️', CONTRAINDICADO: '⛔' };
  const ROTULO_PROC = { INDICADO: 'Compatível', CAUTELA: 'Com cautela', CONTRAINDICADO: 'Evitar' };

  function secao(titulo) {
    return el('p', 'chat-secao', titulo);
  }

  function blocoCondicao(c) {
    const box = el('div', 'chat-condicao');
    const topo = el('div', 'chat-condicao-topo');
    topo.append(el('strong', null, `📚 ${c.nome}`), el('span', 'chat-tag', `CID ${c.cid10} · ${c.area}`));
    box.append(topo);

    const secaoLista = (titulo, itens, cls, aberto = false) => {
      if (!itens.length) return;
      const d = el('details', `chat-condicao-sec ${cls || ''}`);
      if (aberto) d.open = true;
      d.append(el('summary', null, titulo));
      const ul = el('ul');
      itens.forEach((i) => ul.append(el('li', null, i)));
      d.append(ul);
      box.append(d);
    };
    secaoLista('🚩 Fique atento a', c.sinaisAlerta, 'alerta', true);
    secaoLista('🔎 Como avaliar', c.avaliacao, '', true);
    secaoLista('🛠️ Procedimentos recomendados', c.procedimentosRecomendados.map((p) => `${p.nome} (${p.id})`));
    secaoLista('⚠️ Precauções', c.precaucoes);
    secaoLista('🎯 Metas mensuráveis', c.metas);
    secaoLista('🏥 Encaminhe ao médico se', c.encaminharSe, 'alerta');
    box.append(el('p', 'chat-fontes', `Fontes: ${c.fontes.join(' · ')}`));
    return box;
  }

  function blocoQuadro(q) {
    const box = el('div', 'chat-quadro');
    box.append(el('strong', null, `🩺 ${q.nome} — possíveis causas`));
    const lista = el('ol', 'chat-causas');
    for (const c of q.possiveisCausas) {
      const li = el('li', c.sustentada ? 'provavel' : 'considerar');
      li.append(c.sustentada ? '✔ ' : '', c.causa);
      if (c.sustentada) li.append(el('span', 'chat-racional', c.racional ? ` — ${c.racional}` : ' — compatível com o relato'));
      lista.append(li);
    }
    box.append(lista, el('p', 'chat-tag', `CBDF sugerido: ${q.sistemaCbdf}`));
    return box;
  }

  function blocoProcedimento(p) {
    const d = el('details', `chat-proc st-${p.status.toLowerCase()}`);
    const s = el('summary');
    s.append(`${ICONE_PROC[p.status]} ${p.nome} `, el('span', 'chat-proc-status', ROTULO_PROC[p.status]));
    d.append(s);
    p.motivos.forEach((m) => d.append(el('p', 'chat-proc-motivo', m)));
    const info = el('ul', 'chat-proc-info');
    const item = (rotulo, lista) => { if (lista.length) { const li = el('li'); li.append(el('b', null, `${rotulo}: `), lista.join('; ')); info.append(li); } };
    item('Escalas', p.escalas);
    item('Pré-requisitos', p.preRequisitos);
    item('Regras', p.regras);
    item('Fontes', p.fontes);
    d.append(info);
    return d;
  }

  function responder(analise, opcoes = {}) {
    const r = analise.triagem;
    setStatus(r.status);
    const partes = [];

    // 1. Red flags novas
    const novos = r.alertas.filter((a) => !alertasJaMostrados.has(a.regraId));
    novos.forEach((a) => alertasJaMostrados.add(a.regraId));
    if (novos.length) {
      const critico = novos.some((a) => a.severidade === 'CRITICA');
      partes.push(el('p', null, critico
        ? '⚠️ Atenção! Encontrei um sinal de alerta CRÍTICO. Priorize a conduta abaixo antes de continuar:'
        : `Encontrei ${novos.length === 1 ? 'um ponto' : `${novos.length} pontos`} que merece${novos.length === 1 ? '' : 'm'} atenção:`));
      novos.forEach((a) => partes.push(cartaoAlerta(a)));
    }

    // 1a. Orientação imediata (dataset + regras) — logo após os alertas, só quando o plano mudou
    const assinaturaPassos = analise.proximosPassos.join('\n');
    if (assinaturaPassos !== passosAnteriores && analise.proximosPassos.length) {
      passosAnteriores = assinaturaPassos;
      partes.push(secao('👣 Orientação — como seguir'));
      const ol = el('ol', 'chat-passos');
      analise.proximosPassos.forEach((p) => ol.append(el('li', null, p)));
      partes.push(ol);
    }

    // 1b. Condições clínicas reconhecidas pela primeira vez nesta conversa
    const condNovas = (analise.condicoesClinicas || []).filter((c) => !condicoesMostradas.has(c.id));
    condNovas.forEach((c) => condicoesMostradas.add(c.id));
    if (condNovas.length) {
      partes.push(secao(condNovas.length === 1 ? 'Condição clínica reconhecida:' : 'Condições clínicas reconhecidas:'));
      condNovas.forEach((c) => partes.push(blocoCondicao(c)));
    }

    // 2. Quadros novos ou cujas causas prováveis mudaram
    const quadrosMudaram = analise.quadros.filter((q) => {
      const assinatura = q.possiveisCausas.filter((c) => c.sustentada).map((c) => c.causa).join('|');
      if (quadrosMostrados.get(q.id) === assinatura) return false;
      quadrosMostrados.set(q.id, assinatura);
      return true;
    });
    quadrosMudaram.forEach((q) => partes.push(blocoQuadro(q)));

    // 3. Procedimentos (primeira vez: todos; depois: só os que mudaram de status)
    // Só lista depois que há um quadro identificado (antes disso só existe a avaliação P001).
    if (analise.quadros.length || (analise.condicoesClinicas || []).length) {
      const primeiraVez = procStatus.size === 0;
      const lista = primeiraVez
        ? analise.procedimentos
        : analise.procedimentos.filter((p) => procStatus.get(p.id) !== p.status);
      analise.procedimentos.forEach((p) => procStatus.set(p.id, p.status));
      if (lista.length) {
        partes.push(secao(primeiraVez ? '📋 Procedimentos do dataset para este caso' : '📋 Mudou nos procedimentos'));
        lista.forEach((p) => partes.push(blocoProcedimento(p)));
      }
    }

    const iaVaiResponder = Boolean((analise.ia && analise.ia.resposta) || opcoes.iaPendente);

    // 5. Nada de novo: sugere a próxima pergunta pendente (se a IA não vai responder)
    if (!partes.length && !iaVaiResponder) {
      const pendente = analise.quadros.flatMap((q) => q.perguntasPendentes)[0];
      partes.push(el('p', null, pendente ? `Anotado. Próxima pergunta sugerida: ${pendente}` : 'Anotado ✅ Nada novo a sinalizar.'));
    }

    const negadosNovos = [...new Set(r.termosNegados.map((t) => t.termo.toLowerCase()))]
      .filter((t) => !negadosJaMostrados.has(t));
    negadosNovos.forEach((t) => negadosJaMostrados.add(t));
    if (negadosNovos.length) partes.push(el('p', 'chat-negados', `Considerei como negado: ${negadosNovos.join(', ')}.`));

    if (partes.length) balao('bot', ...partes);

    // 6. Resposta da IA já salva (ao reabrir um atendimento)
    if (analise.ia) mostrarIA(analise.ia);
  }

  function mostrarIA(ia, substituir) {
    let conteudo;
    if (ia && ia.resposta) {
      conteudo = [el('span', 'chat-ia-selo', `🤖 Auxiliar de Casos (${ia.modelo || 'IA'})`), ...textoFormatado(ia.resposta)];
    } else if (ia && ia.erro) {
      conteudo = [el('p', null, `🤖 IA indisponível: ${ia.erro} A orientação acima continua válida.`)];
    } else {
      if (substituir) substituir.remove();
      return;
    }
    const cls = ia.resposta ? 'chat-msg bot ia' : 'chat-msg bot ia-erro';
    if (substituir) {
      substituir.className = cls;
      substituir.replaceChildren(...conteudo);
      rolarParaFim();
    } else {
      balao(cls.replace('chat-msg ', ''), ...conteudo);
    }
  }

  // Etapa 2: pede a resposta da IA e mostra um "pensando…" enquanto isso.
  async function pedirIA(idConversa, idMensagem) {
    const aguardando = balao('bot ia aguardando', el('span', 'chat-ia-selo', '🤖 Auxiliar de Casos'),
      el('p', 'chat-ia-pensando', 'Analisando o caso…'));
    try {
      const ia = await gerarIACopiloto(idConversa, idMensagem);
      if (idConversa !== conversaId) { aguardando.remove(); return; } // usuário trocou de atendimento
      mostrarIA(ia, aguardando);
    } catch (err) {
      mostrarIA({ erro: err.message || 'falha ao consultar a IA.' }, aguardando);
    }
  }

  // Markdown mínimo e seguro (sem innerHTML): parágrafos, listas "-"/"*"/"1." e **negrito**.
  function inline(texto) {
    const frag = document.createDocumentFragment();
    texto.split(/(\*\*[^*]+\*\*)/g).forEach((pedaco) => {
      if (/^\*\*[^*]+\*\*$/.test(pedaco)) frag.append(el('b', null, pedaco.slice(2, -2)));
      else if (pedaco) frag.append(pedaco);
    });
    return frag;
  }

  function textoFormatado(texto) {
    const nos = [];
    let lista = null;
    for (const linhaBruta of texto.split(/\r?\n/)) {
      const linha = linhaBruta.trim();
      if (!linha) { lista = null; continue; }
      const item = linha.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) {
        if (!lista) { lista = el('ul', 'chat-ia-lista'); nos.push(lista); }
        const li = el('li');
        li.append(inline(item[1]));
        lista.append(li);
      } else {
        lista = null;
        const p = el('p');
        p.append(inline(linha.replace(/^#+\s*/, '')));
        nos.push(p);
      }
    }
    return nos;
  }

  function boasVindas() {
    balao('bot',
      el('p', null, 'Olá, Luana! 👋 Selecione um paciente acima para eu carregar a ficha e já trazer a orientação inicial, ou descreva um caso livremente.'),
      el('p', 'chat-dica', 'Pode mandar aos poucos: queixa, histórico, medicamentos, sinais vitais (ex.: "SpO2 92%, FC 110"). Eu aponto sinais de alerta, possíveis causas, procedimentos compatíveis e como seguir.'));
  }

  function cartaoPaciente(p) {
    const detalhes = [
      p.idade !== null && p.idade !== undefined ? `${p.idade} anos` : null,
      `${p.totalSessoes} ${p.totalSessoes === 1 ? 'sessão registrada' : 'sessões registradas'}`,
      p.ultimaSessao ? `última em ${p.ultimaSessao}` : null,
    ].filter(Boolean).join(' · ');
    balao('bot sistema', el('p', null, `👤 Atendimento de ${p.nome}`), el('p', 'chat-dica', detalhes));
  }

  // ─── Paciente cadastrado ───
  async function carregarPacientes() {
    try {
      const lista = await listarPacientes();
      lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      for (const p of lista) {
        const opt = document.createElement('option');
        opt.value = p.id_paciente;
        opt.textContent = p.nome;
        pacienteSelect.append(opt);
      }
    } catch { /* sem lista: segue com relato livre */ }
  }

  async function iniciarComPaciente(idPaciente) {
    limparEstado();
    fecharHistorico();
    const digitando = balao('bot digitando', el('span'), el('span'), el('span'));
    try {
      const r = await iniciarAtendimentoCopiloto(idPaciente);
      digitando.remove();
      if (!r) return;
      conversaId = r.conversaId;
      cartaoPaciente(r.paciente);
      responder(r.analise, { iaPendente: r.iaPendente });
      if (r.iaPendente) pedirIA(r.conversaId, r.mensagemId);
      input.focus();
    } catch (err) {
      digitando.remove();
      balao('bot erro', el('p', null, `Não consegui abrir a ficha: ${err.message || 'erro desconhecido'}`));
    }
  }

  function limparEstado() {
    conversaId = null;
    alertasJaMostrados = new Set();
    negadosJaMostrados = new Set();
    quadrosMostrados = new Map();
    condicoesMostradas = new Set();
    procStatus = new Map();
    passosAnteriores = '';
    mensagensEl.replaceChildren();
    setStatus('VAZIO');
  }

  function novaConsulta(focar = true) {
    limparEstado();
    fecharHistorico();
    pacienteSelect.value = '';
    boasVindas();
    if (focar) input.focus();
  }

  async function enviar(texto) {
    texto = texto.trim();
    if (!texto || enviando) return;
    enviando = true;
    balao('user', el('p', null, texto));
    input.value = '';
    ajustarAltura();

    const digitando = balao('bot digitando', el('span'), el('span'), el('span'));
    try {
      const r = await enviarMensagemCopiloto(conversaId, texto, extrairContexto(texto));
      digitando.remove();
      if (r) {
        conversaId = r.conversaId;
        // Etapa 1: orientação do dataset na hora. Etapa 2: IA chega em seguida, sem travar o chat.
        responder(r.analise, { iaPendente: r.iaPendente });
        if (r.iaPendente) pedirIA(r.conversaId, r.mensagemId);
      }
    } catch (err) {
      digitando.remove();
      setStatus('ERRO');
      balao('bot erro', el('p', null, `Não consegui analisar agora: ${err.message || 'erro desconhecido'}`));
    } finally {
      enviando = false;
      input.focus();
    }
  }

  // ─── Histórico ───

  function formatarData(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderizarLista() {
    const termo = historicoBuscaEl.value.trim().toLowerCase();
    const lista = conversasCache.filter((c) =>
      !termo || `${c.titulo} ${c.paciente_nome || ''} ${c.quadros || ''}`.toLowerCase().includes(termo));
    historicoListaEl.replaceChildren();
    if (!lista.length) {
      historicoListaEl.append(el('p', 'chat-historico-vazio',
        conversasCache.length ? 'Nenhum atendimento encontrado.' : 'Nenhum atendimento salvo ainda. Suas conversas aparecem aqui automaticamente.'));
      return;
    }
    for (const c of lista) {
      const item = el('div', `chat-historico-item${c.id === conversaId ? ' atual' : ''}`);
      const abrir = el('button', 'chat-historico-abrir');
      abrir.type = 'button';
      const titulo = el('span', 'chat-historico-titulo', c.titulo);
      titulo.prepend(el('span', `chat-historico-status ${(c.status || '').toLowerCase()}`));
      titulo.title = c.titulo;
      const meta = el('span', 'chat-historico-meta');
      meta.append(
        el('span', '', formatarData(c.atualizado_em)),
        el('span', '', `${c.total_mensagens} msg`),
      );
      if (c.quadros) meta.append(el('span', 'chat-historico-quadro', c.quadros));
      abrir.append(titulo, meta);
      abrir.addEventListener('click', () => abrirConversa(c.id));

      const excluir = el('button', 'chat-historico-excluir');
      excluir.type = 'button';
      excluir.title = 'Excluir atendimento';
      excluir.append(el('span', 'material-symbols-outlined', 'delete'));
      excluir.addEventListener('click', () => confirmarExclusao(item, c));

      item.append(abrir, excluir);
      historicoListaEl.append(item);
    }
  }

  // Confirmação embutida no próprio item (sem confirm() do navegador).
  function confirmarExclusao(item, c) {
    item.replaceChildren();
    item.classList.add('confirmando');
    const sim = el('button', 'chat-historico-sim', 'Excluir');
    const nao = el('button', 'chat-historico-nao', 'Cancelar');
    sim.type = nao.type = 'button';
    nao.addEventListener('click', renderizarLista);
    sim.addEventListener('click', async () => {
      try {
        await excluirConversaCopiloto(c.id);
        conversasCache = conversasCache.filter((x) => x.id !== c.id);
        if (c.id === conversaId) novaConsulta(false);
        renderizarLista();
      } catch (err) {
        showNotification(err.message || 'Falha ao excluir', 'error');
        renderizarLista();
      }
    });
    item.append(el('span', 'chat-historico-pergunta', `Excluir "${c.titulo}"?`), sim, nao);
  }

  async function abrirHistorico() {
    historicoEl.hidden = false;
    historicoBuscaEl.value = '';
    historicoListaEl.replaceChildren(el('p', 'chat-historico-vazio', 'Carregando…'));
    try {
      conversasCache = await listarConversasCopiloto();
      renderizarLista();
    } catch (err) {
      historicoListaEl.replaceChildren(el('p', 'chat-historico-vazio', `Não foi possível carregar: ${err.message}`));
    }
  }

  function fecharHistorico() {
    historicoEl.hidden = true;
  }

  async function abrirConversa(id) {
    try {
      const c = await obterConversaCopiloto(id);
      if (!c) return;
      limparEstado();
      fecharHistorico();
      conversaId = c.id;
      pacienteSelect.value = c.id_paciente ? String(c.id_paciente) : '';
      balao('bot sistema', el('p', null, `📂 Atendimento de ${formatarData(c.criado_em)} reaberto. Pode continuar de onde parou.`));
      if (c.paciente) cartaoPaciente(c.paciente);
      // Reproduz a conversa com as análises salvas, na mesma ordem.
      for (const m of c.mensagens) {
        if (m.tipo !== 'ficha') balao('user', el('p', null, m.texto));
        responder(m.analise);
      }
      input.focus();
    } catch (err) {
      showNotification(err.message || 'Falha ao abrir atendimento', 'error');
    }
  }

  function ajustarAltura() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(input.value); }
  });
  input.addEventListener('input', ajustarAltura);
  document.getElementById('cop-novo').addEventListener('click', () => novaConsulta());
  document.getElementById('cop-historico-btn').addEventListener('click', () =>
    (historicoEl.hidden ? abrirHistorico() : fecharHistorico()));
  document.getElementById('cop-historico-fechar').addEventListener('click', fecharHistorico);
  historicoBuscaEl.addEventListener('input', renderizarLista);
  pacienteSelect.addEventListener('change', () => {
    if (pacienteSelect.value) iniciarComPaciente(Number(pacienteSelect.value));
    else novaConsulta();
  });

  novaConsulta(false);
  carregarPacientes();

  // Mostra o selo do Auxiliar de Casos quando a IA generativa estiver ligada no backend.
  obterStatusCopiloto()
    .then((s) => {
      if (s && s.ia && s.ia.habilitada) {
        document.getElementById('cop-aviso-ia').hidden = false;
        input.placeholder = 'Escreva o relato ou faça uma pergunta sobre o caso…';
      }
    })
    .catch(() => { /* sem status: segue só com regras */ });
})();
