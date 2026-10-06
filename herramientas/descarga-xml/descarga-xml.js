/**
 * descarga-xml.js — Descarga masiva de XML, con dos formas de bajar:
 *
 *   Web service del SAT   e.firma; el SAT prepara la solicitud por su cuenta
 *                         (minutos u horas) y no tiene límite de cantidad.
 *                         Un solo botón: "Descargar XML".
 *   Portal del SAT        contraseña (CIEC, con captcha que escribe el contador)
 *                         o e.firma; resultado al momento y con estado de
 *                         cancelación. "Buscar CFDI" (la lista) y
 *                         "Buscar y descargar" (baja solo lo que falta).
 *
 * El periodo se elige con atajos por mes (Desde / Hasta) y, si hace falta,
 * con días y horas exactos. Arranca en el periodo general de la barra.
 * Las solicitudes viven en un panel lateral que se actualiza solo; si el
 * portal pide captcha, aparece una ventana para escribirlo.
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;

    var NOMBRE_TIPO = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };
    var ACTIVOS = ["enviando", "en_sat", "descargando", "conectando", "captcha", "buscando"];
    var PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

    var E = {
        modo: "webservice", tipo: "emitidos", acceso: "ciec", elegido: null, ciecOtra: false, puedeGuardar: false,
        periodoGeneral: null, periodoTocado: false,
        solicitudes: [], sondeo: null, captcha: { id: null, turno: null, enviado: false },
        abierta: null, detalle: null, tablas: {}, filas: [],
        sesion: { abierta: false, entrando: false }      // sesión abierta del portal (GET /portal/sesion)
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ================================================================ utilidades */

    function alerta(mensaje) {
        var caja = $("alerta");
        caja.textContent = mensaje;
        caja.hidden = false;
        caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function sinAlerta() { $("alerta").hidden = true; }

    var relojToast = null;
    function toast(texto, accion, alPresionar) {
        var t = $("aviso-flotante");
        t.innerHTML = "<span>" + esc(texto) + "</span>" + (accion ? '<button type="button">' + esc(accion) + "</button>" : "");
        if (accion) t.querySelector("button").addEventListener("click", function () { t.hidden = true; alPresionar(); });
        t.hidden = false;
        clearTimeout(relojToast);
        relojToast = setTimeout(function () { t.hidden = true; }, 6000);
    }

    function dos(n) { return (n < 10 ? "0" : "") + n; }
    function isoLocal(f) {
        return f.getFullYear() + "-" + dos(f.getMonth() + 1) + "-" + dos(f.getDate()) + "T" +
            dos(f.getHours()) + ":" + dos(f.getMinutes()) + ":" + dos(f.getSeconds());
    }
    function leerFecha(valor) {
        if (!valor) return null;
        var f = new Date(valor.length === 16 ? valor + ":00" : valor);
        return isNaN(f) ? null : f;
    }
    function inicioMes(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1, 0, 0, 0); }
    function finMes(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0, 23, 59, 59); }
    function mesDe(f) { return f.getFullYear() + "-" + dos(f.getMonth() + 1); }
    function fechaBonita(iso, conHora) {
        if (!iso) return "";
        var s = String(iso).replace(" ", "T");
        var txt = s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
        return conHora && s.length > 10 ? txt + " " + s.slice(11, 19) : txt;
    }
    function cuandoFue(iso) {
        var f = new Date(iso + "Z");
        if (isNaN(f)) return "";
        var hoy = new Date();
        var hora = f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        if (f.toDateString() === hoy.toDateString()) return "hoy " + hora;
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + hora;
    }
    function miles(n) { return Number(n || 0).toLocaleString("es-MX"); }
    function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nada */ } }
    function leerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

    async function api(ruta, opciones) {
        var r = await fetch(API + ruta, Object.assign({ credentials: "include" }, opciones || {}));
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }

    /* ================================================================ modo y acceso */

    /* Web service 1.5: los XML de RECIBIDAS solo se pueden pedir vigentes (con "Todos" o "Cancelados" el SAT
       contesta "XML mal formado"). En el portal sí se pueden buscar todas. */
    function reglaEstado() {
        var soloVigentes = E.modo === "webservice" && E.tipo === "recibidos";
        var sel = $("estado");
        Array.prototype.forEach.call(sel.options, function (o) { o.disabled = soloVigentes && o.value !== "Vigente"; });
        if (soloVigentes) sel.value = "Vigente";
        sel.title = soloVigentes ? "El SAT solo entrega por web service los XML de recibidas vigentes" : "";
        $("estado-nota").hidden = !soloVigentes;
    }

    function ponerModo(modo) {
        E.modo = modo;
        guardarLocal("descarga:modo", modo);
        document.querySelectorAll(".dm-modo").forEach(function (b) {
            b.setAttribute("aria-selected", b.dataset.modo === modo ? "true" : "false");
        });
        var portal = modo === "portal";
        $("btn-buscar").hidden = !portal;
        $("btn-descargar").textContent = portal ? "Buscar y descargar" : "Descargar XML";
        $("nota-modo").textContent = portal
            ? "Buscar CFDI trae la lista del portal con su estado; Buscar y descargar baja solo los XML que todavía no están en tu biblioteca. El portal muestra 500 por búsqueda: si hay más, se parte el periodo solo."
            : "El SAT prepara cada solicitud por su cuenta: puede tardar de minutos a horas. No necesitas dejar esta página abierta; la ves en Solicitudes.";
        pintarAcceso();
        pintarResumen();
        reglaEstado();
        if (portal) cargarSesion();
    }

    function pintarAcceso() {
        var q = E.elegido;
        if (!q) return;
        var portal = E.modo === "portal";
        var conCiec = portal && E.acceso === "ciec";
        $("acceso-portal").hidden = !portal;
        document.querySelectorAll("#acceso-portal button").forEach(function (b) {
            b.setAttribute("aria-pressed", b.dataset.acceso === E.acceso ? "true" : "false");
        });
        $("campos-ciec").hidden = !conCiec;
        $("campos-efirma").hidden = conCiec;
        // e.firma: la guardada del cliente o los archivos
        $("nota-guardada").hidden = !q.efirmaGuardada;
        $("efirma-subir").hidden = !!q.efirmaGuardada;
        $("campo-cer").style.display = q.cer ? "none" : "";
        // Contraseña: la guardada o escribirla (y ofrecer guardarla si es cliente)
        var usaGuardada = q.ciecGuardada && !E.ciecOtra;
        $("nota-ciec-guardada").hidden = !usaGuardada;
        $("ciec-escribir").hidden = usaGuardada;
        $("caja-guardar-ciec").hidden = !(q.esCliente && E.puedeGuardar);
        pintarSesion();
    }

    /* ================================================================ sesión del portal */
    // Como en Mi Admin: se entra una vez y las siguientes búsquedas del mismo RFC (emitidas o
    // recibidas) usan esa sesión, sin contraseña ni captcha, hasta "Cerrar sesión" o 30 min sin uso.

    function sesionUsable() {
        var s = E.sesion;
        return E.modo === "portal" && !!E.elegido && !!s && s.abierta && s.rfc === E.elegido.rfc;
    }

    function pintarSesion() {
        var q = E.elegido, s = E.sesion || {}, caja = $("sesion-portal");
        var portal = E.modo === "portal" && !!q;
        var mia = portal && (s.abierta || s.entrando) && s.rfc === q.rfc;
        var otro = portal && s.abierta && s.rfc !== q.rfc;
        caja.hidden = !(mia || otro);
        if (caja.hidden) return;
        caja.className = "dm-sesion" + (s.entrando ? " dm-sesion--entrando" : "") + (otro ? " dm-sesion--otro" : "");
        var como = s.acceso === "efirma" ? "e.firma" : "contraseña";
        var texto;
        if (otro) texto = "Tienes una sesión abierta del portal con " + s.rfc + ". Al buscar con este RFC se cierra y se entra de nuevo.";
        else if (s.entrando) texto = "Entrando al portal…";
        else texto = "Sesión abierta en el portal (" + como + "): tus búsquedas de " + s.rfc + ", emitidas o recibidas, ya no piden entrar." +
            (s.ocupada || s.cierra_en_min == null ? "" : " Se cierra sola en " + Math.max(1, s.cierra_en_min) + " min sin uso.");
        $("sesion-texto").textContent = texto;
        $("sesion-cerrar").hidden = !s.abierta;
        if (mia && s.abierta) {                          // no hace falta volver a entrar
            $("acceso-portal").hidden = true;
            $("campos-ciec").hidden = true;
            $("campos-efirma").hidden = true;
        }
    }

    async function cargarSesion() {
        if (E.modo !== "portal") return;
        try { E.sesion = await api("/api/descarga-xml/portal/sesion"); }
        catch (e) { E.sesion = { abierta: false, entrando: false }; }
        pintarAcceso();
    }

    $("sesion-cerrar").addEventListener("click", async function () {
        var b = this;
        b.disabled = true;
        try {
            await api("/api/descarga-xml/portal/sesion/cerrar", { method: "POST" });
            E.sesion = { abierta: false, entrando: false };
            pintarAcceso();
            toast("Sesión del portal cerrada.");
            setTimeout(cargarSolicitudes, 3000);
        } catch (e) {
            alerta(e.message);
            cargarSesion();
        } finally {
            b.disabled = false;
        }
    });

    setInterval(function () { if (E.modo === "portal" && E.elegido && !document.hidden) cargarSesion(); }, 60000);

    document.querySelectorAll(".dm-modo").forEach(function (b) {
        b.addEventListener("click", function () { ponerModo(b.dataset.modo); });
    });
    document.querySelectorAll("#acceso-portal button").forEach(function (b) {
        b.addEventListener("click", function () {
            E.acceso = b.dataset.acceso;
            guardarLocal("descarga:acceso", E.acceso);
            pintarAcceso();
        });
    });
    $("ciec-otra").addEventListener("click", function () { E.ciecOtra = true; pintarAcceso(); $("ciec").focus(); });
    $("ciec-olvidar").addEventListener("click", async function () {
        if (!E.elegido || !confirm("¿Olvidar la contraseña guardada de " + (E.elegido.alias || E.elegido.rfc) + "?")) return;
        try {
            await api("/api/descarga-xml/ciec/" + encodeURIComponent(E.elegido.rfc), { method: "DELETE" });
            E.elegido.ciecGuardada = false;
            E.ciecOtra = false;
            pintarAcceso();
            toast("Se olvidó la contraseña guardada.");
        } catch (e) { alerta(e.message); }
    });

    /* ================================================================ qué comprobantes */

    document.querySelectorAll("#tipo button").forEach(function (b) {
        b.addEventListener("click", function () {
            E.tipo = b.dataset.tipo;
            document.querySelectorAll("#tipo button").forEach(function (x) {
                x.setAttribute("aria-pressed", x === b ? "true" : "false");
            });
            $("etq-contraparte").innerHTML = (E.tipo === "emitidos" ? "RFC receptor" : "RFC emisor") + ' <span class="dm-opcional">(opcional)</span>';
            reglaEstado();
        });
    });

    $("rfc-contraparte").addEventListener("input", function () { this.value = this.value.toUpperCase().replace(/\s/g, ""); });

    /* ---- Periodo: atajos Desde / Hasta por mes; los campos exactos son la verdad */

    function ponerRango(ini, fin) {
        $("inicio").value = isoLocal(ini);
        $("fin").value = isoLocal(fin);
        pintarResumen();
    }

    function rango() { return { inicio: leerFecha($("inicio").value), fin: leerFecha($("fin").value) }; }

    function pintarResumen() {
        var r = rango();
        if (E.selDesde && r.inicio) E.selDesde.poner("m:" + mesDe(r.inicio));
        if (E.selHasta && r.fin) E.selHasta.poner("m:" + mesDe(r.fin));
        var p = $("resumen-rango");
        if (!r.inicio || !r.fin) { p.textContent = "Elige el periodo."; return; }
        var txt = "Se pedirá del " + fechaBonita(isoLocal(r.inicio), true) + " al " + fechaBonita(isoLocal(r.fin), true);
        if (r.fin > new Date()) txt += " (el SAT solo tiene hasta este momento)";
        if (E.modo === "portal" && (r.fin - r.inicio) / 86400000 > 366) txt += ". En el portal busca hasta un año a la vez";
        p.textContent = txt + ".";
    }

    function aplicarMes(ym) {
        ponerRango(inicioMes(ym), finMes(ym));
    }

    ["inicio", "fin"].forEach(function (id) {
        $(id).addEventListener("change", function () { E.periodoTocado = true; pintarResumen(); });
    });
    $("btn-exacto").addEventListener("click", function () {
        var abierto = $("exacto").hidden;
        $("exacto").hidden = !abierto;
        this.setAttribute("aria-expanded", abierto ? "true" : "false");
        this.textContent = abierto ? "Ocultar días y horas" : "Días y horas exactos";
    });

    function prepararPeriodo() {
        E.selDesde = Fiscontable.selectorPeriodo({
            boton: $("btn-desde"), etiqueta: $("txt-desde"), general: E.periodoGeneral,
            alCambiar: function (v) {
                if (!v || v.indexOf("m:") !== 0) return;
                E.periodoTocado = true;
                aplicarMes(v.slice(2));            // elegir el inicio arma el mes completo
            }
        });
        E.selHasta = Fiscontable.selectorPeriodo({
            boton: $("btn-hasta"), etiqueta: $("txt-hasta"), general: E.periodoGeneral,
            alCambiar: function (v) {
                if (!v || v.indexOf("m:") !== 0) return;
                E.periodoTocado = true;
                var fin = finMes(v.slice(2)), ini = rango().inicio;
                if (!ini || ini > fin) ini = inicioMes(v.slice(2));
                ponerRango(ini, fin);              // el final se estira hasta ese mes
            }
        });
        aplicarMes(E.periodoGeneral || mesDe(new Date()));
        window.addEventListener("fiscontable:periodo", function (ev) {
            E.periodoGeneral = ev.detail;
            E.selDesde.general(ev.detail);
            E.selHasta.general(ev.detail);
            if (!E.periodoTocado && ev.detail) aplicarMes(ev.detail);
        });
    }

    /* ================================================================ pasos */

    function alElegir(quien) {
        E.elegido = quien;
        E.ciecOtra = false;
        sinAlerta();
        $("paso-acceso").hidden = false;
        $("paso-filtros").hidden = false;
        pintarAcceso();
        cerrarResultados();
        E.solicitudes = [];
        pintarSolicitudes();
        cargarSolicitudes();
    }

    function alLimpiar() {
        E.elegido = null;
        $("paso-acceso").hidden = $("paso-filtros").hidden = true;
        cerrarResultados();
        detenerSondeo();
    }

    /* ================================================================ solicitar */

    function adjuntarEfirma(cuerpo) {
        if (E.elegido.efirmaGuardada) return true;
        var cer = E.elegido.cer || $("cer").files[0], key = $("key").files[0], pwd = $("password").value;
        if (!cer || !key || !pwd) { alerta("Faltan el .cer, el .key o la contraseña de la e.firma."); return false; }
        cuerpo.append("cer", cer);
        cuerpo.append("key", key);
        cuerpo.append("password", pwd);
        return true;
    }

    async function solicitar(modo, boton) {
        sinAlerta();
        if (!E.elegido) { alerta("Primero indica de quién son los comprobantes."); return; }
        var r = rango();
        if (!r.inicio || !r.fin) { alerta("Elige el periodo."); return; }
        if (r.inicio >= r.fin) { alerta("La fecha inicial debe ser anterior a la final."); return; }
        var contraparte = $("rfc-contraparte").value.trim();
        if (contraparte && !PATRON_RFC.test(contraparte)) {
            alerta("El RFC " + (E.tipo === "emitidos" ? "receptor" : "emisor") + " no tiene forma válida (12 o 13 caracteres).");
            return;
        }

        var cuerpo = new FormData();
        cuerpo.append("rfc", E.elegido.rfc);
        cuerpo.append("tipo", E.tipo);
        cuerpo.append("fecha_inicial", isoLocal(r.inicio));
        cuerpo.append("fecha_final", isoLocal(r.fin));
        cuerpo.append("rfc_contraparte", contraparte);
        cuerpo.append("estado", $("estado").value);
        cuerpo.append("tipo_comprobante", $("tipo-comprobante").value);

        var ruta;
        if (E.modo === "webservice") {
            ruta = "/api/descarga-xml/solicitar";
            cuerpo.append("modo", "cfdi");
            if (!adjuntarEfirma(cuerpo)) return;
        } else {
            ruta = "/api/descarga-xml/portal/solicitar";
            cuerpo.append("modo", modo);
            var conSesion = sesionUsable();
            cuerpo.append("acceso", conSesion ? E.sesion.acceso : E.acceso);
            if (conSesion) {
                /* la sesión abierta ya entró al portal: no se manda contraseña ni e.firma */
            } else if (E.acceso === "ciec") {
                if (!E.elegido.ciecGuardada || E.ciecOtra) {
                    var ciec = $("ciec").value;
                    if (!ciec) { alerta("Escribe la contraseña del SAT (CIEC) del contribuyente."); return; }
                    cuerpo.append("ciec", ciec);
                    if ($("guardar-ciec").checked && !$("caja-guardar-ciec").hidden) cuerpo.append("guardar_ciec", "true");
                }
            } else if (!adjuntarEfirma(cuerpo)) return;
        }

        var botones = [$("btn-buscar"), $("btn-descargar")], texto = boton.textContent;
        botones.forEach(function (b) { b.disabled = true; });
        boton.textContent = "Enviando…";
        try {
            await api(ruta, { method: "POST", body: cuerpo });
            if (E.modo === "portal" && E.acceso === "ciec") $("ciec").value = "";
            await cargarSolicitudes();
            Fiscontable.refrescarDescargas();
            var ins = $("insignia");
            ins.classList.remove("dm-insignia--pulso"); void ins.offsetWidth; ins.classList.add("dm-insignia--pulso");
            if (E.modo === "portal") cargarSesion();
            toast(E.modo === "portal"
                ? (conSesion ? "Buscando con la sesión abierta del portal…"
                   : E.acceso === "ciec" ? "Entrando al portal… en un momento te pide el captcha." : "Entrando al portal con la e.firma…")
                : "Solicitud enviada al SAT.", "Ver solicitudes", abrirCajon);
        } catch (e) {
            alerta(e.message || await Fiscontable.leerError(null));
        } finally {
            botones.forEach(function (b) { b.disabled = false; });
            boton.textContent = texto;
        }
    }

    $("btn-buscar").addEventListener("click", function () { solicitar("lista", this); });
    $("btn-descargar").addEventListener("click", function () { solicitar("cfdi", this); });

    /* ================================================================ solicitudes (panel lateral) */

    function abrirCajon() {
        $("velo").hidden = false;
        $("cajon").hidden = false;
        $("cajon-cerrar").focus();
    }
    function cerrarCajon() {
        $("velo").hidden = true;
        $("cajon").hidden = true;
    }
    $("btn-solicitudes").addEventListener("click", abrirCajon);
    $("cajon-cerrar").addEventListener("click", cerrarCajon);
    $("velo").addEventListener("click", cerrarCajon);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("modal-captcha").hidden) cerrarCajon(); });

    async function cargarSolicitudes() {
        if (!E.elegido) return;
        if (E.modo === "portal") cargarSesion();
        var rfc = E.elegido.rfc;
        try {
            var lista = await api("/api/descarga-xml/solicitudes?rfc=" + encodeURIComponent(rfc));
            if (!E.elegido || E.elegido.rfc !== rfc) return;       // cambió de contribuyente mientras tanto
            var antes = {};
            E.solicitudes.forEach(function (s) { antes[s.id] = s.estado; });
            E.solicitudes = lista;
            pintarSolicitudes();
            revisarCaptcha();
            revisarCiecGuardada();
            // Si la que estás viendo acaba de terminar, se recargan sus resultados.
            if (E.abierta && antes[E.abierta] && ACTIVOS.indexOf(antes[E.abierta]) >= 0) {
                var s = lista.find(function (x) { return x.id === E.abierta; });
                if (s && s.estado === "completado") verResultados(E.abierta);
            }
            // Avisa cuando algo termina mientras trabajas en otra cosa
            lista.forEach(function (s) {
                if (antes[s.id] && ACTIVOS.indexOf(antes[s.id]) >= 0 && s.estado === "completado") {
                    toast("Lista: " + descripcionCorta(s), "Ver resultados", function () { verResultados(s.id); });
                }
            });
            var activas = lista.filter(function (s) { return ACTIVOS.indexOf(s.estado) >= 0; });
            if (activas.length) iniciarSondeo(activas.some(function (s) { return s.origen === "portal"; }) ? 2500 : 5000);
            else detenerSondeo();
        } catch (e) {
            $("lista-solicitudes").innerHTML = '<p class="dm-vacio">No se pudieron cargar las solicitudes: ' + esc(e.message) + "</p>";
        }
    }

    function iniciarSondeo(ms) {
        if (E.sondeo && E.sondeo.ms === ms) return;
        detenerSondeo();
        E.sondeo = { ms: ms, reloj: setInterval(cargarSolicitudes, ms) };
    }
    function detenerSondeo() {
        if (E.sondeo) clearInterval(E.sondeo.reloj);
        E.sondeo = null;
    }

    function sello(s) {
        var m = {
            enviando: ["activo", "Enviando al SAT"], en_sat: ["activo", "El SAT la prepara"], descargando: ["activo", "Descargando"],
            conectando: ["activo", "Entrando al portal"], captcha: ["aviso", "Falta el captcha"], buscando: ["activo", "Buscando"],
            completado: ["bien", "Lista"], sin_datos: ["gris", "Sin comprobantes"], error: ["mal", "Error"], cancelado: ["gris", "Detenida"]
        }[s.estado] || ["gris", s.estado];
        var giro = m[0] === "activo" ? '<span class="dm-giro"></span>' : "";
        return '<span class="dm-estado dm-estado--' + m[0] + '">' + giro + esc(m[1]) + "</span>";
    }

    function origenTexto(s) {
        if (s.origen !== "portal") return "Web service";
        return "Portal · " + ((s.filtros || {}).acceso === "efirma" ? "e.firma" : "contraseña");
    }

    function descripcionCorta(s) {
        var que = s.origen === "portal" ? (s.modo === "lista" ? "lista" : "XML") : (s.modo === "metadata" ? "lista" : "XML");
        return (s.tipo === "emitidos" ? "Emitidas" : "Recibidas") + " · " + que + " · " +
            fechaBonita(s.fecha_inicial) + " a " + fechaBonita(s.fecha_final);
    }

    function descripcion(s) {
        var f = s.filtros || {}, extra = [];
        if (f.rfc_contraparte) extra.push((s.tipo === "emitidos" ? "receptor " : "emisor ") + f.rfc_contraparte);
        if (f.estado) extra.push(f.estado === "Vigente" ? "vigentes" : "cancelados");
        if (f.tipo_comprobante) extra.push(NOMBRE_TIPO[f.tipo_comprobante] || f.tipo_comprobante);
        return descripcionCorta(s) + (extra.length ? " · " + extra.join(", ") : "");
    }

    function pintarSolicitudes() {
        var caja = $("lista-solicitudes");
        var activas = E.solicitudes.filter(function (s) { return ACTIVOS.indexOf(s.estado) >= 0; }).length;
        $("insignia").hidden = !activas;
        $("insignia").textContent = activas;
        $("cajon-sub").textContent = E.elegido ? (E.elegido.alias || E.elegido.rfc) + " · " + E.elegido.rfc : "";
        if (!E.solicitudes.length) {
            caja.innerHTML = '<p class="dm-vacio">Todavía no hay solicitudes para este contribuyente.</p>';
            return;
        }
        caja.innerHTML = E.solicitudes.map(function (s) {
            var activa = ACTIVOS.indexOf(s.estado) >= 0;
            var detalle = activa ? (s.progreso || s.mensaje || "") : (s.mensaje || "");
            if (s.estado === "descargando" && s.origen !== "portal" && s.paquetes) {
                detalle = "Paquete " + Math.min(s.paquetes_bajados + 1, s.paquetes) + " de " + s.paquetes + ". " + detalle;
            }
            var acciones = "";
            if (s.estado === "captcha") acciones += '<button type="button" class="fc-btn fc-btn--principal" data-captcha="' + esc(s.id) + '">Escribir el captcha</button>';
            if (s.estado === "completado") acciones += '<button type="button" class="fc-btn fc-btn--principal" data-ver="' + esc(s.id) + '">Ver resultados</button>';
            if (activa) acciones += '<button type="button" class="fc-btn fc-btn--discreto" data-detener="' + esc(s.id) + '">Detener</button>';
            return '<div class="dm-sol' + (activa ? " dm-sol--activa" : "") + '">' +
                '<div class="dm-sol__fila"><span class="dm-sol__titulo"><span class="dm-sol__origen">' + esc(origenTexto(s)) + "</span>" +
                esc(descripcion(s)) + "</span>" + sello(s) + "</div>" +
                '<div class="dm-sol__detalle">' + esc(detalle) + ' <span style="opacity:.7">· ' + esc(cuandoFue(s.creado_en)) + "</span></div>" +
                (acciones ? '<div class="dm-sol__acciones">' + acciones + "</div>" : "") + "</div>";
        }).join("");
    }

    $("lista-solicitudes").addEventListener("click", async function (e) {
        var ver = e.target.closest("[data-ver]");
        if (ver) { cerrarCajon(); verResultados(ver.dataset.ver); return; }
        var cap = e.target.closest("[data-captcha]");
        if (cap) {
            var s = E.solicitudes.find(function (x) { return x.id === cap.dataset.captcha; });
            if (s) { E.captcha = { id: null, turno: null, enviado: false }; mostrarCaptcha(s); }
            return;
        }
        var det = e.target.closest("[data-detener]");
        if (det) {
            det.disabled = true;
            det.textContent = "Deteniendo…";
            await detener(det.dataset.detener);
        }
    });

    async function detener(id) {
        try {
            await api("/api/descarga-xml/solicitudes/" + encodeURIComponent(id) + "/cancelar", { method: "POST" });
        } catch (err) { alerta(err.message); }
        setTimeout(cargarSolicitudes, 1200);
    }

    /** Si una búsqueda del portal ya pasó el login y pidió guardar la contraseña, ya quedó guardada. */
    function revisarCiecGuardada() {
        if (!E.elegido || E.elegido.ciecGuardada) return;
        var ok = E.solicitudes.some(function (s) {
            return s.origen === "portal" && (s.filtros || {}).guardar_ciec &&
                ["buscando", "descargando", "completado", "sin_datos"].indexOf(s.estado) >= 0;
        });
        if (ok) { E.elegido.ciecGuardada = true; E.ciecOtra = false; pintarAcceso(); }
    }

    /* ================================================================ captcha */

    function revisarCaptcha() {
        var pendiente = E.solicitudes.find(function (s) { return s.estado === "captcha" && s.captcha; });
        if (pendiente) { mostrarCaptcha(pendiente); return; }
        if (!$("modal-captcha").hidden) $("modal-captcha").hidden = true;
    }

    function mostrarCaptcha(s) {
        var turno = s.captcha_turno || s.captcha;           // cambia con cada captcha nuevo del portal
        if (E.captcha.id === s.id && E.captcha.turno === turno && !$("modal-captcha").hidden) return;
        if (E.captcha.id === s.id && E.captcha.turno === turno && E.captcha.enviado) return;   // esperando al portal
        var otroIntento = E.captcha.id === s.id && E.captcha.enviado && E.captcha.turno !== turno;
        E.captcha = { id: s.id, turno: turno, enviado: false };
        $("captcha-img").src = s.captcha;
        $("captcha-texto").value = "";
        $("captcha-sub").textContent = "El portal lo pide para entrar con la contraseña de " + s.rfc + ".";
        $("captcha-error").hidden = !otroIntento;
        $("captcha-error").textContent = otroIntento ? "El anterior no coincidió. Escribe el de esta imagen." : "";
        $("modal-captcha").hidden = false;
        $("captcha-texto").focus();
    }

    async function enviarCaptcha() {
        var texto = $("captcha-texto").value.trim();
        if (!texto) { $("captcha-texto").focus(); return; }
        var b = $("captcha-enviar");
        b.disabled = true;
        try {
            await api("/api/descarga-xml/solicitudes/" + encodeURIComponent(E.captcha.id) + "/captcha", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: texto })
            });
            E.captcha.enviado = true;
            $("modal-captcha").hidden = true;
            setTimeout(cargarSolicitudes, 1500);
        } catch (e) {
            $("captcha-error").hidden = false;
            $("captcha-error").textContent = e.message;
        } finally {
            b.disabled = false;
        }
    }
    $("captcha-enviar").addEventListener("click", enviarCaptcha);
    $("captcha-texto").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); enviarCaptcha(); } });
    $("captcha-detener").addEventListener("click", async function () {
        $("modal-captcha").hidden = true;
        await detener(E.captcha.id);
    });

    /* ================================================================ resultados */

    var CATALOGO = [
        { clave: "uuid", etiqueta: "UUID", tipo: "uuid" },
        { clave: "descargado", etiqueta: "Descargado", tipo: "texto" },
        { clave: "rfc_emisor", etiqueta: "RFC emisor", tipo: "texto" },
        { clave: "nombre_emisor", etiqueta: "Nombre emisor", tipo: "texto" },
        { clave: "rfc_receptor", etiqueta: "RFC receptor", tipo: "texto" },
        { clave: "nombre_receptor", etiqueta: "Nombre receptor", tipo: "texto" },
        { clave: "fecha_emision", etiqueta: "Fecha emisión", tipo: "fecha" },
        { clave: "fecha_certificacion", etiqueta: "Fecha certificación", tipo: "fecha" },
        { clave: "rfc_pac", etiqueta: "RFC PAC", tipo: "texto" },
        { clave: "total", etiqueta: "Total", tipo: "moneda" },
        { clave: "tipo_nombre", etiqueta: "Tipo", tipo: "texto" },
        { clave: "serie_folio", etiqueta: "Serie-folio", tipo: "texto" },
        { clave: "estatus_cancelacion", etiqueta: "Estatus cancelación", tipo: "texto" },
        { clave: "estado", etiqueta: "Estado", tipo: "texto" },
        { clave: "estatus_proceso", etiqueta: "Estatus proceso", tipo: "texto" },
        { clave: "fecha_solicitud_cancelacion", etiqueta: "Solicitud de cancelación", tipo: "fecha" },
        { clave: "fecha_cancelacion", etiqueta: "Fecha cancelación", tipo: "fecha" }
    ];
    // La misma "Lista Global" de Mi Admin XML para el portal; sin columnas vacías para el web service
    var PREDETERMINADAS = {
        portal: ["uuid", "descargado", "rfc_emisor", "nombre_emisor", "rfc_receptor", "nombre_receptor", "fecha_emision",
                 "fecha_certificacion", "rfc_pac", "total", "tipo_nombre", "estatus_cancelacion", "estado", "estatus_proceso",
                 "fecha_solicitud_cancelacion", "fecha_cancelacion"],
        ws: ["uuid", "descargado", "tipo_nombre", "rfc_emisor", "nombre_emisor", "rfc_receptor", "nombre_receptor",
             "fecha_emision", "fecha_certificacion", "total", "serie_folio"]
    };
    var SELLOS = { descargado: { "Sí": "verde", "No": "gris" }, estado: { Vigente: "verde", Cancelado: "rojo" } };

    function tablaDe(clave) {
        if (!E.tablas[clave]) {
            E.tablas[clave] = FCTabla.crear({
                caja: $(clave === "portal" ? "res-tabla-portal" : "res-tabla-ws"), id: "descarga-xml-" + clave,
                catalogo: CATALOGO, predeterminadas: PREDETERMINADAS[clave], sellos: SELLOS, claveFila: "uuid",
                claseFila: function (f) { return f.estado === "Cancelado" ? "fila-cancelada" : ""; },
                alClic: function (f) {
                    if (f.descargado !== "Sí" || !E.detalle) return;
                    window.open("/herramientas/xml/detalle/?rfc=" + encodeURIComponent(E.detalle.rfc) + "&uuid=" + encodeURIComponent(f.uuid), "_blank", "noopener");
                }
            });
            E.tablas[clave].iniciarColumnas(null);
        }
        return E.tablas[clave];
    }

    function cerrarResultados() {
        E.abierta = null;
        E.detalle = null;
        $("resultados").hidden = true;
    }
    $("res-cerrar").addEventListener("click", cerrarResultados);

    async function verResultados(id) {
        sinAlerta();
        try {
            var d = await api("/api/descarga-xml/solicitudes/" + encodeURIComponent(id));
            E.abierta = id;
            pintarResultados(d);
        } catch (e) { alerta(e.message); }
    }

    function cifra(valor, nombre, nota) {
        return '<div class="ctx-resumen__dato"><small>' + esc(nombre) + "</small><b>" + miles(valor) + "</b>" +
            (nota ? "<span>" + esc(nota) + "</span>" : "") + "</div>";
    }

    function pintarResultados(d) {
        E.detalle = d;
        var clave = d.origen === "portal" || d.modo === "metadata" ? "portal" : "ws";
        E.filas = (d.filas || []).map(function (f) {
            return Object.assign({}, f, { descargado: f.descargado ? "Sí" : "No", tipo_nombre: NOMBRE_TIPO[f.tipo] || f.tipo || "" });
        });
        var esLista = d.modo === "lista" || d.modo === "metadata";
        $("res-titulo").textContent = (esLista ? "Lista del SAT · " : "XML descargados · ") + (d.tipo === "emitidos" ? "emitidas" : "recibidas");
        $("res-sub").textContent = origenTexto(d) + " · " + d.rfc + " · " + fechaBonita(d.fecha_inicial, true) + " a " +
            fechaBonita(d.fecha_final, true) + (d.mensaje ? " · " + d.mensaje : "");

        var descargados = E.filas.filter(function (f) { return f.descargado === "Sí"; }).length;
        var faltan = E.filas.length - descargados;
        var html = cifra(E.filas.length, "Total de CFDI");
        if (clave === "portal") {
            html += cifra(E.filas.filter(function (f) { return f.estado === "Vigente"; }).length, "Vigentes");
            html += cifra(E.filas.filter(function (f) { return f.estado === "Cancelado"; }).length, "Cancelados");
        }
        html += cifra(descargados, "En tu biblioteca") + cifra(faltan, "No descargados");
        $("res-cifras").innerHTML = html;

        $("res-faltantes").hidden = !(d.origen === "portal" && esLista && faltan > 0);
        $("res-bajar").hidden = !d.nombre_descarga;
        $("res-bajar").querySelector("span").textContent = /\.xlsx$/.test(d.nombre_descarga || "") ? "Descargar Excel" : "Descargar ZIP de XML";
        $("res-bajar").dataset.job = d.job_id;
        $("res-bajar").dataset.nombre = d.nombre_descarga || "";

        var recorte = $("res-recorte");
        recorte.hidden = !(d.total_filas > E.filas.length);
        recorte.textContent = recorte.hidden ? "" : "Se muestran " + miles(E.filas.length) + " de " + miles(d.total_filas) + ". El archivo descargable trae todos.";

        $("res-buscar").value = "";
        $("res-ver").value = "";
        $("res-tabla-ws").hidden = clave !== "ws";
        $("res-tabla-portal").hidden = clave !== "portal";
        $("resultados").hidden = false;
        E.tablaActual = tablaDe(clave);
        filtrarResultados();
        $("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function filtrarResultados() {
        if (!E.tablaActual) return;
        var q = $("res-buscar").value.trim().toUpperCase(), ver = $("res-ver").value;
        E.tablaActual.ponerFilas(E.filas.filter(function (f) {
            if (ver === "si" && f.descargado !== "Sí") return false;
            if (ver === "no" && f.descargado !== "No") return false;
            if ((ver === "Vigente" || ver === "Cancelado") && f.estado !== ver) return false;
            if (!q) return true;
            return [f.uuid, f.rfc_emisor, f.nombre_emisor, f.rfc_receptor, f.nombre_receptor].some(function (v) {
                return v && String(v).toUpperCase().indexOf(q) >= 0;
            });
        }));
    }
    $("res-buscar").addEventListener("input", filtrarResultados);
    $("res-ver").addEventListener("change", filtrarResultados);

    // "Descargar los que faltan": la misma búsqueda del portal, ahora bajando los XML
    $("res-faltantes").addEventListener("click", function () {
        var d = E.detalle;
        if (!d) return;
        ponerModo("portal");
        document.querySelector('#tipo button[data-tipo="' + d.tipo + '"]').click();
        ponerRango(new Date(d.fecha_inicial), new Date(d.fecha_final));
        E.periodoTocado = true;
        var f = d.filtros || {};
        $("rfc-contraparte").value = f.rfc_contraparte || "";
        $("estado").value = f.estado || "Todos";
        reglaEstado();
        $("tipo-comprobante").value = f.tipo_comprobante || "";
        if (f.acceso) { E.acceso = f.acceso; pintarAcceso(); }
        solicitar("cfdi", $("btn-descargar"));
    });

    // Administración de XML abre la empresa activa: si es un cliente, se fija antes de ir.
    $("res-biblioteca").addEventListener("click", async function () {
        this.disabled = true;
        try { if (E.elegido && E.elegido.esCliente) await Fiscontable.elegirEmpresa(E.elegido.rfc); } catch (e) { /* se abre igual */ }
        location.href = "/herramientas/xml/";
    });

    $("res-bajar").addEventListener("click", async function () {
        var boton = this, etiqueta = boton.querySelector("span"), texto = etiqueta.textContent;
        boton.disabled = true;
        etiqueta.textContent = "Descargando…";
        try {
            var r = await fetch(API + "/api/trabajos/" + encodeURIComponent(boton.dataset.job) + "/descargar", { credentials: "include" });
            if (!r.ok) { alerta(await Fiscontable.leerError(r)); return; }
            Fiscontable.guardarArchivo(await r.blob(), boton.dataset.nombre || "descarga_sat");
        } catch (e) {
            alerta("No se pudo bajar el archivo. Búscalo en Mis descargas.");
        } finally {
            boton.disabled = false;
            etiqueta.textContent = texto;
        }
    });

    window.addEventListener("pagehide", detenerSondeo);
    // Al regresar con "Atrás", el navegador puede restaurar la página tal cual: el botón no debe quedar apagado
    window.addEventListener("pageshow", function () { $("res-biblioteca").disabled = false; });

    /* ================================================================ inicio */
    (async function () {
        if (!(await Fiscontable.exigirModulo("descarga_xml"))) return;
        var perfil = await Fiscontable.perfil();
        E.puedeGuardar = !!(perfil && perfil.puede_guardar_efirma);
        E.periodoGeneral = await Fiscontable.periodoActivo();
        E.acceso = leerLocal("descarga:acceso") === "efirma" ? "efirma" : "ciec";
        prepararPeriodo();
        ponerModo(leerLocal("descarga:modo") === "portal" ? "portal" : "webservice");
        PasoCliente.montar({ contenedor: "paso-cliente", alElegir: alElegir, alLimpiar: alLimpiar });
    })();
})();
