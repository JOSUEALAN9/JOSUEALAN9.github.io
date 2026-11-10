/* contacto-publico.js — El contacto que muestran las páginas públicas (Aviso de privacidad, Ayuda).
   Si correo está vacío, se indica escribir desde la cuenta (Configuración → Plan y créditos). */
window.FC_CONTACTO = { correo: "" };
(function () {
    var c = window.FC_CONTACTO, txt = c.correo
        ? 'a <a href="mailto:' + c.correo + '">' + c.correo + "</a>"
        : "por el correo o WhatsApp que aparece en Fiscontable, en <b>Configuración → Plan y créditos</b>";
    document.querySelectorAll("[data-contacto]").forEach(function (el) { el.innerHTML = txt; });
})();
