# Back-end do site de casamento

## O que este projeto faz

- Usa convites individuais armazenados no SQLite.
- Registra confirmação de presença e dados de contato opcionais.
- Lista presentes fixos com valores cadastrados pelo casal.
- Permite configurar limite de escolhas por presente, contando pedidos pendentes e pagos.
- Cria um único pedido com um ou mais presentes e solicita um checkout da InfinitePay.
- Registra o pagamento somente depois da confirmação feita pela API da InfinitePay.

Não há entrega física, estoque de presentes, chave Pix manual nem dados de cartão guardados neste projeto. No checkout, a InfinitePay apresenta as opções disponíveis (Pix e cartão de crédito).

## Iniciar localmente

Use Node.js 24 ou superior. Copie `.env.example` para `.env`, preencha a configuração da InfinitePay quando tiver o domínio público e inicie no PowerShell do VS Code, dentro desta pasta:

```powershell
npm.cmd start
```

O site ficará em `http://localhost:3000` e a API em `http://localhost:3000/api`. Os presentes precisam estar cadastrados em `catalogo-presentes.json` e importados. Os dados do evento ficam em `evento.json`.

### Publicação no Railway

- O serviço inicia com `npm start` e escuta a porta informada pela variável `PORT`.
- Crie um volume persistente para o serviço. O app detecta `RAILWAY_VOLUME_MOUNT_PATH` e grava `casamento.db` nesse volume automaticamente. Se usar outro provedor, configure `DATABASE_PATH` para um diretório persistente.
- Mantenha apenas uma réplica do serviço: SQLite usa um arquivo local e não deve ser compartilhado por múltiplas instâncias.
- Configure `INFINITEPAY_HANDLE`, `ADMIN_TOKEN`, `PUBLIC_SITE_URL` e `PUBLIC_API_URL` como variáveis privadas do serviço. Use a mesma URL pública HTTPS para site e API quando servidos pelo mesmo processo.
- Configure `/api` como health check. Antes de enviar convites, confirme que o domínio HTTPS está ativo e gere os links com `PUBLIC_BASE_URL` apontando para ele.
- Faça uma cópia de segurança do banco antes da migração e confira, depois do primeiro deploy, que os convites, presentes e histórico esperado estão no volume persistente.

## Protótipo do front-end

Os arquivos HTML, CSS e JavaScript ficam em `public/`. Abra `http://localhost:3000` para informar um código de convite ou abra um link individual no formato `http://localhost:3000/convite/CODIGO`. O site apresenta a confirmação de presença, a lista de presentes e os dados do evento. Após o checkout, o retorno consulta a InfinitePay no servidor e mostra se o pagamento foi confirmado.

Se ainda não houver presentes no banco, o catálogo aparecerá vazio até a importação. Antes de importar, revise os itens em `catalogo-presentes.json`; depois, rode `npm.cmd run importar-presentes`.

## InfinitePay

O endpoint de pedido usa o Checkout Integrado da InfinitePay. Ative essa modalidade na conta InfinitePay e copie sua InfiniteTag (sem o `$`) para `.env`:

```powershell
INFINITEPAY_HANDLE=sua_infinite_tag
PUBLIC_SITE_URL=https://seu-site.com
PUBLIC_API_URL=https://api.seu-site.com
```

`PUBLIC_SITE_URL` e `PUBLIC_API_URL` são endereços públicos HTTPS para o retorno do checkout e o webhook. Se o site e a API estiverem no mesmo domínio, use a mesma URL nos dois. O webhook usa o caminho `/api/pagamentos/infinitepay/webhook`. Durante o desenvolvimento local, o checkout não consegue chamar `localhost`; por isso, o endereço público precisa apontar para uma implantação acessível pela internet. Não coloque esses valores em arquivos públicos ou no front-end.

A integração básica de links não precisa de chave de API; a InfiniteTag e os endereços públicos são suficientes. Uma chave só será necessária se forem usadas opções avançadas do checkout. Este projeto não cria um ambiente de sandbox: qualquer pagamento de validação feito no checkout é real. Configure primeiro em produção e só faça uma transação quando estiverem definidos valor e forma de estorno, se necessários.

## Controle dos convites

Acesse `/controle` e informe o valor de `ADMIN_TOKEN` configurado no ambiente do servidor. A página lista nomes, códigos e respostas. Um código recusado pode ser reatribuído para outra pessoa; isso limpa a resposta e os contatos de RSVP. Convites com pedidos associados não podem ser reatribuídos para preservar o histórico. Mantenha `ADMIN_TOKEN` privado e configure-o também como variável de ambiente na hospedagem.

O back-end envia apenas os presentes, seus preços em centavos e o identificador do pedido para gerar um checkout. A pessoa escolhe Pix ou cartão de crédito na página da InfinitePay. O cartão é tratado pela InfinitePay, não pelo nosso banco.

## Catálogo

Edite `catalogo-presentes.json` com os presentes e valores reais. `limiteEscolhas` é opcional: omita ou use `null` para deixar sem limite; use `1` para permitir uma escolha única; use outro inteiro positivo para definir um máximo.

Exemplo de presente que só pode ser escolhido uma vez:

```json
{
  "nome": "Nome do presente",
  "descricao": "Descrição do presente",
  "valorCentavos": 125000,
  "limiteEscolhas": 1
}
```

`125000` significa R$ 1.250,00. Para permitir até três escolhas, use `"limiteEscolhas": 3`; para não limitar, deixe o campo de fora. Depois da primeira carga, execute:

```powershell
npm.cmd run importar-presentes
```

O importador interrompe a execução se já houver presentes no banco, para evitar duplicatas. Ajustes posteriores no catálogo devem ser feitos no banco ou usando uma migração explícita.

## Rotas

- `GET /api` informa o estado da API e as rotas.
- `GET /api/evento` devolve os dados de `evento.json`.
- `GET /api/convites/:codigo` consulta um convite.
- `POST /api/convites/:codigo/resposta` recebe `{"confirmacao":1,"email":"ana@example.com","telefone":"+5511999999999"}`. A confirmação aceita `1` (vai) ou `0` (não vai); para confirmar presença, e-mail e celular são obrigatórios. Depois que a resposta for `0`, ela não pode ser alterada.
- `GET /api/presentes` lista presentes ativos, quantas vezes cada um foi escolhido, seu limite e se ainda está disponível.
- `GET /api/admin/convites` exige a chave administrativa no cabeçalho `Authorization: Bearer ...` e lista os convites.
- `POST /api/admin/convites/:codigo/reatribuir` exige a mesma chave e recebe `{"nome":"Nova pessoa"}` para reatribuir um código recusado sem pedidos associados.
- `POST /api/convites/:codigo/pedidos` recebe `{"presenteIds":[1,2]}` e devolve `checkoutUrl`, `orderNsu` e total. A pessoa precisa ter confirmado presença.
- `GET /api/convites/:codigo/pedidos` lista os pedidos daquele convite.
- `POST /api/convites/:codigo/pedidos/:orderNsu/verificar` recebe `{"transactionNsu":"...","slug":"..."}` após o retorno da InfinitePay e consulta o status no servidor da InfinitePay.
- `POST /api/pagamentos/infinitepay/retorno/verificar` recebe os identificadores devolvidos pelo checkout e consulta a InfinitePay antes de marcar o pedido como pago.
- `POST /api/pagamentos/infinitepay/webhook` recebe notificações do checkout e consulta a InfinitePay antes de marcar o pedido como pago.

Os links dos convites continuam no formato público `/convite/:codigo`; as rotas de dados ficam sob `/api/...`. A página visual desses links será criada no front-end. Os links dos convites são credenciais privadas. Não publique nem envie a lista de links em locais abertos.

## Convites de teste

O banco mantém 40 códigos individuais de convite. Para listar os links, execute `npm.cmd run links`. No computador local, esses links usam `localhost`; após a publicação, configure o domínio e revise os links antes de enviar.

## Informações do evento

Edite `evento.json` com data, horário, local, endereço e dress code. Os valores estão vazios até o casal fornecer as informações.

## Dados e limites atuais

- `casamento.db` contém os convites. Faça cópias de segurança antes de alterações manuais.
- A cópia anterior à atualização do modelo está em `backups/casamento-before-requirements-update-2026-09-24.db`.
- Vários presentes podem ser enviados no mesmo pedido, mas cada convite só pode selecionar o mesmo presente uma vez. O limite é configurado individualmente no catálogo; pedidos pendentes também reservam uma vaga. Se a criação do checkout falhar, o pedido é cancelado e a vaga volta a ficar disponível. Um convidado que abandone um checkout pendente mantém a vaga reservada; ainda não há expiração automática para links não pagos.
- A integração precisa da InfiniteTag da conta e de um domínio HTTPS público configurado no `.env` antes de criar links de checkout.
