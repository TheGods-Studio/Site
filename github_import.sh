#!/bin/bash

# ============================================================
# Script de deploy para o repositório:
# https://github.com/TheGods-Studio/Site
#
# A sincronização do banco de dados (.db) agora é feita
# automaticamente pelo sync-db.js no servidor Render,
# que atualiza o arquivo diretamente no repositório GitHub
# a cada 5 minutos. NÃO envie o .db para o PC local.
# ============================================================

REPO_URL="https://github.com/TheGods-Studio/Site.git"
REPO_DIR="Site"
BRANCH="main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Deploy para TheGods-Studio/Site ===${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}Erro: Git não está instalado. Instale-o primeiro.${NC}"
    exit 1
fi

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

cd - > /dev/null || exit 1

echo -e "${GREEN}Copiando arquivos do projeto para o repositório...${NC}"
rsync -av --progress ./* "$REPO_DIR"/ \
    --exclude="$REPO_DIR" \
    --exclude="db/" \
    --exclude="data/" \
    --exclude=".env" \
    --exclude=".session-secret" \
    --exclude="*.log" \
    --exclude="sync-db.log" 2>/dev/null || {
    cp -r ./* "$REPO_DIR"/ 2>/dev/null
}

cd "$REPO_DIR" || exit 1

echo -e "${GREEN}Adicionando arquivos ao Git...${NC}"
git add .

if git diff --staged --quiet; then
    echo -e "${YELLOW}Nenhuma mudança detectada. Nada para commitar.${NC}"
else
    DATAHORA=$(date "+%d/%m/%Y %H:%M:%S")
    echo -e "${GREEN}Commitando alterações...${NC}"
    git commit -m "Deploy automático via script - $DATAHORA"

    echo -e "${GREEN}Enviando para o GitHub...${NC}"
    git push origin "$BRANCH" || {
        echo -e "${RED}Erro ao fazer push. Verifique suas credenciais.${NC}"
        echo -e "${YELLOW}Dica: use 'git config --global credential.helper store' para salvar a senha.${NC}"
        exit 1
    }
fi

echo -e "${GREEN}✅ Deploy concluído com sucesso!${NC}"
