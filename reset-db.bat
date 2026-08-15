@echo off
setlocal

set "TOKEN=90bbfae6f59921b817525cff75554e5c"
set "URL=https://the-gods-studio.onrender.com/api/db-reset"

echo Enviando reset do banco de dados para o Render...
curl -X POST -H "Content-Type: text/plain" -d "%TOKEN%" "%URL%"

echo.
echo Verifique se o retorno foi {"ok":true}.
pause
