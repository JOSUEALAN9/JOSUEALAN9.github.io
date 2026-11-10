/**
 * forma-demo.js — El formulario «Solicita una demo». Un solo componente para la página principal (#registro) y /demo.
 * Uso:  <div data-forma-demo data-idioma="es"></div>   (se monta automáticamente)   o   Fiscontable.formaDemo(caja, { idioma: "en" })
 * Manda la solicitud a /publico/demo (sin cookies). El servidor revisa todo (core/demos.py): el campo trampa, el tiempo
 * mínimo para llenarlo y los topes por red y por correo. Estilos: assets/css/forma-demo.css.
 */
(function () {
    "use strict";
    var F = window.Fiscontable = window.Fiscontable || {};
    var TEXTOS = {
        es: {
            nombre: "Tu nombre", correo: "Correo electrónico", telefono: "Teléfono", opcional: "(opcional)", personas: "¿Cuántas personas?",
            opciones: [["1", "Solo yo"], ["2-5", "2 a 5"], ["6-10", "6 a 10"], ["11+", "Más de 10"]],
            despacho: "Despacho o empresa", mensaje: "¿Qué te gustaría resolver?",
            acepto: 'Acepto el <a href="/privacidad/" target="_blank" rel="noopener">Aviso de privacidad</a> y los <a href="/terminos/" target="_blank" rel="noopener">Términos</a>.',
            ofertas: "Quiero recibir novedades y promociones de Fiscontable por correo o WhatsApp.",
            enviar: "Solicitar mi demo", enviando: "Enviando…",
            faltaNombre: "Escribe tu nombre.", faltaCorreo: "Escribe un correo válido: ahí te llega el acceso.", faltaAcepto: "Para continuar, acepta el Aviso de privacidad.",
            fallo: "No pudimos enviar tu solicitud. Intenta de nuevo en unos minutos.",
            listo: "Recibimos tu solicitud", listoTexto: "Recibirás un correo en cuanto tu demo esté activa. Revisa también la carpeta de correo no deseado."
        },
        en: {
            nombre: "Your name", correo: "Email", telefono: "Phone", opcional: "(optional)", personas: "How many people?",
            opciones: [["1", "Just me"], ["2-5", "2 to 5"], ["6-10", "6 to 10"], ["11+", "More than 10"]],
            despacho: "Firm or company", mensaje: "What would you like to solve?",
            acepto: 'I accept the <a href="/en/privacy/" target="_blank" rel="noopener">Privacy notice</a> and the <a href="/en/terms/" target="_blank" rel="noopener">Terms</a>.',
            ofertas: "I would like to receive news and offers from Fiscontable by email or WhatsApp.",
            enviar: "Request my demo", enviando: "Sending…",
            faltaNombre: "Enter your name.", faltaCorreo: "Enter a valid email: that is where your access arrives.", faltaAcepto: "To continue, accept the Privacy notice.",
            fallo: "We could not send your request. Please try again in a few minutes.",
            listo: "We received your request", listoTexto: "We will email you as soon as your demo is ready. Check your spam folder too."
        }
    };

    F.formaDemo = function (caja, opciones) {
        if (!caja || caja.dataset.montada) return;
        caja.dataset.montada = "1";
        var idioma = (opciones && opciones.idioma) || caja.dataset.idioma || "es", t = TEXTOS[idioma] || TEXTOS.es, inicio = Date.now();
        var op = ' <i>' + t.opcional + "</i>";
        caja.innerHTML =
            '<form class="fd" novalidate>' +
            '<label class="fd__campo"><span>' + t.nombre + '</span><input class="fd__control" name="nombre" autocomplete="name" maxlength="80" required></label>' +
            '<label class="fd__campo"><span>' + t.correo + '</span><input class="fd__control" name="correo" type="email" autocomplete="email" inputmode="email" maxlength="120" required></label>' +
            '<div class="fd__fila">' +
            '<label class="fd__campo"><span>' + t.telefono + op + '</span><input class="fd__control" name="telefono" type="tel" autocomplete="tel" inputmode="tel" maxlength="20"></label>' +
            '<label class="fd__campo"><span>' + t.personas + '</span><select class="fd__control" name="personas">' +
            t.opciones.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + "</select></label>" +
            "</div>" +
            '<label class="fd__campo"><span>' + t.despacho + op + '</span><input class="fd__control" name="despacho" autocomplete="organization" maxlength="100"></label>' +
            '<label class="fd__campo"><span>' + t.mensaje + op + '</span><textarea class="fd__control" name="mensaje" rows="2" maxlength="600"></textarea></label>' +
            '<label class="fd__trampa" aria-hidden="true">Sitio web <input name="sitio_web" tabindex="-1" autocomplete="off"></label>' +
            '<label class="fd__casilla"><input type="checkbox" name="acepto"><span>' + t.acepto + "</span></label>" +
            '<label class="fd__casilla"><input type="checkbox" name="ofertas"><span>' + t.ofertas + "</span></label>" +
            '<div class="fd__aviso" role="alert" hidden></div>' +
            '<button type="submit" class="fd__boton">' + t.enviar + "</button>" +
            "</form>";
        var forma = caja.querySelector("form"), boton = caja.querySelector(".fd__boton"), aviso = caja.querySelector(".fd__aviso");
        function decir(texto) { aviso.textContent = texto; aviso.hidden = !texto; }
        forma.addEventListener("input", function () { decir(""); });
        forma.addEventListener("submit", async function (e) {
            e.preventDefault();
            var d = {};
            new FormData(forma).forEach(function (v, k) { d[k] = typeof v === "string" ? v.trim() : v; });
            d.acepto = forma.acepto.checked;
            d.ofertas = forma.ofertas.checked;
            d.idioma = idioma;
            d.t = Date.now() - inicio;
            if ((d.nombre || "").length < 3) { forma.nombre.focus(); return decir(t.faltaNombre); }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo || "")) { forma.correo.focus(); return decir(t.faltaCorreo); }
            if (!d.acepto) { forma.acepto.focus(); return decir(t.faltaAcepto); }
            boton.disabled = true; boton.textContent = t.enviando;
            try {
                var r = await fetch(F.API + "/publico/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
                if (!r.ok) throw new Error(idioma === "es" && F.leerError ? await F.leerError(r) : t.fallo);
                caja.innerHTML = '<div class="fd__listo" role="status" tabindex="-1"><span class="fd__listo-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
                    "<h3>" + t.listo + "</h3><p>" + t.listoTexto + "</p></div>";
                caja.firstChild.focus();
                if (opciones && typeof opciones.alTerminar === "function") opciones.alTerminar();
            } catch (er) {
                decir(er instanceof TypeError || /conectar|servidor|sesión/i.test(er.message) ? t.fallo : er.message);
                boton.disabled = false; boton.textContent = t.enviar;
            }
        });
    };

    document.querySelectorAll("[data-forma-demo]").forEach(function (caja) { F.formaDemo(caja); });
})();
