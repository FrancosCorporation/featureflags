const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'featureflags_admin_token';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let flags = [];

function setNotice(elemento, texto = '', erro = false) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
  elemento.classList.toggle('error', Boolean(erro && texto));
}

function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

async function requisicao(caminho, { bearer = '', ...opcoes } = {}) {
  const headers = new Headers(opcoes.headers || {});
  if (opcoes.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  const resposta = await fetch(caminho, { ...opcoes, headers, credentials: 'same-origin' });
  const tipo = resposta.headers.get('content-type') || '';
  const corpo = tipo.includes('application/json') ? await resposta.json() : null;
  if (!resposta.ok) {
    if (resposta.status === 401 && bearer) encerrarSessao();
    const erro = new Error(corpo?.erro?.mensagem || `Não foi possível concluir a solicitação (${resposta.status}).`);
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

function encerrarSessao() {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  $('login-view').hidden = false;
  $('panel-view').hidden = true;
}

async function carregarFlags() {
  if (!token) return false;
  $('refresh-button').disabled = true;
  setNotice($('panel-message'));
  try {
    flags = await requisicao('/api/flags', { bearer: token });
    renderizarFlags();
    return true;
  } catch (erro) {
    if (token) setNotice($('panel-message'), erro.message, true);
    return false;
  } finally {
    $('refresh-button').disabled = false;
  }
}

function criarCelula(conteudo) {
  const celula = document.createElement('td');
  if (conteudo instanceof Node) celula.append(conteudo);
  else celula.textContent = String(conteudo ?? '');
  return celula;
}

function renderizarFlags() {
  const corpo = $('flags-body');
  corpo.replaceChildren();
  $('empty-state').hidden = flags.length > 0;

  for (const flag of flags) {
    const linha = document.createElement('tr');
    const nome = criar('div', 'flag-name');
    nome.append(criar('code', '', flag.chave));
    nome.append(criar('span', '', flag.descricao || 'Sem descrição'));
    const ativa = Number(flag.ativa) === 1;
    const estado = criar('button', `status-toggle ${ativa ? 'is-on' : 'is-off'}`, ativa ? 'Ativa' : 'Desligada');
    estado.type = 'button';
    estado.setAttribute('aria-label', `${ativa ? 'Desligar' : 'Ativar'} flag ${flag.chave}`);
    estado.addEventListener('click', () => alterarFlag(flag.chave, { ativa: !ativa }, estado));

    const rollout = document.createElement('div');
    rollout.className = 'rollout-editor';
    const entrada = document.createElement('input');
    entrada.type = 'number';
    entrada.min = '0';
    entrada.max = '100';
    entrada.step = '1';
    entrada.value = String(flag.rollout);
    entrada.setAttribute('aria-label', `Percentual de rollout de ${flag.chave}`);
    const salvarRollout = criar('button', 'mini-button', 'Salvar');
    salvarRollout.type = 'button';
    salvarRollout.addEventListener('click', () => {
      if (!entrada.reportValidity()) return;
      alterarFlag(flag.chave, { rollout: Number(entrada.value) }, salvarRollout);
    });
    rollout.append(entrada, salvarRollout);

    const alvo = flag.atributo ? `${flag.atributo} = ${flag.valor_alvo}` : 'Todos os usuários';
    const alvoCelula = criarCelula(alvo);
    alvoCelula.className = 'target-cell';
    const acoes = criar('button', 'text-button', 'Editar');
    acoes.type = 'button';
    acoes.addEventListener('click', () => editarFlag(flag));
    const acoesCelula = criarCelula(acoes);
    acoesCelula.className = 'actions-cell';

    linha.append(criarCelula(nome), criarCelula(estado), criarCelula(rollout), alvoCelula, acoesCelula);
    corpo.append(linha);
  }
}

async function alterarFlag(chave, mudancas, botao) {
  botao.disabled = true;
  setNotice($('panel-message'));
  try {
    await requisicao(`/api/flags/${encodeURIComponent(chave)}`, {
      method: 'PATCH', bearer: token, body: JSON.stringify(mudancas)
    });
    await carregarFlags();
    setNotice($('panel-message'), 'Alteração salva.');
  } catch (erro) {
    if (token) setNotice($('panel-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

function editarFlag(flag) {
  $('original-key').value = flag.chave;
  $('flag-key').value = flag.chave;
  $('flag-key').disabled = true;
  $('flag-description').value = flag.descricao || '';
  $('flag-rollout').value = String(flag.rollout);
  $('flag-attribute').value = flag.atributo || '';
  $('flag-target').value = flag.valor_alvo || '';
  $('editor-title').textContent = 'Editar flag';
  $('save-flag-button').textContent = 'Salvar alterações';
  $('cancel-edit-button').hidden = false;
  $('flag-key').focus();
  $('flag-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function limparFormulario() {
  $('flag-form').reset();
  $('original-key').value = '';
  $('flag-key').disabled = false;
  $('flag-rollout').value = '100';
  $('editor-title').textContent = 'Criar uma flag';
  $('save-flag-button').textContent = 'Criar flag';
  $('cancel-edit-button').hidden = true;
}

async function salvarFlag(evento) {
  evento.preventDefault();
  const original = $('original-key').value;
  const botao = $('save-flag-button');
  botao.disabled = true;
  setNotice($('panel-message'));
  const corpo = {
    descricao: $('flag-description').value.trim(),
    rollout: Number($('flag-rollout').value),
    atributo: $('flag-attribute').value.trim(),
    valorAlvo: $('flag-target').value.trim()
  };
  if (!original) corpo.chave = $('flag-key').value.trim();
  else corpo.valor_alvo = corpo.valorAlvo;
  delete corpo.valorAlvo;

  try {
    await requisicao(original ? `/api/flags/${encodeURIComponent(original)}` : '/api/flags', {
      method: original ? 'PATCH' : 'POST', bearer: token, body: JSON.stringify(corpo)
    });
    limparFormulario();
    await carregarFlags();
    setNotice($('panel-message'), original ? 'Flag atualizada.' : 'Flag criada.');
  } catch (erro) {
    if (token) setNotice($('panel-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

async function entrar(evento) {
  evento.preventDefault();
  const botao = $('login-button');
  botao.disabled = true;
  setNotice($('login-message'));
  try {
    const resultado = await requisicao('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('login-email').value.trim(), senha: $('login-password').value })
    });
    token = resultado.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    const carregou = await carregarFlags();
    if (carregou) {
      $('login-view').hidden = true;
      $('panel-view').hidden = false;
      $('login-form').reset();
    }
  } catch (erro) {
    setNotice($('login-message'), erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

$('login-form').addEventListener('submit', entrar);
$('flag-form').addEventListener('submit', salvarFlag);
$('cancel-edit-button').addEventListener('click', limparFormulario);
$('logout-button').addEventListener('click', encerrarSessao);
$('refresh-button').addEventListener('click', carregarFlags);

if (token) {
  $('login-view').hidden = true;
  $('panel-view').hidden = false;
  carregarFlags();
} else {
  $('login-email').focus();
}
