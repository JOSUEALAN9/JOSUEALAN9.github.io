/**
 * modulo-sat.js — lógica compartida entre Constancias (CSF) y Opinión (32-D).
 *
 * Los dos módulos eran archivos casi idénticos de ~1000 líneas, así que
 * cualquier arreglo había que hacerlo dos veces. Desde entonces la lógica
 * vive aquí una sola vez y cada página sólo declara su MODULO.
 *
 * Cambio de esta versión: el modo individual arranca con el paso
 * "¿Para quién?" (assets/js/comun/paso-cliente.js), igual que Declaraciones.
 * Antes se pedían .cer, .key, contraseña y RFC ANTES de saber si ese
 * contribuyente ya tenía e.firma guardada o un documento reciente. Con el
 * orden invertido, el caso más común -- cliente con e.firma guardada --
 * pasó de cuatro campos a un clic.
 *
 * Cada página declara, antes de cargar este archivo:
 *
 *   const MODULO = {
 *       slug: "constancia",       // para las URLs del backend
 *       tipo: "csf",              // tipo de documento en el caché
 *       permiso: "constancias",   // clave del permiso
 *       nombre: "Constancia",     // singular, para los mensajes
 *       prefijoArchivo: "CSF",    // nombre del PDF descargado
 *       adicional: "Opinión de Cumplimiento (32-D)",  // el otro documento
 *   };
 */
(function () {
    "use strict";

    var API = Fiscontable.API;
    var esc = Fiscontable.escapar;

    var elegido = null;          // {rfc, alias, esCliente, efirmaGuardada, cer?, nombreCert?}
    var paso = null;             // el paso "¿Para quién?" montado
    var estado = null;           // lo que el servidor sabe de ese RFC
    var enCurso = {};            // RFC -> job_id, para no lanzar dos robots
    var sondeos = [];            // todos los temporizadores vivos de la página

    var archivosLote = [];
    var revisionLote = null;
    var forzarRegenerar = false;

    /* ================================================== utilidades */

    function $(id) { return document.getElementById(id); }

    function limpiarSondeos() {
        sondeos.forEach(clearInterval);
        sondeos = [];
    }
    window.addEventListener("pagehide", limpiarSondeos);

    function alerta(tipo, mensaje) {
        var caja = $("alerta");
        caja.hidden = false;
        caja.className = tipo === "error" ? "fc-aviso" : "fc-aviso fc-aviso--bien";
        caja.textContent = mensaje;
        caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function sinAlerta() { $("alerta").hidden = true; }

    async function leerError(resp) {
        if (!resp) return "No pudimos conectar con el servidor. Revisa tu conexión o si el túnel está activo.";
        if (resp.status === 401 || resp.status === 403) return "Tu sesión expiró. Recarga la página e intenta otra vez.";
        if (resp.status >= 500) {
            try {
                var d = await resp.json();
                var detalle = (d.detail || "").replace(/^Fallo en robot SAT:\s*/i, "");
                if (/dashboard|redirecciones|Generar Constancia|timeout/i.test(detalle)) {
                    return "El SAT no respondió a tiempo. Puede ser la contraseña de la e.firma o que su " +
                        "servicio esté saturado. Verifica los datos e intenta en unos minutos.";
                }
                return detalle ? "No se pudo completar: " + detalle : "Error inesperado en el servidor.";
            } catch (e) {
                return "Error inesperado en el servidor.";
            }
        }
        return "Hubo un problema al procesar la solicitud (código " + resp.status + ").";
    }

    function fechaLarga(iso) {
        var f = new Date(iso + "Z");
        if (isNaN(f)) return "";
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    }

    async function bajarBlob(url, nombre) {
        var resp = await fetch(API + url, { credentials: "include" });
        if (!resp.ok) throw resp;
        var objeto = URL.createObjectURL(await resp.blob());
        var a = document.createElement("a");
        a.href = objeto;
        a.download = nombre;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(objeto); }, 4000);
    }

    /* ============================== MODO INDIVIDUAL — paso 2 */

    function pintarPaso2(html) {
        var caja = $("paso-dos");
        caja.innerHTML = html;
        caja.hidden = !html;
    }

    function esqueleto() {
        pintarPaso2(
            '<div class="ficha">' +
              '<div class="fc-esqueleto" style="height:15px;width:48%"></div>' +
              '<div class="fc-esqueleto" style="height:13px;width:72%;margin-top:11px"></div>' +
              '<div class="fc-esqueleto" style="height:44px;margin-top:18px"></div>' +
            "</div>");
    }

    /**
     * Averigua todo lo que el servidor ya sabe de este RFC antes de
     * pedirle nada al usuario: si hay un trabajo corriendo, si tiene
     * e.firma guardada, y si ya existe un documento reciente.
     */
    async function investigarRFC(rfc) {
        var info = { pendiente: null, efirma: false, cache: null, registrado: null };

        try {
            var r1 = await fetch(API + "/api/trabajos/pendiente?rfc=" + encodeURIComponent(rfc) +
                "&tipo=" + MODULO.tipo, { credentials: "include" });
            if (r1.ok) {
                var p = await r1.json();
                if (p.existe) info.pendiente = p.job_id;
            }
        } catch (e) { /* no es bloqueante */ }

        try {
            var r2 = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/efirma-estado",
                { credentials: "include" });
            if (r2.ok) info.efirma = !!(await r2.json()).efirma_guardada;
        } catch (e) { /* no es bloqueante */ }

        try {
            var r3 = await fetch(API + "/api/documentos/estado?rfc=" + encodeURIComponent(rfc) +
                "&tipo=" + MODULO.tipo, { credentials: "include" });
            if (r3.ok) {
                var d = await r3.json();
                if (d.existe) info.cache = d;
            }
        } catch (e) { /* no es bloqueante */ }

        try {
            var r4 = await fetch(API + "/api/clientes/" + encodeURIComponent(rfc) + "/existe",
                { credentials: "include" });
            if (r4.ok) info.registrado = await r4.json();
        } catch (e) { /* no es bloqueante */ }

        return info;
    }

    async function alElegirCliente(quien) {
        elegido = quien;
        sinAlerta();
        esqueleto();

        var info = await investigarRFC(quien.rfc);
        if (!elegido || elegido.rfc !== quien.rfc) return;   // cambió de RFC mientras consultábamos
        estado = info;

        if (estado.pendiente) {
            vistaProgreso("Ya tenías un documento en proceso para este RFC. Retomamos el seguimiento.");
            vigilarTrabajo(estado.pendiente);
            return;
        }
        if (estado.cache) { vistaCache(); return; }
        if (estado.efirma) { vistaEfirmaGuardada(); return; }
        vistaFormulario();
    }

    function alLimpiarCliente() {
        elegido = null;
        estado = null;
        sinAlerta();
        pintarPaso2("");
    }

    /* --- Estado A: ya existe un documento reciente --- */

    function vistaCache() {
        pintarPaso2(
            '<div class="ficha fade-in">' +
              '<h2 class="ficha__titulo">Ya tienes esta ' + esc(MODULO.nombre) + "</h2>" +
              '<p class="ficha__nota">Se generó el ' + esc(fechaLarga(estado.cache.generado_en)) +
              ". Puedes bajar esa misma o pedir una nueva al SAT.</p>" +
              '<div class="botonera">' +
                '<button type="button" class="boton-principal" id="btn-cache">Descargar la que ya tengo</button>' +
                '<button type="button" class="boton-secundario" id="btn-nueva">Pedir una nueva al SAT</button>' +
              "</div></div>");

        $("btn-cache").addEventListener("click", async function () {
            var b = this;
            b.disabled = true;
            b.textContent = "Descargando…";
            try {
                await bajarBlob("/api/documentos/descargar?rfc=" + encodeURIComponent(elegido.rfc) +
                    "&tipo=" + MODULO.tipo, MODULO.prefijoArchivo + "_" + elegido.rfc + ".pdf");
            } catch (resp) {
                alerta("error", "No se pudo bajar el documento guardado. Prueba pidiendo uno nuevo.");
            } finally {
                b.disabled = false;
                b.textContent = "Descargar la que ya tengo";
            }
        });

        $("btn-nueva").addEventListener("click", function () {
            if (estado.efirma) generarConEfirmaGuardada();
            else vistaFormulario();
        });
    }

    /* --- Estado B: e.firma guardada, sin documento reciente --- */

    function vistaEfirmaGuardada() {
        pintarPaso2(
            '<div class="ficha fade-in">' +
              '<h2 class="ficha__titulo">Todo listo</h2>' +
              '<p class="ficha__nota">Este contribuyente ya tiene su e.firma guardada, no hay nada más que subir.</p>' +
              '<button type="button" class="boton-principal" id="btn-generar">Generar ' + esc(MODULO.nombre) + "</button>" +
              '<button type="button" class="enlace-discreto" id="btn-otra-efirma">Usar otra e.firma</button>' +
            "</div>");

        $("btn-generar").addEventListener("click", generarConEfirmaGuardada);
        $("btn-otra-efirma").addEventListener("click", vistaFormulario);
    }

    async function generarConEfirmaGuardada() {
        if (enCurso[elegido.rfc]) {
            alerta("error", "Ya se está generando este documento. Espera a que termine.");
            return;
        }
        sinAlerta();
        vistaProgreso("Arrancando…");
        try {
            var resp = await fetch(API + "/api/clientes/" + encodeURIComponent(elegido.rfc) +
                "/generar-" + MODULO.slug, { method: "POST", credentials: "include" });
            if (!resp.ok) {
                alerta("error", await leerError(resp));
                vistaEfirmaGuardada();
                return;
            }
            var datos = await resp.json();
            vigilarTrabajo(datos.job_id);
            Fiscontable.refrescarDescargas();
        } catch (e) {
            alerta("error", await leerError(null));
            vistaEfirmaGuardada();
        }
    }

    /* --- Estado C: hay que subir la e.firma --- */

    function vistaFormulario() {
        var registrado = estado && estado.registrado;
        var yaTieneGuardada = estado && estado.efirma;

        pintarPaso2(
            '<div class="ficha fade-in">' +
              '<h2 class="ficha__titulo">Su e.firma</h2>' +
              '<p class="ficha__nota">Viaja cifrada y se borra del servidor al terminar.</p>' +

              (elegido.cer
                ? '<label class="campo"><span class="campo__etiqueta">Clave privada (.key)</span>' +
                    '<input type="file" id="key" accept=".key" class="campo__archivo"></label>' +
                  '<p class="pc-pista pc-pista--bien" id="pista-cer">Certificado: ' + esc(elegido.cer.name) +
                    ' <button type="button" class="pc-cambiar" id="btn-otro-cer" style="margin-left:6px;padding:2px 8px">Cambiar</button></p>'
                : '<div class="dos">' +
                    '<label class="campo"><span class="campo__etiqueta">Certificado (.cer)</span>' +
                      '<input type="file" id="cer" accept=".cer" class="campo__archivo"></label>' +
                    '<label class="campo"><span class="campo__etiqueta">Clave privada (.key)</span>' +
                      '<input type="file" id="key" accept=".key" class="campo__archivo"></label>' +
                  "</div>" +
                  '<p class="pc-pista" id="pista-cer"></p>') +

              '<label class="campo" style="margin-top:8px">' +
                '<span class="campo__etiqueta">Contraseña de la e.firma</span>' +
                '<span style="position:relative;display:block">' +
                  '<input type="password" id="password" autocomplete="new-password" class="campo__control" style="padding-right:44px">' +
                  '<button type="button" class="ojo" id="ver-password" aria-label="Mostrar contraseña">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.5 12C3.7 7.9 7.5 5 12 5s8.3 2.9 9.5 7c-1.2 4.1-5 7-9.5 7s-8.3-2.9-9.5-7z"/></svg>' +
                  "</button></span></label>" +

              (MODULO.adicional ?
                '<label class="interruptor"><input type="checkbox" id="chk-adicional">' +
                "<span><strong>Traer también la " + esc(MODULO.adicional) + "</strong>" +
                "<span>Se saca en la misma sesión, sin volver a pedir los datos.</span></span></label>" : "") +

              (yaTieneGuardada ? "" :
                '<label class="interruptor"><input type="checkbox" id="chk-guardar">' +
                '<span><strong>Guardar esta e.firma</strong><span>' +
                (registrado && registrado.existe
                    ? "Queda cifrada en la ficha de " + esc(registrado.alias) + ", para no volver a subirla."
                    : "Queda cifrada y este RFC se da de alta en tu directorio.") +
                "</span></span></label>" +
                '<div class="campo" id="campo-alias" hidden style="margin-top:2px">' +
                  '<span class="campo__etiqueta">Nombre del cliente</span>' +
                  '<input type="text" id="alias" class="campo__control" placeholder="Ej. Constructora del Caribe" value="' +
                    esc(elegido.nombreCert || "") + '">' +
                "</div>") +

              '<button type="button" class="boton-principal" id="btn-generar">Generar ' + esc(MODULO.nombre) + "</button>" +
            "</div>");

        $("ver-password").addEventListener("click", function () {
            var c = $("password");
            c.type = c.type === "password" ? "text" : "password";
        });

        // El RFC ya lo eligió el usuario en el paso 1, así que el .cer
        // ahora sirve para CONFIRMAR que corresponde. Antes el RFC salía
        // del certificado y una confusión de archivos era invisible.
        if ($("btn-otro-cer")) {
            $("btn-otro-cer").addEventListener("click", function () {
                if (paso) paso.reabrir();
            });
        }

        if ($("cer")) $("cer").addEventListener("change", async function (e) {
            var pista = $("pista-cer");
            var archivo = e.target.files[0];
            if (!archivo) { pista.textContent = ""; return; }

            pista.className = "pc-pista";
            pista.textContent = "Leyendo el certificado…";
            var rfcCert = await extraerRFCDeCertificado(archivo);

            if (!rfcCert) {
                pista.textContent = "No pudimos leer el RFC del certificado. Si estás seguro de que es el correcto, continúa.";
                return;
            }
            if (rfcCert !== elegido.rfc) {
                pista.className = "pc-pista pc-pista--mal";
                pista.textContent = "Cuidado: este certificado es de " + esc(rfcCert) +
                    " y elegiste " + esc(elegido.rfc) + ".";
                return;
            }
            pista.className = "pc-pista pc-pista--bien";
            pista.textContent = "El certificado corresponde a " + esc(rfcCert) + ".";
        });

        var chkGuardar = $("chk-guardar");
        if (chkGuardar) {
            chkGuardar.addEventListener("change", function () {
                var hacenFaltaDatos = this.checked && !(registrado && registrado.existe);
                $("campo-alias").hidden = !hacenFaltaDatos;
                if (hacenFaltaDatos) $("alias").focus();
            });
        }

        $("btn-generar").addEventListener("click", generarConFormulario);
    }

    async function generarConFormulario() {
        sinAlerta();
        if (enCurso[elegido.rfc]) {
            alerta("error", "Ya se está generando este documento. Espera a que termine.");
            return;
        }

        var cer = elegido.cer || ($("cer") && $("cer").files[0]);
        var key = $("key").files[0];
        var password = $("password").value;
        if (!cer || !key || !password) {
            alerta("error", "Faltan el .cer, el .key o la contraseña.");
            return;
        }

        var chkGuardar = $("chk-guardar");
        var quiereGuardar = !!(chkGuardar && chkGuardar.checked);
        var alias = $("alias") ? $("alias").value.trim() : "";
        var esNuevo = quiereGuardar && !(estado.registrado && estado.registrado.existe);

        if (esNuevo && !alias) {
            alerta("error", "Escribe el nombre del cliente para darlo de alta, o desactiva el guardado de la e.firma.");
            return;
        }

        var adicional = $("chk-adicional") ? $("chk-adicional").checked : false;

        var cuerpo = new FormData();
        cuerpo.append("rfc", elegido.rfc);
        cuerpo.append("password", password);
        cuerpo.append("cer", cer);
        cuerpo.append("key", key);
        cuerpo.append("descargar_csf", MODULO.tipo === "csf" ? "true" : String(adicional));
        cuerpo.append("descargar_32d", MODULO.tipo === "opinion" ? "true" : String(adicional));
        cuerpo.append("guardar_efirma", String(quiereGuardar));
        cuerpo.append("alias_cliente", alias);

        var boton = $("btn-generar");
        boton.disabled = true;
        boton.textContent = "Arrancando…";

        try {
            var resp = await fetch(API + "/api/" + MODULO.slug + "/iniciar",
                { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) {
                alerta("error", await leerError(resp));
                boton.disabled = false;
                boton.textContent = "Generar " + MODULO.nombre;
                return;
            }
            var datos = await resp.json();
            vistaProgreso("Arrancando…");
            vigilarTrabajo(datos.job_id);
            Fiscontable.refrescarDescargas();
        } catch (e) {
            alerta("error", await leerError(null));
            boton.disabled = false;
            boton.textContent = "Generar " + MODULO.nombre;
        }
    }

    /* --- Progreso de un trabajo individual --- */

    function vistaProgreso(mensaje) {
        pintarPaso2(
            '<div class="ficha fade-in">' +
              '<h2 class="ficha__titulo">En proceso</h2>' +
              '<p class="ficha__nota" id="progreso-texto">' + esc(mensaje) + "</p>" +
              '<div class="progress-track" style="margin-top:12px"><div class="progress-fill" id="progreso-fill" style="width:6%"></div></div>' +
              '<p class="ficha__nota" style="margin-top:10px">Puedes seguir trabajando: esto sigue corriendo ' +
              "y lo vas a encontrar en Mis descargas.</p>" +
            "</div>");
    }

    function vigilarTrabajo(jobId) {
        var rfc = elegido.rfc;
        enCurso[rfc] = jobId;
        var segundos = 0;

        var intervalo = setInterval(async function () {
            segundos += 2;
            var resp;
            try {
                resp = await fetch(API + "/api/trabajos/" + jobId, { credentials: "include" });
            } catch (e) {
                return;    // tropiezo de red: se reintenta en la siguiente vuelta
            }
            if (!resp.ok) {
                clearInterval(intervalo);
                delete enCurso[rfc];
                alerta("error", await leerError(resp));
                vistaFormulario();
                return;
            }

            var t = await resp.json();

            if (t.estado === "procesando") {
                var fill = $("progreso-fill");
                if (fill) fill.style.width = Math.min(10 + segundos * 2, 92) + "%";
                var texto = $("progreso-texto");
                if (texto) texto.textContent = t.progreso || "Procesando… (" + segundos + " s)";
                return;
            }

            clearInterval(intervalo);
            delete enCurso[rfc];
            Fiscontable.refrescarDescargas();

            if (t.estado === "completado") {
                var fillFinal = $("progreso-fill");
                if (fillFinal) fillFinal.style.width = "100%";
                try {
                    await bajarBlob("/api/trabajos/" + jobId + "/descargar",
                        t.nombre_descarga || (MODULO.prefijoArchivo + "_" + rfc + ".pdf"));
                    alerta("bien", "Listo. El documento ya se descargó.");
                } catch (err) {
                    alerta("error", "El documento se generó, pero no se pudo bajar solo. Búscalo en Mis descargas.");
                }
                estado.cache = { generado_en: new Date().toISOString().slice(0, 19) };
                vistaCache();
            } else {
                alerta("error", t.mensaje_error || "No se pudo generar el documento.");
                vistaFormulario();
            }
        }, 2000);

        sondeos.push(intervalo);
    }

    /* =================================== MODO MASIVO (por lote) */

    var esMovil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        window.matchMedia("(pointer: coarse)").matches;

    async function mostrarCuota() {
        try {
            var resp = await fetch(API + "/api/mi-cuota", { credentials: "include" });
            if (!resp.ok) return;
            var cuota = await resp.json();
            if (cuota.limite === null) return;

            var linea = $("linea-cuota");
            linea.textContent = cuota.disponibles === 0
                ? "Ya usaste los " + cuota.limite + " contribuyentes de hoy. El contador se reinicia mañana."
                : "Hoy te quedan " + cuota.disponibles + " de " + cuota.limite +
                  " contribuyentes. Los que ya tengas descargados no cuentan.";
            linea.hidden = false;
        } catch (e) { /* si no se puede consultar, no se dice nada */ }
    }

    function prepararDropzone() {
        var zona = $("dropzone");
        var input = $("folder_input");

        if (esMovil) {
            $("dropzone-titulo").textContent = "Toca para seleccionar los archivos";
            $("dropzone-subtitulo").textContent = "Elige el directorio.xlsx y todos los .cer/.key a la vez";
        } else {
            input.setAttribute("webkitdirectory", "");
            input.setAttribute("directory", "");
        }

        zona.addEventListener("click", function () { input.click(); });
        input.addEventListener("change", function (e) { validarCarpeta(Array.from(e.target.files)); });

        ["dragenter", "dragover", "dragleave", "drop"].forEach(function (evento) {
            zona.addEventListener(evento, function (e) { e.preventDefault(); e.stopPropagation(); });
        });
        ["dragenter", "dragover"].forEach(function (evento) {
            zona.addEventListener(evento, function () { zona.classList.add("dropzone--activa"); });
        });
        ["dragleave", "drop"].forEach(function (evento) {
            zona.addEventListener(evento, function () { zona.classList.remove("dropzone--activa"); });
        });

        zona.addEventListener("drop", async function (e) {
            var archivos = [];
            var items = e.dataTransfer.items;
            for (var i = 0; i < items.length; i++) {
                var entrada = items[i].webkitGetAsEntry();
                if (entrada) archivos = archivos.concat(await leerEntrada(entrada));
            }
            validarCarpeta(archivos);
        });
    }

    async function leerEntrada(entrada) {
        if (entrada.isFile) return [await new Promise(function (r) { entrada.file(r); })];
        if (!entrada.isDirectory) return [];
        var lector = entrada.createReader();
        var hijos = await new Promise(function (r) { lector.readEntries(r); });
        var archivos = [];
        for (var i = 0; i < hijos.length; i++) archivos = archivos.concat(await leerEntrada(hijos[i]));
        return archivos;
    }

    function validarCarpeta(archivos) {
        archivosLote = archivos.filter(function (f) {
            var n = f.name.toLowerCase();
            return n.endsWith(".cer") || n.endsWith(".key") || n.endsWith(".xlsx");
        });

        var excel = archivosLote.find(function (f) { return f.name.toLowerCase() === "directorio.xlsx"; });
        var panel = $("panel-validacion");
        var lista = $("lista-errores");
        var btn = $("btn-masivo");

        panel.hidden = false;
        lista.innerHTML = "";
        btn.disabled = true;

        if (!excel) {
            lista.innerHTML = "<li>No encontramos <strong>directorio.xlsx</strong> entre los archivos que elegiste.</li>";
            return;
        }

        lista.innerHTML = "<li>Revisando el Excel…</li>";

        var lector = new FileReader();
        lector.onload = function (e) {
            try {
                var libro = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
                var filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]]);

                if (!filas.length) {
                    lista.innerHTML = "<li>El Excel no tiene ningún renglón que procesar.</li>";
                    return;
                }

                var nombres = archivosLote.map(function (f) { return f.name.toLowerCase(); });
                var faltantes = [];

                filas.forEach(function (fila, i) {
                    var rfc = fila.RFC ? String(fila.RFC).trim() : "Renglón " + (i + 2);
                    var cer = fila.Archivo_CER ? String(fila.Archivo_CER).trim().toLowerCase() : "";
                    var key = fila.Archivo_KEY ? String(fila.Archivo_KEY).trim().toLowerCase() : "";
                    if (cer && !cer.endsWith(".cer")) cer += ".cer";
                    if (key && !key.endsWith(".key")) key += ".key";

                    if (!cer || nombres.indexOf(cer) === -1) {
                        faltantes.push("<li><strong>" + esc(rfc) + "</strong>: falta el .cer (" +
                            esc(cer || "celda vacía") + ")</li>");
                    }
                    if (!key || nombres.indexOf(key) === -1) {
                        faltantes.push("<li><strong>" + esc(rfc) + "</strong>: falta el .key (" +
                            esc(key || "celda vacía") + ")</li>");
                    }
                });

                if (faltantes.length) {
                    lista.innerHTML = faltantes.join("");
                    return;
                }

                lista.innerHTML = '<li class="ok">Los ' + filas.length +
                    " renglones tienen sus archivos. Revisando contra el servidor…</li>";
                revisarLoteEnServidor();
            } catch (err) {
                lista.innerHTML = "<li>No se pudo leer el Excel. Verifica que no esté dañado.</li>";
            }
        };
        lector.readAsArrayBuffer(excel);
    }

    async function revisarLoteEnServidor() {
        var panel = $("panel-revision");
        var contenido = $("revision-contenido");
        panel.hidden = false;
        contenido.innerHTML = '<p class="ficha__nota">Revisando e.firmas y documentos existentes…</p>';

        var cuerpo = new FormData();
        archivosLote.forEach(function (f) { cuerpo.append("archivos_lote", f); });
        cuerpo.append("tipo_documento", MODULO.tipo);

        try {
            var resp = await fetch(API + "/api/lote/revisar",
                { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) {
                contenido.innerHTML = '<p class="ficha__nota">No se pudo revisar por adelantado. Puedes continuar de todos modos.</p>';
                $("btn-masivo").disabled = false;
                return;
            }
            revisionLote = await resp.json();
            await pintarRevision();
        } catch (e) {
            contenido.innerHTML = '<p class="ficha__nota">No se pudo revisar por adelantado. Puedes continuar de todos modos.</p>';
            $("btn-masivo").disabled = false;
        }
    }

    async function pintarRevision() {
        var r = revisionLote;
        var listos = r.listos.length, yaHay = r.ya_existentes.length, malos = r.con_problemas.length;

        var html = '<div class="sellos">' +
            '<span class="sello">' + r.total + " en el Excel</span>" +
            (listos ? '<span class="sello sello--bien">' + listos + " por generar</span>" : "") +
            (yaHay ? '<span class="sello sello--info">' + yaHay + " ya descargados</span>" : "") +
            (malos ? '<span class="sello sello--mal">' + malos + " con problemas</span>" : "") +
            "</div>";

        try {
            var resp = await fetch(API + "/api/mi-cuota", { credentials: "include" });
            if (resp.ok) {
                var cuota = await resp.json();
                if (cuota.limite !== null && listos > cuota.disponibles) {
                    html += '<div class="nota nota--alerta">Este lote pediría <strong>' + listos +
                        "</strong> documentos al SAT, pero hoy te quedan <strong>" + cuota.disponibles +
                        "</strong> de " + cuota.limite + ". Divídelo o continúa mañana.</div>";
                }
            }
        } catch (e) { /* sin aviso de cuota */ }

        if (malos) {
            html += '<div class="nota nota--alerta"><strong>Estos no se procesan hasta que los corrijas:</strong><ul>' +
                r.con_problemas.map(function (p) {
                    return "<li>" + esc(p.rfc) + " — " + esc(p.motivo) + "</li>";
                }).join("") + "</ul></div>";
        }

        if (yaHay) {
            html += '<div class="nota nota--info"><p><strong>' + yaHay +
                " de estos RFC ya tienen su documento</strong> de hace menos de " + r.dias_reutilizacion +
                " días. Puedes aprovecharlos y ahorrarte la espera, o pedir todo nuevo.</p>" +
                '<div class="opciones-lote">' +
                  '<label><input type="radio" name="modo-lote" value="reutilizar" checked> Aprovechar los que ya tengo</label>' +
                  '<label><input type="radio" name="modo-lote" value="forzar"> Pedir todos nuevos al SAT</label>' +
                "</div></div>";
        }

        $("revision-contenido").innerHTML = html;

        Array.prototype.forEach.call(document.getElementsByName("modo-lote"), function (radio) {
            radio.addEventListener("change", function () {
                forzarRegenerar = this.value === "forzar";
                actualizarBotonMasivo();
            });
        });

        actualizarBotonMasivo();
    }

    function actualizarBotonMasivo() {
        var btn = $("btn-masivo");
        var r = revisionLote;
        if (!r) { btn.disabled = false; return; }

        var cuantos = forzarRegenerar ? r.listos.length + r.ya_existentes.length : r.listos.length;

        if (cuantos === 0 && r.ya_existentes.length && !forzarRegenerar) {
            btn.disabled = false;
            btn.textContent = "Descargar los " + r.ya_existentes.length + " que ya tengo";
            return;
        }
        if (cuantos === 0) {
            btn.disabled = true;
            btn.textContent = "No hay nada que procesar";
            return;
        }
        btn.disabled = false;
        btn.textContent = "Generar " + cuantos + " documento" + (cuantos === 1 ? "" : "s");
    }

    async function lanzarLote() {
        sinAlerta();
        var btn = $("btn-masivo");
        var original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Arrancando…";

        var cuerpo = new FormData();
        archivosLote.forEach(function (f) { cuerpo.append("archivos_lote", f); });
        cuerpo.append("forzar_regenerar", String(forzarRegenerar));

        try {
            var resp = await fetch(API + "/api/" + MODULO.slug + "/lote/iniciar",
                { method: "POST", credentials: "include", body: cuerpo });
            if (!resp.ok) {
                alerta("error", await leerError(resp));
                btn.disabled = false;
                btn.textContent = original;
                return;
            }
            var datos = await resp.json();
            vigilarLote(datos.lote_id, btn, original);
            Fiscontable.refrescarDescargas();
        } catch (e) {
            alerta("error", await leerError(null));
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    function vigilarLote(loteId, btn, original) {
        $("progreso-masivo").hidden = false;

        var intervalo = setInterval(async function () {
            var resp;
            try {
                resp = await fetch(API + "/api/lotes/" + loteId, { credentials: "include" });
            } catch (e) {
                return;
            }
            if (!resp.ok) {
                clearInterval(intervalo);
                alerta("error", await leerError(resp));
                btn.disabled = false;
                btn.textContent = original;
                return;
            }

            var lote = await resp.json();

            if (lote.estado === "procesando") {
                var pct = lote.total > 0 ? Math.round((lote.procesados / lote.total) * 100) : 5;
                $("progreso-masivo-fill").style.width = Math.max(pct, 5) + "%";
                $("progreso-masivo-texto").textContent = lote.total > 0
                    ? "Procesando " + lote.procesados + " de " + lote.total +
                      (lote.rfc_actual ? " · " + lote.rfc_actual : "")
                    : "Preparando el lote…";
                return;
            }

            clearInterval(intervalo);
            btn.disabled = false;
            btn.textContent = original;
            Fiscontable.refrescarDescargas();

            if (lote.estado === "completado") {
                $("progreso-masivo-fill").style.width = "100%";
                $("progreso-masivo-texto").textContent = "Terminado.";
                try {
                    await bajarBlob("/api/lotes/" + loteId + "/descargar", lote.nombre_descarga || "Lote.zip");
                } catch (err) {
                    alerta("error", "El lote se generó, pero no se pudo bajar solo. Búscalo en Mis descargas.");
                    return;
                }
                if (lote.fallidos && lote.fallidos.length) {
                    alerta("error", "Terminó con " + lote.exitosos + " de " + lote.total +
                        ". Abre Mis descargas para ver qué pasó con los " + lote.fallidos.length + " restantes.");
                } else {
                    alerta("bien", "Terminado: " + lote.exitosos + " de " + lote.total + " documentos.");
                }
            } else {
                $("progreso-masivo").hidden = true;
                alerta("error", lote.mensaje_error || "El lote no se pudo completar.");
            }
        }, 3000);

        sondeos.push(intervalo);
    }

    /* ================================================= pestañas */

    function cambiarPestana(modo) {
        ["individual", "masivo"].forEach(function (m) {
            var esta = m === modo;
            $("tab-" + m).classList.toggle("pestana--activa", esta);
            $("tab-" + m).setAttribute("aria-selected", String(esta));
            $("panel-" + m).hidden = !esta;
        });
        sinAlerta();
    }

    /* ================================================= arranque */

    document.addEventListener("DOMContentLoaded", async function () {
        $("tab-individual").addEventListener("click", function () { cambiarPestana("individual"); });
        $("tab-masivo").addEventListener("click", function () { cambiarPestana("masivo"); });
        $("btn-masivo").addEventListener("click", lanzarLote);

        // Se comprueba el permiso antes de dejar que el usuario llene nada.
        if (!(await Fiscontable.exigirModulo(MODULO.permiso))) return;

        paso = PasoCliente.montar({
            contenedor: "paso-cliente",
            alElegir: alElegirCliente,
            alLimpiar: alLimpiarCliente
        });

        prepararDropzone();
        mostrarCuota();
    });
})();
