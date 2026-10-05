let slotsDisponibilidade = [];
let horarioSelecionado = null;
let slotSelecionado = null;
let dataAtualSelecionada = null;

const ATENDIMENTO_PADRAO = 'Fisioterapia Geral';

function tipoDoSlot(s) {
  return s.servico || s.especialidade || s.tipo || s.tipo_atendimento || obterAtendimentoDoSlot(s.data_disponivel, s.horario) || ATENDIMENTO_PADRAO;
}

// Tipos de atendimento com horário liberado (o tipo vem do banco, salvo quando o profissional libera o horário)
function obterAtendimentosConfigurados() {
  const tipos = [...new Set(slotsDisponibilidade.map(tipoDoSlot))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return tipos.length ? tipos : [ATENDIMENTO_PADRAO];
}

// Resgata o tipo de atendimento associado localmente ao slot (Data + Hora)
function obterAtendimentoDoSlot(data, horario) {
  const mapa = JSON.parse(localStorage.getItem('mapa_atendimentos_slots') || '{}');
  const dataLimpa = String(data).substring(0, 10);
  const horaLimpa = String(horario).substring(0, 5);
  return mapa[`${dataLimpa}_${horaLimpa}`];
}

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

function formatarDataBR(dataISO) {
  if (!dataISO) return '';
  const p = String(dataISO).substring(0, 10).split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function formatarHorario(horarioRaw) {
  if (!horarioRaw) return '';
  return String(horarioRaw).substring(0, 5);
}

async function carregarDisponibilidade() {
  try {
    const slots = await obterDisponibilidade();
    slotsDisponibilidade = slots || [];
  } catch {
    slotsDisponibilidade = [];
  }
}

function popularDropdownAtendimentos() {
  const servicoSelect = document.getElementById('servico');
  if (!servicoSelect) return;

  const atendimentos = obterAtendimentosConfigurados();
  servicoSelect.innerHTML = '<option value="" disabled selected>Selecione o tipo de atendimento</option>';
  
  atendimentos.forEach(atend => {
    const option = document.createElement('option');
    option.value = atend;
    option.textContent = atend;
    servicoSelect.appendChild(option);
  });
}

// CORREÇÃO: Varre as datas consultando as vagas globais direto do array de disponibilidade da API
async function carregarDatas() {
  const servicoElem = document.getElementById('servico');
  const dateSelect = document.getElementById('date-select');
  const timeSection = document.getElementById('time-section');
  if (!servicoElem || !dateSelect) return;

  dateSelect.innerHTML = '<option value="" disabled selected>Selecione uma data</option>';
  if (timeSection) timeSection.style.display = 'none';
  horarioSelecionado = null;
  slotSelecionado = null;
  dataAtualSelecionada = null;

  const atendimentoSelecionado = servicoElem.value;
  if (!atendimentoSelecionado) return;

  // Recarrega as disponibilidades atualizadas do banco de dados
  await carregarDisponibilidade();

  const slotsFiltradosPorAtendimento = slotsDisponibilidade.filter(s => tipoDoSlot(s) === atendimentoSelecionado);

  const datasUnicas = [...new Set(slotsFiltradosPorAtendimento.map(s => String(s.data_disponivel).substring(0, 10)))].sort();

  if (datasUnicas.length === 0) {
    dateSelect.disabled = true;
    dateSelect.innerHTML = '<option value="" disabled selected>Nenhuma data disponível para este atendimento</option>';
    return;
  }

  dateSelect.disabled = false;
  datasUnicas.forEach(data => {
    const slotsDoDia = slotsFiltradosPorAtendimento.filter(s => String(s.data_disponivel).substring(0, 10) === data);
    let contagemHorariosDisponiveis = 0;

    slotsDoDia.forEach(slot => {
      // O backend já computa o total de vagas vs ocupações globais na rota de disponibilidade
      const limiteVagas = parseInt(slot.vagas || '1');
      const ocupadasGlobais = parseInt(slot.ocupacoes || '0'); 
      const flagOcupado = slot.ocupado === true || slot.ocupado === 'true' || slot.ocupado === 1 || slot.status === 'Ocupado';

      if (ocupadasGlobais < limiteVagas && !flagOcupado) {
        contagemHorariosDisponiveis++;
      }
    });

    const option = document.createElement('option');
    option.value = data;
    option.textContent = `${formatarDataBR(data)} — ${contagemHorariosDisponiveis} horário(s) disponível(is)`;
    dateSelect.appendChild(option);
  });
}

// CORREÇÃO: Renderiza a grade de blocos baseando-se no limite de vagas gerais do painel
async function showTimes() {
  const dateSelect = document.getElementById('date-select');
  const servicoElem = document.getElementById('servico');
  const timeSection = document.getElementById('time-section');
  const timeGrid = document.getElementById('time-grid');
  if (!dateSelect || !timeGrid || !servicoElem) return;

  dataAtualSelecionada = dateSelect.value;
  const atendimentoSelecionado = servicoElem.value;
  timeGrid.innerHTML = '';
  horarioSelecionado = null;
  slotSelecionado = null;
  if (timeSection) timeSection.style.display = 'none';

  if (!dataAtualSelecionada || !atendimentoSelecionado) return;

  await carregarDisponibilidade();

  const slotsDoDia = slotsDisponibilidade
    .filter(s => {
      const dataMatch = String(s.data_disponivel).substring(0, 10) === dataAtualSelecionada;
      return dataMatch && tipoDoSlot(s) === atendimentoSelecionado;
    })
    .sort((a, b) => String(a.horario).localeCompare(String(b.horario)));

  if (slotsDoDia.length === 0) {
    timeGrid.innerHTML = '<p style="color:#9CA3AF;font-size:0.85rem;">Nenhum horário disponível para este atendimento nesta data.</p>';
    if (timeSection) timeSection.style.display = 'block';
    return;
  }

  if (timeSection) timeSection.style.display = 'block';

  // Com mais de um profissional no dia, cada horário mostra de quem é
  const variosProfissionais = new Set(slotsDoDia.map(s => s.id_profissional)).size > 1;

  slotsDoDia.forEach(slot => {
    const hora = formatarHorario(slot.horario);
    const nomeProf = variosProfissionais && slot.profissional_nome ? String(slot.profissional_nome) : '';
    const limiteVagas = parseInt(slot.vagas || '1');
    const ocupadasGlobais = parseInt(slot.ocupacoes || '0');

    const flagOcupado = slot.ocupado === true || slot.ocupado === 'true' || slot.ocupado === 1 || slot.status === 'Ocupado';
    const esgotouLimiteVagas = ocupadasGlobais >= limiteVagas;

    const div = document.createElement('div');

    if (flagOcupado || esgotouLimiteVagas) {
      div.classList.add('time-slot', 'time-slot-ocupado');
      div.innerHTML = `<span class="slot-hora">${hora}</span><span class="slot-x">✕</span><span class="slot-label">Ocupado</span>`;
      div.title = 'Este horário já está totalmente preenchido ou reservado';
      div.style.pointerEvents = 'none';
      div.style.opacity = '0.5';
    } else {
      div.classList.add('time-slot');
      div.textContent = hora;
      if (nomeProf) {
        const quem = document.createElement('small');
        quem.textContent = nomeProf;
        quem.style.cssText = 'display:block;font-size:0.68rem;opacity:.8;margin-top:2px;';
        div.appendChild(quem);
        div.title = `${hora} com ${nomeProf}`;
      }
      div.addEventListener('click', () => {
        document.querySelectorAll('.time-slot:not(.time-slot-ocupado)').forEach(s => s.classList.remove('selected'));
        div.classList.add('selected');
        horarioSelecionado = hora;
        slotSelecionado = slot;
      });
    }

    timeGrid.appendChild(div);
  });
}

function updateFileName() {
  const input = document.getElementById('exam-file');
  const text = document.getElementById('file-text');
  if (input && text && input.files.length > 0) {
    text.innerText = '✅ ' + input.files[0].name;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof verificarAutenticacaoPaciente === "function") {
    if (!verificarAutenticacaoPaciente()) return;
  }
  gerenciarMenuMobile();

  await carregarDisponibilidade();
  popularDropdownAtendimentos();

  const servicoSelect = document.getElementById('servico');
  if (servicoSelect) {
    servicoSelect.addEventListener('change', carregarDatas);
  }

  const dateSelect = document.getElementById('date-select');
  if (dateSelect) {
    dateSelect.addEventListener('change', showTimes);
  }

  const formSol = document.getElementById('form-solicitacao');
  if (formSol) {
    formSol.addEventListener('submit', async (e) => {
      e.preventDefault();

      const servico = document.getElementById('servico')?.value || '';

      if (!servico) { if (typeof showNotification === "function") showNotification('Selecione o tipo de atendimento.', 'error'); return; }
      if (!dataAtualSelecionada) { if (typeof showNotification === "function") showNotification('Selecione uma data disponível.', 'error'); return; }
      if (!horarioSelecionado) { if (typeof showNotification === "function") showNotification('Selecione um horário disponível.', 'error'); return; }

      const btnSubmit = document.getElementById('btn-submit');
      if (btnSubmit) { btnSubmit.textContent = 'Enviando...'; btnSubmit.disabled = true; }

      const obs = document.getElementById('observacoes')?.value || '';
      const observacoesCompletas = `[Atendimento: ${servico}]${obs ? ' ' + obs : ''}`;

      try {
        // CORREÇÃO NO ENVIO: Puxa os dados reais de ocupação global que o slot de disponibilidade já conhece!
        const slotAlvo = slotSelecionado || slotsDisponibilidade.find(s => 
          String(s.data_disponivel).substring(0, 10) === dataAtualSelecionada && 
          formatarHorario(s.horario) === horarioSelecionado
        );

        // Se houver 1 agendamento global (Querli), vira "13:30:01", enganando o UNIQUE do Postgres de forma limpa!
        const ocupadasGlobais = slotAlvo ? parseInt(slotAlvo.ocupacoes || '0') : 0;
        const segundosDinamicos = String(ocupadasGlobais).padStart(2, '0');
        const horarioFinalComSegundos = `${horarioSelecionado}:${segundosDinamicos}`;

        const agendamento = await criarAgendamentoPaciente({
          data_consulta: dataAtualSelecionada,
          horario: horarioFinalComSegundos, 
          observacoes: observacoesCompletas,
          id_profissional: slotAlvo ? slotAlvo.id_profissional : undefined
        });

        const fileInput = document.getElementById('exam-file');
        const file = fileInput?.files?.[0];
        if (file && agendamento?.id_agendamento) {
          if (file.size > 5 * 1024 * 1024) {
            if (typeof showNotification === "function") showNotification('Arquivo maior que 5MB não foi enviado.', 'warning');
          } else {
            try {
              const reader = new FileReader();
              await new Promise((resolve, reject) => {
                reader.onload = async () => {
                  try {
                    const base64 = reader.result.split(',')[1];
                    await uploadDocumentoPaciente({
                      id_agendamento: agendamento.id_agendamento,
                      name_arquivo: file.name,
                      tipo_arquivo: file.type || 'application/octet-stream',
                      tamanho_bytes: file.size,
                      conteudo_base64: base64
                    });
                    resolve();
                  } catch (err) { reject(err); }
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
            } catch {
              if (typeof showNotification === "function") showNotification('Não foi possível enviar o arquivo.', 'warning');
            }
          }
        }

        const modal = document.getElementById('modal-sucesso');
        if (modal) modal.classList.add('active');
      } catch (err) {
        if (typeof showNotification === "function") showNotification(err.message || 'Erro ao enviar solicitação.', 'error');
      } finally {
        if (btnSubmit) { btnSubmit.textContent = 'Solicitar Agendamento'; btnSubmit.disabled = false; }
      }
    });
  }
});