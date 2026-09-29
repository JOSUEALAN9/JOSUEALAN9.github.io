/**
 * descarga-xml.js — Descarga masiva de XML (Fase 10a: web service del SAT con e.firma).
 *
 * Flujo, inspirado en Mi Admin XML:
 *   1. ¿Para quién?  (PasoCliente: directorio o e.firma suelta)
 *   2. Acceso        e.firma (guardada o subida). CIEC + captcha llega en la 10b.
 *   3. Qué bajar     Emitidas: rango libre de fecha y hora.
 *                    Recibidas: año / mes / día (0 = todos) y rango de horas.
 *                    "Buscar CFDI" = lista (Metadata), "Buscar y descargar" = XML.
 *   4. Solicitudes   el historial del RFC; se actualiza solo mientras alguna sigue en el SAT.
 *   5. Resultados    cifras y la tabla (la misma de Administración de XML).
 *
 * El SAT prepara cada solicitud por su cuenta (minutos u horas); el servidor la
 * sigue aunque se cierre la página, y también aparece en "Mis descargas".
 */
(function () {
    "use strict";
    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;

    var MESES = ["Todos", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
                 "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    var NOMBRE_TIPO = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };
    var ACTIVOS = ["enviando", "en_sat", "descargando"];
    var PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

    var elegido = null;
    var tipo = "emitidos";
    var solicitudes = [];
    var sondeo = null;
    var abierta = null;          // solicitud cuyos resultados se ven
    var tabla = null;
    var filasRes = [];

    var $ = function (id) { return document.getElementById(id); };
    var fAcceso = $("paso-acceso"), fFiltros = $("paso-filtros"), fSolicitudes = $("paso-solicitudes");

    /* ------------------------------------------------------------ utilidades */

    function alerta(mensaje) {
        var caja = $("alerta");
        caja.textContent = mensaje;
        caja.hidden = false;
        caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function sinAlerta() { $("alerta").hidden = true; }

    function dos(n) { return (n < 10 ? "0" : "") + n; }
    function fechaLocal(f, hora) {
        return f.getFullYear() + "-" + dos(f.getMonth() + 1) + "-" + dos(f.getDate()) + "T" + hora;
    }
    function conSegundos(hora) {
        hora = (hora || "").trim();
        return hora.length === 5 ? hora + ":00" : hora;
    }
    function fechaBonita(iso, conHora) {
        if (!iso) return "";
        var s = String(iso).replace(" ", "T");
        var txt = s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
        return conHora && s.length > 10 ? txt + " " + s.slice(11, 16) : txt;
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

    /* ------------------------------------------------------------ filtros */

    (function prepararFiltros() {
        var hoy = new Date();
        $("em-inicio").value = fechaLocal(hoy, "00:00:00");
        $("em-fin").value = fechaLocal(hoy, "23:59:59");

        var anio = $("re-anio");
        for (var a = hoy.getFullYear(); a >= hoy.getFullYear() - 10; a--) {
            anio.insertAdjacentHTML("beforeend", '<option value="' + a + '">' + a + "</option>");
        }
        $("re-mes").innerHTML = MESES.map(function (m, i) {
            return '<option value="' + i + '">' + i + (i ? " · " + m : " · Todos") + "</option>";
        }).join("");
        $("re-mes").value = String(hoy.getMonth() + 1);
        pintarDias();
    })();

    function pintarDias() {
        var mes = +$("re-mes").value, anio = +$("re-anio").value, antes = $("re-dia").value || "0";
        var dias = mes ? new Date(anio, mes, 0).getDate() : 0;
        var html = '<option value="0">0 · Todos</option>';
        for (var d = 1; d <= dias; d++) html += '<option value="' + d + '">' + d + "</option>";
        $("re-dia").innerHTML = html;
        $("re-dia").disabled = !mes;              // sin mes no hay día que elegir
        $("re-dia").value = +antes <= dias ? antes : "0";
        pintarRango();
    }

    /** El rango que resulta de año / mes / día + horas (0 = todos). */
    function rangoRecibidos() {
        var anio = +$("re-anio").value, mes = +$("re-mes").value, dia = +$("re-dia").value;
        var hIni = conSegundos($("re-hora-inicio").value) || "00:00:00";
        var hFin = conSegundos($("re-hora-fin").value) || "23:59:59";
        var ini, fin;
        if (!mes) { ini = new Date(anio, 0, 1); fin = new Date(anio, 11, 31); }
        else if (!dia) { ini = new Date(anio, mes - 1, 1); fin = new Date(anio, mes, 0); }
        else { ini = fin = new Date(anio, mes - 1, dia); }
        return { inicio: fechaLocal(ini, hIni), fin: fechaLocal(fin, hFin) };
    }

    function pintarRango() {
        var r = rangoRecibidos();
        $("re-rango").textContent = "Se pedirá del " + fechaBonita(r.inicio, true) + " al " + fechaBonita(r.fin, true) + ".";
    }

    ["re-anio", "re-mes"].forEach(function (id) { $(id).addEventListener("change", pintarDias); });
    ["re-dia", "re-hora-inicio", "re-hora-fin"].forEach(function (id) { $(id).addEventListener("change", pintarRango); });

    document.querySelectorAll(".pestana[data-tipo]").forEach(function (p) {
        p.addEventListener("click", function () {
            tipo = p.dataset.tipo;
            document.querySelectorAll(".pestana[data-tipo]").forEach(function (x) {
                var activa = x === p;
                x.classList.toggle("pestana--activa", activa);
                x.setAttribute("aria-selected", activa ? "true" : "false");
            });
            $("filtros-emitidos").hidden = tipo !== "emitidos";
            $("filtros-recibidos").hidden = tipo !== "recibidos";
        });
    });

    document.querySelectorAll(".dm-rfc").forEach(function (c) {
        c.addEventListener("input", function () { c.value = c.value.toUpperCase().replace(/\s/g, ""); });
    });

    $("ver-password").addEventListener("click", function () {
        var c = $("password");
        c.type = c.type === "password" ? "text" : "password";
        this.setAttribute("aria-label", c.type === "password" ? "Mostrar contraseña" : "Ocultar contraseña");
    });

    /* ------------------------------------------------------------ pasos */

    function alElegir(quien) {
        elegido = quien;
        sinAlerta();
        fAcceso.hidden = false;
        $("nota-guardada").hidden = !quien.efirmaGuardada;
        $("campos-efirma").hidden = !!quien.efirmaGuardada;
        $("campo-cer").style.display = quien.cer ? "none" : "";
        fFiltros.hidden = false;
        fSolicitudes.hidden = false;
        cerrarResultados();
        detenerSondeo();
        solicitudes = [];
        $("lista-solicitudes").innerHTML = '<p class="dm-vacio">Cargando…</p>';
        cargarSolicitudes();
    }

    function alLimpiar() {
        elegido = null;
        fAcceso.hidden = fFiltros.hidden = fSolicitudes.hidden = true;
        cerrarResultados();
        detenerSondeo();
    }

    /* ------------------------------------------------------------ solicitar */

    async function solicitar(modo, boton) {
        sinAlerta();
        if (!elegido) { alerta("Primero indica de quién son los comprobantes."); return; }

        var rango, contraparte;
        if (tipo === "emitidos") {
            rango = { inicio: $("em-inicio").value, fin: $("em-fin").value };
            if (!rango.inicio || !rango.fin) { alerta("Escribe la fecha inicial y la final."); return; }
            if (rango.inicio >= rango.fin) { alerta("La fecha inicial debe ser anterior a la final."); return; }
            contraparte = $("em-rfc").value.trim();
        } else {
            rango = rangoRecibidos();
            if (rango.inicio >= rango.fin) { alerta("La hora inicial debe ser anterior a la final."); return; }
            contraparte = $("re-rfc").value.trim();
        }
        if (contraparte && !PATRON_RFC.test(contraparte)) {
            alerta("El RFC " + (tipo === "emitidos" ? "receptor" : "emisor") + " no tiene forma válida (12 o 13 caracteres).");
            return;
        }

        var cuerpo = new FormData();
        cuerpo.append("rfc", elegido.rfc);
        cuerpo.append("tipo", tipo);
        cuerpo.append("modo", modo);
        cuerpo.append("fecha_inicial", rango.inicio);
        cuerpo.append("fecha_final", rango.fin);
        cuerpo.append("rfc_contraparte", contraparte);
        cuerpo.append("estado", $("estado").value);
        cuerpo.append("tipo_comprobante", $("tipo-comprobante").value);

        if (!elegido.efirmaGuardada) {
            var cer = elegido.cer || $("cer").files[0];
            var key = $("key").files[0];
            var pwd = $("password").value;
            if (!cer || !key || !pwd) { alerta("Faltan el .cer, el .key o la contraseña de la e.firma."); return; }
            cuerpo.append("cer", cer);
            cuerpo.append("key", key);
            cuerpo.append("password", pwd);
        }

        var texto = boton.textContent;
        $("btn-buscar").disabled = $("btn-descargar").disabled = true;
        boton.textContent = "Enviando…";
        try {
            var resp = await fetch(API + "/api/descarga-xml/solicitar", { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) { alerta(await Fiscontable.leerError(resp)); return; }
            await cargarSolicitudes();
            Fiscontable.refrescarDescargas();
            fSolicitudes.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (e) {
            alerta(await Fiscontable.leerError(null));
        } finally {
            $("btn-buscar").disabled = $("btn-descargar").disabled = false;
            boton.textContent = texto;
        }
    }

    $("btn-buscar").addEventListener("click", function () { solicitar("metadata", this); });
    $("btn-descargar").addEventListener("click", function () { solicitar("cfdi", this); });

    /* ------------------------------------------------------------ solicitudes */

    async function cargarSolicitudes() {
        if (!elegido) return;
        var rfc = elegido.rfc;
        try {
            var resp = await fetch(API + "/api/descarga-xml/solicitudes?rfc=" + encodeURIComponent(rfc), { credentials: "include" });
            if (!resp.ok) throw new Error(await Fiscontable.leerError(resp));
            var lista = await resp.json();
            if (!elegido || elegido.rfc !== rfc) return;       // cambió de contribuyente mientras tanto
            var antes = {};
            solicitudes.forEach(function (s) { antes[s.id] = s.estado; });
            solicitudes = lista;
            pintarSolicitudes();
            // Si la que estás viendo acaba de terminar, se recargan sus resultados.
            if (abierta && antes[abierta] && ACTIVOS.indexOf(antes[abierta]) >= 0) {
                var s = solicitudes.find(function (x) { return x.id === abierta; });
                if (s && s.estado === "completado") verResultados(abierta);
            }
            if (lista.some(function (s) { return ACTIVOS.indexOf(s.estado) >= 0; })) iniciarSondeo();
            else detenerSondeo();
        } catch (e) {
            $("lista-solicitudes").innerHTML = '<p class="dm-vacio">No se pudieron cargar las solicitudes: ' + esc(e.message) + "</p>";
        }
    }

    function iniciarSondeo() {
        if (sondeo) return;
        sondeo = setInterval(cargarSolicitudes, 5000);
    }
    function detenerSondeo() { clearInterval(sondeo); sondeo = null; }

    function sello(s) {
        var m = {
            enviando: ["activo", "Enviando al SAT"], en_sat: ["activo", "El SAT la prepara"],
            descargando: ["activo", "Descargando"], completado: ["bien", "Lista"],
            sin_datos: ["gris", "Sin comprobantes"], error: ["mal", "Error"], cancelado: ["gris", "Detenida"]
        }[s.estado] || ["gris", s.estado];
        var giro = m[0] === "activo" ? '<span class="dm-giro"></span>' : "";
        return '<span class="dm-estado dm-estado--' + m[0] + '">' + giro + esc(m[1]) + "</span>";
    }

    function descripcion(s) {
        var partes = [s.tipo === "emitidos" ? "Emitidas" : "Recibidas", s.modo === "metadata" ? "lista (Buscar CFDI)" : "XML"];
        var f = s.filtros || {};
        var extra = [];
        if (f.rfc_contraparte) extra.push((s.tipo === "emitidos" ? "receptor " : "emisor ") + f.rfc_contraparte);
        if (f.estado) extra.push(f.estado === "Vigente" ? "vigentes" : "cancelados");
        if (f.tipo_comprobante) extra.push(NOMBRE_TIPO[f.tipo_comprobante] || f.tipo_comprobante);
        return partes.join(" · ") + " · " + fechaBonita(s.fecha_inicial, true) + " a " + fechaBonita(s.fecha_final, true) +
            (extra.length ? " · " + extra.join(", ") : "");
    }

    function pintarSolicitudes() {
        var caja = $("lista-solicitudes");
        if (!solicitudes.length) {
            caja.innerHTML = '<p class="dm-vacio">Todavía no hay solicitudes para este contribuyente.</p>';
            return;
        }
        caja.innerHTML = solicitudes.map(function (s) {
            var activa = ACTIVOS.indexOf(s.estado) >= 0;
            var detalle = activa ? (s.progreso || s.mensaje || "") : (s.mensaje || "");
            if (s.estado === "descargando" && s.paquetes) detalle = "Paquete " + Math.min(s.paquetes_bajados + 1, s.paquetes) + " de " + s.paquetes + ". " + detalle;
            var acciones = "";
            if (s.estado === "completado") {
                acciones += '<button type="button" class="fc-btn fc-btn--principal" data-ver="' + esc(s.id) + '">Ver resultados</button>';
            }
            if (activa) {
                acciones += '<button type="button" class="fc-btn fc-btn--discreto" data-detener="' + esc(s.id) + '">Detener</button>';
            }
            return '<div class="dm-sol' + (activa ? " dm-sol--activa" : "") + '">' +
                '<div class="dm-sol__fila"><span class="dm-sol__titulo">' + esc(descripcion(s)) + "</span>" + sello(s) + "</div>" +
                '<div class="dm-sol__detalle">' + esc(detalle) + ' <span style="opacity:.7">· ' + esc(cuandoFue(s.creado_en)) + "</span></div>" +
                (acciones ? '<div class="dm-sol__acciones">' + acciones + "</div>" : "") +
                "</div>";
        }).join("");
    }

    $("lista-solicitudes").addEventListener("click", async function (e) {
        var ver = e.target.closest("[data-ver]");
        if (ver) { verResultados(ver.dataset.ver); return; }
        var det = e.target.closest("[data-detener]");
        if (det) {
            det.disabled = true;
            det.textContent = "Deteniendo…";
            try {
                var r = await fetch(API + "/api/descarga-xml/solicitudes/" + encodeURIComponent(det.dataset.detener) + "/cancelar",
                    { method: "POST", credentials: "include" });
                if (!r.ok) alerta(await Fiscontable.leerError(r));
            } catch (err) { alerta(await Fiscontable.leerError(null)); }
            setTimeout(cargarSolicitudes, 1500);
        }
    });
    $("btn-refrescar").addEventListener("click", cargarSolicitudes);

    /* ------------------------------------------------------------ resultados */

    var CATALOGO = [
        { clave: "uuid", etiqueta: "UUID", tipo: "uuid" },
        { clave: "descargado", etiqueta: "Descargado", tipo: "texto" },
        { clave: "estado", etiqueta: "Estado", tipo: "texto" },
        { clave: "tipo_nombre", etiqueta: "Tipo", tipo: "texto" },
        { clave: "rfc_emisor", etiqueta: "RFC emisor", tipo: "texto" },
        { clave: "nombre_emisor", etiqueta: "Nombre emisor", tipo: "texto" },
        { clave: "rfc_receptor", etiqueta: "RFC receptor", tipo: "texto" },
        { clave: "nombre_receptor", etiqueta: "Nombre receptor", tipo: "texto" },
        { clave: "fecha_emision", etiqueta: "Fecha emisión", tipo: "fecha" },
        { clave: "fecha_certificacion", etiqueta: "Fecha certificación", tipo: "fecha" },
        { clave: "rfc_pac", etiqueta: "RFC PAC", tipo: "texto" },
        { clave: "total", etiqueta: "Total", tipo: "moneda" },
        { clave: "serie_folio", etiqueta: "Serie-folio", tipo: "texto" },
        { clave: "fecha_cancelacion", etiqueta: "Fecha cancelación", tipo: "fecha" }
    ];
    var PREDETERMINADAS = ["uuid", "descargado", "estado", "tipo_nombre", "rfc_emisor", "nombre_emisor", "rfc_receptor",
                           "nombre_receptor", "fecha_emision", "fecha_certificacion", "rfc_pac", "total", "fecha_cancelacion"];
    var SELLOS = {
        descargado: { "Sí": "verde", "No": "gris" },
        estado: { Vigente: "verde", Cancelado: "rojo" }
    };

    function cerrarResultados() {
        abierta = null;
        $("resultados").hidden = true;
    }
    $("res-cerrar").addEventListener("click", cerrarResultados);

    async function verResultados(id) {
        sinAlerta();
        try {
            var r = await fetch(API + "/api/descarga-xml/solicitudes/" + encodeURIComponent(id), { credentials: "include" });
            if (!r.ok) { alerta(await Fiscontable.leerError(r)); return; }
            var d = await r.json();
            abierta = id;
            pintarResultados(d);
        } catch (e) {
            alerta(await Fiscontable.leerError(null));
        }
    }

    function cifra(valor, nombre, clase) {
        return '<div class="dm-cifra' + (clase ? " dm-cifra--" + clase : "") + '"><div class="dm-cifra__valor">' + miles(valor) +
            '</div><div class="dm-cifra__nombre">' + esc(nombre) + "</div></div>";
    }

    function pintarResultados(d) {
        filasRes = (d.filas || []).map(function (f) {
            return Object.assign({}, f, {
                descargado: f.descargado ? "Sí" : "No",
                tipo_nombre: NOMBRE_TIPO[f.tipo] || f.tipo || "",
                estado: f.estado || ""
            });
        });
        $("res-titulo").textContent = (d.modo === "metadata" ? "Lista del SAT · " : "XML descargados · ") +
            (d.tipo === "emitidos" ? "emitidas" : "recibidas");
        $("res-sub").textContent = d.rfc + " · " + fechaBonita(d.fecha_inicial, true) + " a " + fechaBonita(d.fecha_final, true) +
            (d.mensaje ? " · " + d.mensaje : "");

        var descargados = filasRes.filter(function (f) { return f.descargado === "Sí"; }).length;
        var html = cifra(filasRes.length, "Total de CFDI");
        if (d.modo === "metadata") {
            html += cifra(filasRes.filter(function (f) { return f.estado === "Vigente"; }).length, "Vigentes", "bien");
            html += cifra(filasRes.filter(function (f) { return f.estado === "Cancelado"; }).length, "Cancelados", "mal");
        }
        html += cifra(descargados, "Ya en tu biblioteca", "bien");
        html += cifra(filasRes.length - descargados, "No descargados", filasRes.length - descargados ? "mal" : "");
        $("res-cifras").innerHTML = html;

        var recorte = $("res-recorte");
        recorte.hidden = !(d.total_filas > filasRes.length);
        recorte.textContent = recorte.hidden ? "" : "Se muestran " + miles(filasRes.length) + " de " + miles(d.total_filas) +
            ". El archivo descargable trae todos.";

        $("res-bajar").textContent = d.modo === "metadata" ? "Descargar Excel" : "Descargar ZIP de XML";
        $("res-bajar").dataset.job = d.job_id;
        $("res-bajar").dataset.nombre = d.nombre_descarga || "";
        $("res-buscar").value = "";
        $("res-ver").value = "";

        $("resultados").hidden = false;
        if (!tabla) {
            tabla = FCTabla.crear({
                caja: $("res-tabla"), id: "descarga-xml", catalogo: CATALOGO, predeterminadas: PREDETERMINADAS,
                sellos: SELLOS, claveFila: "uuid",
                claseFila: function (f) { return f.estado === "Cancelado" ? "fila-cancelada" : ""; },
                alClic: function (f) {
                    if (f.descargado !== "Sí") return;
                    window.open("/herramientas/xml/detalle/?rfc=" + encodeURIComponent(d.rfc) + "&uuid=" + encodeURIComponent(f.uuid), "_blank", "noopener");
                }
            });
            tabla.iniciarColumnas(null);
        }
        filtrarResultados();
        $("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function filtrarResultados() {
        if (!tabla) return;
        var q = $("res-buscar").value.trim().toUpperCase();
        var ver = $("res-ver").value;
        tabla.ponerFilas(filasRes.filter(function (f) {
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
    // Administración de XML abre la empresa activa: si es un cliente, se fija antes de ir.
    $("res-biblioteca").addEventListener("click", async function () {
        this.disabled = true;
        try { if (elegido && elegido.esCliente) await Fiscontable.elegirEmpresa(elegido.rfc); } catch (e) { /* se abre igual */ }
        location.href = "/herramientas/xml/";
    });
    $("res-ver").addEventListener("change", filtrarResultados);

    $("res-bajar").addEventListener("click", async function () {
        var boton = this, texto = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Descargando…";
        try {
            var r = await fetch(API + "/api/trabajos/" + encodeURIComponent(boton.dataset.job) + "/descargar", { credentials: "include" });
            if (!r.ok) { alerta(await Fiscontable.leerError(r)); return; }
            var url = URL.createObjectURL(await r.blob());
            var a = document.createElement("a");
            a.href = url;
            a.download = boton.dataset.nombre || "descarga_sat";
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        } catch (e) {
            alerta("No se pudo bajar el archivo. Búscalo en Mis descargas.");
        } finally {
            boton.disabled = false;
            boton.textContent = texto;
        }
    });

    window.addEventListener("pagehide", detenerSondeo);

    /* ------------------------------------------------------------ inicio */
    (async function () {
        if (!(await Fiscontable.exigirModulo("descarga_xml"))) return;
        PasoCliente.montar({ contenedor: "paso-cliente", alElegir: alElegir, alLimpiar: alLimpiar });
    })();
})();
