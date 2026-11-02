const { db } = require('./database');

const baseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const convites = db.prepare(
  'SELECT nome, cod FROM convites ORDER BY user_id'
).all();

for (const convite of convites) {
  console.log(convite.nome + ': ' + baseUrl + '/convite/' + convite.cod);
}

console.log('Total de links listados: ' + convites.length);
db.close();
