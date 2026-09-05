/**
 * The Gods Studio - Tema Visual e Efeitos Globais
 * - Barra lateral única gerada automaticamente
 * - Fundo animado Matrix Rain com caracteres ricos
 * - Compatível com o sistema de login e permissões
 */

(function () {
  'use strict';

  const isAdminArea = window.location.pathname.includes('/admin');
  const isConfigPage = window.location.pathname.endsWith('/config.html') || window.location.pathname === '/config.html';
  const logoPath = 'Images/TheGods Studio - LOGO.png';

  /**
   * Adiciona a barra lateral em todas as páginas públicas
   */
  function addSidebar() {
    if (isAdminArea || isConfigPage || document.querySelector('.sidebar, .admin-sidebar, .config-sidebar')) return;

    const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    
    // Páginas do menu: [arquivo, nome amigável, requer login?]
    const links = [
      ['index.html', 'Início', false],
      ['aplicativos.html', 'Aplicativos', true],
      ['shop.html', 'Loja', true],
      ['contato.html', 'Contato', true]
    ];

    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar site-theme-sidebar';
    sidebar.setAttribute('aria-label', 'Navegação principal');

    let linksHtml = '<img src="' + logoPath + '" alt="The Gods Studio" class="logo-sidebar">';
    
    links.forEach(function (link) {
      const active = (currentPage === link[0] || (currentPage === '' && link[0] === 'index.html')) ? ' class="active"' : '';
      const protectedAttr = link[2] ? ' data-protected="true"' : '';
      linksHtml += '<a href="' + link[0] + '"' + active + protectedAttr + '>' + link[1] + '</a>';
    });

    // Botão de configurações (aparece quando o usuário estiver logado)
    linksHtml += '<a href="config.html" id="settings-btn" hidden aria-label="Configurações da conta">Configurações</a>';

    // Botão de acesso ao Painel Admin (aparece somente quando o usuário for admin)
    linksHtml += '<a href="/admin" data-admin-link style="display: none;" aria-label="Painel Administrativo">Painel Admin</a>';

    sidebar.innerHTML = linksHtml;
    document.body.appendChild(sidebar);
  }

  /**
   * Fundo animado da Chuva Matrix (executa em apenas 1 instância para economizar CPU)
   */
  function addMatrixRain() {
    let canvas = document.getElementById('matrix-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'matrix-canvas';
      document.body.prepend(canvas);
    }
    
    // Evita duplicar a animação se já estiver pronta
    if (canvas.dataset.siteThemeReady) return;
    canvas.dataset.siteThemeReady = 'true';

    const ctx = canvas.getContext('2d');
    
    // Conjunto de caracteres estilo Cyberpunk (alfanumérico + japonês + símbolos)
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?/~`あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよアイウエオカキクケコサシスセソタチツテト';
    const charsArray = chars.split('');

    let width = 0;
    let height = 0;
    let fontSize = 16;
    let columns = 0;
    let drops = [];

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      fontSize = Math.max(14, Math.min(20, width / 60));
      columns = Math.floor(width / fontSize);
      drops = [];
      for (let i = 0; i < columns; i++) {
        drops[i] = Math.floor(Math.random() * -80);
      }
    }

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.045)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = fontSize + 'px monospace';
      ctx.textAlign = 'center';

      for (let i = 0; i < drops.length; i++) {
        const char = charsArray[Math.floor(Math.random() * charsArray.length)];
        const x = i * fontSize + fontSize / 2;
        const y = drops[i] * fontSize;

        // Cor ciano neon com variações sutis de brilho
        const alpha = Math.random() * 0.35 + 0.55;
        ctx.fillStyle = 'rgba(0, 255, 234, ' + alpha + ')';
        ctx.fillText(char, x, y);

        drops[i]++;

        // Reinicia a gota no topo ao atingir o final da tela
        if (drops[i] * fontSize > height && Math.random() > 0.975) {
          drops[i] = Math.floor(Math.random() * -30);
        }
      }

      window.requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  function init() {
    document.body.classList.add('site-theme-active');
    addSidebar();
    addMatrixRain();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
