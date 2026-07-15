#!/bin/bash

# ============================================================
# Script de upload automático para o repositório:
# https://github.com/TheGods-Studio/Site
# ============================================================

REPO_URL="https://github.com/TheGods-Studio/Site.git"
REPO_DIR="Site"
BRANCH="main"  # Altere para "master" se for o caso

# Cores para mensagens no terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # Sem cor

echo -e "${GREEN}=== Upload Automático para TheGods-Studio/Site ===${NC}"

# 1. Verifica se o Git está instalado
if ! command -v git &> /dev/null; then
    echo -e "${RED}Erro: Git não está instalado. Instale-o primeiro.${NC}"
    exit 1
fi

# 2. Verifica se o diretório do repositório já existe
if [ -d "$REPO_DIR" ]; then
    echo -e "${YELLOW}Diretório '$REPO_DIR' já existe. Atualizando...${NC}"
    cd "$REPO_DIR" || exit 1
    git pull origin "$BRANCH" 2>/dev/null || echo -e "${YELLOW}Não foi possível fazer pull (repositório vazio ou sem commits).${NC}"
else
    echo -e "${GREEN}Clonando repositório...${NC}"
    git clone "$REPO_URL" || {
        echo -e "${RED}Erro ao clonar. Verifique a URL e suas permissões.${NC}"
        exit 1
    }
    cd "$REPO_DIR" || exit 1
fi

# 3. Volta para o diretório anterior (onde estão os arquivos que você quer enviar)
#    e copia TUDO para dentro do repositório (exceto o próprio .git)
cd - > /dev/null || exit 1

echo -e "${GREEN}Copiando arquivos para o repositório...${NC}"
# Copia todos os arquivos e pastas (exceto o diretório do repositório)
# OBS: isso sobrescreve arquivos com o mesmo nome
rsync -av --progress ./* "$REPO_DIR"/ --exclude="$REPO_DIR" 2>/dev/null || {
    # fallback caso rsync não esteja disponível
    cp -r ./* "$REPO_DIR"/ 2>/dev/null
}
# Remove arquivos temporários e pastas indesejadas (opcional)
# rm -rf "$REPO_DIR"/*.tmp

# 4. Entra no repositório e faz o commit
cd "$REPO_DIR" || exit 1

echo -e "${GREEN}Adicionando arquivos ao Git...${NC}"
git add .

# Verifica se há mudanças para commit
if git diff --staged --quiet; then
    echo -e "${YELLOW}Nenhuma mudança detectada. Nada para commitar.${NC}"
else
    # Pega a data/hora para a mensagem de commit
    DATAHORA=$(date "+%d/%m/%Y %H:%M:%S")
    echo -e "${GREEN}Commitando alterações...${NC}"
    git commit -m "Upload automático via script - $DATAHORA"

    echo -e "${GREEN}Enviando para o GitHub...${NC}"
    git push origin "$BRANCH" || {
        echo -e "${RED}Erro ao fazer push. Verifique suas credenciais.${NC}"
        echo -e "${YELLOW}Dica: use 'git config --global credential.helper store' para salvar a senha.${NC}"
        exit 1
    }
fi

echo -e "${GREEN}✅ Upload concluído com sucesso!${NC}"
