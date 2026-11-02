const appRoot = document.querySelector('#app');
const notice = document.querySelector('#notice');
let invitationCode = decodeURIComponent(location.pathname.match(/^\/convite\/([^/]+)/)?.[1] || '');
let invite = null;
let gifts = [];
const selectedGiftIds = new Set();
const giftImageUrls = {
  'Liquidificador': '/images/products/liquidificador.jpg',
  'Sanduicheira elétrica': '/images/products/sanduicheira-eletrica.jpg',
  'Cafeteira elétrica': '/images/products/cafeteira-eletrica.jpg',
  'Batedeira': '/images/products/batedeira.jpg',
  'Grill elétrico': '/images/products/grill-eletrico.jpg',
  'Panela elétrica de arroz': '/images/products/panela-eletrica-arroz.jpg',
  'Fritadeira Air Fryer': '/images/products/air-fryer.jpg',
  'Aspirador de pó': '/images/products/aspirador-po.jpg',
  'Panela de pressão elétrica': '/images/products/panela-pressao-eletrica.jpg',
  'Micro-ondas': '/images/products/micro-ondas.jpg',
  'Smart TV': '/images/products/smart-tv.jpg',
  'Ar condicionado': '/images/products/ar-condicionado.jpg',
  'Geladeira Electrolux duas portas': '/images/products/geladeira.jpg',
  'Lava-louças': '/images/products/lava-loucas.jpg',
  'Máquina lava e seca': '/images/products/maquina-lava-e-seca.jpg'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function money(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.erro || 'Não foi possível concluir essa etapa.');
  return body;
}

function weddingSections() {
  return `
    <section class="hero" aria-label="Rhyann e Letícia">
      <img class="hero-photo" src="/images/1.jpg" alt="Rhyann e Letícia juntos na praia" fetchpriority="high">
      <div class="hero-shade"></div>
      <div class="hero-copy"><span>COM ALEGRIA, CONVIDAMOS VOCÊ PARA CELEBRAR</span><h1>Rhyann <i>&</i> Letícia</h1><p>19 · 12 · 2026</p><a class="round-link" href="#contagem">DESLIZE PARA CONTINUAR <b>↓</b></a></div>
      <span class="hero-side">NOSSO CASAMENTO · 19 DE DEZEMBRO DE 2026</span>
    </section>
    <section class="intro-section paper-section" id="contagem">
      <p class="eyebrow">Uma nova fase começa...</p><h2>Estamos contando os dias</h2>
      <div class="countdown" id="countdown"><div><strong>—</strong><span>DIAS</span></div><i></i><div><strong>—</strong><span>HORAS</span></div><i></i><div><strong>—</strong><span>MINUTOS</span></div><i></i><div><strong>—</strong><span>SEGUNDOS</span></div></div>
      <p class="section-note">Será muito especial ter você com a gente.</p>
      <a class="text-link" href="#celebracao">CONHEÇA OS DETALHES <span>↓</span></a>
    </section>
    <section class="photo-break"><img src="/images/2.jpg" alt="Rhyann e Letícia celebrando juntos" loading="lazy"><span>O nosso para sempre começa aqui</span></section>
    <section class="event-section paper-section" id="celebracao">
      <p class="eyebrow">Reserve a data</p><h2>O grande dia</h2>
      <div class="date-stamp"><span>SÁBADO</span><strong>19</strong><span>DEZEMBRO</span></div>
      <div class="event-details">
        <article class="event-detail"><span class="detail-icon">✧</span><h3>Recepção</h3><p class="pending">19h · Sal e Brasa — João Pessoa</p><span class="event-address">Av. Cabo Branco, 1830 - Cabo Branco<br>CEP 58045-010 · João Pessoa/PB</span><p class="event-note"><strong>Dress code</strong><br>Branco e verde</p><span class="detail-icon event-note-divider" aria-hidden="true">✧</span><p class="event-note">Preparamos tudo com carinho para compartilhar esse momento especial com você. O jantar será uma cortesia dos noivos. As bebidas serão de responsabilidade de cada convidado.</p></article>
      </div>
    </section>
    <section class="gallery-section">
      <div class="gallery-heading"><p class="eyebrow">Nós dois</p><h2>Um pouco da nossa história</h2></div>
      <div class="photo-grid">${[3, 4, 5, 6].map((number, index) => `<figure class="gallery-photo photo-${index + 1}"><img src="/images/${number}.jpg" alt="Rhyann e Letícia, foto ${index + 1} da galeria" loading="lazy"></figure>`).join('')}</div>
    </section>
    <section class="rsvp-section paper-section" id="confirmacao">
      <p class="eyebrow">Esperamos por você</p><h2>Você vem celebrar com a gente?</h2>
      <p class="section-note">Confirme sua presença pelo seu convite individual.</p>
      <div id="rsvp-area"></div>
    </section>
    <section class="gifts-section paper-section" id="presentes">
      <p class="eyebrow">Com carinho</p><h2>Lista de presentes</h2>
      <p class="section-note">Estamos construindo juntos um novo capítulo, repleto de sonhos e planos. Nossa lista foi pensada com carinho e traz sugestões simbólicas, cujos valores serão destinados a tornar realidade alguns dos nossos sonhos.</p>
      <div id="gift-area"><div class="preview-pending">A lista de presentes aparece após a confirmação da presença.</div></div>
    </section>
    <section class="closing-section"><img src="/images/7.jpg" alt="Rhyann e Letícia juntos" loading="lazy"><div class="closing-copy"><span>COM AMOR</span><h2>Rhyann <i>&</i> Letícia</h2><p>19 · 12 · 2026</p></div></section>`;
}

function startCountdown() {
  const target = new Date('2026-12-19T19:00:00-03:00').getTime();
  const update = () => {
    const remaining = Math.max(0, target - Date.now());
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const values = [days, hours, minutes, seconds];
    document.querySelectorAll('#countdown strong').forEach((node, index) => { node.textContent = String(values[index]).padStart(2, '0'); });
  };
  update();
  window.setInterval(update, 1000);
}

function renderRsvpArea() {
  const area = document.querySelector('#rsvp-area');
  if (!invitationCode) {
    area.innerHTML = `<form id="preview-code-form" class="code-form"><label for="invite-code">Código do convite</label><div><input id="invite-code" required autocomplete="off" placeholder="Digite seu código"><button class="pill-button" type="submit">Continuar</button></div></form>`;
    document.querySelector('#preview-code-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = document.querySelector('#invite-code').value.trim();
      if (!code) return;
      try {
        const foundInvite = await requestJson(`/api/convites/${encodeURIComponent(code)}`);
        invitationCode = code;
        invite = foundInvite;
        history.pushState({}, '', `/convite/${encodeURIComponent(code)}`);
        renderInviteState();
        document.querySelector('#confirmacao').scrollIntoView({ behavior: 'smooth' });
      } catch (error) { showNotice(error.message); }
    });
    return;
  }
  if (!invite) {
    area.innerHTML = '<div class="rsvp-loading">Carregando seu convite...</div>';
    return;
  }
  if (invite?.confirmacao === 1) {
    area.innerHTML = `<p class="rsvp-done">Presença confirmada. Estamos felizes por celebrar com você, ${escapeHtml(invite.nome)}!</p><button class="text-link button-link" id="edit-rsvp">ALTERAR RESPOSTA</button>`;
    document.querySelector('#edit-rsvp').addEventListener('click', renderRsvpForm);
  } else if (invite?.confirmacao === 0) {
    area.innerHTML = `<p class="rsvp-done">Agradecemos por nos avisar, ${escapeHtml(invite.nome)}. Sua resposta foi registrada e não pode ser alterada.</p>`;
  } else renderRsvpForm();
}

function renderRsvpForm() {
  const area = document.querySelector('#rsvp-area');
  if (!invitationCode || !invite) {
    area.innerHTML = '<div class="rsvp-loading">Carregando seu convite...</div>';
    return;
  }
  area.innerHTML = `<p class="guest-greeting">Olá, ${escapeHtml(invite.nome)}!</p><p class="section-note">Escolha uma opção para confirmar sua presença.</p><form id="rsvp-fields" class="contact-fields"><label>E-mail<input id="email" type="email" autocomplete="email" placeholder="voce@email.com" value="${escapeHtml(invite.email || '')}" required></label><label>Celular<input id="telefone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000" value="${escapeHtml(invite.telefone || '')}" required></label></form><div class="button-row"><button class="pill-button" id="attend" type="button">Sim, estarei presente</button><button class="pill-button secondary" id="decline" type="button">Não poderei comparecer</button></div>`;
  document.querySelector('#attend').addEventListener('click', () => submitRsvp(1));
  document.querySelector('#decline').addEventListener('click', () => submitRsvp(0));
}

async function submitRsvp(confirmacao) {
  clearNotice();
  const form = document.querySelector('#rsvp-fields');
  if (confirmacao === 1 && !form.reportValidity()) return;
  const buttons = document.querySelectorAll('#rsvp-area button');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const email = document.querySelector('#email')?.value.trim();
    const telefone = document.querySelector('#telefone')?.value.trim();
    await requestJson(`/api/convites/${encodeURIComponent(invitationCode)}/resposta`, { method: 'POST', body: JSON.stringify({ confirmacao, email, telefone }) });
    invite.confirmacao = confirmacao;
    if (email) invite.email = email;
    if (telefone) invite.telefone = telefone;
    renderInviteState();
    if (confirmacao === 1) document.querySelector('#presentes').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false; });
    showNotice(error.message);
  }
}

async function renderGiftArea() {
  const area = document.querySelector('#gift-area');
  if (!invitationCode || invite?.confirmacao !== 1) {
    area.innerHTML = '<div class="preview-pending">A lista de presentes fica disponível após confirmar presença.</div>';
    return;
  }
  area.innerHTML = '<div class="gift-loading">Carregando a lista de presentes...</div>';
  try {
    gifts = await requestJson('/api/presentes');
    if (!gifts.length) {
      area.innerHTML = '<div class="preview-pending">A nova lista de presentes está sendo preparada.</div>';
      return;
    }
    const interactive = true;
    area.innerHTML = `<div class="gifts-grid">${gifts.map((gift) => {
      const soldOut = !gift.disponivel;
      const imageUrl = giftImageUrls[gift.nome];
      const tag = interactive ? 'label' : 'article';
      const selector = interactive ? `<input class="gift-check" type="checkbox" value="${gift.id}" ${soldOut ? 'disabled' : ''}><span class="gift-checkmark">${soldOut ? 'ESGOTADO' : '♡'}</span>` : '';
      const image = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(gift.nome)}" loading="lazy" referrerpolicy="no-referrer">`
        : '<span class="gift-image-fallback">Imagem ilustrativa</span>';
      return `<${tag} class="gift-card ${soldOut ? 'is-unavailable' : ''}">${selector}<div class="gift-photo">${image}</div><h3>${escapeHtml(gift.nome)}</h3><p>${escapeHtml(gift.descricao || '')}</p><strong>${money(gift.valorCentavos)}</strong><small>${gift.limiteEscolhas === null ? 'Disponível' : `${gift.quantidadeEscolhida} de ${gift.limiteEscolhas} escolhas`}</small></${tag}>`;
    }).join('')}</div>${interactive ? `<div class="gift-actions"><p><span id="selection-count">Nenhum presente selecionado</span><strong id="selection-total">R$ 0,00</strong></p><button class="pill-button" id="checkout">Presentear</button></div>` : '<p class="preview-hint">Prévia dos presentes • A escolha fica disponível no convite individual após a confirmação de presença.</p>'}`;
    area.querySelectorAll('.gift-photo img').forEach((image) => image.addEventListener('error', () => {
      image.replaceWith(Object.assign(document.createElement('span'), { className: 'gift-image-fallback', textContent: 'Imagem ilustrativa' }));
    }, { once: true }));
    if (!interactive) return;
    area.querySelectorAll('.gift-check').forEach((checkbox) => checkbox.addEventListener('change', () => {
      const id = Number(checkbox.value);
      if (checkbox.checked) selectedGiftIds.add(id); else selectedGiftIds.delete(id);
      checkbox.closest('.gift-card').classList.toggle('is-selected', checkbox.checked);
      updateGiftTotal();
    }));
    document.querySelector('#checkout').addEventListener('click', checkout);
    updateGiftTotal();
  } catch (error) { area.innerHTML = `<div class="preview-pending">${escapeHtml(error.message)}</div>`; }
}

function updateGiftTotal() {
  const count = selectedGiftIds.size;
  const total = gifts.filter((gift) => selectedGiftIds.has(gift.id)).reduce((sum, gift) => sum + gift.valorCentavos, 0);
  const countElement = document.querySelector('#selection-count');
  const totalElement = document.querySelector('#selection-total');
  if (countElement) countElement.textContent = count ? `${count} presente(s) selecionado(s)` : 'Nenhum presente selecionado';
  if (totalElement) totalElement.textContent = money(total);
}

async function checkout() {
  if (!selectedGiftIds.size) return showNotice('Escolha pelo menos um presente.');
  const button = document.querySelector('#checkout');
  button.disabled = true;
  button.textContent = 'Preparando checkout...';
  try {
    const order = await requestJson(`/api/convites/${encodeURIComponent(invitationCode)}/pedidos`, { method: 'POST', body: JSON.stringify({ presenteIds: [...selectedGiftIds] }) });
    location.assign(order.checkoutUrl);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Presentear';
    showNotice(error.message);
  }
}

function renderInviteState() {
  renderRsvpArea();
  renderGiftArea();
}

async function start() {
  appRoot.innerHTML = weddingSections();
  if (location.pathname === '/pagamento/retorno') {
    const result = document.createElement('section');
    result.className = 'payment-return';
    result.style.cssText = 'padding:24px;text-align:center;color:#334d40;background:#e8ede6;font:400 15px/1.7 Georgia,serif';
    result.innerHTML = '<p class="eyebrow">Retorno do checkout</p><p class="payment-return-message" role="status" aria-live="polite">Estamos confirmando seu pagamento com a InfinitePay…</p>';
    document.querySelector('#contagem').after(result);
    const params = new URLSearchParams(location.search);
    const orderNsu = params.get('order_nsu');
    const transactionNsu = params.get('transaction_nsu');
    const slug = params.get('slug');
    const message = result.querySelector('.payment-return-message');
    if (!orderNsu || !transactionNsu || !slug) {
      message.textContent = 'Não recebemos os dados necessários para confirmar o pagamento. Se você concluiu a compra, aguarde alguns instantes e consulte seus pedidos pelo convite.';
    } else {
      requestJson('/api/pagamentos/infinitepay/retorno/verificar', {
        method: 'POST',
        body: JSON.stringify({ orderNsu, transactionNsu, slug })
      }).then((payment) => {
        message.textContent = payment.pago
          ? 'Pagamento confirmado. Muito obrigado pelo carinho com a gente!'
          : 'O pagamento ainda não foi confirmado. Se você acabou de pagar, aguarde um pouco e confira seus pedidos pelo convite.';
      }).catch(() => {
        message.textContent = 'Não foi possível confirmar agora. Se você concluiu a compra, aguarde alguns instantes e consulte seus pedidos pelo convite.';
      });
    }
  }
  startCountdown();
  renderRsvpArea();
  renderGiftArea();
  if (!invitationCode) return;
  try {
    invite = await requestJson(`/api/convites/${encodeURIComponent(invitationCode)}`);
    renderInviteState();
  } catch (_) {
    appRoot.innerHTML = `<section class="invalid-invite paper-section"><p class="eyebrow">Convite individual</p><h1>Não encontramos este convite</h1><p>Confira se o link recebido está completo.</p><a class="pill-button" href="/">Ver prévia do site</a></section>`;
  }
}

start();
