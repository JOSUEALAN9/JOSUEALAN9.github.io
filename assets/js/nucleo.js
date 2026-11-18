/**
 * nucleo.js — lo que todas las páginas de Fiscontable comparten, en un
 * solo lugar. Se carga ANTES que cualquier otro script del portal.
 *
 *   Fiscontable.API        dirección del backend (el único lugar donde vive)
 *   Fiscontable.VERSION    versión de la interfaz (la cambia publicar.sh)
 *   Fiscontable.escapar(t) texto seguro para meter en HTML
 *   Fiscontable.leerError(resp) -> Promise<mensaje>  errores del servidor
 *                                   en lenguaje de contador
 *
 * barra.js agrega después lo de la barra superior (perfil, permisos,
 * panel de descargas) sobre este mismo objeto.
 */
(function () {
    "use strict";

    var VERSION = "202611180413";
    // www.fiscontable.app → fiscontable.app: una sola dirección (la sesión y las preferencias guardadas son por dirección)
    if (location.hostname === "www.fiscontable.app") {
        location.replace("https://fiscontable.app" + location.pathname + location.search + location.hash);
    }
    // Ambiente de pruebas (pruebas.josuealan.com, solo para el dueño): habla con su propio servidor de pruebas
    var PRUEBAS = /^pruebas\./.test(location.hostname);
    // El servidor va en el mismo dominio que la web (si no, el navegador bloquea la sesión entre dominios):
    // fiscontable.app → api.fiscontable.app; josuealan.com (mientras dura el cambio) → api.josuealan.com.
    var DOMINIO = /(^|\.)fiscontable\.app$/.test(location.hostname) ? "fiscontable.app" : "josuealan.com";
    var API = "https://" + (PRUEBAS ? "api-pruebas." : "api.") + DOMINIO;

    /* Cortes breves (la Vostro reiniciando, un tropiezo de la red): antes de dar un error, se reintenta solo unos
       segundos con el aviso «Reconectando…». Consultas (GET): siempre. Envíos (POST, PUT, DELETE): solo si Cloudflare
       dice que no alcanzó al servidor (502-504, 52x): ahí la petición no llegó, así que no se repite nada. */
    (function () {
        var original = window.fetch;
        if (!original) return;
        var ESPERAS = [1000, 2000, 4000, 8000];
        var SIN_SERVIDOR = [502, 503, 504, 520, 521, 522, 523, 524, 530];
        var aviso = null, esperando = 0;
        function pintar() {
            if (!document.body) return;
            if (!aviso) {
                aviso = document.createElement("div");
                aviso.className = "fc-reconecta"; aviso.setAttribute("role", "status"); aviso.hidden = true;
                document.body.appendChild(aviso);
            }
            var sinRed = navigator.onLine === false;
            aviso.textContent = sinRed ? "Sin conexión a internet" : "Reconectando con Fiscontable…";
            aviso.classList.toggle("fc-reconecta--sin-red", sinRed);
            aviso.hidden = !(esperando > 0 || sinRed);
        }
        window.addEventListener("online", pintar);
        window.addEventListener("offline", pintar);
        window.fetch = function (recurso, opciones) {
            var url = typeof recurso === "string" ? recurso : (recurso instanceof URL ? recurso.href : "");
            if (!url || url.indexOf(API) !== 0 || (opciones && opciones.keepalive)) return original.apply(this, arguments);
            var metodo = String((opciones && opciones.method) || "GET").toUpperCase();
            var consulta = metodo === "GET" || metodo === "HEAD";
            var yo = this, args = arguments, intento = 0, contado = false;
            return new Promise(function (resolver, rechazar) {
                function cerrar() { if (contado) { contado = false; esperando--; pintar(); } }
                function otraVez() {
                    if (!contado) { contado = true; esperando++; pintar(); }
                    setTimeout(probar, ESPERAS[intento++]);
                }
                function probar() {
                    original.apply(yo, args).then(function (r) {
                        if (SIN_SERVIDOR.indexOf(r.status) >= 0 && intento < ESPERAS.length) return otraVez();
                        cerrar(); resolver(r);
                    }, function (e) {
                        if (e && e.name === "AbortError") { cerrar(); return rechazar(e); }
                        if (consulta && intento < ESPERAS.length) return otraVez();
                        cerrar(); rechazar(e);
                    });
                }
                probar();
            });
        };
    })();

    // Transición entre páginas: si el navegador la cancela (otra navegación encima, pestaña oculta) no es un error;
    // sin esto queda una promesa rechazada «sin atender» en la consola.
    ["pagereveal", "pageswap"].forEach(function (ev) {
        window.addEventListener(ev, function (e) {
            var v = e.viewTransition; if (!v) return;
            [v.ready, v.finished, v.updateCallbackDone].forEach(function (p) { if (p && p.catch) p.catch(function () { /* cancelada */ }); });
        });
    });

    // Ícono de la pestaña (assets/marca, se genera con herramientas/agente/tienda/generar_logo.py del backend)
    (function () {
        if (document.querySelector('link[rel~="icon"]')) return;
        [["icon", "/assets/marca/favicon.svg?v=" + VERSION, "image/svg+xml"], ["alternate icon", "/assets/marca/favicon.ico?v=" + VERSION, ""],
         ["apple-touch-icon", "/assets/marca/apple-touch-icon.png?v=" + VERSION, ""]].forEach(function (x) {
            var l = document.createElement("link");
            l.rel = x[0]; l.href = x[1]; if (x[2]) l.type = x[2];
            document.head.appendChild(l);
        });
    })();

    function escapar(valor) {
        return String(valor == null ? "" : valor)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    async function leerError(resp) {
        if (!resp) return navigator.onLine === false ? "Sin conexión a internet. Revisa tu red e intenta de nuevo."
            : "Fiscontable no responde en este momento. Intenta de nuevo en unos minutos.";
        var d = null;
        try { d = await resp.json(); } catch (e) { /* sin cuerpo JSON */ }
        var detalle = d && typeof d.detail === "string" ? d.detail : "";
        // {detail: {mensaje, omitidos: [{archivo, motivo}]}}: el mensaje y el primer motivo
        if (!detalle && d && d.detail && typeof d.detail.mensaje === "string")
            detalle = d.detail.mensaje + (d.detail.omitidos && d.detail.omitidos.length ? " " + d.detail.omitidos.slice(0, 3).map(function (o) {
                return (o.archivo ? o.archivo + ": " : "") + (o.motivo || "");
            }).join(" · ") : "");
        // 401/403 del inicio de sesión (Access) = sesión vencida; otros 403 traen su motivo (plan, sesión cerrada…)
        if (resp.status === 401 || (resp.status === 403 && (!detalle || /token de (cloudflare )?access|access no trae/i.test(detalle))))
            return "Tu sesión expiró. Recarga la página para entrar otra vez.";
        if (detalle) return detalle;
        if (resp.status >= 500) return "Error inesperado en el servidor. Intenta en unos minutos.";
        return "Hubo un problema al procesar la solicitud (código " + resp.status + ").";
    }

    /* Guarda un archivo que llegó del servidor. Como la descarga empieza segundos después del clic (cuando el
       servidor termina), a veces el navegador ya no la toma como pedida por la persona y no la inicia, sin avisar.
       Por eso, además, queda un aviso con el enlace: un clic directo ahí siempre descarga. */
    function guardarArchivo(blob, nombre) {
        nombre = nombre || "archivo";
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        var previa = document.getElementById("fc-descarga-lista");
        if (previa) previa.remove();
        var caja = document.createElement("div");
        caja.id = "fc-descarga-lista";
        caja.setAttribute("role", "status");
        caja.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;max-width:calc(100vw - 32px);display:flex;gap:10px;align-items:center;" +
            "background:rgb(var(--g-900));color:rgb(var(--g-200));border-radius:12px;padding:10px 12px 10px 14px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.35)";
        var texto = document.createElement("span");
        texto.textContent = "¿No empezó la descarga?";
        var enlace = document.createElement("a");
        enlace.href = url; enlace.download = nombre;
        enlace.textContent = "Descargar " + nombre;
        enlace.style.cssText = "color:rgb(var(--in-200));text-decoration:underline;overflow-wrap:anywhere";
        var cerrar = document.createElement("button");
        cerrar.type = "button"; cerrar.textContent = "×"; cerrar.setAttribute("aria-label", "Cerrar");
        cerrar.style.cssText = "background:none;border:0;color:rgb(var(--g-400));font-size:18px;line-height:1;cursor:pointer;padding:0 2px";
        cerrar.addEventListener("click", function () { caja.remove(); });
        enlace.addEventListener("click", function () { setTimeout(function () { caja.remove(); }, 400); });
        caja.appendChild(texto); caja.appendChild(enlace);
        // Un PDF también se puede ver ahí mismo, con el visor de Fiscontable
        if ((/pdf/i.test(blob.type) || /\.pdf$/i.test(nombre)) && window.Fiscontable && window.Fiscontable.verPdf) {
            var ver = document.createElement("button");
            ver.type = "button"; ver.textContent = "Ver";
            ver.style.cssText = "background:rgb(var(--in-200));color:rgb(var(--g-900));border:0;border-radius:8px;padding:5px 10px;font:inherit;font-weight:700;cursor:pointer";
            ver.addEventListener("click", function () { caja.remove(); window.Fiscontable.verPdf(blob, { nombre: nombre }); });
            caja.appendChild(ver);
            texto.textContent = "Listo:";
        }
        caja.appendChild(cerrar);
        document.body.appendChild(caja);
        setTimeout(function () { caja.remove(); }, 60000);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }

    /* Lo que hizo el agente (la PC del contador) ya quedó guardado en esa PC: no se vuelve a descargar automáticamente.
       Se dice dónde quedó y un botón le pide a esa PC que abra la carpeta (Mostrar en mi PC). */
    function carpetaEnPc(ruta) {
        // «C:\Users\x\Documents\Fiscontable\RFC\Constancias\2026\a.pdf» → «Documentos › Fiscontable › RFC › Constancias › 2026»
        var r = String(ruta || "").replace(/\//g, "\\");
        var i = Math.max(r.lastIndexOf("\\"), 0);
        var carpeta = i ? r.slice(0, i) : r;
        var m = carpeta.match(/(Documents|Documentos)\\.*/i);
        return (m ? m[0] : carpeta).replace(/^Documents/i, "Documentos").split("\\").filter(Boolean).join(" › ");
    }

    function textoEnPc(enPc) {
        if (!enPc || !enPc.rutas || !enPc.rutas.length) return "";
        var n = enPc.rutas.length;
        return (enPc.pc || "Tu equipo") + " · " + carpetaEnPc(enPc.rutas[0]) + (n > 1 ? " · " + n + " archivos" : "");
    }

    async function mostrarEnPc(enPc, boton, decir) {
        // decir(texto): para quien no tiene un botón con texto donde escribir (los botones de ícono del panel)
        if (boton) { boton.disabled = true; boton.textContent = "Abriendo…"; }
        try {
            var r = await fetch(API + "/api/agentes/" + enPc.agente_id + "/abrir", {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ruta: enPc.rutas[0] })
            });
            if (!r.ok) throw new Error(await leerError(r));
            if (boton) boton.textContent = "✓ Abierta en " + (enPc.pc || "tu equipo");
            if (decir) decir("Carpeta abierta en " + (enPc.pc || "tu equipo") + ".");
        } catch (e) {
            if (boton) { boton.textContent = "No se pudo abrir"; boton.title = e.message; }
            if (decir) decir("No se pudo abrir la carpeta: " + e.message);
        }
        if (boton) setTimeout(function () { boton.disabled = false; boton.textContent = "Abrir carpeta"; boton.title = ""; }, 5000);
    }

    function cajaEnPc(enPc, alDescargar) {
        var caja = document.createElement("div");
        caja.className = "fc-en-pc";
        caja.style.cssText = "margin-top:10px;padding:11px 13px;border:1px solid rgb(var(--ok-200));background:rgb(var(--ok-50));border-radius:10px;" +
            "font-size:13px;color:rgb(var(--ok-600));display:flex;flex-wrap:wrap;gap:8px;align-items:center";
        var t = document.createElement("span");
        t.style.cssText = "flex:1 1 260px;display:grid;gap:2px;min-width:0";
        var t1 = document.createElement("b"), t2 = document.createElement("small");
        var rutas = enPc.rutas || [], t3 = document.createElement("small");
        t1.textContent = "Guardado en " + (enPc.pc || "tu equipo");
        t1.style.color = "rgb(var(--g-900))";
        t2.textContent = carpetaEnPc(rutas[0]);
        t3.textContent = rutas.length > 1 ? rutas.length + " archivos" : String(rutas[0] || "").split(/[\\/]/).pop();
        t2.style.cssText = t3.style.cssText = "color:rgb(var(--g-600));overflow-wrap:anywhere";
        t.appendChild(t1); t.appendChild(t2); if (t3.textContent) t.appendChild(t3);
        caja.appendChild(t);
        var b = document.createElement("button");
        b.type = "button"; b.className = "fc-btn"; b.textContent = "Abrir carpeta";
        b.addEventListener("click", function () { mostrarEnPc(enPc, b); });
        caja.appendChild(b);
        if (alDescargar) {
            var d = document.createElement("button");
            d.type = "button"; d.className = "fc-btn fc-btn--discreto"; d.textContent = "Descargar";
            d.addEventListener("click", function () { alDescargar(d); });
            caja.appendChild(d);
        }
        return caja;
    }

    /* Lo que se ve en la página (pestaña, periodo…) queda en la dirección: con F5 o un enlace
       compartido se vuelve exactamente a la misma vista. url("tab") lee; url({tab: "x", anio: null}) escribe (null borra). */
    function url(cambios) {
        var q = new URLSearchParams(location.search);
        if (typeof cambios === "string") return q.get(cambios);
        Object.keys(cambios || {}).forEach(function (k) {
            var v = cambios[k];
            if (v === null || v === undefined || v === "") q.delete(k); else q.set(k, v);
        });
        var texto = q.toString();
        try { history.replaceState(history.state, "", location.pathname + (texto ? "?" + texto : "") + location.hash); } catch (e) { /* sin historial */ }
    }

    /* Periodo de los cuadros (año+meses o fechas) ⇄ dirección */
    function periodoAUrl(est, porFechas) {
        return porFechas ? { anio: null, meses: null, desde: est.desde || null, hasta: est.hasta || null }
            : { anio: est.anio || null, meses: (est.meses || []).join(",") || null, desde: null, hasta: null };
    }
    function periodoDeUrl() {
        var q = new URLSearchParams(location.search);
        if (q.get("anio")) return { anio: q.get("anio"), meses: (q.get("meses") || "").split(",").filter(function (m) { return /^\d\d$/.test(m); }) };
        if (q.get("desde") || q.get("hasta")) return { desde: q.get("desde") || "", hasta: q.get("hasta") || "" };
        return null;
    }

    console.info("Fiscontable — interfaz " + VERSION);

    /* <option> de "Descargar desde" (descarga automática de XML): "Solo lo reciente" y los meses del mínimo al
       actual (AAAA-MM), del más nuevo al más viejo. */
    var MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre",
        "Octubre", "Noviembre", "Diciembre"];
    function nombreMes(aaaaMm) {
        return aaaaMm ? MESES_LARGOS[+aaaaMm.slice(5, 7) - 1] + " " + aaaaMm.slice(0, 4) : "";
    }
    function opcionesDesde(minimo, actual, elegido) {
        var html = '<option value="">Periodo reciente</option>', a = +actual.slice(0, 4), m = +actual.slice(5, 7);
        var hay = false;
        while (true) {
            var v = a + "-" + (m < 10 ? "0" : "") + m;
            if (v < minimo) break;
            if (v === elegido) hay = true;
            html += '<option value="' + v + '"' + (v === elegido ? " selected" : "") + ">Desde " + nombreMes(v) + "</option>";
            if (--m === 0) { m = 12; a--; }
        }
        // Lo eligió el admin antes que el mínimo de hoy: se respeta y se muestra
        if (elegido && !hay) html += '<option value="' + elegido + '" selected>Desde ' + nombreMes(elegido) + "</option>";
        return html;
    }

    window.Fiscontable = Object.assign(window.Fiscontable || {}, {
        API: API,
        PRUEBAS: PRUEBAS,
        VERSION: VERSION,
        escapar: escapar,
        leerError: leerError,
        guardarArchivo: guardarArchivo,
        textoEnPc: textoEnPc,
        mostrarEnPc: mostrarEnPc,
        cajaEnPc: cajaEnPc,
        url: url,
        periodoAUrl: periodoAUrl,
        periodoDeUrl: periodoDeUrl,
        nombreMes: nombreMes,
        opcionesDesde: opcionesDesde
    });
})();

/* Ventanas emergentes menos sensibles (todas las páginas). Dos reglas, antes de que cada módulo vea el clic:
   1) Un clic que empezó dentro de la ventana y terminó en el fondo (pasa al seleccionar texto para copiarlo) no la cierra.
   2) Una ventana con campos o confirmaciones no se cierra al tocar fuera: solo con su botón o con Esc.
   Las ventanas de solo lectura se siguen cerrando con un clic limpio en el fondo. */
(function () {
    "use strict";
    var abajo = null;
    document.addEventListener("pointerdown", function (e) { abajo = e.target; }, true);
    // Acciones declaradas en el HTML sin código en línea (17-nov-2026, para poder quitar 'unsafe-inline' de la política
    // de contenido): data-fc-clic="nombreDeFuncionGlobal" (con data-fc-solo no sube a la fila), data-fc-envio (formularios),
    // data-fc-abre="idDelCampoDeArchivo" y data-fc-quieto (un enlace que no hace nada).
    document.addEventListener("click", function (e) {
        var el = e.target && e.target.closest && e.target.closest("[data-fc-clic],[data-fc-abre],[data-fc-quieto]");
        if (!el || el.disabled) return;
        if (el.hasAttribute("data-fc-quieto")) { e.preventDefault(); return; }
        if (el.dataset.fcAbre) { var campo = document.getElementById(el.dataset.fcAbre); if (campo) campo.click(); return; }
        var f = window[el.dataset.fcClic];
        if (typeof f !== "function") return;
        if (el.hasAttribute("data-fc-solo")) e.stopPropagation();
        f.call(el === window ? window : (el.dataset.fcClic === "print" ? window : el), e);
    }, true);
    document.addEventListener("submit", function (e) {
        var el = e.target && e.target.closest && e.target.closest("[data-fc-envio]");
        var f = el && window[el.dataset.fcEnvio];
        if (typeof f === "function") f.call(el, e);
    }, true);

    // Moneda de los reportes (17-nov): cómo quiere ver esta persona los importes en moneda extranjera, en pantalla y en
    // los Excel de Administración de XML y de Conciliación. modo: "xml" (en pesos, T.C. de cada XML), "dof" (en pesos,
    // T.C. del DOF) o "" (sin convertir). siempre: no volver a preguntar. Se guarda en este navegador.
    window.Fiscontable.monedaReportes = {
        leer: function () {
            try {
                var p = JSON.parse(localStorage.getItem("fc:moneda") || "null") || {};
                return { modo: p.modo === "xml" || p.modo === "dof" || p.modo === "" ? p.modo : "xml", siempre: !!p.siempre };
            } catch (e) { return { modo: "xml", siempre: false }; }
        },
        guardar: function (modo, siempre) {
            try { localStorage.setItem("fc:moneda", JSON.stringify({ modo: modo, siempre: !!siempre })); } catch (e) { /* nada */ }
        },
        texto: function (modo) {
            return modo === "xml" ? "en pesos, con el tipo de cambio de cada XML" : modo === "dof" ? "en pesos, con el tipo de cambio del DOF (Banxico)" : "sin convertir";
        }
    };

    // Aviso de carga sobre una tabla (17-nov, «algo para saber que ya cargó la info nueva»): mientras llega lo pedido se ve una
    // barra que corre y la etiqueta «Cargando…»; al llegar, «Actualizado · …» unos segundos. Lo usan Administración de XML,
    // Conciliación y Retenciones.  var c = Fiscontable.avisoCarga(marco, {atenuar: true}); c.mostrar(texto, textoSiTarda); c.listo(texto); c.quitar();
    window.Fiscontable.avisoCarga = function (marco, opciones) {
        var reloj = 0, barra = document.createElement("div"), etiqueta = document.createElement("p"),
            giro = document.createElement("span"), texto = document.createElement("span");
        barra.className = "fc-carga-barra"; barra.setAttribute("aria-hidden", "true"); barra.appendChild(document.createElement("span"));
        etiqueta.className = "fc-carga"; etiqueta.setAttribute("role", "status"); etiqueta.setAttribute("aria-live", "polite"); etiqueta.hidden = true;
        giro.className = "fc-carga__giro"; giro.setAttribute("aria-hidden", "true");
        etiqueta.appendChild(giro); etiqueta.appendChild(texto);
        marco.classList.add("fc-carga-marco");
        if (opciones && opciones.atenuar) marco.classList.add("fc-carga-marco--atenua");
        // junto: la etiqueta va en línea después de ese elemento (18-nov, Alan: flotando sobre la tabla estorbaba);
        // la barrita de avance y el atenuado siguen en el marco.
        var junto = opciones && opciones.junto, base = "fc-carga" + (junto ? " fc-carga--enlinea" : "");
        etiqueta.className = base;
        if (junto) junto.insertAdjacentElement("afterend", etiqueta); else marco.insertBefore(etiqueta, marco.firstChild);
        marco.insertBefore(barra, marco.firstChild);
        function quitar() { clearTimeout(reloj); marco.classList.remove("fc-carga-marco--cargando"); etiqueta.hidden = true; }
        return {
            mostrar: function (mensaje, siTarda) {
                clearTimeout(reloj);
                etiqueta.className = base; etiqueta.hidden = false; texto.textContent = mensaje;
                marco.classList.add("fc-carga-marco--cargando");
                if (siTarda) reloj = setTimeout(function () { texto.textContent = siTarda; }, 6000);
            },
            listo: function (mensaje) {
                quitar();
                etiqueta.className = base + " fc-carga--listo"; etiqueta.hidden = false; texto.textContent = mensaje;
                reloj = setTimeout(function () { etiqueta.hidden = true; }, 4000);
            },
            quitar: quitar
        };
    };

    function esFondo(t) {
        if (!t || !t.matches) return false;
        return t.tagName === "DIALOG" || t.matches(".xml-modal, .xml-velo, .fp-fondo, .en-fondo, #fondo, #ventana, #modal, #modal-datos, [data-fondo]");
    }
    document.addEventListener("click", function (e) {
        var t = e.target;
        if (!esFondo(t)) return;
        var arrastre = !!abajo && abajo !== t && t.contains(abajo);
        var firme = !!t.querySelector('input:not([type="hidden"]), textarea, select, [data-firme]');
        if (arrastre || firme) e.stopImmediatePropagation();
    }, true);
})();
