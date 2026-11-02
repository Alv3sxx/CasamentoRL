const loginForm = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const tokenInput = document.querySelector('#admin-token');
const message = document.querySelector('#message');
const inviteList = document.querySelector('#invite-list');
let adminToken = sessionStorage.getItem('weddingAdminToken') || '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

async function adminRequest(url, options = {}) {
  const headers = { Authorization: `Bearer ${adminToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir a solicitação.');
  return data;
}

function renderInvites(invites) {
  if (!invites.length) {
    inviteList.innerHTML = '<p class="empty">Nenhum convite encontrado.</p>';
    return;
  }

  inviteList.innerHTML = invites.map((invite) => {
    const status = invite.confirmacao === 1 ? 'Presença confirmada' : invite.confirmacao === 0 ? 'Não vai comparecer' : 'Sem resposta';
    let action = '';
    if (invite.confirmacao === 0 && invite.temPedido) {
      action = '<span class="blocked">Reatribuição bloqueada: há um pedido associado a este código.</span>';
    } else if (invite.confirmacao === 0) {
      action = `<div class="action"><input data-new-name="${escapeHtml(invite.codigo)}" maxlength="90" placeholder="Nome da nova pessoa" aria-label="Nome da nova pessoa para o código ${escapeHtml(invite.codigo)}"><button class="button reassign" data-code="${escapeHtml(invite.codigo)}" type="button">Reatribuir código</button></div>`;
    } else {
      action = '<span class="blocked">Disponível para nova resposta apenas após recusa.</span>';
    }
    return `<article class="invite-card"><div><span class="label">Convidado</span><strong>${escapeHtml(invite.nome)}</strong></div><div><span class="label">Código</span><code>${escapeHtml(invite.codigo)}</code></div><div><span class="label">Resposta</span><span class="status">${status}</span></div>${action}</article>`;
  }).join('');
}

async function loadInvites() {
  setMessage('Carregando convites…');
  try {
    const invites = await adminRequest('/api/admin/convites');
    renderInvites(invites);
    setMessage(`${invites.length} convites carregados.`);
  } catch (error) {
    setMessage(error.message, true);
    if (error.message === 'Chave administrativa inválida.') {
      sessionStorage.removeItem('weddingAdminToken');
      adminToken = '';
      dashboard.classList.add('hidden');
      loginForm.classList.remove('hidden');
      tokenInput.focus();
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  adminToken = tokenInput.value.trim();
  sessionStorage.setItem('weddingAdminToken', adminToken);
  loginForm.classList.add('hidden');
  dashboard.classList.remove('hidden');
  await loadInvites();
});

inviteList.addEventListener('click', async (event) => {
  const button = event.target.closest('.reassign');
  if (!button) return;
  const code = button.dataset.code;
  const input = inviteList.querySelector(`[data-new-name="${CSS.escape(code)}"]`);
  const nome = input?.value.trim() || '';
  if (!nome) return setMessage('Informe o nome da nova pessoa.', true);
  if (!window.confirm(`Reatribuir este código para ${nome}? A resposta e os contatos atuais serão removidos.`)) return;

  button.disabled = true;
  try {
    const result = await adminRequest(`/api/admin/convites/${encodeURIComponent(code)}/reatribuir`, {
      method: 'POST',
      body: JSON.stringify({ nome })
    });
    setMessage(result.mensagem);
    await loadInvites();
  } catch (error) {
    setMessage(error.message, true);
    button.disabled = false;
  }
});

document.querySelector('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('weddingAdminToken');
  adminToken = '';
  dashboard.classList.add('hidden');
  loginForm.classList.remove('hidden');
  inviteList.replaceChildren();
  message.textContent = '';
  tokenInput.value = '';
  tokenInput.focus();
});

if (adminToken) {
  tokenInput.value = adminToken;
  loginForm.classList.add('hidden');
  dashboard.classList.remove('hidden');
  loadInvites();
}
