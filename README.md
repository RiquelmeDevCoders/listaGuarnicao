# listaGuarni-o

**Escala SD EV — Lista da Guarnição.** Sistema web (PWA) para os SD EVs consultarem e preencherem a escala do dia seguinte, em tempo real, substituindo a organização pelo grupo do WhatsApp.

HTML + CSS + JavaScript puro, Firebase Authentication (anônimo) e Cloud Firestore. Tudo dentro do plano gratuito (Spark). Não usa Storage, Functions nem nenhum serviço pago.

Fluxo: **ENTROU → CADASTROU → VIU A ESCALA → ESCOLHEU A VAGA → CONFIRMOU → PRONTO.**

---

## 1. Estrutura do projeto

```
index.html              página única (cadastro, escala, histórico, admin)
css/style.css           visual militar, mobile first
js/app.js               interface, rotas (#historico, #admin), regras de tela
js/firebase.js          configuração do Firebase e todas as operações no banco
js/time.js              datas e horários em America/Sao_Paulo
js/escala.js            vagas da escala (posto duplo)
js/versao.js            versão atual e mensagem de novidades
version.json            versão publicada (avisa quem está com versão antiga)
manifest.json           PWA (nome, ícones, tela cheia)
sw.js                   service worker (abre rápido e funciona sem sinal para consulta)
icons/                  ícones do app
firestore.rules         regras de segurança do Firestore  ← publicar no console
firestore.indexes.json  sem índices compostos necessários
firebase.json           configuração para Firebase CLI / Hosting / emulador
tests/                  testes de datas, regras do Firestore e interface
```

## 2. Banco de dados (Firestore)

```
users/{uid}
  nome        "RIQUELME"            nome de guerra (maiúsculas)
  om          "CIA C" | "PE"
  createdAt   timestamp do servidor
  lastSeen    timestamp do servidor (último acesso)
  bloqueado   false

escalas/{AAAA-MM-DD}               uma escala por dia (o ID é a data da escala)
  data        "2026-10-05"
  createdAt   timestamp do servidor
  slots
    h1p1 … h3p3                    vaga 1 de cada posto (1º/2º/3º horário × P1/P2/P3)
    h1p1b … h3p3b                  vaga 2 de cada posto (posto duplo)
  quem                             índice { uid: vaga } — usado pelas regras para validar cada reserva
                                   olhando uma vaga só (o Firestore limita cada regra a 1.000 expressões)
      null                         vaga livre
      { uid, nome, om, em }        vaga ocupada (em = horário do servidor)

config/admin
  uid         uid do aparelho principal do SD EV RIQUELME
  createdAt

admins/{uid}                       outros aparelhos do ADM, liberados com a senha do ADM
```

**Posto duplo:** todo posto tem 2 vagas (18 por escala). Escalas antigas, anteriores a 25/10/2026, foram feitas com 9 vagas e aparecem assim no histórico (`DOUBLE_FROM` em `js/escala.js`, usado só para exibição).

As 9 vagas ficam num único documento: uma leitura mostra a escala inteira, o tempo real é um único listener e a concorrência é resolvida numa transação sobre um documento só. O histórico são os próprios documentos de `escalas` com data anterior; não há cópia duplicada.

## 3. Configurar o Firebase (uma vez)

1. Acesse <https://console.firebase.google.com> → projeto **listagrd**.
2. **Authentication** → *Começar* → *Método de login* → ative **Anônimo** → Salvar.
3. **Authentication** → *Configurações* → *Domínios autorizados* → adicione `riquelmedevcoders.github.io`.
4. **Firestore Database** → *Criar banco de dados* → modo **produção** → local `southamerica-east1 (São Paulo)`.
5. **Firestore Database** → aba **Regras** → apague tudo, cole o conteúdo de [`firestore.rules`](firestore.rules) → **Publicar**.
6. Não é preciso criar coleções nem índices: tudo é criado pelo próprio sistema.

> As credenciais em `js/firebase.js` são públicas por natureza (identificam o projeto). Quem protege os dados são as regras do passo 5. Nenhuma chave secreta existe no frontend.

## 4. Publicar (GitHub Pages — gratuito)

1. No GitHub: repositório **listaGuarni-o** → *Settings* → *Pages*.
2. *Source*: **Deploy from a branch** → Branch **main** / pasta **/(root)** → Save.
3. Em 1–2 minutos o sistema fica em: **https://riquelmedevcoders.github.io/listaGuarni-o/**

Para lançar uma versão nova:

1. `node scripts/versao.mjs 2.1.1` — atualiza a versão em todos os arquivos (index, imports, service worker, version.json).
2. Escreva o recado em `NOVIDADES` (`js/versao.js`).
3. Se mudou `firestore.rules`, publique no console **antes** do push.
4. Commit e push na `main`.

Os arquivos são carregados com `?v=VERSÃO`, então nenhum celular mistura arquivo novo com antigo.

Quem estiver com o app aberto vê a faixa **“Nova versão disponível! ATUALIZAR”**; ao entrar na versão nova, cada militar vê o recado uma única vez.

Alternativa: Firebase Hosting (também gratuito) com `npx firebase deploy --only hosting,firestore:rules` — publica o site e as regras de uma vez.

## 5. Ativar o administrador (FAÇA ANTES DE DIVULGAR O LINK)

1. Abra o link publicado no **seu** celular.
2. Cadastre-se com nome de guerra **RIQUELME** e sua OM.
3. O sistema grava `config/admin` com o seu identificador e mostra o botão **ADM** no topo.

A partir daí o nome **RIQUELME** fica reservado: ninguém mais consegue se cadastrar com ele, e o documento `config/admin` não pode ser alterado nem apagado pelo app.

**Entrar como ADM em outro aparelho (senha):**

No aparelho novo, cadastre-se como **RIQUELME**. O sistema pede a **Senha do ADM** (senha padrão, não precisa cadastrar); com a senha certa, esse aparelho também vira ADM. Quem não sabe a senha não consegue usar o nome RIQUELME.

A senha fica gravada nas regras do Firestore como hash SHA-256 (função `adminPassHash()` em `firestore.rules`). Para trocar: gere o SHA-256 de `escala-sd-ev|NOVASENHA`, substitua o valor ali e publique as regras de novo.

Perdeu todos os aparelhos ADM? No console do Firebase, em `config/admin`, troque `uid` pelo `uid` do seu novo cadastro (documento em `users`).

## 6. Como o sistema funciona

- **Cadastro:** nome de guerra + OM (CIA C ou PE). O Firebase cria um usuário anônimo persistente no aparelho, então o militar não precisa preencher de novo. “SD EV” digitado antes do nome é removido automaticamente.
- **Escala do dia seguinte:** calculada automaticamente pelo horário de Brasília (domingo → segunda, …, sábado → domingo). Não existe seleção manual de data.
- **Abertura:** a escala de amanhã abre hoje às **18:00** (seg a sex) ou **16:00** (sáb e dom). Antes disso aparece “Escala ainda não liberada” com contagem regressiva. A abertura é decidida pelo **horário do servidor**: o app mede a diferença entre o relógio do celular e o do servidor a cada acesso, e as regras do Firestore usam `request.time` — alterar o relógio do celular não libera nada.
- **Fechamento:** à meia-noite (Brasília) a escala vira histórico, somente leitura, e a tela passa a mostrar a próxima.
- **Escolha:** ESCOLHER → “Você deseja assumir o 2º horário, P2?” → CONFIRMAR. A gravação é uma transação no Firestore. Se outro militar confirmou antes, aparece “Essa vaga acabou de ser ocupada por outro militar. Escolha outra disponível.”
- **Uma vaga por militar:** quem já está escalado vê “Você já está escalado nesta escala.”, a própria vaga destacada e o botão **CANCELAR / TROCAR MINHA VAGA** (a vaga volta a ficar livre na hora).
- **Posto duplo:** cada posto mostra VAGA 1 e VAGA 2; dois militares podem tirar o mesmo posto, cada um em uma vaga.
- **Status:** AGUARDANDO LIBERAÇÃO, ABERTA, PREENCHIDA (18/18; 9/9 nas escalas antigas) e ENCERRADA. Sempre com texto, não só cor.
- **Tempo real:** todos veem as mudanças em ~1 segundo.
- **Histórico:** lista por data (“04/10/2026 — Escala de 05/10/2026”). Ao tocar, abre a escala completa, somente leitura. O botão **ESCALA DE HOJE** abre direto a escala em andamento.
- **Compartilhar escala:** gera a mensagem pronta (LISTA DA GUARNIÇÃO / 1º HORÁRIO / P1 - …) e abre o compartilhamento do celular; sem suporte, abre o WhatsApp Web e copia o texto.
- **Compartilhar sistema:** compartilhamento nativo ou “Link copiado!”.
- **Grupo oficial:** botão para o grupo do WhatsApp.
- **Offline:** dados ficam em cache local (consulta sem sinal), mas **reserva só é confirmada online** — transações do Firestore exigem o servidor.
- **PWA:** “Adicionar à tela inicial” no Android/iPhone abre como aplicativo (“Escala SD EV”).

### Painel ADM (somente SD EV RIQUELME)

- Lista de militares cadastrados com OM, data de cadastro e último acesso, busca e totais por OM.
- **BLOQUEAR / DESBLOQUEAR** militar (bloqueado não escolhe nem cancela vagas).
- **EXCLUIR** militar: apaga o cadastro e tira ele da escala aberta (o histórico fica como estava).
- **Erros dos militares:** toda falha no celular de alguém (ex.: `permission-denied`) é registrada com nome, ação, escala e versão do app.
- **Aviso de regras desatualizadas:** se o `firestore.rules` publicado no console for antigo, o painel avisa.
- **REMOVER** militar de qualquer vaga, na escala atual ou em escalas antigas.
- Histórico completo.

Preparado para crescer: novas ações de admin seguem o padrão `isAdmin()` nas regras e funções em `js/firebase.js`.

## 7. Regras de segurança implementadas

Todas validadas **no servidor** (Firestore Security Rules). Nada depende só do JavaScript do navegador.

| Ataque / erro | Proteção |
|---|---|
| Dois militares na mesma vaga | Transação no app **e** regra: só ocupa vaga se ela está `null` no banco no instante da gravação |
| Militar em duas vagas | Regra verifica as 9 vagas: se o `uid` já está em alguma, a reserva é recusada |
| Escolher antes do horário / escala futura | `request.time` (relógio do Google) precisa estar entre a abertura (18:00 ou 16:00 da véspera) e a meia-noite do dia da escala |
| Alterar escala antiga | Fora da janela, militar comum não altera nada |
| Ocupar vaga em nome de outro | `uid` da vaga = usuário autenticado; `nome` e `om` precisam ser idênticos ao perfil salvo |
| Falsificar horário da reserva | Campo `em` precisa ser exatamente o horário do servidor |
| Liberar vaga de outro militar | Só o dono (ou o admin) pode voltar uma vaga para livre |
| Criar vagas inexistentes / campos extras | Documento precisa ter exatamente `data`, `createdAt`, `slots`, e `slots` exatamente as 9 chaves |
| Mudar a data da escala | `data` precisa ser igual ao ID e não pode ser alterada |
| Alterar mais de uma vaga por vez | Militar comum altera exatamente 1 vaga por gravação |
| Excluir dados | Só o ADM exclui cadastros de militares (nunca o próprio) e registros de erro; escalas nunca são excluídas |
| Mudar nome/OM/bloqueio próprio | Militar só atualiza `lastSeen` do próprio perfil |
| Ver dados de outros militares | `users` só é lido pelo dono e pelo admin |
| Virar admin / usar o nome RIQUELME | `config/admin` só é criado uma vez; outro aparelho só vira ADM enviando o hash correto da senha junto com o cadastro RIQUELME |
| Terceiro militar no posto duplo | Cada vaga (`h1p1`, `h1p1b`) aceita só 1 militar; não existe terceira chave |
| Usuário bloqueado | Não reserva nem cancela |
| Qualquer outra coleção | Bloqueada (`allow read, write: if false`) |
| Nome com HTML/script | Nome aceita só letras maiúsculas e espaço; o app também escapa todo texto exibido |

### Limitações (sem backend próprio)

- **Identidade:** o login anônimo identifica o **aparelho/navegador**, não a pessoa. Alguém pode limpar os dados do navegador, criar outro cadastro e se escalar com outro nome. Mitigação: o nome e a OM aparecem na escala para todos, e o admin pode remover e bloquear. Para identidade forte seria preciso login com Google/telefone (o de telefone tem custo).
- **Nomes repetidos:** dois militares podem se cadastrar com o mesmo nome de guerra (a OM ajuda a diferenciar).
- **Horário de verão:** as regras usam Brasília = UTC−3 (sem horário de verão desde 2019). Se voltar, ajuste os valores `3h`/`5h` em `firestore.rules` e `BRT_OFFSET_H` em `js/time.js`.
- **Senha curta e pública:** a senha do ADM tem 4 dígitos e o hash dela está no `firestore.rules`, que fica público no GitHub. Alguém com conhecimento técnico consegue descobri-la testando as 10 mil combinações. Para mais segurança, troque por uma senha maior (veja acima) ou deixe o repositório privado.
- **Abuso de cota:** sem App Check, alguém mal-intencionado poderia gerar leituras em massa. O plano gratuito permite 50 mil leituras e 20 mil gravações por dia, muito acima do uso normal. Se necessário, ative o **App Check com reCAPTCHA v3** (gratuito).
- O relógio do celular só afeta o que é **exibido** até o app sincronizar com o servidor; a decisão final é sempre do servidor.

## 8. Testes

```bash
npm install
npm run test:time                 # datas e horários (domingo→segunda, sábado→domingo, 16h/18h, virada de mês/ano)
npm test                          # datas + regras do Firestore no emulador (precisa de Java)
node --test tests/ui/ui.test.mjs  # interface completa com banco simulado (Playwright)
```

`tests/rules.test.mjs` cobre: cadastro, nome reservado, leitura indevida, escala de hoje/futura, campos falsos, vaga ocupada, segunda vaga, cancelamento, 10 militares disputando a mesma vaga ao mesmo tempo, usuário bloqueado, escala antiga e permissões do admin. Os testes que dependem da janela aberta são pulados automaticamente fora do horário (rode após 18:00, ou 16:00 no fim de semana).

## 9. Checklist antes de colocar no grupo

- [ ] Login **Anônimo** ativado no Authentication
- [ ] Firestore criado em modo produção
- [ ] Regras de `firestore.rules` **publicadas** (confira a data de publicação no console)
- [ ] GitHub Pages ativo e o link abre no celular
- [ ] Você se cadastrou como **RIQUELME** e o botão **ADM** apareceu
- [ ] Antes do horário: aparece “AGUARDANDO LIBERAÇÃO” com contagem regressiva
- [ ] Mudar o relógio do celular **não** libera a escala
- [ ] No horário: escolher uma vaga → confirmação → “Vaga reservada com sucesso!”
- [ ] Em outro celular: a vaga aparece ocupada em tempo real, sem atualizar a página
- [ ] Tentar escolher uma segunda vaga → “Você já possui uma vaga nesta escala.”
- [ ] Cancelar a vaga → ela volta a ficar disponível nos dois celulares
- [ ] Dois celulares tocando CONFIRMAR na mesma vaga juntos → só um consegue
- [ ] Tentar se cadastrar como RIQUELME em outro celular → recusado
- [ ] Histórico abre e não permite alterar
- [ ] COMPARTILHAR ESCALA gera a mensagem no formato da guarnição
- [ ] COMPARTILHAR SISTEMA e ENTRAR NO GRUPO DO WHATSAPP funcionam
- [ ] “Adicionar à tela inicial” no Android e no iPhone
- [ ] Painel ADM: bloquear/desbloquear e remover militar de uma vaga

---

Sistema desenvolvido por **SD EV RIQUELME**.
