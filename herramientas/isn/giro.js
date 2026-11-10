/* Giro o actividad de Tributanet: buscador propio sobre el catálogo del portal.
 * Se puede escribir a mano (la lista solo ayuda) y avisa si lo escrito no está en la lista.
 *   GiroTributanet.conectar(input, { giros: [...], propuesta: { giro, en_lista }, origen: "ISN" })
 * La propuesta nunca se pone automáticamente: la persona pulsa «Usar el mismo» y luego guarda. */
(function () {
    "use strict";
    var TOPE = 40;
    function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function llave(t) {           // sin acentos, signos ni mayúsculas: «TIEND. AUTOSERV.» = «tiend autoserv»
        return String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
    }
    function buscar(indice, texto) {
        var q = llave(texto);
        if (!q) return [];
        var piezas = q.split(" ");
        var hallados = indice.filter(function (g) {
            return piezas.every(function (p) {
                // «tienda» encuentra «TIEND.» y «cerveza» encuentra «CERV.»: el portal abrevia
                return g.llave.indexOf(p) >= 0 || g.palabras.some(function (w) { return w.length >= 3 && p.indexOf(w) === 0; });
            });
        });
        hallados.sort(function (a, b) { return (b.llave.indexOf(q) === 0) - (a.llave.indexOf(q) === 0) || a.llave.length - b.llave.length; });
        return hallados;
    }

    function conectar(input, o) {
        o = o || {};
        var indice = (o.giros || []).map(function (g) { var k = llave(g); return { texto: g, llave: k, palabras: k.split(" ") }; });
        var porLlave = {};
        indice.forEach(function (g) { porLlave[g.llave] = g.texto; });
        var caja = document.createElement("div");
        caja.className = "isn-giro";
        caja.innerHTML = '<ul class="isn-giro__lista" role="listbox" hidden></ul><p class="isn-giro__estado" hidden></p><p class="isn-giro__propuesta" hidden></p>';
        input.closest("label").insertAdjacentElement("afterend", caja);
        var lista = caja.querySelector(".isn-giro__lista"), estado = caja.querySelector(".isn-giro__estado"),
            propuesta = caja.querySelector(".isn-giro__propuesta"), activo = -1, visibles = [];
        input.setAttribute("autocomplete", "off");
        input.placeholder = indice.length ? "Escribe una parte (p. ej. «autoserv cerv») y elige de la lista" : "Escríbelo como aparece en Tributanet";

        function pintarEstado() {
            var v = input.value.trim(), exacto = porLlave[llave(v)];
            estado.hidden = !v || !indice.length;
            if (!estado.hidden) {
                var eligiendo = !exacto && !lista.hidden;          // mientras hay opciones a la vista no se regaña: se invita a elegir
                estado.className = "isn-giro__estado" + (exacto ? " isn-giro__estado--bien" : eligiendo ? "" : " isn-giro__estado--ojo");
                estado.textContent = exacto ? "✓ Está en la lista de Tributanet." : eligiendo ? "Elige uno de la lista (o termina de escribirlo a mano)."
                    : "No está en la lista de Tributanet. Puedes dejarlo escrito a mano, pero si el portal no lo tiene no se podrá presentar.";
            }
            var p = o.propuesta;
            propuesta.hidden = !(p && p.giro) || llave(p.giro) === llave(v);
            if (!propuesta.hidden) {
                propuesta.innerHTML = "En el " + esc(o.origen || "ISN") + " esta empresa declara con el giro <b>" + esc(p.giro) + "</b>" +
                    (p.en_lista === false ? " (no está tal cual en la lista de Tributanet)" : "") +
                    (/\.$/.test(p.giro) && p.en_lista !== false ? " " : ". ") + '<button type="button" class="xml-enlace">Usar el mismo</button>';
            }
        }
        function cerrar() { lista.hidden = true; activo = -1; }
        function abrir() {
            var todos = buscar(indice, input.value);
            visibles = todos.slice(0, TOPE);
            if (!visibles.length || (visibles.length === 1 && visibles[0].texto === input.value.trim())) { cerrar(); return; }
            lista.innerHTML = visibles.map(function (g, i) { return '<li role="option" data-i="' + i + '">' + esc(g.texto) + "</li>"; }).join("") +
                (todos.length > TOPE ? '<li class="isn-giro__mas">y ' + (todos.length - TOPE) + " más: escribe otra palabra para afinar</li>" : "");
            lista.hidden = false; activo = -1;
        }
        function elegir(texto) { input.value = texto; cerrar(); pintarEstado(); input.dispatchEvent(new Event("change", { bubbles: true })); }
        function marcar(i) {
            activo = i;
            [].forEach.call(lista.querySelectorAll("li[data-i]"), function (li, n) {
                li.classList.toggle("es-activo", n === i);
                if (n === i) li.scrollIntoView({ block: "nearest" });
            });
        }
        input.addEventListener("input", function () { abrir(); pintarEstado(); });
        input.addEventListener("focus", function () { if (input.value.trim() && !porLlave[llave(input.value)]) abrir(); });
        input.addEventListener("keydown", function (ev) {
            if (lista.hidden) return;
            if (ev.key === "ArrowDown") { ev.preventDefault(); marcar(Math.min(activo + 1, visibles.length - 1)); }
            else if (ev.key === "ArrowUp") { ev.preventDefault(); marcar(Math.max(activo - 1, 0)); }
            else if (ev.key === "Enter") { ev.preventDefault(); elegir(visibles[Math.max(activo, 0)].texto); }
            else if (ev.key === "Escape") { ev.stopPropagation(); cerrar(); }
        });
        input.addEventListener("blur", function () {
            setTimeout(function () {                    // deja pasar el clic en la lista
                cerrar();
                var exacto = porLlave[llave(input.value)];
                if (exacto && exacto !== input.value.trim()) input.value = exacto;   // se deja escrito igual que en el portal
                pintarEstado();
            }, 160);
        });
        lista.addEventListener("mousedown", function (ev) {
            var li = ev.target.closest("li[data-i]");
            if (li) { ev.preventDefault(); elegir(visibles[+li.dataset.i].texto); }
        });
        propuesta.addEventListener("click", function (ev) {
            if (ev.target.closest("button")) { elegir(o.propuesta.giro); input.focus(); }
        });
        pintarEstado();
        return { refrescar: pintarEstado };
    }

    window.GiroTributanet = { conectar: conectar, llave: llave, buscar: function (giros, t) {
        return buscar(giros.map(function (g) { var k = llave(g); return { texto: g, llave: k, palabras: k.split(" ") }; }), t).map(function (g) { return g.texto; }); } };
})();
