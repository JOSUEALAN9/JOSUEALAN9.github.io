/**
 * despacho.js — Mi despacho. Lo ve cada persona del despacho:
 *   Equipo        quién está y con qué papel; el titular cambia permisos, invita y quita.
 *   Solicitudes   pedir acceso a una empresa; el titular y quienes aprueban aceptan o rechazan.
 *   Bitácora      quién hizo qué en las empresas del despacho (titular y quienes aprueban).
 *   Ajustes       nombre, correo de avisos y si las personas nuevas tienen su propio espacio (titular).
 * El servidor decide qué ve cada quien (modulos/despacho/router.py); aquí solo se pinta.
 */
(function () {
    "use strict";
    var F = window.Fiscontable, API = F.API, esc = F.escapar;
    var datos = null, filtroSol = "pendiente", edicion = null;
    var AYUDA_PAPEL = {
        titular: "Administra el equipo, los permisos y los ajustes, y acepta solicitudes. Ve todo el despacho.",
        aprobador: "Acepta o rechaza solicitudes y ve la bitácora. Trabaja con lo que le permitas.",
        miembro: "Trabaja con las empresas y los módulos que le des."
    };

    function $(id) { return document.getElementById(id); }

    async function pedir(ruta, opciones) {
        opciones = opciones || {};
        var conf = { method: opciones.method || "GET", credentials: "include" };
        if (opciones.body !== undefined) { conf.headers = { "Content-Type": "application/json" }; conf.body = JSON.stringify(opciones.body); }
        var r = await fetch(API + ruta, conf);
        if (!r.ok) throw new Error(await F.leerError(r));
        return r.json();
    }

    function fecha(iso) {
        if (!iso) return "";
        var d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
        return isNaN(d) ? iso : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function inicial(texto) { return esc(String(texto || "?").trim().charAt(0).toUpperCase()); }

    function aviso(texto) { if (F.toast) F.toast(texto); }

    // ------------------------------------------------------------------ cargar
    async function cargar() {
        try {
            datos = await pedir("/api/despacho");
        } catch (e) {
            $("dp-cargando").className = "ui-tarjeta ui-falla";
            $("dp-cargando").innerHTML = "<b>No se pudo cargar</b>" + esc(e.message) +
                '<button type="button" class="ui-btn ui-btn--secundario" id="dp-reintentar">Reintentar</button>';
            $("dp-reintentar").addEventListener("click", function () { location.reload(); });
            return;
        }
        $("dp-cargando").hidden = true;
        if (!datos.despacho) return pintarSin();
        pintar();
    }

    function pintarSin() {
        $("dp-sin").hidden = false;
        var inv = datos.invitacion;
        if (!inv) return;
        $("dp-invitacion").hidden = false;
        $("dp-invitacion-texto").textContent = (inv.invito ? inv.invito + " te invitó" : "Te invitaron") + " al despacho «" + inv.despacho +
            "» como " + inv.papel + ".";
    }

    function pintar() {
        var d = datos.despacho;
        $("dp-con").hidden = false;
        $("dp-titulo").textContent = d.nombre;
        var activos = datos.equipo.filter(function (m) { return m.estado === "activo"; }).length;
        $("dp-sub").textContent = datos.yo.nombre_papel + " · " + activos + (activos === 1 ? " persona" : " personas") +
            (d.vigente === false ? " · la licencia del despacho venció" : "");
        $("dp-invitar").hidden = !datos.titular;
        document.querySelector('[data-vista="bitacora"]').hidden = !datos.aprueba;
        document.querySelector('[data-vista="ajustes"]').hidden = !datos.titular;
        var n = datos.pendientes || 0;
        $("dp-n-pendientes").hidden = !n;
        $("dp-n-pendientes").textContent = n;
        $("dp-sol-titulo").textContent = datos.aprueba ? "Solicitudes del equipo" : "Mis solicitudes";
        // Pedir acceso solo tiene sentido si no tiene todas las empresas
        document.querySelector(".dp-pedir").hidden = datos.yo.empresas === null;
        $("dp-salir").hidden = datos.titular && datos.equipo.filter(function (m) { return m.papel === "titular"; }).length <= 1;
        pintarYo();
        pintarEquipo();
        if (datos.titular) llenarAjustes();
        var q = new URLSearchParams(location.search).get("vista");
        mostrarVista(q && document.querySelector('[data-vista="' + q + '"]:not([hidden])') ? q : "equipo");
    }

    // ------------------------------------------------------------------ vistas
    function mostrarVista(clave) {
        document.querySelectorAll(".dp-vistas [data-vista]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.vista === clave)); });
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== clave; });
        var url = new URL(location.href);
        if (clave === "equipo") url.searchParams.delete("vista"); else url.searchParams.set("vista", clave);
        history.replaceState(null, "", url.pathname + url.search);
        if (clave === "solicitudes") cargarSolicitudes();
        if (clave === "bitacora") cargarBitacora();
    }

    // ------------------------------------------------------------------ equipo
    function resumenPermisos(m) {
        if (m.papel === "titular") return "Todo el despacho";
        var partes = [];
        partes.push(m.empresas === null ? "Todas las empresas" : m.empresas.length + (m.empresas.length === 1 ? " empresa" : " empresas"));
        partes.push(m.modulos === null ? "todos los módulos" : m.modulos.length + (m.modulos.length === 1 ? " módulo" : " módulos"));
        if (m.agregar_propio) partes.push("registra empresas");
        if (m.solo_lectura) partes.push("solo consulta");
        if (m.sin_conexion) partes.push("su PC trabaja sin conexión");
        partes.push(m.personal ? "con Mi espacio" : "sin Mi espacio");
        return partes.join(" · ");
    }

    function pintarEquipo() {
        var lista = datos.equipo;
        $("dp-n-equipo").textContent = lista.length + (lista.length === 1 ? " persona" : " personas");
        $("dp-equipo").innerHTML = lista.length ? lista.map(function (m) {
            var estado = m.estado === "invitado" ? '<span class="ui-estado ui-estado--aviso">Invitación pendiente</span>'
                : m.estado === "suspendido" ? '<span class="ui-estado ui-estado--error">Suspendido</span>' : "";
            return '<li><span class="dp-inicial' + (m.papel === "titular" ? " dp-inicial--titular" : "") + '">' + inicial(m.nombre || m.correo) + "</span>" +
                '<span class="dp-quien"><strong>' + esc(m.nombre || m.correo) + (m.correo === datos.yo.correo ? " (tú)" : "") + "</strong>" +
                "<small>" + (m.nombre ? esc(m.correo) + " · " : "") + (datos.titular ? esc(resumenPermisos(m)) : "") + "</small></span>" +
                '<span class="dp-lado">' + estado + '<span class="dp-etiqueta dp-etiqueta--' + esc(m.papel) + '">' + esc(m.nombre_papel) + "</span>" +
                (datos.titular ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-editar="' + esc(m.correo) + '">Permisos</button>' : "") +
                "</span></li>";
        }).join("") : '<li class="dp-lista__vacio">Todavía no hay nadie en el equipo.</li>';
    }

    function pintarYo() {
        var caja = $("dp-yo");
        if (datos.titular) { caja.hidden = true; return; }
        var y = datos.yo, mods = {};
        datos.modulos.forEach(function (m) { mods[m.clave] = m.nombre; });
        var nombresMod = y.modulos === null ? "Todos los del despacho" : (y.modulos.map(function (c) { return mods[c] || c; }).join(", ") || "Ninguno");
        caja.hidden = false;
        caja.innerHTML = "<h2>Tus permisos en el despacho</h2><div class=\"dp-permisos\">" +
            '<div class="dp-permiso"><span>Empresas</span>' + (y.empresas === null ? "Todas" : y.empresas.length + " asignadas") + "</div>" +
            '<div class="dp-permiso"><span>Módulos</span>' + esc(nombresMod) + "</div>" +
            '<div class="dp-permiso"><span>Registrar empresas en el despacho</span>' + (y.agregar ? "Sí" : "Con solicitud al titular") + "</div>" +
            '<div class="dp-permiso"><span>Mi espacio</span>' + (y.personal ? "Sí, tus clientes extra solo los ves tú" : "No") + "</div>" +
            (y.solo_lectura ? '<div class="dp-permiso"><span>Modo</span>Solo consulta</div>' : "") + "</div>";
    }

    // ------------------------------------------------------------------ ventana de permisos / invitar
    function abrirModal(miembro) {
        edicion = { invitar: !miembro, miembro: miembro || null };
        var m = miembro || { papel: "miembro", empresas: null, modulos: null, agregar_propio: false, solo_lectura: false,
                             personal: datos.despacho.ajustes ? datos.despacho.ajustes.personal_de_fabrica !== false : true, estado: "activo" };
        $("dp-modal-titulo").textContent = miembro ? "Permisos de " + (miembro.nombre || miembro.correo) : "Invitar a alguien";
        $("dp-modal-sub").textContent = miembro ? miembro.correo : "Recibe un aviso para unirse al despacho.";
        $("dp-campo-correo").hidden = !!miembro;
        $("dp-correo").value = "";
        $("dp-quitar").hidden = !miembro;
        $("dp-campo-suspender").hidden = !miembro || miembro.estado === "invitado";
        $("dp-guardar").textContent = miembro ? "Guardar" : "Invitar";
        $("dp-papel").innerHTML = datos.papeles.map(function (p) {
            return '<option value="' + esc(p.clave) + '"' + (p.clave === m.papel ? " selected" : "") + ">" + esc(p.nombre) + "</option>";
        }).join("");
        document.querySelector('input[name="dp-emp"][value="' + (m.empresas === null ? "todas" : "algunas") + '"]').checked = true;
        document.querySelector('input[name="dp-mod"][value="' + (m.modulos === null ? "todos" : "algunos") + '"]').checked = true;
        var elegidas = m.empresas || [], mods = m.modulos || datos.modulos.map(function (x) { return x.clave; });
        $("dp-empresas").innerHTML = (datos.empresas || []).length ? datos.empresas.map(function (e) {
            return '<label class="ui-check" data-buscar="' + esc((e.alias + " " + e.rfc).toLowerCase()) + '"><input type="checkbox" value="' + esc(e.rfc) + '"' +
                (elegidas.indexOf(e.rfc) >= 0 ? " checked" : "") + "><span>" + esc(e.alias) + "<small>" + esc(e.rfc) + "</small></span></label>";
        }).join("") : '<p class="dp-tenue">El despacho todavía no tiene empresas.</p>';
        $("dp-empresas-buscar").value = "";
        $("dp-modulos").innerHTML = datos.modulos.map(function (x) {
            return '<label class="ui-check"><input type="checkbox" value="' + esc(x.clave) + '"' + (mods.indexOf(x.clave) >= 0 ? " checked" : "") + "> " + esc(x.nombre) + "</label>";
        }).join("");
        $("dp-agregar").checked = !!m.agregar_propio;
        $("dp-personal").checked = !!m.personal;
        $("dp-lectura").checked = !!m.solo_lectura;
        $("dp-sin-conexion").checked = !!m.sin_conexion;
        $("dp-suspender").checked = m.estado === "suspendido";
        $("dp-modal-error").hidden = true;
        actualizarModal();
        $("dp-modal").showModal();
        if (!miembro) $("dp-correo").focus();
    }

    function actualizarModal() {
        var papel = $("dp-papel").value, titular = papel === "titular";
        $("dp-papel-ayuda").textContent = AYUDA_PAPEL[papel] || "";
        $("dp-grupo-empresas").hidden = $("dp-grupo-modulos").hidden = titular;
        $("dp-agregar").closest("label").hidden = $("dp-lectura").closest("label").hidden = $("dp-sin-conexion").closest("label").hidden = titular;
        $("dp-empresas-caja").hidden = document.querySelector('input[name="dp-emp"]:checked').value !== "algunas";
        $("dp-modulos").hidden = document.querySelector('input[name="dp-mod"]:checked').value !== "algunos";
    }

    function errorModal(texto) { $("dp-modal-error").textContent = texto; $("dp-modal-error").hidden = false; }

    async function guardarModal() {
        var papel = $("dp-papel").value;
        var cuerpo = { papel: papel, personal: $("dp-personal").checked };
        if (papel !== "titular") {
            if (document.querySelector('input[name="dp-emp"]:checked').value === "todas") cuerpo.todas_las_empresas = true;
            else cuerpo.empresas = [].map.call($("dp-empresas").querySelectorAll("input:checked"), function (i) { return i.value; });
            if (document.querySelector('input[name="dp-mod"]:checked').value === "todos") cuerpo.todos_los_modulos = true;
            else cuerpo.modulos = [].map.call($("dp-modulos").querySelectorAll("input:checked"), function (i) { return i.value; });
            cuerpo.agregar = $("dp-agregar").checked;
            cuerpo.solo_lectura = $("dp-lectura").checked;
            cuerpo.sin_conexion = $("dp-sin-conexion").checked;
        }
        if (edicion.invitar) {
            cuerpo.correo = $("dp-correo").value.trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.correo)) return errorModal("Escribe un correo válido.");
        } else if (edicion.miembro.estado !== "invitado") {
            cuerpo.estado = $("dp-suspender").checked ? "suspendido" : "activo";
        }
        // Invitar o cambiar a una persona pide confirmar que eres tú (PIN, o código por correo si no tienes PIN)
        var invitar = edicion.invitar, correoMiembro = invitar ? null : edicion.miembro.correo;
        var hecho = await F.confirmarIdentidad(invitar ? "invitar_miembro" : "cambiar_miembro", function (c) {
            cuerpo.confirmacion = c;
            return invitar ? pedir("/api/despacho/invitar", { method: "POST", body: cuerpo })
                : pedir("/api/despacho/miembros/" + encodeURIComponent(correoMiembro), { method: "PUT", body: cuerpo });
        });
        if (!hecho) return;
        $("dp-modal").close();
        aviso(invitar ? "Invitación enviada a " + cuerpo.correo + "." : "Permisos guardados.");
        try { await recargar(); } catch (e) { aviso(e.message); }
    }

    async function quitar() {
        var m = edicion && edicion.miembro;
        if (!m) return;
        var ok = await F.confirmar({ titulo: "¿Quitar a " + (m.nombre || m.correo) + " del despacho?", peligro: true, si: "Quitar",
            texto: "Deja de ver las empresas del despacho. Lo que haya en su Mi espacio se queda con esa persona." });
        if (!ok) return;
        var hecho = await F.confirmarIdentidad("quitar_miembro", function (c) {
            return pedir("/api/despacho/miembros/" + encodeURIComponent(m.correo), { method: "DELETE", body: { confirmacion: c } });
        });
        if (!hecho) return;
        $("dp-modal").close();
        aviso("Listo, ya no está en el despacho.");
        try { await recargar(); } catch (e) { errorModal(e.message); }
    }

    async function recargar() {
        datos = await pedir("/api/despacho");
        if (!datos.despacho) { location.reload(); return; }
        var vista = new URLSearchParams(location.search).get("vista") || "equipo";
        pintar();
        mostrarVista(document.querySelector('[data-vista="' + vista + '"]:not([hidden])') ? vista : "equipo");
    }

    // ------------------------------------------------------------------ solicitudes
    async function cargarSolicitudes() {
        var caja = $("dp-solicitudes");
        caja.innerHTML = '<li class="dp-lista__vacio">Cargando…</li>';
        try {
            var r = await pedir("/api/despacho/solicitudes" + (filtroSol ? "?estado=" + filtroSol : ""));
            pintarSolicitudes(r.solicitudes || []);
        } catch (e) {
            caja.innerHTML = '<li class="dp-lista__vacio">' + esc(e.message) + "</li>";
        }
    }

    function pintarSolicitudes(lista) {
        var yo = datos.yo.correo;
        $("dp-solicitudes").innerHTML = lista.length ? lista.map(function (s) {
            var estado = s.estado === "pendiente" ? '<span class="ui-estado ui-estado--aviso">Pendiente</span>'
                : s.estado === "aceptada" ? '<span class="ui-estado ui-estado--ok">Aceptada</span>'
                : s.estado === "rechazada" ? '<span class="ui-estado ui-estado--error">Rechazada</span>' : '<span class="ui-estado">Cancelada</span>';
            var acciones = "";
            if (s.estado === "pendiente" && datos.aprueba && s.de_correo !== yo)
                acciones = '<button type="button" class="ui-btn ui-btn--primario ui-btn--28" data-aceptar="' + s.id + '">Aceptar</button>' +
                    '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-rechazar="' + s.id + '">Rechazar</button>';
            else if (s.estado === "pendiente" && s.de_correo === yo)
                acciones = '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-cancelar="' + s.id + '">Cancelar</button>';
            var resuelta = s.resuelta_por && s.estado !== "pendiente" ? " · " + (s.estado === "cancelada" ? "cancelada" : "por " + s.resuelta_por) + " " + fecha(s.resuelta_en) : "";
            return '<li><span class="dp-sol-texto"><b>' + esc(s.tipo_texto) + "</b>" +
                "<span>" + esc(s.nombre || "") + ' <span class="dp-rfc">' + esc(s.rfc) + "</span></span>" +
                "<small>" + (s.de_correo === yo ? "Tú" : esc(s.de_correo)) + " · " + esc(fecha(s.creada)) + esc(resuelta) + "</small>" +
                (s.nota ? '<small class="dp-sol-nota">«' + esc(s.nota) + "»</small>" : "") +
                (s.respuesta ? "<small>Respuesta: " + esc(s.respuesta) + "</small>" : "") + "</span>" +
                '<span class="dp-lado">' + estado + acciones + "</span></li>";
        }).join("") : '<li class="dp-lista__vacio">' + (filtroSol ? "No hay solicitudes pendientes." : "Todavía no hay solicitudes.") + "</li>";
    }

    async function responder(id, acepta, boton) {
        if (!acepta && !(await F.confirmar({ titulo: "¿Rechazar la solicitud?", si: "Rechazar", peligro: true }))) return;
        boton.classList.add("ui-btn--cargando");
        try {
            var r = await pedir("/api/despacho/solicitudes/" + id + "/" + (acepta ? "aceptar" : "rechazar"), { method: "POST", body: {} });
            aviso(acepta ? (r.resultado || "Solicitud aceptada.") : "Solicitud rechazada.");
            await recargar();
            mostrarVista("solicitudes");
        } catch (e) {
            boton.classList.remove("ui-btn--cargando");
            aviso(e.message);
        }
    }

    async function cancelarSolicitud(id, boton) {
        boton.classList.add("ui-btn--cargando");
        try {
            await pedir("/api/despacho/solicitudes/" + id, { method: "DELETE" });
            cargarSolicitudes();
        } catch (e) { boton.classList.remove("ui-btn--cargando"); aviso(e.message); }
    }

    async function pedirAcceso(ev) {
        ev.preventDefault();
        var rfc = $("dp-pedir-rfc").value.trim().toUpperCase(), nota = $("dp-pedir-nota");
        function decir(texto) { nota.textContent = texto; nota.hidden = false; }
        if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return decir("Ese RFC no tiene la forma correcta (12 o 13 caracteres).");
        try {
            var e = await pedir("/api/despacho/existe/" + encodeURIComponent(rfc));
            if (!e.existe) return decir("Esa empresa no está en el despacho. Si es tuya, regístrala en Mi espacio y luego pásala al despacho desde Clientes.");
            if (e.tengo_acceso) return decir("Ya tienes acceso a " + (e.alias || rfc) + ".");
            if (e.solicitud_pendiente) return decir("Ya pediste acceso a " + (e.alias || rfc) + "; está pendiente.");
            var r = await pedir("/api/despacho/solicitudes", { method: "POST", body: { tipo: "acceso", rfc: rfc } });
            $("dp-pedir-rfc").value = "";
            decir(r.estado === "aceptada" ? "Listo: ya tienes acceso a " + (e.alias || rfc) + "." : "Listo: le avisamos al titular. Te llega un aviso cuando responda.");
            cargarSolicitudes();
        } catch (er) { decir(er.message); }
    }

    // ------------------------------------------------------------------ bitácora
    async function cargarBitacora() {
        var sel = $("dp-bit-persona");
        if (sel.options.length <= 1) {
            sel.insertAdjacentHTML("beforeend", datos.equipo.map(function (m) {
                return '<option value="' + esc(m.correo) + '">' + esc(m.nombre || m.correo) + "</option>";
            }).join(""));
        }
        var cuerpo = $("dp-bitacora");
        cuerpo.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
        try {
            var r = await pedir("/api/despacho/bitacora" + (sel.value ? "?correo=" + encodeURIComponent(sel.value) : ""));
            var nombres = {};
            datos.equipo.forEach(function (m) { nombres[m.correo] = m.nombre || m.correo; });
            cuerpo.innerHTML = r.eventos.length ? r.eventos.map(function (e) {
                return "<tr><td>" + esc(fecha(e.en)) + "</td><td>" + esc(nombres[e.correo] || e.correo) + "</td><td>" + esc(e.accion) +
                    (e.detalle ? "<small>" + esc(e.detalle) + "</small>" : "") + '</td><td class="dp-rfc">' + esc((e.rfc || "").replace(/,/g, ", ")) + "</td></tr>";
            }).join("") : '<tr><td colspan="4">Sin movimientos todavía.</td></tr>';
        } catch (e) {
            cuerpo.innerHTML = '<tr><td colspan="4">' + esc(e.message) + "</td></tr>";
        }
    }

    // ------------------------------------------------------------------ ajustes
    function llenarAjustes() {
        var d = datos.despacho;
        $("dp-aj-nombre").value = d.nombre || "";
        $("dp-aj-contacto").value = d.contacto || "";
        $("dp-aj-personal").checked = !d.ajustes || d.ajustes.personal_de_fabrica !== false;
        cargarMigraciones();
    }

    async function guardarAjustes(ev) {
        ev.preventDefault();
        var boton = ev.target.querySelector("[type=submit]");
        boton.classList.add("ui-btn--cargando");
        try {
            datos = await pedir("/api/despacho/ajustes", { method: "PUT", body: { nombre: $("dp-aj-nombre").value.trim(),
                contacto: $("dp-aj-contacto").value.trim(), personal_de_fabrica: $("dp-aj-personal").checked } });
            pintar();
            mostrarVista("ajustes");
            aviso("Ajustes guardados.");
        } catch (e) { aviso(e.message); } finally { boton.classList.remove("ui-btn--cargando"); }
    }

    // ------------------------------------------------------------------ solicitar migración (titular)
    var EST_MIG = { pendiente: ["Pendiente", "aviso"], en_curso: ["En curso", "info"], atendida: ["Atendida", "ok"], rechazada: ["No aprobada", "error"] };
    async function cargarMigraciones() {
        try {
            var l = (await pedir("/api/despacho/migracion")).solicitudes;
            $("dp-mig-lista").innerHTML = l.map(function (s) {
                var e = EST_MIG[s.estado] || [s.estado, ""];
                return "<li><span><b>" + esc(s.origen) + "</b><small>" + (s.empresas ? s.empresas.length + (s.empresas.length === 1 ? " empresa" : " empresas") : "Todas sus empresas") +
                    " · " + esc(fecha(s.creada)) + (s.motivo ? " · " + esc(s.motivo) : "") + '</small></span><span class="ui-estado ui-estado--' + e[1] + '">' + esc(e[0]) + "</span></li>";
            }).join("");
        } catch (e) { $("dp-mig-lista").innerHTML = ""; }
    }
    function errorMig(t) { $("dp-mig-error").textContent = t || ""; $("dp-mig-error").hidden = !t; }
    function abrirMigracion() {
        $("dp-mig-forma").reset(); $("dp-mig-rfcs").hidden = true; errorMig("");
        $("dp-mig-dlg").showModal(); $("dp-mig-origen").focus();
    }
    async function enviarMigracion() {
        var origen = $("dp-mig-origen").value.trim().toLowerCase(), empresas = null;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(origen)) return errorMig("Escribe el correo de la cuenta que entrega las empresas.");
        if (document.querySelector('input[name="dp-mig-cuales"]:checked').value === "algunas") {
            empresas = $("dp-mig-rfcs").value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
            if (!empresas.length) return errorMig("Escribe al menos un RFC.");
        }
        errorMig("");
        $("dp-mig-dlg").close();
        var hecho = await F.confirmarIdentidad("solicitar_migracion", function (c) {
            return pedir("/api/despacho/migracion", { method: "POST", body: { origen: origen, empresas: empresas, nota: $("dp-mig-nota").value.trim(), confirmacion: c } });
        });
        if (hecho) { aviso("Solicitud enviada. Te avisaremos por correo cuando quede atendida."); cargarMigraciones(); }
        else $("dp-mig-dlg").showModal();
    }

    // ------------------------------------------------------------------ invitación y salida
    async function responderInvitacion(acepta) {
        if (!acepta && !(await F.confirmar({ titulo: "¿Rechazar la invitación?", si: "Rechazar", peligro: true }))) return;
        try {
            await pedir("/api/despacho/invitacion/" + (acepta ? "aceptar" : "rechazar"), { method: "POST" });
            if (acepta) { try { sessionStorage.setItem("fc-espacio-cambio", "despacho"); } catch (e) { /* nada */ } }
            location.reload();
        } catch (e) { aviso(e.message); }
    }

    async function salir() {
        var ok = await F.confirmar({ titulo: "¿Salir del despacho «" + datos.despacho.nombre + "»?", peligro: true, si: "Salir",
            texto: "Dejas de ver sus empresas. Lo que pasaste al despacho se queda en el despacho; tu Mi espacio sigue siendo tuyo." });
        if (!ok) return;
        try {
            await pedir("/api/despacho/salir", { method: "POST" });
            location.href = "/";
        } catch (e) { aviso(e.message); }
    }

    // ------------------------------------------------------------------ eventos
    document.querySelector(".dp-vistas").addEventListener("click", function (e) {
        var b = e.target.closest("[data-vista]");
        if (b) mostrarVista(b.dataset.vista);
    });
    document.querySelector(".dp-filtro").addEventListener("click", function (e) {
        var b = e.target.closest("[data-filtro]");
        if (!b) return;
        filtroSol = b.dataset.filtro;
        document.querySelectorAll(".dp-filtro [data-filtro]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
        cargarSolicitudes();
    });
    $("dp-equipo").addEventListener("click", function (e) {
        var b = e.target.closest("[data-editar]");
        if (b) abrirModal(datos.equipo.filter(function (m) { return m.correo === b.dataset.editar; })[0]);
    });
    $("dp-solicitudes").addEventListener("click", function (e) {
        var b = e.target.closest("[data-aceptar],[data-rechazar],[data-cancelar]");
        if (!b) return;
        if (b.dataset.cancelar) cancelarSolicitud(b.dataset.cancelar, b);
        else responder(b.dataset.aceptar || b.dataset.rechazar, !!b.dataset.aceptar, b);
    });
    $("dp-invitar").addEventListener("click", function () { abrirModal(null); });
    $("dp-papel").addEventListener("change", actualizarModal);
    $("dp-forma").addEventListener("change", function (e) { if (e.target.name === "dp-emp" || e.target.name === "dp-mod") actualizarModal(); });
    $("dp-forma").addEventListener("submit", function (e) { e.preventDefault(); guardarModal(); });
    $("dp-empresas-buscar").addEventListener("input", function () {
        var q = this.value.trim().toLowerCase();
        $("dp-empresas").querySelectorAll("[data-buscar]").forEach(function (l) { l.hidden = q && l.dataset.buscar.indexOf(q) < 0; });
    });
    $("dp-guardar").addEventListener("click", guardarModal);
    $("dp-quitar").addEventListener("click", quitar);
    $("dp-modal").addEventListener("click", function (e) { if (e.target.closest("[data-cerrar]") || e.target === this) this.close(); });
    $("dp-pedir").addEventListener("submit", pedirAcceso);
    $("dp-bit-persona").addEventListener("change", cargarBitacora);
    $("dp-ajustes").addEventListener("submit", guardarAjustes);
    $("dp-aceptar").addEventListener("click", function () { responderInvitacion(true); });
    $("dp-rechazar").addEventListener("click", function () { responderInvitacion(false); });
    $("dp-salir").addEventListener("click", salir);
    $("dp-mig-abrir").addEventListener("click", abrirMigracion);
    $("dp-mig-enviar").addEventListener("click", enviarMigracion);
    $("dp-mig-forma").addEventListener("submit", function (e) { e.preventDefault(); enviarMigracion(); });
    $("dp-mig-forma").addEventListener("change", function (e) {
        if (e.target.name === "dp-mig-cuales") { $("dp-mig-rfcs").hidden = e.target.value !== "algunas"; if (!$("dp-mig-rfcs").hidden) $("dp-mig-rfcs").focus(); }
    });
    $("dp-mig-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-mig-cerrar]")) this.close(); });

    cargar();
})();
