#!/bin/bash

# ========================================
# Script de Instalação - Silfer Bot
# Para Termux (Android)
# ========================================

echo "🤖 Instalando Silfer Bot no Termux..."
echo ""

# Atualiza pacotes
echo "📦 Atualizando pacotes..."
pkg update -y && pkg upgrade -y

# Instala dependências
echo "📦 Instalando Node.js e Git..."
pkg install nodejs git -y

# Clona o repositório (substitua pelo seu)
echo "📥 Clonando repositório..."
# git clone https://github.com/SEU_USUARIO/botWpp.git
# cd botWpp

# Se você já clonou, só entre na pasta:
cd ~/botWpp 2>/dev/null || cd ~/storage/shared/botWpp 2>/dev/null || echo "❌ Clone o repositório primeiro!"

# Instala dependências do projeto
echo "📦 Instalando dependências do bot..."
cd baileys
npm install

# Cria .env se não existir
if [ ! -f "../.env" ]; then
    echo "⚙️ Criando arquivo .env..."
    cp ../.env.example ../.env
    echo "⚠️ IMPORTANTE: Edite o arquivo .env com suas chaves!"
    echo "   Execute: nano ../.env"
fi

echo ""
echo "=========================================="
echo "  ✅ Instalação concluída!"
echo "=========================================="
echo ""
echo "Para iniciar o bot:"
echo "  cd ~/botWpp/baileys"
echo "  npm start"
echo ""
echo "Para rodar em background:"
echo "  tmux new -s bot"
echo "  npm start"
echo "  (Ctrl+B, depois D para sair)"
echo ""
