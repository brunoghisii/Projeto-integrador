/* ============================================================
   copiloto.js — Copiloto Clínico (chat) no Painel
   Cada mensagem é salva no histórico (POST /api/copiloto/conversas/...)
   e o servidor analisa a conversa inteira. Cada pergunta vira um novo
   par de balões (profissional → assistente); nada é sobrescrito.
   Resposta do assistente, num único balão:
     1. alertas de triagem (topo, destacados);
     2. resposta da IA (Gemini), com o histórico da conversa como contexto;
     3. detalhes técnicos recolhíveis (orientação, quadros, procedimentos).
   Conversas antigas podem ser reabertas pelo painel de histórico.
   ============================================================ */

(function () {
  const form = document.getElementById('cop-form');
  if (!form) return;

  const input = document.getElementById('cop-input');
  const botaoEnviar = form.querySelector('.chat-enviar');
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

  const SUGESTOES = [
    'Montar plano para dor lombar crônica',
    'Sugerir exercícios para pós-operatório de joelho (LCA)',
    'Como avaliar uma dor no ombro ao elevar o braço?',
    'Quais sinais de alerta observar na cervicalgia?',
  ];

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
  let iaHabilitada = false;

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

  // ─── UI básica ───
  function el(tag, cls, texto) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function icone(nome) {
    return el('span', 'material-symbols-outlined', nome);
  }

  function rolarParaFim() {
    requestAnimationFrame(() => { mensagensEl.scrollTop = mensagensEl.scrollHeight; });
  }

  function primeiroNome() {
    const u = typeof getUsuario === 'function' ? getUsuario() : null;
    return String((u && u.nome) || '').trim().split(/\s+/)[0] || '';
  }

  /** Balão simples (mensagens da profissional e avisos do sistema). */
  function balao(autor, ...conteudo) {
    const b = el('div', `chat-msg ${autor}`);
    b.append(...conteudo);
    mensagensEl.append(b);
    rolarParaFim();
    return b;
  }

  function balaoUsuario(texto) {
    return balao('user', el('p', null, texto));
  }

  /**
   * Balão do assistente: avatar + corpo com três áreas fixas
   * (alertas no topo, resposta, detalhes técnicos).
   */
  function balaoAssistente() {
    const linha = el('div', 'chat-linha bot');
    const avatar = el('div', 'chat-avatar');
    avatar.append(icone('neurology'));
    const msg = el('div', 'chat-msg bot');
    const alertas = el('div', 'chat-area-alertas');
    const resposta = el('div', 'chat-area-resposta');
    const tecnico = el('div', 'chat-area-tecnico');
    msg.append(alertas, resposta, tecnico);
    linha.append(avatar, msg);
    mensagensEl.append(linha);
    rolarParaFim();
    return { linha, msg, alertas, resposta, tecnico };
  }

  function digitando() {
    const d = el('div', 'chat-digitando');
    d.setAttribute('aria-label', 'Assistente digitando');
    d.append(el('span'), el('span'), el('span'));
    return d;
  }

  function setStatus(status) {
    statusEl.dataset.status = status;
    statusEl.textContent = ROTULO_STATUS[status] || status;
  }

  function travarEntrada(travar) {
    enviando = travar;
    input.disabled = travar;
    atualizarBotao();
    if (!travar) input.focus();
  }

  function atualizarBotao() {
    botaoEnviar.disabled = enviando || !input.value.trim();
  }

  // ─── Markdown mínimo e seguro (sem innerHTML) ───
  function inline(texto) {
    const frag = document.createDocumentFragment();
    texto.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g).forEach((pedaco) => {
      if (/^\*\*[^*]+\*\*$/.test(pedaco)) frag.append(el('b', null, pedaco.slice(2, -2)));
      else if (/^(\*[^*]+\*|_[^_]+_)$/.test(pedaco)) frag.append(el('i', null, pedaco.slice(1, -1)));
      else if (pedaco) frag.append(pedaco);
    });
    return frag;
  }

  function markdown(texto) {
    const nos = [];
    let lista = null;
    let tipoLista = '';
    for (const linhaBruta of texto.split(/\r?\n/)) {
      const linha = linhaBruta.trim();
      if (!linha) { lista = null; continue; }
      const titulo = linha.match(/^#{1,6}\s+(.*)$/);
      const itemUl = linha.match(/^[-*•]\s+(.*)$/);
      const itemOl = linha.match(/^\d+[.)]\s+(.*)$/);
      if (titulo) {
        lista = null;
        const h = el('h4', 'chat-md-titulo');
        h.append(inline(titulo[1].replace(/\*\*/g, '')));
        nos.push(h);
      } else if (itemUl || itemOl) {
        const tipo = itemUl ? 'ul' : 'ol';
        if (!lista || tipoLista !== tipo) { lista = el(tipo, 'chat-md-lista'); tipoLista = tipo; nos.push(lista); }
        const li = el('li');
        li.append(inline((itemUl || itemOl)[1]));
        lista.append(li);
      } else {
        lista = null;
        const p = el('p');
        p.append(inline(linha));
        nos.push(p);
      }
    }
    return nos;
  }

  // ─── Blocos da análise por regras ───
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
    card.append(el('span', 'chat-tag', `Gravidade ${ROTULO_SEVERIDADE[a.severidade]}${a.sistemaCbdf ? ` · CBDF ${a.sistemaCbdf}` : ''}`));
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

  /**
   * Preenche o balão com a análise por regras: alertas novos no topo e o resto
   * (só o que mudou desde a última mensagem) num bloco técnico recolhível.
   * Sem IA, o bloco técnico já vem aberto, pois é a resposta principal.
   */
  function preencherAnalise(b, analise, comIA) {
    const r = analise.triagem;
    setStatus(r.status);

    // 1. Red flags novas — sempre no topo e visíveis
    const novos = r.alertas.filter((a) => !alertasJaMostrados.has(a.regraId));
    novos.forEach((a) => alertasJaMostrados.add(a.regraId));
    if (novos.length) {
      const critico = novos.some((a) => a.severidade === 'CRITICA');
      const titulo = el('p', `chat-alertas-titulo${critico ? ' critico' : ''}`);
      titulo.append(icone(critico ? 'emergency' : 'warning'), critico
        ? 'Sinal de alerta CRÍTICO — priorize a conduta abaixo'
        : `${novos.length === 1 ? 'Um ponto merece' : `${novos.length} pontos merecem`} atenção`);
      b.alertas.append(titulo);
      novos.forEach((a) => b.alertas.append(cartaoAlerta(a)));
    }

    // 2. Detalhes técnicos (só o que é novo nesta mensagem)
    const partes = [];
    const assinaturaPassos = analise.proximosPassos.join('\n');
    if (assinaturaPassos !== passosAnteriores && analise.proximosPassos.length) {
      passosAnteriores = assinaturaPassos;
      partes.push(secao('👣 Orientação — como seguir'));
      const ol = el('ol', 'chat-passos');
      analise.proximosPassos.forEach((p) => ol.append(el('li', null, p)));
      partes.push(ol);
    }

    const condNovas = (analise.condicoesClinicas || []).filter((c) => !condicoesMostradas.has(c.id));
    condNovas.forEach((c) => condicoesMostradas.add(c.id));
    if (condNovas.length) {
      partes.push(secao(condNovas.length === 1 ? '📚 Condição clínica reconhecida' : '📚 Condições clínicas reconhecidas'));
      condNovas.forEach((c) => partes.push(blocoCondicao(c)));
    }

    const quadrosMudaram = analise.quadros.filter((q) => {
      const assinatura = q.possiveisCausas.filter((c) => c.sustentada).map((c) => c.causa).join('|');
      if (quadrosMostrados.get(q.id) === assinatura) return false;
      quadrosMostrados.set(q.id, assinatura);
      return true;
    });
    if (quadrosMudaram.length) partes.push(secao('🩺 Raciocínio e CBDF'));
    quadrosMudaram.forEach((q) => partes.push(blocoQuadro(q)));

    // Procedimentos: só depois que há quadro/condição (antes disso só existe a avaliação P001).
    if (analise.quadros.length || (analise.condicoesClinicas || []).length) {
      const primeiraVez = procStatus.size === 0;
      const lista = primeiraVez
        ? analise.procedimentos
        : analise.procedimentos.filter((p) => procStatus.get(p.id) !== p.status);
      analise.procedimentos.forEach((p) => procStatus.set(p.id, p.status));
      if (lista.length) {
        partes.push(secao(primeiraVez ? '📋 Procedimentos do catálogo' : '📋 Mudou nos procedimentos'));
        lista.forEach((p) => partes.push(blocoProcedimento(p)));
      }
    }

    const negadosNovos = [...new Set(r.termosNegados.map((t) => t.termo.toLowerCase()))]
      .filter((t) => !negadosJaMostrados.has(t));
    negadosNovos.forEach((t) => negadosJaMostrados.add(t));
    if (negadosNovos.length) partes.push(el('p', 'chat-negados', `Considerei como negado: ${negadosNovos.join(', ')}.`));

    b.tecnico.replaceChildren();
    if (partes.length) {
      const d = el('details', 'chat-tecnico');
      if (!comIA) d.open = true;
      const s = el('summary');
      s.append(icone('clinical_notes'), comIA ? 'Detalhes técnicos da análise' : 'Análise do caso');
      d.append(s, ...partes);
      b.tecnico.append(d);
    }

    // Sem IA e sem nada novo: sugere a próxima pergunta pendente
    if (!comIA && !partes.length && !novos.length) {
      const pendente = analise.quadros.flatMap((q) => q.perguntasPendentes)[0];
      b.resposta.replaceChildren(el('p', null, pendente ? `Anotado. Próxima pergunta sugerida: ${pendente}` : 'Anotado ✅ Nada novo a sinalizar.'));
    }
  }

  /** Mostra a resposta da IA (ou a falha com "Tentar novamente") na área de resposta do balão. */
  function mostrarIA(b, ia, idConversa, idMensagem) {
    if (ia && ia.resposta) {
      b.msg.classList.remove('falhou');
      b.resposta.replaceChildren(...markdown(ia.resposta));
      return;
    }
    const nuncaGerada = !ia; // conversa antiga, de antes da IA estar ligada
    if (!nuncaGerada) b.msg.classList.add('falhou');
    const erro = el('div', nuncaGerada ? 'chat-erro pendente' : 'chat-erro');
    erro.append(el('p', null, nuncaGerada
      ? 'Esta mensagem ainda não tem resposta da IA.'
      : `Não consegui gerar a resposta agora${ia.erro ? ` (${ia.erro.replace(/\.$/, '')})` : ''}.`));
    const tentar = el('button', 'chat-tentar');
    tentar.type = 'button';
    tentar.append(icone('refresh'), nuncaGerada ? 'Gerar resposta' : 'Tentar novamente');
    tentar.addEventListener('click', async () => {
      if (enviando) return;
      travarEntrada(true);
      await pedirIA(b, idConversa, idMensagem);
      travarEntrada(false);
    });
    erro.append(tentar);
    if (b.tecnico.childElementCount) erro.append(el('p', 'chat-dica', 'A análise por regras abaixo continua válida.'));
    b.resposta.replaceChildren(erro);
  }

  async function pedirIA(b, idConversa, idMensagem) {
    b.resposta.replaceChildren(digitando());
    rolarParaFim();
    let ia;
    try {
      ia = await gerarIACopiloto(idConversa, idMensagem);
    } catch (err) {
      ia = { erro: err.message || 'falha de conexão' };
    }
    if (idConversa !== conversaId) return; // a profissional trocou de atendimento
    mostrarIA(b, ia || { erro: 'sem resposta do servidor' }, idConversa, idMensagem);
    rolarParaFim();
  }

  // ─── Boas-vindas ───
  function boasVindas() {
    const nome = primeiroNome();
    const b = balaoAssistente();
    b.msg.classList.add('boas-vindas');
    b.resposta.append(
      el('p', null, `Olá${nome ? `, ${nome}` : ''}! 👋 Sou o seu Auxiliar de Casos.`),
      el('p', null, 'Me conte o caso como contaria a um colega: queixa, tempo, o que piora ou melhora, sinais vitais. Ou escolha um paciente acima para eu carregar a ficha.'),
    );
    const chips = el('div', 'chat-sugestoes');
    for (const s of SUGESTOES) {
      const c = el('button', 'chat-sugestao', s);
      c.type = 'button';
      c.addEventListener('click', () => enviar(s));
      chips.append(c);
    }
    b.resposta.append(chips);
  }

  function cartaoPaciente(p) {
    const detalhes = [
      p.idade !== null && p.idade !== undefined ? `${p.idade} anos` : null,
      `${p.totalSessoes} ${p.totalSessoes === 1 ? 'sessão registrada' : 'sessões registradas'}`,
      p.ultimaSessao ? `última em ${p.ultimaSessao}` : null,
    ].filter(Boolean).join(' · ');
    return balao('sistema', el('p', null, `👤 Atendimento de ${p.nome}`), el('p', 'chat-dica', detalhes));
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
    travarEntrada(true);
    const b = balaoAssistente();
    b.resposta.append(digitando());
    try {
      const r = await iniciarAtendimentoCopiloto(idPaciente);
      if (!r) { b.linha.remove(); return; }
      conversaId = r.conversaId;
      b.linha.before(cartaoPaciente(r.paciente));
      preencherAnalise(b, r.analise, r.iaPendente);
      if (r.iaPendente) await pedirIA(b, r.conversaId, r.mensagemId);
      else b.resposta.replaceChildren();
    } catch (err) {
      b.resposta.replaceChildren(el('p', 'chat-erro', `Não consegui abrir a ficha: ${err.message || 'erro desconhecido'}`));
    } finally {
      travarEntrada(false);
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
    if (enviando) return;
    limparEstado();
    fecharHistorico();
    pacienteSelect.value = '';
    boasVindas();
    if (focar) input.focus();
  }

  // ─── Envio ───
  async function enviar(texto) {
    texto = texto.trim();
    if (!texto || enviando) return;
    // Sugestões da tela de boas-vindas somem quando a conversa começa
    mensagensEl.querySelectorAll('.chat-sugestoes').forEach((n) => n.remove());

    balaoUsuario(texto);
    input.value = '';
    ajustarAltura();
    travarEntrada(true);

    const b = balaoAssistente();
    await processar(b, texto);
    travarEntrada(false);
  }

  /** Etapa 1 (regras, na hora) + etapa 2 (IA). Em falha, o balão oferece "Tentar novamente". */
  async function processar(b, texto) {
    b.msg.classList.remove('falhou');
    b.resposta.replaceChildren(digitando());
    rolarParaFim();
    let r;
    try {
      r = await enviarMensagemCopiloto(conversaId, texto, extrairContexto(texto));
    } catch (err) {
      setStatus('ERRO');
      b.msg.classList.add('falhou');
      const erro = el('div', 'chat-erro');
      erro.append(el('p', null, `Não consegui enviar sua mensagem: ${err.message || 'erro desconhecido'}.`));
      const tentar = el('button', 'chat-tentar');
      tentar.type = 'button';
      tentar.append(icone('refresh'), 'Tentar novamente');
      tentar.addEventListener('click', async () => {
        if (enviando) return;
        travarEntrada(true);
        await processar(b, texto);
        travarEntrada(false);
      });
      erro.append(tentar);
      b.resposta.replaceChildren(erro);
      return;
    }
    if (!r) { b.linha.remove(); return; }
    conversaId = r.conversaId;
    preencherAnalise(b, r.analise, r.iaPendente);
    if (r.iaPendente) await pedirIA(b, r.conversaId, r.mensagemId);
    else if (b.resposta.querySelector('.chat-digitando')) b.resposta.replaceChildren();
    rolarParaFim();
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
      excluir.append(icone('delete'));
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
    if (enviando) return;
    try {
      const c = await obterConversaCopiloto(id);
      if (!c) return;
      limparEstado();
      fecharHistorico();
      conversaId = c.id;
      pacienteSelect.value = c.id_paciente ? String(c.id_paciente) : '';
      balao('sistema', el('p', null, `📂 Atendimento de ${formatarData(c.criado_em)} reaberto. Pode continuar de onde parou.`));
      if (c.paciente) cartaoPaciente(c.paciente);
      // Reproduz a conversa no mesmo formato: pergunta → resposta, na ordem em que aconteceu.
      for (const m of c.mensagens) {
        if (m.tipo !== 'ficha') balaoUsuario(m.texto);
        const b = balaoAssistente();
        const ia = m.analise.ia;
        const teveIA = Boolean(ia) || iaHabilitada;
        preencherAnalise(b, m.analise, teveIA);
        if (ia && ia.resposta) mostrarIA(b, ia, c.id, m.id);
        else if (teveIA) mostrarIA(b, ia, c.id, m.id);
      }
      rolarParaFim();
      input.focus();
    } catch (err) {
      showNotification(err.message || 'Falha ao abrir atendimento', 'error');
    }
  }

  function ajustarAltura() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    atualizarBotao();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(input.value); }
  });
  input.addEventListener('input', ajustarAltura);
  document.getElementById('cop-novo').addEventListener('click', () => novaConsulta());
  document.getElementById('cop-historico-btn').addEventListener('click', () =>
    (historicoEl.hidden ? abrirHistorico() : fecharHistorico()));
  document.getElementById('cop-historico-fechar').addEventListener('click', fecharHistorico);
  historicoBuscaEl.addEventListener('input', renderizarLista);
  pacienteSelect.addEventListener('change', () => {
    if (enviando) return;
    if (pacienteSelect.value) iniciarComPaciente(Number(pacienteSelect.value));
    else novaConsulta();
  });

  novaConsulta(false);
  atualizarBotao();
  carregarPacientes();

  // Mostra o selo do Auxiliar de Casos quando a IA generativa estiver ligada no backend.
  obterStatusCopiloto()
    .then((s) => {
      if (s && s.ia && s.ia.habilitada) {
        iaHabilitada = true;
        document.getElementById('cop-aviso-ia').hidden = false;
        input.placeholder = 'Escreva o relato ou faça uma pergunta sobre o caso…';
      }
    })
    .catch(() => { /* sem status: segue só com regras */ });
})();
