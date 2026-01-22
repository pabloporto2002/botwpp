#!/bin/bash

# ========================================
# Auto-Update Bot - Silfer Concursos
# Verifica atualizações a cada 5 minutos
# ========================================

BOT_DIR="$HOME/botwpp"
CHECK_INTERVAL=300  # 5 minutos em segundos
BOT_PID=""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')]${NC} $1"
}

# Inicia o bot
start_bot() {
    log "🚀 Iniciando bot..."
    cd "$BOT_DIR"
    npm start &
    BOT_PID=$!
    log "Bot iniciado com PID: $BOT_PID"
}

# Para o bot
stop_bot() {
    if [ -n "$BOT_PID" ] && kill -0 "$BOT_PID" 2>/dev/null; then
        warn "⏹️ Parando bot (PID: $BOT_PID)..."
        kill $BOT_PID 2>/dev/null
        wait $BOT_PID 2>/dev/null
        log "Bot parado."
    fi
}

# Verifica se há atualizações no GitHub
check_updates() {
    cd "$BOT_DIR"
    
    # Busca atualizações sem aplicar
    git fetch origin main --quiet 2>/dev/null
    
    # Compara local com remoto
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse origin/main 2>/dev/null)
    
    if [ "$LOCAL" != "$REMOTE" ]; then
        return 0  # Há atualizações
    else
        return 1  # Sem atualizações
    fi
}

# Aplica atualizações
apply_updates() {
    cd "$BOT_DIR"
    
    warn "📥 Baixando atualizações..."
    git pull origin main --quiet
    
    log "📦 Atualizando dependências..."
    npm install --quiet 2>/dev/null
    
    log "✅ Atualização concluída!"
}

# Cleanup ao sair
cleanup() {
    warn "\n🛑 Encerrando..."
    stop_bot
    exit 0
}

trap cleanup SIGINT SIGTERM

# ========================================
# MAIN
# ========================================

clear
echo "========================================"
echo "   🤖 SILFER BOT - AUTO UPDATE"
echo "   Verificando a cada 5 minutos"
echo "========================================"
echo ""

# Verifica se o diretório existe
if [ ! -d "$BOT_DIR" ]; then
    error "❌ Diretório $BOT_DIR não encontrado!"
    error "Execute primeiro: git clone https://github.com/pabloporto2002/botwpp.git ~/botwpp"
    exit 1
fi

# Verifica se há .env
if [ ! -f "$BOT_DIR/.env" ]; then
    warn "⚠️ Arquivo .env não encontrado!"
    warn "Crie o arquivo: nano $BOT_DIR/.env"
fi

# Atualiza antes de iniciar
log "🔄 Verificando atualizações iniciais..."
if check_updates; then
    apply_updates
fi

# Inicia o bot
start_bot

# Loop principal
while true; do
    sleep $CHECK_INTERVAL
    
    log "🔍 Verificando atualizações..."
    
    if check_updates; then
        warn "📢 Nova atualização disponível!"
        stop_bot
        apply_updates
        start_bot
    else
        log "✓ Sem atualizações."
    fi
done
