const express = require('express');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const eventInfo = require('./evento.json');
const { db } = require('./database');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use('/api/convites', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(req, res, next) {
  const expectedToken = process.env.ADMIN_TOKEN;
  const authorization = req.get('authorization') || '';
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  if (!expectedToken) return res.status(503).json({ erro: 'O painel de controle ainda não está configurado.' });
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return res.status(401).json({ erro: 'Chave administrativa inválida.' });
  }

  res.set('Cache-Control', 'no-store');
  return next();
}

const findInvite = db.prepare(
  'SELECT user_id, nome, confirmacao, email, telefone FROM convites WHERE cod = ?'
);
const findGift = db.prepare(
  'SELECT presente_id, nome, descricao, valor_centavos, limite_escolhas FROM presentes WHERE presente_id = ? AND ativo = 1'
);
const countGiftSelections = db.prepare(`
  SELECT COUNT(*) AS total
  FROM itens_pedido i
  JOIN pedidos p ON p.pedido_id = i.pedido_id
  WHERE i.presente_id = ? AND p.status IN ('pendente', 'pago')
`);
const findInviteGiftSelection = db.prepare(`
  SELECT 1
  FROM itens_pedido i
  JOIN pedidos p ON p.pedido_id = i.pedido_id
  WHERE p.user_id = ? AND i.presente_id = ? AND p.status IN ('pendente', 'pago')
  LIMIT 1
`);

function getBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : null;
}

async function createInfinitePayLink({ orderNsu, gifts }) {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    throw new ApiError(503, 'O pagamento ainda não está configurado.');
  }

  const siteUrl = getBaseUrl(process.env.PUBLIC_SITE_URL);
  const apiUrl = getBaseUrl(process.env.PUBLIC_API_URL);
  const payload = {
    handle,
    order_nsu: orderNsu,
    items: gifts.map((gift) => ({
      quantity: 1,
      price: gift.valor_centavos,
      description: gift.nome
    }))
  };

  if (siteUrl) payload.redirect_url = siteUrl + '/pagamento/retorno';
  if (apiUrl) payload.webhook_url = apiUrl + '/api/pagamentos/infinitepay/webhook';

  const response = await fetch('https://api.checkout.infinitepay.io/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new ApiError(502, 'A InfinitePay respondeu em um formato inesperado.');
  }

  if (!response.ok || typeof data.url !== 'string') {
    console.error('Falha ao criar checkout InfinitePay:', response.status, data);
    throw new ApiError(502, 'Não foi possível iniciar o pagamento. Tente novamente.');
  }

  return data.url;
}

async function verifyAndSavePayment({ orderNsu, transactionNsu, slug }) {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) throw new ApiError(503, 'O pagamento ainda não está configurado.');

  const order = db.prepare(
    'SELECT pedido_id, total_centavos, status FROM pedidos WHERE order_nsu = ?'
  ).get(orderNsu);
  if (!order) throw new ApiError(404, 'Pedido não encontrado.');
  if (order.status === 'pago') return { pago: true };

  const response = await fetch('https://api.checkout.infinitepay.io/payment_check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug
    }),
    signal: AbortSignal.timeout(10000)
  });

  let payment;
  try {
    payment = await response.json();
  } catch (_) {
    throw new ApiError(502, 'A InfinitePay respondeu em um formato inesperado.');
  }

  if (!response.ok) throw new ApiError(502, 'Não foi possível verificar o pagamento.');
  if (!payment.success || !payment.paid) return { pago: false };
  if (payment.amount !== order.total_centavos) {
    throw new ApiError(409, 'O valor confirmado não corresponde ao pedido.');
  }
  if (!['pix', 'credit_card'].includes(payment.capture_method)) {
    throw new ApiError(409, 'A InfinitePay informou uma forma de pagamento inesperada.');
  }

  db.prepare(`
    UPDATE pedidos
    SET status = 'pago', metodo_pagamento = ?, invoice_slug = ?,
        transaction_nsu = ?, valor_pago_centavos = ?, parcelas = ?, pago_em = CURRENT_TIMESTAMP
    WHERE pedido_id = ? AND status = 'pendente'
  `).run(
    payment.capture_method,
    slug,
    transactionNsu,
    payment.paid_amount,
    payment.installments || 1,
    order.pedido_id 
  );

  return { pago: true };
}

app.get('/api', (req, res) => {
  res.json({
    servico: 'API do casamento',
    status: 'ativo',
    rotas: [
      'GET /api/evento',
      'GET /api/convites/:codigo',
      'POST /api/convites/:codigo/resposta',
      'GET /api/presentes',
      'GET /api/admin/convites',
      'POST /api/admin/convites/:codigo/reatribuir',
      'POST /api/convites/:codigo/pedidos',
      'GET /api/convites/:codigo/pedidos',
      'POST /api/convites/:codigo/pedidos/:orderNsu/verificar',
      'POST /api/pagamentos/infinitepay/retorno/verificar',
      'POST /api/pagamentos/infinitepay/webhook'
    ]
  });
});

app.get('/api/evento', (req, res) => {
  res.json(eventInfo);
});

app.get('/api/admin/convites', requireAdmin, (req, res) => {
  const convites = db.prepare(`
    SELECT c.cod, c.nome, c.confirmacao,
           EXISTS(SELECT 1 FROM pedidos p WHERE p.user_id = c.user_id) AS tem_pedido
    FROM convites c
    ORDER BY c.nome COLLATE NOCASE, c.user_id
  `).all();
  return res.json(convites.map((convite) => ({
    codigo: convite.cod,
    nome: convite.nome,
    confirmacao: convite.confirmacao,
    temPedido: convite.tem_pedido === 1
  })));
});

app.post('/api/admin/convites/:codigo/reatribuir', requireAdmin, (req, res) => {
  const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
  if (!nome || nome.length > 90) {
    return res.status(400).json({ erro: 'Informe o nome da nova pessoa (até 90 caracteres).' });
  }

  const convite = db.prepare('SELECT user_id, confirmacao FROM convites WHERE cod = ?').get(req.params.codigo);
  if (!convite) return res.status(404).json({ erro: 'Convite não encontrado.' });
  if (convite.confirmacao !== 0) {
    return res.status(409).json({ erro: 'Só convites com resposta “não vou” podem ser reatribuídos.' });
  }
  if (db.prepare('SELECT 1 FROM pedidos WHERE user_id = ? LIMIT 1').get(convite.user_id)) {
    return res.status(409).json({ erro: 'Este convite tem um pedido associado e não pode ser reatribuído.' });
  }

  const result = db.prepare(`
    UPDATE convites
    SET nome = ?, confirmacao = NULL, email = NULL, telefone = NULL
    WHERE cod = ? AND confirmacao = 0
      AND NOT EXISTS (SELECT 1 FROM pedidos WHERE pedidos.user_id = convites.user_id)
  `).run(nome, req.params.codigo);
  if (result.changes === 0) {
    return res.status(409).json({ erro: 'O convite mudou de estado e não pode ser reatribuído.' });
  }
  return res.json({ mensagem: 'Código reatribuído; a nova pessoa poderá responder ao convite.', codigo: req.params.codigo, nome });
});

app.get('/api/convites/:codigo', (req, res) => {
  const convite = findInvite.get(req.params.codigo);
  if (!convite) {
    return res.status(404).json({ erro: 'Convite não encontrado.' });
  }
  return res.json({
    nome: convite.nome,
    confirmacao: convite.confirmacao,
    email: convite.email,
    telefone: convite.telefone
  });
});

app.post('/api/convites/:codigo/resposta', (req, res) => {
  const body = req.body || {};
  const confirmacao = body.confirmacao;

  if (confirmacao !== 0 && confirmacao !== 1) {
    return res.status(400).json({ erro: 'Confirmação deve ser o número 0 ou 1.' });
  }

  for (const [campo, limite] of [['email', 254], ['telefone', 32]]) {
    const valor = body[campo];
    if (valor !== undefined && valor !== null && typeof valor !== 'string') {
      return res.status(400).json({ erro: campo + ' deve ser texto.' });
    }
    if (typeof valor === 'string' && valor.trim().length > limite) {
      return res.status(400).json({ erro: campo + ' excede o tamanho permitido.' });
    }
  }

  const email = typeof body.email === 'string' ? body.email.trim() || null : null;
  const telefone = typeof body.telefone === 'string' ? body.telefone.trim() || null : null;
  if (confirmacao === 1 && (!email || !telefone)) {
    return res.status(400).json({ erro: 'Informe seu e-mail e celular para confirmar presença.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }

  const result = db.prepare(
    'UPDATE convites SET confirmacao = ?, email = COALESCE(?, email), telefone = COALESCE(?, telefone) WHERE cod = ? AND (confirmacao IS NULL OR confirmacao = 1)'
  ).run(confirmacao, email, telefone, req.params.codigo);

  if (result.changes === 0) {
    const convite = findInvite.get(req.params.codigo);
    if (!convite) return res.status(404).json({ erro: 'Convite não encontrado.' });
    if (convite.confirmacao === 0) {
      return res.status(409).json({ erro: 'Sua resposta de que não poderá comparecer já foi registrada e não pode ser alterada.' });
    }
  }
  return res.json({ mensagem: 'Confirmação registrada.' });
});

app.get('/api/presentes', (req, res) => {
  const gifts = db.prepare(`
    SELECT p.presente_id, p.nome, p.descricao, p.valor_centavos,
           p.limite_escolhas, COUNT(o.pedido_id) AS quantidade_escolhida
    FROM presentes p
    LEFT JOIN itens_pedido i ON i.presente_id = p.presente_id
    LEFT JOIN pedidos o ON o.pedido_id = i.pedido_id AND o.status IN ('pendente', 'pago')
    WHERE p.ativo = 1
    GROUP BY p.presente_id
    ORDER BY p.nome
  `).all();
  return res.json(gifts.map((gift) => ({
    id: gift.presente_id,
    nome: gift.nome,
    descricao: gift.descricao,
    valorCentavos: gift.valor_centavos,
    limiteEscolhas: gift.limite_escolhas,
    quantidadeEscolhida: gift.quantidade_escolhida,
    disponivel: gift.limite_escolhas === null
      || gift.quantidade_escolhida < gift.limite_escolhas
  })));
});

app.post('/api/convites/:codigo/pedidos', async (req, res, next) => {
  const convite = findInvite.get(req.params.codigo);
  if (!convite) return res.status(404).json({ erro: 'Convite não encontrado.' });
  if (convite.confirmacao !== 1) {
    return res.status(409).json({ erro: 'É necessário confirmar presença antes de escolher presentes.' });
  }
  if (!convite.email || !convite.telefone) {
    return res.status(409).json({ erro: 'Informe seu e-mail e celular antes de escolher presentes.' });
  }

  const ids = req.body && req.body.presenteIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 40) {
    return res.status(400).json({ erro: 'Envie uma lista com 1 a 40 presentes.' });
  }
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ erro: 'Os IDs devem ser inteiros positivos e não repetidos.' });
  }

  const gifts = [];
  for (const id of ids) {
    const gift = findGift.get(id);
    if (!gift) return res.status(404).json({ erro: 'Um dos presentes não existe ou não está disponível.' });
    gifts.push(gift);
  }

  const totalCents = gifts.reduce((total, gift) => total + gift.valor_centavos, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return res.status(400).json({ erro: 'O total do pedido é inválido.' });
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) return res.status(503).json({ erro: 'O pagamento ainda não está configurado.' });

  const orderNsu = randomUUID();
  let pedidoId;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const gift of gifts) {
      if (findInviteGiftSelection.get(convite.user_id, gift.presente_id)) {
        throw new ApiError(409, 'Este convite já selecionou o presente "' + gift.nome + '".');
      }
      if (gift.limite_escolhas === null) continue;
      const selected = countGiftSelections.get(gift.presente_id).total;
      if (selected >= gift.limite_escolhas) {
        throw new ApiError(409, 'O presente "' + gift.nome + '" já atingiu o limite de escolhas.');
      }
    }

    const result = db.prepare(
      'INSERT INTO pedidos (user_id, order_nsu, total_centavos) VALUES (?, ?, ?)'
    ).run(convite.user_id, orderNsu, totalCents);
    pedidoId = Number(result.lastInsertRowid);

    const addItem = db.prepare(
      'INSERT INTO itens_pedido (pedido_id, presente_id, presente_nome, valor_centavos) VALUES (?, ?, ?, ?)'
    );
    for (const gift of gifts) {
      addItem.run(pedidoId, gift.presente_id, gift.nome, gift.valor_centavos);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (error instanceof ApiError) return res.status(error.status).json({ erro: error.message });
    return next(error);
  }

  try {
    const checkoutUrl = await createInfinitePayLink({ orderNsu, gifts });
    db.prepare('UPDATE pedidos SET checkout_url = ? WHERE pedido_id = ?').run(checkoutUrl, pedidoId);
    return res.status(201).json({ pedidoId, orderNsu, checkoutUrl, totalCentavos: totalCents });
  } catch (error) {
    if (error instanceof ApiError) {
      db.prepare("UPDATE pedidos SET status = 'cancelado' WHERE pedido_id = ?").run(pedidoId);
      return res.status(error.status).json({ erro: error.message });
    }
    db.prepare("UPDATE pedidos SET status = 'cancelado' WHERE pedido_id = ?").run(pedidoId);
    return next(error);
  }
});

app.get('/api/convites/:codigo/pedidos', (req, res) => {
  const convite = findInvite.get(req.params.codigo);
  if (!convite) return res.status(404).json({ erro: 'Convite não encontrado.' });

  const orders = db.prepare(`
    SELECT pedido_id, order_nsu, total_centavos, status, metodo_pagamento,
           checkout_url, criado_em, pago_em
    FROM pedidos WHERE user_id = ? ORDER BY pedido_id DESC
  `).all(convite.user_id);
  const getItems = db.prepare(
    'SELECT presente_nome AS presente, valor_centavos FROM itens_pedido WHERE pedido_id = ? ORDER BY item_pedido_id'
  );
  return res.json(orders.map((order) => ({ ...order, itens: getItems.all(order.pedido_id) })));
});

app.post('/api/convites/:codigo/pedidos/:orderNsu/verificar', async (req, res, next) => {
  const convite = findInvite.get(req.params.codigo);
  if (!convite) return res.status(404).json({ erro: 'Convite não encontrado.' });
  const order = db.prepare(
    'SELECT order_nsu FROM pedidos WHERE order_nsu = ? AND user_id = ?'
  ).get(req.params.orderNsu, convite.user_id);
  if (!order) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  const body = req.body || {};
  if (typeof body.transactionNsu !== 'string' || typeof body.slug !== 'string') {
    return res.status(400).json({ erro: 'Informe transactionNsu e slug retornados pela InfinitePay.' });
  }

  try {
    const result = await verifyAndSavePayment({
      orderNsu: order.order_nsu,
      transactionNsu: body.transactionNsu,
      slug: body.slug
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ erro: error.message });
    return next(error);
  }
});

app.post('/api/pagamentos/infinitepay/retorno/verificar', async (req, res, next) => {
  const body = req.body || {};
  if (['orderNsu', 'transactionNsu', 'slug'].some((key) => typeof body[key] !== 'string' || !body[key].trim())) {
    return res.status(400).json({ erro: 'Retorno do checkout incompleto.' });
  }

  try {
    const result = await verifyAndSavePayment({
      orderNsu: body.orderNsu,
      transactionNsu: body.transactionNsu,
      slug: body.slug
    });
    res.set('Cache-Control', 'no-store');
    return res.json(result);
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ erro: error.message });
    return next(error);
  }
});

app.post('/api/pagamentos/infinitepay/webhook', async (req, res, next) => {
  const body = req.body || {};
  if ([body.order_nsu, body.transaction_nsu, body.invoice_slug].some((value) => typeof value !== 'string')) {
    return res.status(400).json({ erro: 'Notificação de pagamento inválida.' });
  }

  try {
    const result = await verifyAndSavePayment({
      orderNsu: body.order_nsu,
      transactionNsu: body.transaction_nsu,
      slug: body.invoice_slug
    });
    if (!result.pago) return res.status(400).json({ erro: 'O pagamento ainda não foi confirmado.' });
    return res.sendStatus(200);
  } catch (error) {
    if (error instanceof ApiError) return res.status(400).json({ erro: error.message });
    return next(error);
  }
});

const publicDirectory = path.join(__dirname, 'public');
app.use(express.static(publicDirectory));

app.get('/convite/:codigo', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/pagamento/retorno', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/controle', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'controle.html'));
});

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ erro: 'JSON inválido.' });
  }
  if (error.status === 413) {
    return res.status(413).json({ erro: 'O corpo do pedido é grande demais.' });
  }
  console.error(error);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log('Site do casamento em http://localhost:' + port);
  });
}

module.exports = { app };
