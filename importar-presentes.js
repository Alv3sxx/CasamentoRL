const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./database');

const catalogPath = path.join(__dirname, 'catalogo-presentes.json');
let catalogo;

try {
  catalogo = JSON.parse(fs.readFileSync(catalogPath, 'utf8').replace(/^\uFEFF/, ''));
} catch (error) {
  console.error('Não foi possível ler catalogo-presentes.json:', error.message);
  db.close();
  process.exit(1);
}

if (!Array.isArray(catalogo) || catalogo.length === 0) {
  console.error('Adicione pelo menos um presente ao catalogo-presentes.json antes de importar.');
  db.close();
  process.exit(1);
}

const totalExistente = db.prepare('SELECT COUNT(*) AS total FROM presentes').get().total;
if (totalExistente > 0) {
  console.error('A tabela presentes já contém dados. Importação interrompida para evitar duplicatas.');
  db.close();
  process.exit(1);
}

const nomes = new Set();
for (const item of catalogo) {
  if (!item || typeof item.nome !== 'string' || item.nome.trim().length < 1 || item.nome.trim().length > 90) {
    console.error('Cada presente precisa de um nome com 1 a 90 caracteres.');
    db.close();
    process.exit(1);
  }
  if (typeof item.descricao !== 'string') {
    console.error('A descrição de cada presente precisa ser texto.');
    db.close();
    process.exit(1);
  }
  if (!Number.isSafeInteger(item.valorCentavos) || item.valorCentavos <= 0) {
    console.error('valorCentavos precisa ser um inteiro maior que zero.');
    db.close();
    process.exit(1);
  }
  if (item.limiteEscolhas !== undefined && item.limiteEscolhas !== null
      && (!Number.isSafeInteger(item.limiteEscolhas) || item.limiteEscolhas < 1)) {
    console.error('limiteEscolhas precisa ser null ou um inteiro maior que zero.');
    db.close();
    process.exit(1);
  }
  const nomeNormalizado = item.nome.trim().toLocaleLowerCase('pt-BR');
  if (nomes.has(nomeNormalizado)) {
    console.error('Há nomes de presentes repetidos no catálogo.');
    db.close();
    process.exit(1);
  }
  nomes.add(nomeNormalizado);
}

const inserirPresente = db.prepare(
  'INSERT INTO presentes (nome, descricao, valor_centavos, limite_escolhas) VALUES (?, ?, ?, ?)'
);

db.exec('BEGIN IMMEDIATE');
try {
  for (const item of catalogo) {
    inserirPresente.run(item.nome.trim(), item.descricao.trim(), item.valorCentavos, item.limiteEscolhas ?? null);
  }
  db.exec('COMMIT');
  console.log('Presentes importados: ' + catalogo.length);
} catch (error) {
  db.exec('ROLLBACK');
  console.error('Importação cancelada:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
