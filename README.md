# 🏥 Sistema de Clínica Luana - Fisioterapia e Pilates

Projeto de um sistema web completo desenvolvido para uma profissional da área de Fisioterapia e Pilates, com o objetivo de gerenciar pacientes, agendar consultas, controlar financeiro e facilitar o atendimento domiciliar.

O projeto foi estruturado de forma modular, permitindo futuras expansões e integrações com serviços externos.

---

## 🚀 Tecnologias Utilizadas

### 🎨 Front-end
* HTML5 – Estruturação das páginas
* CSS3 – Estilização e layout responsivo
* JavaScript Vanilla – Interatividade da aplicação

### ⚙️ Back-end
* Node.js – Ambiente de execução JavaScript no servidor
* Express.js – Framework para criação de APIs REST
* TypeScript – Tipagem estática e segurança de tipos

### 🗄️ Banco de Dados
* PostgreSQL – Sistema de gerenciamento de banco de dados relacional
* Supabase – PostgreSQL na nuvem

---

## 🎯 Funcionalidades

### Área do Paciente
* Cadastro e login com validação completa
* Agendamento de consultas (Fisioterapia, Pilates, Ambos)
* Visualizar próximas sessões e histórico completo
* Pagamento via PIX ou Dinheiro
* Upload e envio de documentos
* Visualizar prescrições e pendências
* Editar perfil e dados pessoais

### Área do Profissional
* Dashboard com resumo de agendamentos e financeiro
* Listar pacientes com busca avançada (nome, CPF, data nascimento)
* Ver histórico completo de cada paciente
* Confirmar, remarcar ou cancelar agendamentos
* Registrar consultas realizadas com prescrições
* Avaliar documentos enviados pelos pacientes
* Controlar pagamentos (PIX e Dinheiro)
* Gerar relatórios de consultas e financeiro

---

## 🛠️ Ferramentas de Desenvolvimento
* Visual Studio Code – Editor de código-fonte
* Git – Controle de versionamento
* GitHub – Hospedagem do repositório

---

## 🏗️ Arquitetura do Projeto

O projeto segue uma arquitetura baseada na separação entre front-end e back-end, permitindo maior organização, manutenção e escalabilidade.

O front-end é responsável pela interface do usuário, enquanto o back-end, implementado com Node.js + Express + TypeScript, é responsável pelo gerenciamento de dados, autenticação, integração de pagamentos e automações.

O banco de dados PostgreSQL (hospedado no Supabase) armazena as informações de pacientes, profissionais, agendamentos, consultas, documentos, histórico, financeiro e pendências, seguindo um modelo relacional com integridade referencial via chaves estrangeiras.

---

## 🗄️ Estrutura do Banco de Dados

O banco sistema_clinica é composto pelas seguintes tabelas:

| Tabela | Descrição |
|--------|-----------|
| paciente | Dados cadastrais dos pacientes |
| profissional | Dados cadastrais dos profissionais de saúde |
| administrador | Usuários com acesso administrativo |
| agendamento | Consultas agendadas entre paciente e profissional |
| consulta | Pacote de sessões de tratamento |
| sessao_consulta | Cada sessão individual com descrição e prescrição |
| documento | Arquivos e exames enviados pelo paciente |
| prescricao | Prescrições médicas e exercícios recomendados |
| financeiro | Controle de pagamentos das consultas |
| historico_consultas | Histórico clínico do paciente |
| pendencias | Pendências do paciente (pagamentos, documentos) |

---

## 📱 Servidor no celular

O backend (que também serve o front-end) roda 24h em um celular Android com Termux + pm2, publicado via ngrok:

* **Sistema / API:** https://untapped-daffodil-livable.ngrok-free.dev (API em , health check em )
* **Deploy automático:** a cada push na branch , o celular atualiza e reinicia o servidor em até 1 minuto.
* **Configuração:** o  do celular é configurado à parte, direto no aparelho, e **não vai para o git**. Use  como modelo.
* Requisições feitas fora do próprio domínio precisam do header  (já incluso em ).

---

## 📌 Status do Projeto

* ✅ Front-end funcional e responsivo
* ✅ Back-end completo e implementado
* ✅ Banco de dados modelado, implementado e integrado
* ✅ Autenticação com JWT (3 tipos: Paciente, Profissional, Admin)
* ✅ CRUD completo de pacientes, agendamentos e consultas
* ✅ Sistema de pagamentos (PIX + Dinheiro)
* ✅ Histórico por sessões com prescrições
* ✅ Filtro avançado de pacientes
* ✅ Dashboard profissional com resumos
* ✅ Controle financeiro integrado
* ✅ Relatórios de consultas e financeiro
* ✅ Upload de documentos
* ✅ Sistema responsivo (Mobile, Tablet, Desktop)
* ✅ Backend publicado no Render
* 🚀 Frontend pendente de publicação
