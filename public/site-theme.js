(function () {
  'use strict';

  const isAdminArea = window.location.pathname.includes('/admin');
  const logoPath = 'Images/TheGods Studio - LOGO.png';

  function addSidebar() {
    if (isAdminArea || document.querySelector('.sidebar, .admin-sidebar, .config-sidebar, .site-theme-sidebar')) return;
    const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const links = [
      ['index.html', 'Inicio'],
      ['aplicativos.html', 'Aplicativos'],
      ['shop.html', 'Loja'],
      ['contato.html', 'Contato']
    ];
    const sidebar = document.createElement('nav');
    sidebar.className = 'site-theme-sidebar';
    sidebar.setAttribute('aria-label', 'Navegacao principal');
    sidebar.innerHTML = '<img src="' + logoPath + '" alt="The Gods Studio">' + links.map(function (link) {
      const active = currentPage === link[0] ? ' class="active"' : '';
      return '<a href="' + link[0] + '"' + active + '>' + link[1] + '</a>';
    }).join('');
    document.body.appendChild(sidebar);
  }

  function addMatrixRain() {
    let canvas = document.getElementById('matrix-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'matrix-canvas';
      document.body.prepend(canvas);
    }
    if (canvas.dataset.siteThemeReady) return;
    canvas.dataset.siteThemeReady = 'true';
    const context = canvas.getContext('2d');
    const chars = '01ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    let width = 0;
    let height = 0;
    let fontSize = 16;
    let drops = [];

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      fontSize = Math.max(14, Math.min(20, width / 60));
      drops = Array.from({ length: Math.ceil(width / fontSize) }, function () {
        return Math.floor(Math.random() * -80);
      });
    }

    function draw() {
      context.fillStyle = 'rgba(0, 0, 0, .045)';
      context.fillRect(0, 0, width, height);
      context.font = fontSize + 'px monospace';
      context.textAlign = 'center';
      drops.forEach(function (drop, index) {
        const x = index * fontSize + fontSize / 2;
        const y = drop * fontSize;
        context.fillStyle = 'rgba(0, 255, 234, ' + (Math.random() * .35 + .45) + ')';
        context.fillText(chars[Math.floor(Math.random() * chars.length)], x, y);
        drops[index] += 1;
        if (y > height && Math.random() > .975) drops[index] = Math.floor(Math.random() * -30);
      });
      window.requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  function init() {
    document.body.classList.add('site-theme-active');
    addSidebar();
    const authWrap = document.querySelector('.auth-wrap');
    if (authWrap && !document.querySelector('.page-shell')) authWrap.classList.add('site-theme-content');
    addMatrixRain();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
