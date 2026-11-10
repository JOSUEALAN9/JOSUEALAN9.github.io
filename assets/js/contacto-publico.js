/* contacto-publico.js — El contacto que muestran las páginas públicas (Aviso de privacidad, Términos, Ayuda).
   Mientras «correo» esté vacío se manda al formulario de la página principal (y, a quien ya tiene cuenta, a su
   Configuración). Al poner aquí un correo, todas las páginas lo muestran. */
window.FC_CONTACTO = { correo: "soporte@fiscontable.app", ventas: "ventas@fiscontable.app" };
(function () {
    var c = window.FC_CONTACTO, en = (document.documentElement.lang || "es").slice(0, 2) === "en", txt;
    if (c.correo) txt = (en ? "to " : "a ") + '<a href="mailto:' + c.correo + '">' + c.correo + "</a>";
    else if (en) txt = 'through <a href="/en/?sitio#registro">the form on our home page</a> or, if you already have an account, from <b>Settings → Plan and credits</b> inside Fiscontable';
    else txt = 'desde <a href="/?sitio#registro">el formulario de la página principal</a> o, si ya tienes cuenta, en <b>Configuración → Plan y créditos</b> dentro de Fiscontable';
    document.querySelectorAll("[data-contacto]").forEach(function (el) { el.innerHTML = txt; });
})();
