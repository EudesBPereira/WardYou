# Política de Privacidade — WardYou

> **Rascunho técnico** para revisão jurídica (LGPD). Não é aconselhamento legal —
> um advogado deve validar antes de publicar. Campos entre **[colchetes]**
> exigem preenchimento do fundador (razão social, CNPJ, DPO). O restante reflete
> o que o sistema **de fato faz hoje** (verificado no código em 2026-07-10) —
> não prometa aqui o que o produto não implementa.
> Última revisão técnica: 2026-07-10. Ver histórico de versões no §9.

## 1. Quem somos
WardYou ("nós") é uma plataforma de segurança familiar. Controlador: **[razão
social / CNPJ]**. Encarregado (DPO): **[nome / e-mail]**.

## 2. Dados que tratamos
- **Conta**: nome, e-mail, telefone (opcional), senha (armazenada com hash
  PBKDF2-SHA512, 100k iterações — nunca em texto puro).
- **Localização**: coordenadas e precisão, capturadas quando você compartilha
  com a família/trajetos. Pode ser **aproximada** (configurável por dispositivo).
- **Dispositivos**: nome, plataforma, nível de bateria, token de push (FCM).
- **Família**: vínculos, papéis (admin/responsável/criança/idoso) e
  consentimentos concedidos.
- **Controle parental** (quando aplicável): limites de tempo, regras de apps,
  lista de apps instalados no aparelho da criança, agendamentos, tarefas,
  resumos de uso do dispositivo da criança.
- **SOS e trajetos**: eventos de emergência e participação em trajetos.
- **Auditoria**: registros de ações sensíveis (login, consentimentos, SOS, etc.)
  com metadados mascarados (coordenadas e segredos nunca aparecem em texto puro
  no log).

## 3. Finalidades e base legal
- Prestar o serviço de segurança/compartilhamento familiar — execução de
  contrato.
- Compartilhar localização/bateria entre membros — **consentimento** (revogável
  a qualquer momento no app; a posição só é exposta a quem tem consentimento
  ativo — não há acesso "por padrão" a nenhum membro da família).
- Controle parental sobre menores — exercício regular de direitos pelos
  responsáveis (LGPD art. 14, §1º), sob gestão do responsável dentro da família.
- Segurança, prevenção a fraude e auditoria — legítimo interesse / cumprimento
  legal.

## 4. Decisões automatizadas
O controle parental **bloqueia automaticamente** apps fora da lista liberada
pelo responsável (sem intervenção humana no momento do bloqueio) e pode
restringir o uso ao atingir um limite diário de tempo. Isso é configurado e
pode ser revisto a qualquer momento pelo responsável na tela de controle
parental — nenhuma decisão automatizada é definitiva ou aplicada sem que um
responsável tenha definido a regra.

## 5. Compartilhamento e transferência internacional
Os dados pessoais são compartilhados **apenas dentro da sua família**,
conforme os consentimentos ativos. **Não vendemos dados a terceiros.**
Usamos os seguintes operadores (sub-processadores), que podem processar dados
fora do Brasil:
- **Microsoft Azure** (hospedagem da API e do banco de dados, região *West
  Central US*, EUA) — processamento de conta, localização, família, controle
  parental e auditoria.
- **Google Firebase Cloud Messaging** (envio de notificações push) — recebe
  apenas o token do dispositivo e o conteúdo da notificação, não o restante
  dos dados da conta.
Essas transferências internacionais devem se apoiar em salvaguarda adequada
(ex.: cláusulas contratuais padrão dos respectivos fornecedores) — **o
fundador/DPO deve confirmar e citar o instrumento exato usado por cada
fornecedor** antes de publicar esta política.

## 6. Seus direitos (LGPD)
Disponíveis em **Ajustes → Privacidade e dados**:
- **Acessar/portar**: exportar seus dados em JSON.
- **Revogar consentimentos**: desativar todas as permissões ativas.
- **Eliminar**: solicitar a exclusão da conta (processada pela equipe).
- **Histórico**: ver a atividade recente (auditoria) e quem acessou seus dados.
- **Revisar decisão automatizada**: solicitar revisão humana de qualquer
  bloqueio/limite aplicado pelo controle parental, junto ao responsável da
  família ou pelo canal de suporte.
- **Reclamação**: você também pode reclamar diretamente à Autoridade Nacional
  de Proteção de Dados (ANPD) — https://www.gov.br/anpd.

## 7. Retenção e segurança
Mantemos os dados **enquanto a conta existir**; hoje não há expurgo automático
por prazo (ex.: histórico de localização e logs de auditoria não são apagados
sozinhos) — a eliminação ocorre por solicitação de exclusão de conta. **Se o
negócio decidir adotar prazos de retenção automáticos, este documento e o
código de expurgo precisam mudar juntos.**
> **Nota de benchmark (pesquisa de mercado, 2026-07-10):** concorrentes diretos
> adotam prazos explícitos — Bark purga dados analisados em até 15 dias e
> dados de conta em até 15 dias após cancelamento; Qustodio mantém dados da
> assinatura ativa + 5 anos em estado bloqueado para fins legais. Dado que o
> WardYou trata dados sensíveis de menores e localização em tempo real, recomendo
> ao fundador decidir um prazo numérico (mais próximo do modelo Bark, por ser
> mais protetivo) e implementar o expurgo correspondente antes de publicar
> este documento — ver [docs/ARQUITETURA-AGENTES.md](ARQUITETURA-AGENTES.md).
Medidas técnicas: criptografia em trânsito (HTTPS), hashing de senhas
(PBKDF2-SHA512) e de refresh tokens (SHA-256), gating de localização por
consentimento ativo, mascaramento de segredos/coordenadas em logs de
auditoria.
Em caso de incidente de segurança que gere risco relevante aos titulares,
notificaremos a ANPD e os titulares afetados em prazo razoável, conforme
LGPD art. 48.

## 8. Menores
O tratamento de dados de crianças ocorre com consentimento específico e em
destaque do responsável legal (LGPD art. 14), exercido ao adicioná-la à
família e configurar o controle parental — o app não permite que uma conta
marcada como "criança" opere sem estar vinculada a um responsável. **Nunca
vendemos, alugamos ou compartilhamos dados de crianças fora da família** para
qualquer finalidade publicitária ou comercial.

**Notas técnicas para o fundador/jurídico (benchmark de mercado, 2026-07-10):**
- Hoje o sistema não verifica idade (não há campo de data de nascimento) — o
  papel "criança" é atribuído pelo responsável na estrutura familiar, não
  validado por documento. Avalie se é preciso um mecanismo de verificação
  adicional.
- O consentimento do responsável hoje é um simples toggle in-app. Concorrentes
  (padrão COPPA/GDPR-K) usam mecanismos mais robustos de verificação (ex.:
  confirmação por cartão, ID, ou formulário assinado) — avalie se o toggle
  atende ao padrão de consentimento "específico e destacado" exigido pela
  LGPD art. 14, ou se vale reforçar o fluxo de aprovação existente.
- **Particularidade do WardYou** (diferente de concorrentes como Kids360/Bark,
  que só têm app para o responsável): a própria criança usa o app com sua
  própria tela. A LGPD exige que informações sobre tratamento de dados sejam
  apresentadas de forma simples, clara e acessível, **considerando as
  características cognitivas da criança** — recomenda-se uma versão do aviso
  de privacidade em linguagem adaptada, exibida na própria experiência da
  criança, não só nos Termos que o responsável aceita.

## 9. Contato, alterações e versionamento
Dúvidas/solicitações: **[e-mail do DPO]**. Esta política pode ser atualizada;
notificaremos mudanças relevantes no app. Alterações relevantes desde a
criação: 2026-07-10 — adicionada seção de transferência internacional,
decisões automatizadas e nota sobre verificação de idade de menores.
