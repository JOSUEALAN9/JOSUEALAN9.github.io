/**
 * bandeja-xml.js — Bandeja para agregar XML a una biblioteca (sale de la de
 * Administración de XML). Requiere nucleo.js y los estilos de xml.css.
 *
 * Los XML (también los de un ZIP) se leen en el navegador para mostrar un
 * resumen antes de guardar. Nada llega al servidor hasta "Procesar", y
 * solo se envían los XML de la empresa elegida; los de otras empresas se
 * quedan en la bandeja.
 *
 *   var b = FCBandeja.crear({
 *       seccion: elemento donde se dibuja la bandeja (se muestra/oculta sola),
 *       resultado: elemento donde se muestra el resultado de la carga,
 *       endpoint: "/api/conciliacion/cargar",
 *       destinoPreferido: function () { return rfcQueEstasViendo; },
 *       alTerminar: function (destino) {}           // p. ej. recargar la página
 *   });
 *   b.abrir(); b.cerrar(); b.agregar(listaDeArchivos);
 * También acepta soltar archivos en cualquier parte de la página.
 */
(function () {
    "use strict";
    var esc = Fiscontable.escapar;
    var GENERICOS = { XAXX010101000: 1, XEXX010101000: 1 };
    var LIMITE_LOTE = 40 * 1024 * 1024, LIMITE_ARCHIVOS = 400;

    function avisar(t) { if (Fiscontable.aviso) Fiscontable.aviso(t); else alert(t); }

    function crear(o) {
        var API = Fiscontable.API;
        var BJ = { xml: new Map(), invalidos: [], destino: null, cargandoZip: null, leyendo: 0, clientes: null };
        var seccion = o.seccion;
        seccion.classList.add("xml-bandeja");
        seccion.hidden = true;
        seccion.innerHTML =
            '<div class="xml-bandeja__cabeza"><h2>Agregar XML</h2><button type="button" class="xml-enlace" data-cerrar>Cerrar</button></div>' +
            '<div class="xml-zona"><p class="xml-zona__titulo">Arrastra aquí tus XML, carpetas o archivos ZIP</p>' +
            '<p class="xml-zona__sub">Puedes agregar varias veces. Nada se guarda hasta que presiones <strong>Procesar</strong>.</p>' +
            '<div class="xml-zona__botones"><label class="xml-btn">Elegir archivos<input type="file" data-archivos multiple accept=".xml,.zip" hidden></label>' +
            '<label class="xml-btn">Elegir carpeta<input type="file" data-carpeta webkitdirectory multiple hidden></label></div>' +
            '<p class="xml-tenue" data-leyendo hidden></p></div><div data-resumen></div>';
        var resumen = seccion.querySelector("[data-resumen]"), leyendo = seccion.querySelector("[data-leyendo]");

        async function apiJSON(ruta, opciones) {
            var resp;
            try { resp = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {})); }
            catch (e) { throw new Error("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo."); }
            if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
            return resp.json();
        }

        function abrir() {
            seccion.hidden = false;
            pintar();
            if (BJ.clientes === null) {
                BJ.clientes = {};
                apiJSON("/api/clientes").then(function (lista) {
                    lista.forEach(function (c) { BJ.clientes[c.rfc] = c.alias; });
                    pintar();
                }).catch(function () { /* sin directorio: se ordena por frecuencia */ });
            }
        }

        function leerXML(nombre, bytes) {
            if (bytes.length > 5 * 1024 * 1024) { BJ.invalidos.push({ archivo: nombre, motivo: "Pesa más de 5 MB." }); return; }
            var doc = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "application/xml");
            var raiz = doc.documentElement;
            if (!raiz || raiz.localName !== "Comprobante" || doc.getElementsByTagName("parsererror").length) {
                BJ.invalidos.push({ archivo: nombre, motivo: "No es un CFDI." }); return;
            }
            var tfd = doc.getElementsByTagNameNS("*", "TimbreFiscalDigital")[0];
            var em = doc.getElementsByTagNameNS("*", "Emisor")[0], re = doc.getElementsByTagNameNS("*", "Receptor")[0];
            function at(el, n) { return el ? (el.getAttribute(n) || el.getAttribute(n.charAt(0).toLowerCase() + n.slice(1)) || "") : ""; }
            var uuid = at(tfd, "UUID").toUpperCase();
            if (!uuid) { BJ.invalidos.push({ archivo: nombre, motivo: "No está timbrado." }); return; }
            BJ.xml.set(uuid, { nombre: nombre, bytes: bytes, tipo: at(raiz, "TipoDeComprobante"),
                er: at(em, "Rfc").toUpperCase(), en: at(em, "Nombre"), rr: at(re, "Rfc").toUpperCase(), rn: at(re, "Nombre") });
        }

        function cargarJSZip() {
            if (window.JSZip) return Promise.resolve();
            if (!BJ.cargandoZip) {
                BJ.cargandoZip = new Promise(function (ok, mal) {
                    var sc = document.createElement("script");
                    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
                    sc.onload = ok;
                    sc.onerror = function () { BJ.cargandoZip = null; mal(new Error("No se pudo abrir el ZIP (falló la descarga del lector de ZIP).")); };
                    document.head.appendChild(sc);
                });
            }
            return BJ.cargandoZip;
        }

        async function agregar(archivos) {
            abrir();
            var utiles = archivos.filter(function (f) { return /\.(xml|zip)$/i.test(f.name); });
            if (!utiles.length) { avisar("No encontré XML ni ZIP en lo que agregaste."); return; }
            leyendo.hidden = false; leyendo.textContent = "Leyendo…";
            BJ.leyendo++; pintar();
            var hechos = 0;
            async function respiro() {
                if (++hechos % 50 === 0) { leyendo.textContent = "Leyendo… " + hechos + " XML"; await new Promise(function (r) { setTimeout(r, 0); }); }
            }
            for (var i = 0; i < utiles.length; i++) {
                var f = utiles[i];
                try {
                    if (/\.zip$/i.test(f.name)) {
                        await cargarJSZip();
                        var zip = await window.JSZip.loadAsync(f);
                        var entradas = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && /\.xml$/i.test(n); });
                        for (var j = 0; j < entradas.length; j++) {
                            leerXML(entradas[j].split("/").pop(), await zip.files[entradas[j]].async("uint8array"));
                            await respiro();
                        }
                    } else {
                        leerXML(f.name, new Uint8Array(await f.arrayBuffer()));
                        await respiro();
                    }
                } catch (e) {
                    BJ.invalidos.push({ archivo: f.name, motivo: e.message && e.message.indexOf("ZIP") !== -1 ? e.message : "No se pudo leer." });
                }
            }
            BJ.leyendo--;
            leyendo.hidden = BJ.leyendo <= 0;
            pintar();
        }

        function candidatos() {
            var cuenta = {}, nombres = {};
            BJ.xml.forEach(function (x) {
                (x.tipo === "N" ? [x.er] : [x.er, x.rr]).forEach(function (r) {
                    if (!r || GENERICOS[r]) return;
                    cuenta[r] = (cuenta[r] || 0) + 1;
                    if (!nombres[r]) nombres[r] = r === x.er ? x.en : x.rn;
                });
            });
            var mios = BJ.clientes || {};
            return Object.keys(cuenta).sort(function (a, b) { return (!!mios[b] - !!mios[a]) || (cuenta[b] - cuenta[a]); })
                .slice(0, 12).map(function (r) { return { rfc: r, nombre: mios[r] || nombres[r], n: cuenta[r], cliente: !!mios[r] }; });
        }

        function deDestino(x, d) { return x.tipo === "N" ? x.er === d : (x.er === d || x.rr === d); }

        function pintar() {
            if (!BJ.xml.size && !BJ.invalidos.length) { resumen.innerHTML = ""; return; }
            var cands = candidatos(), actual = o.destinoPreferido ? o.destinoPreferido() : null;
            if (!BJ.destino || !cands.some(function (c) { return c.rfc === BJ.destino; })) {
                BJ.destino = actual && cands.some(function (c) { return c.rfc === actual; }) ? actual : (cands[0] ? cands[0].rfc : null);
            }
            var d = BJ.destino;
            var n = { recibidos: 0, emitidos: 0, nomina: 0, pagos: 0, ajenos: 0 };
            BJ.xml.forEach(function (x) {
                if (!d || !deDestino(x, d)) { n.ajenos++; return; }
                if (x.tipo === "N") n.nomina++; else if (x.tipo === "P") n.pagos++; else if (x.er === d) n.emitidos++; else n.recibidos++;
            });
            var total = n.recibidos + n.emitidos + n.nomina + n.pagos;
            function cifra(v, t, ajena) { return v ? '<div class="xml-cifra' + (ajena ? " xml-cifra--ajena" : "") + '"><b>' + v.toLocaleString("es-MX") + "</b><span>" + t + "</span></div>" : ""; }
            resumen.innerHTML = '<div class="xml-resumen">' +
                (cands.length ? '<div class="xml-resumen__destino">Estos XML son de <select data-destino>' + cands.map(function (c) {
                    return '<option value="' + esc(c.rfc) + '"' + (c.rfc === d ? " selected" : "") + ">" +
                        esc((c.nombre || "Sin nombre") + " · " + c.rfc + " (" + c.n + " XML)" + (c.cliente ? "" : " · sin registrar")) + "</option>";
                }).join("") + "</select></div>" : "") +
                '<div class="xml-resumen__cifras">' + cifra(n.emitidos, "Emitidos") + cifra(n.recibidos, "Recibidos") + cifra(n.pagos, "Pagos") +
                cifra(n.nomina, "Nómina") + cifra(n.ajenos, "de otras empresas (no se cargan ahora)", true) + cifra(BJ.invalidos.length, "no son CFDI", true) + "</div>" +
                '<div class="xml-resumen__acciones"><button type="button" class="xml-btn xml-btn--primario" data-procesar' + (total && !BJ.leyendo ? "" : " disabled") + ">" +
                (BJ.leyendo ? "Leyendo archivos…" : "Procesar " + total.toLocaleString("es-MX") + " XML") + "</button>" +
                '<button type="button" class="xml-enlace" data-vaciar>Vaciar bandeja</button></div>' +
                (d && !(BJ.clientes || {})[d] ? '<p class="xml-tenue" style="margin-top:8px">Esta empresa no está en tu directorio: sus XML se borran solos 7 días después de la última carga.</p>' : "") +
                "</div>";
        }

        async function procesar() {
            var d = BJ.destino;
            var cand = candidatos().find(function (c) { return c.rfc === d; });
            var lista = [];
            BJ.xml.forEach(function (x, uuid) { if (deDestino(x, d)) lista.push([uuid, x]); });
            if (!lista.length) return;
            var lotes = [], actual = [], peso = 0;
            lista.forEach(function (par) {
                if (actual.length && (peso + par[1].bytes.length > LIMITE_LOTE || actual.length >= LIMITE_ARCHIVOS)) { lotes.push(actual); actual = []; peso = 0; }
                actual.push(par); peso += par[1].bytes.length;
            });
            if (actual.length) lotes.push(actual);
            var boton = resumen.querySelector("[data-procesar]");
            boton.disabled = true;
            var tot = { nuevos: 0, duplicados: 0, rechazados: [] };
            for (var i = 0; i < lotes.length; i++) {
                boton.textContent = "Procesando… " + Math.round(100 * i / lotes.length) + "%";
                var fd = new FormData();
                lotes[i].forEach(function (par) { fd.append("archivos", new Blob([par[1].bytes], { type: "application/xml" }), par[1].nombre); });
                fd.append("rfc", d);
                try {
                    var r = await apiJSON(o.endpoint, { method: "POST", body: fd });
                    tot.nuevos += r.nuevos; tot.duplicados += r.duplicados;
                    tot.rechazados = tot.rechazados.concat(r.rechazados || []);
                    lotes[i].forEach(function (par) { BJ.xml.delete(par[0]); });
                } catch (e) {
                    tot.rechazados.push({ archivo: "Parte " + (i + 1) + " de " + lotes.length, motivo: e.message });
                }
            }
            o.resultado.innerHTML = '<div class="xml-resultado' + (tot.rechazados.length ? " xml-resultado--error" : "") + '">' +
                '<button type="button" class="xml-resultado__cerrar" title="Cerrar" data-cerrar-resultado>×</button>' +
                "<strong>" + esc((cand && cand.nombre) || d) + ": " + tot.nuevos.toLocaleString("es-MX") + " XML nuevos guardados" +
                (tot.duplicados ? " · " + tot.duplicados + " ya estaban" : "") + "</strong>" +
                (tot.rechazados.length ? "<ul>" + tot.rechazados.slice(0, 15).map(function (r) { return "<li>" + esc(r.archivo) + " — " + esc(r.motivo) + "</li>"; }).join("") + "</ul>" : "") +
                (BJ.xml.size ? '<p style="margin-top:8px">Quedaron ' + BJ.xml.size.toLocaleString("es-MX") + " XML de otras empresas en la bandeja.</p>" : "") + "</div>";
            if (!BJ.xml.size) BJ.invalidos = [];
            seccion.hidden = true;
            pintar();
            if (o.alTerminar) await o.alTerminar(d);
        }

        function leerEntrada(entrada, salida) {
            return new Promise(function (resolver) {
                if (entrada.isFile) entrada.file(function (f) { salida.push(f); resolver(); }, function () { resolver(); });
                else if (entrada.isDirectory) {
                    var lector = entrada.createReader(), todas = [];
                    (function leer() {
                        lector.readEntries(function (lote) {
                            if (!lote.length) { Promise.all(todas.map(function (x) { return leerEntrada(x, salida); })).then(resolver); return; }
                            todas = todas.concat(Array.prototype.slice.call(lote)); leer();
                        }, function () { resolver(); });
                    })();
                } else resolver();
            });
        }

        seccion.querySelector("[data-cerrar]").addEventListener("click", function () { seccion.hidden = true; });
        seccion.querySelector("[data-archivos]").addEventListener("change", function (e) { agregar(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        seccion.querySelector("[data-carpeta]").addEventListener("change", function (e) { agregar(Array.prototype.slice.call(e.target.files)); e.target.value = ""; });
        resumen.addEventListener("change", function (e) { if (e.target.matches("[data-destino]")) { BJ.destino = e.target.value; pintar(); } });
        resumen.addEventListener("click", function (e) {
            if (e.target.closest("[data-procesar]")) procesar();
            if (e.target.closest("[data-vaciar]")) { BJ.xml.clear(); BJ.invalidos = []; BJ.destino = null; pintar(); }
        });
        o.resultado.addEventListener("click", function (e) { if (e.target.closest("[data-cerrar-resultado]")) o.resultado.innerHTML = ""; });

        // Soltar archivos en cualquier parte de la página
        var velo = document.createElement("div");
        velo.className = "xml-velo"; velo.hidden = true;
        velo.innerHTML = "<div>Suelta los XML para agregarlos a la bandeja</div>";
        document.body.appendChild(velo);
        var profundidad = 0;
        function conArchivos(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1; }
        document.addEventListener("dragenter", function (e) { if (!conArchivos(e)) return; e.preventDefault(); profundidad++; velo.hidden = false; });
        document.addEventListener("dragover", function (e) { if (conArchivos(e)) e.preventDefault(); });
        document.addEventListener("dragleave", function (e) { if (!conArchivos(e)) return; if (--profundidad <= 0) { profundidad = 0; velo.hidden = true; } });
        document.addEventListener("drop", async function (e) {
            if (!conArchivos(e)) return;
            e.preventDefault(); profundidad = 0; velo.hidden = true;
            var archivos = [], items = e.dataTransfer.items;
            if (items && items.length && items[0].webkitGetAsEntry) {
                var entradas = Array.prototype.map.call(items, function (it) { return it.webkitGetAsEntry(); }).filter(Boolean);
                await Promise.all(entradas.map(function (en) { return leerEntrada(en, archivos); }));
            } else archivos = Array.prototype.slice.call(e.dataTransfer.files);
            agregar(archivos);
        });

        return { abrir: abrir, cerrar: function () { seccion.hidden = true; }, agregar: agregar, abierta: function () { return !seccion.hidden; } };
    }

    window.FCBandeja = { crear: crear };
})();
