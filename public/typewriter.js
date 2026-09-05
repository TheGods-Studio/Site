/**
 * The Gods Studio - Efeito de Digitação (Typewriter)
 * 
 * Como usar:
 * No HTML, você pode definir o título e subtítulo diretamente na tag:
 * <h1 class="page-title" data-title="The Gods Studio" data-subtitle="Design - Programação - Tecnologia">
 *   <span class="title-line"><span id="typed-title"></span><span class="cursor" id="cursor-title"></span></span>
 *   <span class="title-line title-subtitle"><span id="typed-subtitle"></span><span class="cursor" id="cursor-subtitle"></span></span>
 * </h1>
 * 
 * Se você não colocar data-title ou data-subtitle, ele usará os textos padrão da página!
 */

(function () {
  'use strict';

  function initTypewriter() {
    const typedTitle = document.getElementById('typed-title');
    const typedSubtitle = document.getElementById('typed-subtitle');
    const cursorTitle = document.getElementById('cursor-title');
    const cursorSubtitle = document.getElementById('cursor-subtitle');

    if (!typedTitle || !typedSubtitle) return;

    // Detecta os textos configurados no HTML ou define padrão conforme a página
    const container = typedTitle.closest('[data-title], [data-subtitle]') || document.querySelector('.page-title-box, .page-title') || {};
    const path = window.location.pathname.toLowerCase();

    let titleText = (container.getAttribute && container.getAttribute('data-title')) || 'The Gods Studio';
    let subtitleText = (container.getAttribute && container.getAttribute('data-subtitle')) || '';

    if (!subtitleText) {
      if (path.includes('shop')) {
        subtitleText = 'Loja oficial - Boas Compras!';
      } else if (path.includes('aplicativos')) {
        subtitleText = 'Aplicativos / Programas';
      } else if (path.includes('contato')) {
        subtitleText = 'Contato Oficial';
      } else {
        subtitleText = 'Design - Programação - Tecnologia';
      }
    }

    let titleIndex = 0;
    let subtitleIndex = 0;
    let phase = 0; // 0: digitando título, 1: digitando subtítulo, 2: pausa final

    function updateCursors() {
      if (cursorTitle) cursorTitle.style.display = (phase === 0) ? 'inline-block' : 'none';
      if (cursorSubtitle) cursorSubtitle.style.display = (phase === 1 || phase === 2) ? 'inline-block' : 'none';
    }

    function type() {
      updateCursors();

      // Fase 0: Digitando o título
      if (phase === 0) {
        if (titleIndex < titleText.length) {
          typedTitle.textContent = titleText.substring(0, titleIndex + 1);
          titleIndex++;
          setTimeout(type, 65);
        } else {
          phase = 1;
          setTimeout(type, 350);
        }
        return;
      }

      // Fase 1: Digitando o subtítulo
      if (phase === 1) {
        if (subtitleIndex < subtitleText.length) {
          typedSubtitle.textContent = subtitleText.substring(0, subtitleIndex + 1);
          subtitleIndex++;
          setTimeout(type, 45);
        } else {
          phase = 2;
          updateCursors();
        }
      }
    }

    // Inicia após um pequeno delay para a página carregar
    setTimeout(type, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTypewriter);
  } else {
    initTypewriter();
  }
})();
