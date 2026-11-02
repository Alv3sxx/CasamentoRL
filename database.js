const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const databasePath = process.env.DATABASE_PATH
  || (volumePath ? path.join(volumePath, 'casamento.db') : path.join(__dirname, 'casamento.db'));
const db = new DatabaseSync(databasePath);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS convites (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 90),
    cod TEXT NOT NULL UNIQUE,
    confirmacao INTEGER CHECK (confirmacao IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS presentes (
    presente_id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 90),
    descricao TEXT NOT NULL DEFAULT '',
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    limite_escolhas INTEGER CHECK (limite_escolhas IS NULL OR limite_escolhas > 0),
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
  );
`);

// Migra a tabela antiga, que controlava estoque e entrega física.
const presenteColumns = new Set(
  db.prepare('PRAGMA table_info(presentes)').all().map((column) => column.name)
);

if (presenteColumns.has('estoque_fisico')) {
  const choicesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'escolhas'"
  ).get();
  if (choicesTable && db.prepare('SELECT COUNT(*) AS total FROM escolhas').get().total > 0) {
    db.close();
    throw new Error('A migração foi interrompida porque escolhas antigas existem. Faça uma cópia do banco e revise esses registros antes de migrar.');
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      DROP TABLE IF EXISTS escolhas;
      CREATE TABLE presentes_novo (
        presente_id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 90),
        descricao TEXT NOT NULL DEFAULT '',
        valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
        limite_escolhas INTEGER CHECK (limite_escolhas IS NULL OR limite_escolhas > 0),
        ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
      );
      INSERT INTO presentes_novo (presente_id, nome, descricao, valor_centavos, ativo)
      SELECT presente_id, nome, descricao, valor_centavos, ativo FROM presentes;
      DROP TABLE presentes;
      ALTER TABLE presentes_novo RENAME TO presentes;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    db.close();
    throw error;
  }
}

const currentGiftColumns = new Set(
  db.prepare('PRAGMA table_info(presentes)').all().map((column) => column.name)
);
if (!currentGiftColumns.has('limite_escolhas')) {
  db.exec('ALTER TABLE presentes ADD COLUMN limite_escolhas INTEGER CHECK (limite_escolhas IS NULL OR limite_escolhas > 0)');
} else {
  const limitColumn = db.prepare('PRAGMA table_info(presentes)').all()
    .find((column) => column.name === 'limite_escolhas');
  if (limitColumn.notnull || limitColumn.dflt_value !== null) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE presentes_novo (
          presente_id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 90),
          descricao TEXT NOT NULL DEFAULT '',
          valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
          limite_escolhas INTEGER CHECK (limite_escolhas IS NULL OR limite_escolhas > 0),
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
        );
        INSERT INTO presentes_novo (presente_id, nome, descricao, valor_centavos, limite_escolhas, ativo)
        SELECT presente_id, nome, descricao, valor_centavos,
               CASE WHEN limite_escolhas = 3 THEN NULL ELSE limite_escolhas END,
               ativo
        FROM presentes;
        DROP TABLE presentes;
        ALTER TABLE presentes_novo RENAME TO presentes;
        COMMIT;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      db.exec('PRAGMA foreign_keys = ON;');
      db.close();
      throw error;
    }
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    pedido_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES convites(user_id) ON DELETE CASCADE,
    order_nsu TEXT NOT NULL UNIQUE,
    total_centavos INTEGER NOT NULL CHECK (total_centavos > 0),
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
    metodo_pagamento TEXT CHECK (metodo_pagamento IN ('pix', 'credit_card')),
    checkout_url TEXT,
    invoice_slug TEXT,
    transaction_nsu TEXT UNIQUE,
    receipt_url TEXT,
    valor_pago_centavos INTEGER CHECK (valor_pago_centavos IS NULL OR valor_pago_centavos >= 0),
    parcelas INTEGER CHECK (parcelas IS NULL OR parcelas >= 1),
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pago_em TEXT
  );

  CREATE TABLE IF NOT EXISTS itens_pedido (
    item_pedido_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL REFERENCES pedidos(pedido_id) ON DELETE CASCADE,
    presente_id INTEGER NOT NULL REFERENCES presentes(presente_id),
    presente_nome TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    UNIQUE (pedido_id, presente_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pedidos_user_id ON pedidos(user_id);
  CREATE INDEX IF NOT EXISTS idx_itens_pedido_id ON itens_pedido(pedido_id);
  CREATE INDEX IF NOT EXISTS idx_itens_pedido_presente_id ON itens_pedido(presente_id);
`);

const conviteColumns = new Set(
  db.prepare('PRAGMA table_info(convites)').all().map((column) => column.name)
);

if (!conviteColumns.has('email')) {
  db.exec('ALTER TABLE convites ADD COLUMN email TEXT');
}

if (!conviteColumns.has('telefone')) {
  db.exec('ALTER TABLE convites ADD COLUMN telefone TEXT');
}

module.exports = { db, databasePath };
