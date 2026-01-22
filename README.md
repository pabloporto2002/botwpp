# 🤖 Bot WhatsApp - Silfer Concursos

Bot de atendimento automatizado para WhatsApp, desenvolvido para a **Silfer Concursos**.

## 🎯 Funcionalidades

- ✅ **Respostas Automáticas** - Responde com base em palavras-chave
- ✅ **Sistema de Aprendizado** - Aprende novas respostas quando o admin responde perguntas desconhecidas
- ✅ **Follow-up Automático** - Envia lembrete após 5 minutos de inatividade
- ✅ **Encaminhamento ao Admin** - Perguntas desconhecidas são encaminhadas ao administrador
- ✅ **Formatação WhatsApp** - Usa *negrito*, _itálico_ e emojis

## 📁 Estrutura do Projeto

```
botWpp/
├── baileys/              # Bot principal (Baileys WebSocket)
│   ├── index.js          # Arquivo principal do bot
│   ├── explorer.js       # Ferramenta de exploração (opcional)
│   └── package.json
├── shared/               # Arquivos compartilhados
│   ├── respostas.json    # Base de respostas conhecidas
│   ├── learnedResponses.json  # Respostas aprendidas
│   ├── pendingQuestions.json  # Perguntas pendentes
│   ├── responseHandler.js     # Processador de mensagens
│   ├── learningService.js     # Sistema de aprendizado
│   └── geminiService.js       # Integração com Gemini AI
├── .env.example          # Exemplo de variáveis de ambiente
└── README.md
```

## 🚀 Instalação

### 1. Clone o repositório
```bash
git clone https://github.com/SEU_USUARIO/botWpp.git
cd botWpp
```

### 2. Configure as variáveis de ambiente
```bash
cp .env.example .env
# Edite o .env com suas chaves de API do Gemini
```

### 3. Instale as dependências
```bash
cd baileys
npm install
```

### 4. Execute o bot
```bash
npm start
```

### 5. Escaneie o QR Code
Um QR Code será exibido na tela. Escaneie com o WhatsApp.

## 📱 Instalação no Termux (Android)

```bash
# Atualiza pacotes
pkg update && pkg upgrade -y

# Instala Node.js e Git
pkg install nodejs git -y

# Clona o repositório
git clone https://github.com/SEU_USUARIO/botWpp.git
cd botWpp/baileys

# Instala dependências
npm install

# Cria arquivo .env
nano ../.env
# Cole suas chaves de API

# Inicia o bot
npm start
```

Para manter rodando em background:
```bash
pkg install tmux
tmux new -s bot
npm start
# Ctrl+B, depois D para sair sem parar
```

## ⚙️ Configuração

### Variáveis de Ambiente (.env)
```env
SESSION_NAME=silfer-bot
GEMINI_API_KEY_1=sua_chave_aqui
GEMINI_API_KEY_2=outra_chave_aqui
# Adicione múltiplas chaves para balanceamento
```

### Número do Admin
Edite o arquivo `shared/learningService.js` linha 7:
```javascript
const ADMIN_NUMBER = '5521990338405';
```

## 📝 Sistema de Aprendizado

Quando o bot não sabe uma resposta:
1. Envia ao cliente: *"Vou verificar essa informação..."*
2. Encaminha a pergunta ao admin
3. O admin responde no formato: `#ID resposta`
4. O bot formata, envia ao cliente e **aprende** para próximas vezes

## 🛠️ Tecnologias

- **Node.js** - Runtime JavaScript
- **Baileys** - Biblioteca WhatsApp Web
- **Google Gemini** - IA para formatação de respostas
- **Termux** - Para rodar em Android

## 📄 Licença

Projeto privado - Silfer Concursos © 2026
