/**
 * cuenta.js — Piezas únicas del inicio de sesión propio (las usan /login y Configuración → Mi perfil → Seguridad).
 * Solo necesitan nucleo.js (la pantalla de inicio de sesión no carga la barra).
 *
 *   Fiscontable.campoClave(caja, { etiqueta, confirmar, oscuro, autocompletar })
 *       → { valor(), lista() }   contraseña con «Ver», la regla en vivo y, si se pide, confirmarla.
 *   Fiscontable.dosPasos(caja, { preparar, activar, alTerminar, oscuro })
 *       preparar() → {secreto, uri}; activar(codigo) → {respaldo: [...]}. Muestra el QR, pide el código y al final los
 *       10 códigos de respaldo (copiar o descargar) antes de seguir.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, esc = F.escapar;
    var REGLAS = [
        ["largo", "8 o más caracteres", function (v) { return v.length >= 8; }],
        ["mayus", "Una mayúscula", function (v) { return /[A-ZÁÉÍÓÚÑÜ]/.test(v); }],
        ["numero", "Un número", function (v) { return /\d/.test(v); }],
        ["especial", "Un carácter especial (! ? # $ %)", function (v) { return /[^\w\s]|_/.test(v); }]
    ];
    var n = 0;

    F.campoClave = function (caja, o) {
        o = o || {};
        var id = "fcc-" + (++n);
        caja.innerHTML = '<div class="fcc' + (o.oscuro ? " fcc--oscuro" : "") + '">' +
            '<label class="fcc__campo" for="' + id + '"><span>' + esc(o.etiqueta || "Contraseña nueva") + "</span>" +
            '<span class="fcc__caja"><input id="' + id + '" type="password" class="fcc__input" maxlength="128" autocomplete="' + (o.autocompletar || "new-password") + '">' +
            '<button type="button" class="fcc__ver" aria-label="Ver la contraseña">Ver</button></span></label>' +
            '<ul class="fcc__regla" aria-live="polite">' + REGLAS.map(function (r) { return '<li data-r="' + r[0] + '">' + esc(r[1]) + "</li>"; }).join("") + "</ul>" +
            (o.confirmar ? '<label class="fcc__campo" for="' + id + 'b"><span>Escríbela otra vez</span><span class="fcc__caja"><input id="' + id + 'b" type="password" class="fcc__input" maxlength="128" autocomplete="new-password"></span></label>' +
                '<p class="fcc__igual" hidden>No coinciden.</p>' : "") + "</div>";
        var a = caja.querySelector("#" + id), b = o.confirmar ? caja.querySelector("#" + id + "b") : null;
        function pintar() {
            var v = a.value;
            REGLAS.forEach(function (r) { caja.querySelector('[data-r="' + r[0] + '"]').classList.toggle("fcc--bien", r[2](v)); });
            if (b) caja.querySelector(".fcc__igual").hidden = !b.value || b.value === v;
        }
        a.addEventListener("input", pintar);
        if (b) b.addEventListener("input", pintar);
        caja.querySelector(".fcc__ver").addEventListener("click", function () {
            var ver = a.type === "password";
            a.type = ver ? "text" : "password"; if (b) b.type = a.type;
            this.textContent = ver ? "Ocultar" : "Ver";
        });
        return {
            entrada: a,
            valor: function () { return a.value; },
            /** Mensaje de lo que falta, o "" si cumple. */
            revisar: function () {
                var faltan = REGLAS.filter(function (r) { return !r[2](a.value); }).map(function (r) { return r[1].toLowerCase(); });
                if (faltan.length) return "A tu contraseña le falta: " + faltan.join(", ") + ".";
                if (b && b.value !== a.value) return "Las dos contraseñas no coinciden.";
                return "";
            }
        };
    };

    var qrListo = null;
    function cargarQr() {
        if (window.QRCode) return Promise.resolve(window.QRCode);
        if (!qrListo) qrListo = new Promise(function (ok, mal) {
            var s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
            s.onload = function () { ok(window.QRCode); };
            s.onerror = function () { qrListo = null; mal(new Error("sin QR")); };
            document.head.appendChild(s);
        });
        return qrListo;
    }

    F.dosPasos = async function (caja, o) {
        o = o || {};
        caja.innerHTML = '<div class="fdp' + (o.oscuro ? " fdp--oscuro" : "") + '"><p class="fdp__texto">Preparando…</p></div>';
        var datos;
        try { datos = await o.preparar(); } catch (e) { caja.querySelector(".fdp__texto").textContent = e.message; return; }
        caja.innerHTML = '<div class="fdp' + (o.oscuro ? " fdp--oscuro" : "") + '">' +
            '<ol class="fdp__pasos"><li>Abre en tu teléfono <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> y agrega una cuenta.</li>' +
            "<li>Escanea este código (o escribe la clave a mano).</li><li>Escribe el código de 6 números que te muestra.</li></ol>" +
            '<div class="fdp__qr" aria-label="Código QR para tu app"></div>' +
            '<p class="fdp__clave">Clave: <code>' + esc(datos.secreto) + "</code></p>" +
            '<form class="fdp__forma"><input class="fdp__codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" aria-label="Código de 6 números">' +
            '<button type="submit" class="fdp__boton">Activar</button></form><p class="fdp__msj" role="alert" hidden></p></div>';
        try {
            var Q = await cargarQr();
            new Q(caja.querySelector(".fdp__qr"), { text: datos.uri, width: 176, height: 176, colorDark: "#1C1B19", colorLight: "#FFFFFF", correctLevel: Q.CorrectLevel.M });
        } catch (e) { caja.querySelector(".fdp__qr").remove(); }
        var forma = caja.querySelector("form"), msj = caja.querySelector(".fdp__msj"), campo = caja.querySelector(".fdp__codigo");
        campo.focus();
        forma.addEventListener("submit", async function (e) {
            e.preventDefault();
            var codigo = campo.value.replace(/\D/g, "");
            if (codigo.length !== 6) { msj.textContent = "Escribe los 6 números que muestra tu app."; msj.hidden = false; return; }
            var boton = forma.querySelector("button");
            boton.disabled = true;
            try {
                var r = await o.activar(codigo);
                mostrarRespaldo(caja, r.respaldo || [], o);
            } catch (er) { msj.textContent = er.message; msj.hidden = false; boton.disabled = false; }
        });
    };

    function mostrarRespaldo(caja, codigos, o) {
        caja.innerHTML = '<div class="fdp' + (o.oscuro ? " fdp--oscuro" : "") + '"><p class="fdp__ok">✓ Verificación en dos pasos activada.</p>' +
            '<p class="fdp__texto">Guarda estos <b>códigos de respaldo</b>. Cada uno sirve una vez si pierdes tu teléfono. No se vuelven a mostrar.</p>' +
            '<pre class="fdp__respaldo">' + codigos.map(esc).join("\n") + "</pre>" +
            '<div class="fdp__acciones"><button type="button" data-a="copiar">Copiar</button><button type="button" data-a="bajar">Descargar</button>' +
            '<button type="button" data-a="listo" class="fdp__boton">Ya los guardé</button></div></div>';
        caja.querySelector(".fdp__acciones").addEventListener("click", function (e) {
            var b = e.target.closest("[data-a]");
            if (!b) return;
            var texto = "Códigos de respaldo de Fiscontable (cada uno sirve una vez)\n\n" + codigos.join("\n") + "\n";
            if (b.dataset.a === "copiar") navigator.clipboard.writeText(texto).then(function () { b.textContent = "Copiados ✓"; });
            else if (b.dataset.a === "bajar") F.guardarArchivo(new Blob([texto], { type: "text/plain" }), "fiscontable-codigos-de-respaldo.txt");
            else if (o.alTerminar) o.alTerminar();
        });
    }
})();
