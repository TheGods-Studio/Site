@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo ==========================================
echo   The Gods Studio - Git Push Script
echo ==========================================
echo.

set "REPO_URL=https://github.com/TheGods-Studio/Site.git"
set "BRANCH=main"
set "COMMIT_MSG=feat: admin panel e sistema RBAC completo"

REM ==========================================
REM Verifica se o Git esta instalado
REM ==========================================
git --version >nul 2>&1
if errorlevel 1 (
    echo ERRO: Git nao encontrado.
    echo Instale o Git em:
    echo https://git-scm.com/
    echo.
    pause
    exit /b 1
)

REM ==========================================
REM Verifica se ja e um repositorio Git
REM ==========================================
if not exist ".git\" (
    echo Inicializando repositorio Git...
    git init

    if errorlevel 1 (
        echo ERRO: Nao foi possivel inicializar o Git.
        pause
        exit /b 1
    )

    echo.
    echo Definindo branch principal como %BRANCH%...
    git branch -M %BRANCH%

    echo.
    echo Adicionando remote:
    echo %REPO_URL%
    git remote add origin "%REPO_URL%"
) else (
    echo Repositorio Git ja inicializado.
    echo.

    REM Verifica se o remote origin existe
    git remote get-url origin >nul 2>&1

    if errorlevel 1 (
        echo Adicionando remote:
        echo %REPO_URL%
        git remote add origin "%REPO_URL%"
    ) else (
        echo Remote ja configurado.
        echo Atualizando URL do remote...
        git remote set-url origin "%REPO_URL%"
    )
)

REM ==========================================
REM Garante que a branch seja main
REM ==========================================
echo.
echo Verificando branch...
git branch -M %BRANCH%

REM ==========================================
REM Verificacao de arquivos sensiveis
REM ==========================================
echo.
echo ==========================================
echo   Verificando arquivos sensiveis...
echo ==========================================
echo.

REM .env
if exist ".env" (
    echo AVISO: Arquivo .env encontrado!
    echo Este arquivo pode conter senhas ou chaves secretas.
    echo.

    if not exist ".gitignore" (
        echo ERRO: .gitignore nao existe!
        echo Crie um .gitignore antes de continuar.
        pause
        exit /b 1
    )

    findstr /E /C:".env" .gitignore >nul 2>&1

    if errorlevel 1 (
        echo ERRO: .env nao esta protegido pelo .gitignore!
        echo Adicione:
        echo .env
        echo.
        pause
        exit /b 1
    ) else (
        echo OK: .env esta protegido pelo .gitignore.
    )
)

REM .session-secret
if exist ".session-secret" (
    echo.
    echo AVISO: Arquivo .session-secret encontrado!

    if not exist ".gitignore" (
        echo ERRO: .gitignore nao existe!
        pause
        exit /b 1
    )

    findstr /E /C:".session-secret" .gitignore >nul 2>&1

    if errorlevel 1 (
        echo ERRO: .session-secret nao esta protegido pelo .gitignore!
        echo Adicione:
        echo .session-secret
        echo.
        pause
        exit /b 1
    ) else (
        echo OK: .session-secret esta protegido pelo .gitignore.
    )
)

REM Pasta data
if exist "data\" (
    echo.
    echo AVISO: Pasta data\ encontrada!

    if not exist ".gitignore" (
        echo ERRO: .gitignore nao existe!
        pause
        exit /b 1
    )

    findstr /C:"data/" .gitignore >nul 2>&1

    if errorlevel 1 (
        findstr /C:"data\" .gitignore >nul 2>&1
    )

    if errorlevel 1 (
        echo ERRO: data/ nao esta protegido pelo .gitignore!
        echo Adicione:
        echo data/
        echo.
        pause
        exit /b 1
    ) else (
        echo OK: data/ esta protegido pelo .gitignore.
    )
)

REM ==========================================
REM Adicionando arquivos
REM ==========================================
echo.
echo ==========================================
echo   Adicionando arquivos...
echo ==========================================
echo.

git add .

if errorlevel 1 (
    echo ERRO: Falha ao adicionar arquivos.
    pause
    exit /b 1
)

REM ==========================================
REM Status
REM ==========================================
echo.
echo ==========================================
echo   Status do Git
echo ==========================================
echo.

git status

REM ==========================================
REM Commit
REM ==========================================
echo.
echo ==========================================
echo   Criando commit
echo ==========================================
echo.

git diff --cached --quiet

if errorlevel 1 (
    echo Criando commit:
    echo %COMMIT_MSG%
    echo.

    git commit -m "%COMMIT_MSG%"

    if errorlevel 1 (
        echo.
        echo ERRO: Falha ao criar o commit.
        pause
        exit /b 1
    )
) else (
    echo Nenhuma alteracao nova para commit.
)

REM ==========================================
REM Push
REM ==========================================
echo.
echo ==========================================
echo   Enviando para o GitHub...
echo ==========================================
echo.

git push -u origin %BRANCH%

if errorlevel 1 (
    echo.
    echo ==========================================
    echo   ERRO NO PUSH
    echo ==========================================
    echo.
    echo O push normal falhou.
    echo.
    echo Possiveis motivos:
    echo - Voce nao esta autenticado no GitHub
    echo - O repositorio nao pertence a sua conta
    echo - A branch remota possui commits diferentes
    echo - O GitHub rejeitou o push
    echo.

    choice /C SN /N /M "Deseja tentar FORCE PUSH? [S/N]: "

    if errorlevel 2 (
        echo.
        echo Push cancelado.
        pause
        exit /b 1
    )

    echo.
    echo ATENCAO: FORCE PUSH pode sobrescrever historico remoto!
    echo.

    git push -u origin %BRANCH% --force

    if errorlevel 1 (
        echo.
        echo ERRO: Force push tambem falhou.
        pause
        exit /b 1
    )
)

REM ==========================================
REM Sucesso
REM ==========================================
echo.
echo ==========================================
echo   SUCESSO!
echo ==========================================
echo.
echo Projeto enviado para:
echo %REPO_URL%
echo.
echo Branch:
echo %BRANCH%
echo.
echo Commit:
echo %COMMIT_MSG%
echo.
echo ==========================================

pause
exit /b 0