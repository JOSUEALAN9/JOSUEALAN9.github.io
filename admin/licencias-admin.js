/*
 * admin/licencias-admin.js — Pestaña Licencias de Administración: emitir claves (individuales, de despacho o lugares extra
 * para un despacho), ver quién las activó y hasta cuándo, y cancelarlas. Las claves completas se ven una sola vez, al emitirlas.
 * 20-nov-2026 (noche 10):
 *   · El renglón de una licencia sin usar a la que ya se le mandó la bienvenida o el enlace dice «Esperando que cree su cuenta
 *     (correo enviado el DD/MM a las HH:MM)» (lo arma el servidor: core/bienvenida.esperando).
 *   · «Acceso» en ese renglón: genera el enlace para crear la cuenta (con la licencia) y lo deja listo para WhatsApp.
 *   · «Mandar bienvenida» por pasos: contribuyente → su factura → clave y correo → resumen con «Mandar» y «Corregir».
 *   · Tipo «Lugares extra» (auditoría H9): suma lugares a un despacho sin dar meses ni timbres.
 */
(function () {
    "use strict";
    var API = Fiscontable.API, esc = Fiscontable.escapar;
    var $ = function (id) { return document.getElementById(id); };
    var datos = null, filtro = "", claves = [];
    var ESTADOS = { disponible: ["Sin usar", ""], activa: ["Activa", "ok"], vencida: ["Vencida", "aviso"], caducada: ["Caducó sin usar", "aviso"], revocada: ["Cancelada", "error"] };

    async function api(ruta, metodo, cuerpo) {
        var r = await fetch(API + ruta, { method: metodo || "GET", credentials: "include",
            headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (!r.ok) throw new Error(await Fiscontable.leerError(r));
        return r.json();
    }
    function avisar(tipo, texto) { if (typeof mostrarAlerta === "function") mostrarAlerta(tipo, texto); else Fiscontable.avisar(texto); }
    function fecha(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
    function dinero(n) { return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function copiar(texto, boton, listo) {
        var antes = boton.textContent;
        navigator.clipboard.writeText(texto).then(function () { boton.textContent = listo || "Copiado ✓"; setTimeout(function () { boton.textContent = antes; }, 1800); },
            function () { avisar("error", "No se pudo copiar: selecciónalo y cópialo a mano."); });
    }

    async function cargar() {
        try { datos = await api("/api/admin/licencias" + (filtro ? "?estado=" + filtro : "")); } catch (e) { avisar("error", e.message); return; }
        pintar();
    }

    function pintar() {
        var lista = datos.licencias;
        if (!filtro) $("cuenta-licencias").textContent = lista.length ? "(" + lista.length + ")" : "";
        $("lca-vacio").classList.toggle("hidden", lista.length > 0);
        var planes = {};
        datos.planes.forEach(function (p) { planes[p.clave] = p.nombre; });
        $("lca-lista").innerHTML = lista.map(function (l) {
            var e = ESTADOS[l.estado] || [l.estado, ""], espera = l.espera, lugares = l.tipo === "lugares";
            var tipo = lugares ? " · +" + l.asientos + (l.asientos === 1 ? " lugar" : " lugares") : (l.tipo === "despacho" ? " · " + l.asientos + " lugares" : "");
            var cuenta = l.activada_por ? esc(l.activada_por) + (l.cuenta && l.cuenta !== l.activada_por ? '<span class="lc-tenue">cuenta del despacho</span>' : "")
                : espera ? esc(espera.correo) + '<span class="lc-tenue">' + (espera.tiene_cuenta ? "ya tiene cuenta" : "aún sin cuenta") + "</span>" : "—";
            var acciones = (l.estado === "disponible" || l.estado === "activa" ?
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-bienvenida>Bienvenida</button> ' : "") +
                (l.estado === "disponible" || l.estado === "activa" || l.estado === "vencida" ?
                    '<button type="button" class="ui-btn ui-btn--terciario ui-btn--28" data-revocar="' + l.id + '" data-activa="' + (l.estado !== "disponible" ? 1 : 0) +
                    '" data-lugares="' + (lugares ? 1 : 0) + '">Cancelar</button>' : "");
            // Solo «…XXXX» (20-nov-2026): la clave completa nunca se ve aquí
            return '<tr class="border-t border-gray-100' + (espera ? " lc-con-espera" : "") + '">' +
                '<td class="p-4 font-mono text-xs whitespace-nowrap" title="' + esc(l.clave) + '">…' + esc(l.ultimos || l.clave.slice(-4)) + "</td>" +
                '<td class="p-4 lc-col-tipo">' + esc(datos.tipos[l.tipo] || l.tipo) + "<div class=\"text-xs text-slate-500\">" + esc(planes[l.plan] || l.rol) + esc(tipo) + "</div>" +
                    (l.nota ? '<div class="lc-nota">' + esc(l.nota) + "</div>" : "") + "</td>" +
                '<td class="p-4 whitespace-nowrap">' + (lugares ? "La del despacho" : l.meses + (l.meses === 1 ? " mes" : " meses")) + "</td>" +
                '<td class="p-4"><span class="ui-estado' + (e[1] ? " ui-estado--" + e[1] : (espera ? " ui-estado--aviso" : "")) + '">' + esc(e[0]) + "</span></td>" +
                '<td class="p-4 text-xs">' + cuenta + "</td>" +
                '<td class="p-4 lc-col-vence">' + (l.vence_en ? fecha(l.vence_en) : (l.caduca ? "Activar antes del " + fecha(l.caduca) : "—")) + "</td>" +
                '<td class="p-4"><div class="lc-acciones">' + acciones + "</div></td></tr>" +
                // 20-nov-2026: la que espera que creen la cuenta lleva su renglón de estado y «Acceso» (enlace para WhatsApp)
                (espera ? '<tr class="lc-fila-espera"><td colspan="7"><div class="lc-espera" data-espera><span>' + esc(espera.texto) +
                    (espera.tiene_cuenta ? "" : " · " + esc(espera.correo)) + "</span>" +
                    (!espera.tiene_cuenta && !lugares ? '<button type="button" class="ui-btn ui-btn--secundario ui-btn--28" data-acceso="' + l.id +
                        '" title="Enlace para crear su cuenta, para mandarlo por WhatsApp">Acceso</button>' : "") + "</div></td></tr>" : "");
        }).join("");
        anchoVisible();
    }
    // El renglón «Esperando…» se queda en la parte visible de la tabla aunque esta se deslice a lo ancho (celular)
    function anchoVisible() {
        var caja = $("lca-lista").closest(".overflow-x-auto");
        if (caja && caja.clientWidth) $("lca-lista").style.setProperty("--lc-visible", (caja.clientWidth - 32) + "px");
    }
    window.addEventListener("resize", function () { if (datos) anchoVisible(); });

    // ---------------------------------------------------------------- emitir
    function tipoElegido() { return document.querySelector('input[name="lca-tipo"]:checked').value; }

    function abrirEmitir() {
        claves = [];
        $("lca-forma").reset();
        $("lca-plan").innerHTML = datos.planes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + "</option>"; }).join("") ||
            '<option value="">Pro</option>';
        $("lca-meses").innerHTML = datos.meses.map(function (m) { return '<option value="' + m + '"' + (m === 12 ? " selected" : "") + ">" + m + (m === 1 ? " mes" : " meses") + "</option>"; }).join("");
        ["lca-resultado", "lca-copiar", "lca-bajar", "lca-bienvenida", "lca-error"].forEach(function (id) { $(id).hidden = true; });
        $("lca-crear").hidden = false; $("lca-cancelar").textContent = "Cancelar";
        [].forEach.call($("lca-forma").querySelectorAll("input,select"), function (x) { x.disabled = false; });
        tipoCambio();
        $("lca-dlg").showModal();
    }

    function tipoCambio() {
        var tipo = tipoElegido(), despacho = tipo === "despacho", lugares = tipo === "lugares";
        $("lca-campo-asientos").hidden = !(despacho || lugares);
        $("lca-campo-cantidad").hidden = despacho || lugares;
        $("lca-campo-meses").hidden = lugares;
        $("lca-ayuda-lugares").hidden = !lugares;
        $("lca-etq-asientos").textContent = lugares ? "Lugares a sumar" : "Licencias del despacho (mínimo 5)";
        var a = $("lca-asientos");
        a.min = lugares ? 1 : 5;
        if (lugares && (+a.value === 5 || !a.value)) a.value = 1;
        if (despacho && +a.value < 5) a.value = 5;
        if (despacho || lugares) { var pd = datos.planes.filter(function (p) { return /despacho/i.test(p.clave); })[0]; if (pd) $("lca-plan").value = pd.clave; }
    }

    async function emitir() {
        var tipo = tipoElegido(), equipo = tipo === "despacho" || tipo === "lugares";
        var cuerpo = { tipo: tipo, plan: $("lca-plan").value || null, meses: tipo === "lugares" ? 0 : +$("lca-meses").value,
                       asientos: equipo ? +$("lca-asientos").value : 1, cantidad: equipo ? 1 : +$("lca-cantidad").value,
                       nota: $("lca-nota").value.trim(), caduca_dias: $("lca-caduca").value ? +$("lca-caduca").value : null };
        var b = $("lca-crear");
        b.classList.add("ui-btn--cargando"); b.disabled = true;
        $("lca-error").hidden = true;
        try {
            claves = (await api("/api/admin/licencias", "POST", cuerpo)).claves;
            $("lca-claves").textContent = claves.join("\n");
            $("lca-resultado").hidden = false;
            $("lca-copiar").hidden = $("lca-bajar").hidden = false;
            $("lca-bienvenida").hidden = claves.length !== 1;
            $("lca-crear").hidden = true; $("lca-cancelar").textContent = "Listo";
            [].forEach.call($("lca-forma").querySelectorAll("input,select"), function (x) { x.disabled = true; });
            $("lca-dlg-sub").textContent = claves.length === 1 ? "Esta es la clave." : "Estas son las " + claves.length + " claves.";
            cargar();
        } catch (e) { $("lca-error").textContent = e.message; $("lca-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    }

    async function revocar(id, activa, lugares) {
        var terminar = false;
        if (lugares && activa) {
            if (!(await Fiscontable.preguntar("¿Cancelar estos lugares extra? Se quitan del despacho. Su vigencia, sus timbres y su entrada no cambian."))) return;
        } else if (activa) {
            if (!(await Fiscontable.preguntar("¿Cancelar esta licencia? Ya está en uso."))) return;
            // 19-nov-2026, el dueño: terminar el acceso = ya no entran (ni su equipo, si es de un despacho) y ven por qué
            terminar = (await Fiscontable.preguntar("¿También le cierras la entrada hoy mismo?\n\nAceptar = ya no entra (si es de un despacho, tampoco su equipo, salvo quien tenga licencia propia): se cierran sus sesiones y al intentar entrar ve «La licencia … terminó».\nCancelar = sigue entrando hasta que venza la vigencia que ya tenía."));
        } else if (!(await Fiscontable.preguntar("¿Cancelar esta clave? Ya no se podrá activar."))) return;
        try {
            var r = await api("/api/admin/licencias/" + id + "/revocar", "POST", { terminar_acceso: terminar });
            if (r.lugares != null) avisar("success", "Listo: el despacho queda con " + r.lugares + " lugares.");
            cargar();
        } catch (e) { avisar("error", e.message); }
    }

    $("lca-emitir").addEventListener("click", async function () { if (!datos) await cargar(); abrirEmitir(); });
    $("lca-crear").addEventListener("click", emitir);
    $("lca-forma").addEventListener("change", function (e) { if (e.target.name === "lca-tipo") tipoCambio(); });
    $("lca-forma").addEventListener("submit", function (e) { e.preventDefault(); });
    $("lca-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-lca-cerrar]") || e.target === this) this.close(); });
    $("lca-copiar").addEventListener("click", function () { copiar(claves.join("\n"), this, "Copiadas ✓"); });
    $("lca-bajar").addEventListener("click", function () {
        var nota = $("lca-nota").value.trim();
        var texto = "Licencias de Fiscontable" + (nota ? " · " + nota : "") + "\nActívalas en https://fiscontable.app/activar\n\n" + claves.join("\n") + "\n";
        Fiscontable.guardarArchivo ? Fiscontable.guardarArchivo(new Blob([texto], { type: "text/plain" }), "licencias-fiscontable.txt")
            : (function () { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([texto], { type: "text/plain" })); a.download = "licencias-fiscontable.txt"; a.click(); })();
    });
    $("lca-filtro").addEventListener("click", function (e) {
        var b = e.target.closest("[data-estado]");
        if (!b) return;
        filtro = b.dataset.estado;
        [].forEach.call(this.querySelectorAll("[data-estado]"), function (x) { x.setAttribute("aria-selected", String(x === b)); });
        cargar();
    });
    $("lca-lista").addEventListener("click", function (e) {
        var b = e.target.closest("[data-revocar]");
        if (b) return revocar(b.dataset.revocar, b.dataset.activa === "1", b.dataset.lugares === "1");
        if (e.target.closest("[data-bienvenida]")) return abrirBienvenida("");
        var a = e.target.closest("[data-acceso]");
        if (a) abrirAcceso(+a.dataset.acceso);
    });

    /* ---------------------------------------------------- bienvenida por pasos (20-nov-2026): correo con diseño, clave y factura */
    var bv = { paso: 1, contribuyentes: [], quien: null, facturas: [], factura: null, sinFactura: false, resumen: null, enviada: false };

    function irPaso(n) {
        bv.paso = n;
        [].forEach.call($("lcb-forma").querySelectorAll("[data-paso]"), function (p) { p.hidden = +p.dataset.paso !== n; });
        [].forEach.call($("lcb-pasos").querySelectorAll("[data-ir]"), function (b) {
            var k = +b.dataset.ir;
            b.setAttribute("aria-selected", String(k === n));
            b.classList.toggle("lc-hecho", k < n);
            b.disabled = bv.enviada || k > n || (k === 2 && bv.sinFactura);
        });
        $("lcb-error").hidden = true;
        if (!bv.enviada) $("lcb-ok").hidden = true;
        $("lcb-atras").hidden = n === 1 || bv.enviada;
        $("lcb-atras").textContent = n === 4 ? "Corregir" : "Anterior";
        $("lcb-revisar").hidden = n !== 3;
        $("lcb-mandar").hidden = n !== 4 || bv.enviada;
        $("lcb-prueba").hidden = !(n === 3 || n === 4) || bv.enviada;
        $("lcb-cerrar").textContent = bv.enviada ? "Listo" : "Cerrar";
        $("lcb-cerrar").hidden = !bv.enviada && n >= 3;           // en 3 y 4 cierra la ✕: así caben los botones en el celular
        var de = bv.quien ? "<b>" + esc(bv.quien.nombre) + "</b> · " + esc(bv.quien.rfc) : "";
        $("lcb-de").innerHTML = de ? "Facturas de " + de : "";
        $("lcb-de3").innerHTML = bv.sinFactura ? "Sin factura adjunta." :
            (bv.factura ? "Para " + de + " · factura <b>" + esc(bv.factura.serie_folio) + "</b> (" + esc(dinero(bv.factura.total)) + ")" : "");
        if (n === 1) setTimeout(function () { $("lcb-buscar").focus(); }, 0);
        if (n === 3) setTimeout(function () { ($("lcb-clave").value ? $("lcb-correo") : $("lcb-clave")).focus(); }, 0);
    }

    function pintarContribuyentes() {
        var q = $("lcb-buscar").value.trim().toLowerCase();
        var lista = bv.contribuyentes.filter(function (c) { return !q || (c.nombre + " " + c.rfc).toLowerCase().indexOf(q) >= 0; });
        $("lcb-contribuyentes").innerHTML = lista.length ? lista.map(function (c) {
            return '<li><button type="button" data-rfc="' + esc(c.rfc) + '" aria-pressed="' + String(!!(bv.quien && bv.quien.rfc === c.rfc)) + '">' +
                '<span class="lc-op__texto"><b>' + esc(c.nombre) + "</b><small>" + esc(c.rfc) + " · " + c.facturas + (c.facturas === 1 ? " factura" : " facturas") +
                " · la última del " + esc(fecha(c.ultima)) + "</small></span></button></li>";
        }).join("") : '<li class="lc-vacio">' + (bv.contribuyentes.length ? "Nadie coincide con «" + esc(q) + "»." :
            "Aún no tienes facturas timbradas. Puedes mandarla sin factura.") + "</li>";
    }

    function pintarFacturas() {
        $("lcb-facturas").innerHTML = (bv.facturas.length ? bv.facturas.map(function (f) {
            return '<li><button type="button" data-factura="' + esc(f.id) + '" aria-pressed="' + String(!!(bv.factura && bv.factura.id === f.id)) + '">' +
                '<span class="lc-op__texto"><b>' + esc(f.serie_folio || "Sin folio") + "</b><small>" + esc(fecha(f.fecha)) + (f.pruebas ? " · de pruebas" : "") + "</small></span>" +
                '<span class="lc-op__lado">' + esc(dinero(f.total)) + "</span></button></li>";
        }).join("") : '<li class="lc-vacio">Ese contribuyente no tiene facturas timbradas.</li>') +
            '<li><button type="button" data-factura=""><span class="lc-op__texto"><b>Sin factura</b><small>Mandar solo la bienvenida y la clave</small></span></button></li>';
    }

    async function abrirBienvenida(clave) {
        bv = { paso: 1, contribuyentes: [], quien: null, facturas: [], factura: null, sinFactura: false, resumen: null, enviada: false };
        $("lcb-clave").value = clave || ""; $("lcb-correo").value = ""; $("lcb-nombre").value = ""; $("lcb-buscar").value = "";
        $("lcb-correo-ayuda").hidden = true; $("lcb-ok").hidden = true;
        $("lcb-contribuyentes").innerHTML = '<li class="lc-vacio">Cargando…</li>';
        irPaso(1);
        $("lcb-dlg").showModal();
        try { bv.contribuyentes = (await api("/api/admin/licencias/contribuyentes")).contribuyentes || []; }
        catch (e) { bv.contribuyentes = []; }
        pintarContribuyentes();
    }

    async function elegirContribuyente(rfc) {
        bv.quien = bv.contribuyentes.filter(function (c) { return c.rfc === rfc; })[0] || null;
        bv.sinFactura = false; bv.factura = null;
        if (!bv.quien) return;
        if (bv.quien.correo && !$("lcb-correo").value) { $("lcb-correo").value = bv.quien.correo; $("lcb-correo-ayuda").hidden = false; }
        bv.facturas = [];
        $("lcb-facturas").innerHTML = '<li class="lc-vacio">Cargando…</li>';
        irPaso(2);
        try { bv.facturas = (await api("/api/admin/licencias/facturas?rfc=" + encodeURIComponent(rfc))).facturas || []; } catch (e) { bv.facturas = []; }
        pintarFacturas();
    }

    function cuerpoBienvenida(prueba) {
        return { clave: $("lcb-clave").value.trim(), correo: $("lcb-correo").value.trim(), nombre: $("lcb-nombre").value.trim(),
                 factura_id: bv.factura ? bv.factura.id : null, prueba: !!prueba };
    }

    function pintarResumen(r) {
        var filas = [["A quién", bv.quien ? esc(bv.quien.nombre) + '<small class="lc-mono">' + esc(bv.quien.rfc) + "</small>" : (r.nombre ? esc(r.nombre) : "—")],
                     ["Correo", esc(r.correo) + (r.nombre ? "<small>Saludo: «Hola, " + esc(r.nombre) + "»</small>" : "")],
                     ["Plan", esc(r.plan) + '<small class="lc-mono">Clave ' + esc(r.clave) + "</small>"],
                     [r.tipo === "lugares" ? "Lugares extra" : "Licencias", String(r.licencias)]];
        if (r.tipo !== "lugares") filas.push(["Meses", r.meses + " desde que la active"], ["Empresas (RFC)", r.rfc != null ? String(r.rfc) : "—"],
                                              ["Timbres", r.timbres ? Number(r.timbres).toLocaleString("es-MX") : "Ninguno incluido"]);
        else filas.push(["Vigencia", "La del despacho (no da meses ni timbres)"]);
        filas.push(["Factura adjunta", r.factura ? esc(r.factura.serie_folio) + " · " + esc(dinero(r.factura.total)) + "<small>PDF y XML · del " + esc(fecha(r.factura.fecha)) + "</small>" : "Sin factura"]);
        $("lcb-resumen").innerHTML = filas.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + f[1] + "</dd>"; }).join("");
    }

    async function revisar() {
        var b = $("lcb-revisar");
        $("lcb-error").hidden = true;
        if (!$("lcb-clave").value.trim()) { $("lcb-error").textContent = "Pega la clave completa, como salió al emitirla."; $("lcb-error").hidden = false; return; }
        b.classList.add("ui-btn--cargando"); b.disabled = true;
        try {
            bv.resumen = await api("/api/admin/licencias/bienvenida/resumen", "POST", cuerpoBienvenida(false));
            pintarResumen(bv.resumen);
            irPaso(4);
        } catch (e) { $("lcb-error").textContent = e.message; $("lcb-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    }

    async function mandarBienvenida(prueba) {
        var b = $(prueba ? "lcb-prueba" : "lcb-mandar");
        $("lcb-error").hidden = $("lcb-ok").hidden = true;
        b.classList.add("ui-btn--cargando"); b.disabled = true;
        try {
            var r = await api("/api/admin/licencias/bienvenida", "POST", cuerpoBienvenida(prueba));
            $("lcb-ok").textContent = prueba ? "Te mandamos la prueba a tu correo (" + r.para + "). Revisa cómo se ve y luego da «" + (bv.paso === 4 ? "Mandar" : "Revisar") + "»." :
                "Listo: la bienvenida salió a " + r.para + (r.factura ? ", con la factura " + r.factura + "." : ".") +
                " Mientras no cree su cuenta, la licencia dirá «Esperando que cree su cuenta».";
            $("lcb-ok").hidden = false;
            if (!prueba) { bv.enviada = true; irPaso(4); cargar(); }
        } catch (e) { $("lcb-error").textContent = e.message; $("lcb-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    }

    $("lca-bienvenida").addEventListener("click", function () { $("lca-dlg").close(); abrirBienvenida(claves[0]); });
    $("lcb-buscar").addEventListener("input", pintarContribuyentes);
    $("lcb-buscar").addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var p = $("lcb-contribuyentes").querySelector("[data-rfc]");
        if (p) elegirContribuyente(p.dataset.rfc);
    });
    $("lcb-contribuyentes").addEventListener("click", function (e) { var b = e.target.closest("[data-rfc]"); if (b) elegirContribuyente(b.dataset.rfc); });
    $("lcb-facturas").addEventListener("click", function (e) {
        var b = e.target.closest("[data-factura]");
        if (!b) return;
        bv.factura = bv.facturas.filter(function (f) { return f.id === b.dataset.factura; })[0] || null;
        irPaso(3);
    });
    $("lcb-sin-factura").addEventListener("click", function () { bv.quien = null; bv.factura = null; bv.sinFactura = true; irPaso(3); });
    $("lcb-pasos").addEventListener("click", function (e) { var b = e.target.closest("[data-ir]"); if (b && !b.disabled) irPaso(+b.dataset.ir); });
    $("lcb-atras").addEventListener("click", function () { irPaso(bv.paso === 4 ? 3 : (bv.paso === 3 && bv.sinFactura ? 1 : bv.paso - 1)); });
    $("lcb-revisar").addEventListener("click", revisar);
    $("lcb-prueba").addEventListener("click", function () { mandarBienvenida(true); });
    $("lcb-mandar").addEventListener("click", function () { mandarBienvenida(false); });
    $("lcb-forma").addEventListener("submit", function (e) { e.preventDefault(); if (bv.paso === 3) revisar(); });
    $("lcb-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-lcb-cerrar]") || e.target === this) this.close(); });

    /* ---------------------------------------------------- «Acceso» (20-nov-2026): enlace para crear la cuenta, por WhatsApp */
    var acceso = { id: null, r: null };
    function abrirAcceso(id) {
        var l = (datos.licencias || []).filter(function (x) { return x.id === id; })[0];
        if (!l) return;
        acceso = { id: id, r: null };
        $("lce-sub").textContent = "Licencia " + l.clave.replace(/^FSC-[·\-]+/, "…") + ". Con el enlace crea su contraseña y la licencia se activa sola.";
        $("lce-correo").value = (l.espera && l.espera.correo) || "";
        $("lce-correo").disabled = false;
        ["lce-resultado", "lce-error", "lce-copiar", "lce-copiar-enlace", "lce-whatsapp"].forEach(function (k) { $(k).hidden = true; });
        $("lce-generar").hidden = false;
        $("lce-dlg").showModal();
        $("lce-correo").focus();
    }
    async function generarAcceso() {
        var b = $("lce-generar");
        $("lce-error").hidden = true;
        b.classList.add("ui-btn--cargando"); b.disabled = true;
        try {
            var r = acceso.r = await api("/api/admin/licencias/" + acceso.id + "/enlace", "POST", { correo: $("lce-correo").value.trim() });
            $("lce-enlace").textContent = r.enlace;
            $("lce-vence").textContent = "Vence el " + r.vence_texto + " (" + r.horas + " horas) y sirve una sola vez. Uno nuevo deja sin efecto el anterior.";
            $("lce-resultado").hidden = false;
            $("lce-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(r.mensaje);
            ["lce-copiar", "lce-copiar-enlace", "lce-whatsapp"].forEach(function (k) { $(k).hidden = false; });
            b.hidden = true; $("lce-correo").disabled = true;
            cargar();
        } catch (e) { $("lce-error").textContent = e.message; $("lce-error").hidden = false; }
        finally { b.classList.remove("ui-btn--cargando"); b.disabled = false; }
    }
    $("lce-generar").addEventListener("click", generarAcceso);
    $("lce-forma").addEventListener("submit", function (e) { e.preventDefault(); if (!$("lce-generar").hidden) generarAcceso(); });
    $("lce-copiar").addEventListener("click", function () { if (acceso.r) copiar(acceso.r.mensaje, this); });
    $("lce-copiar-enlace").addEventListener("click", function () { if (acceso.r) copiar(acceso.r.enlace, this); });
    $("lce-dlg").addEventListener("click", function (e) { if (e.target.closest("[data-lce-cerrar]") || e.target === this) this.close(); });

    window.LicenciasAdmin = { cargar: cargar };
})();
