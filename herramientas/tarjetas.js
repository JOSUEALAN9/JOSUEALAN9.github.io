/* Antes iba en línea en la página (17-nov-2026: las páginas ya no llevan código en línea). */
    (function () {
        // Las tarjetas salen del mismo catálogo que el menú «Módulos» y la portada (barra.js)
        var esc = Fiscontable.escapar;
        function svg(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }
        function sinAcentos(t) { return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
        var motivo = null;
        function pintar() {
            var q = sinAcentos(document.getElementById("buscar-herramienta").value.trim());
            var cat = (Fiscontable.catalogo || []).filter(function (m) { return !m.cuenta && !m.soloAdmin && !m.reservado && m.clave !== "clientes" &&
                (!Fiscontable.verModulo || Fiscontable.verModulo(m)); });          // lo que el titular del despacho no te dio, ni se ve
            var grupos = (Fiscontable.grupos || []).slice(), html = "", n = 0;
            grupos.forEach(function (g) {
                var items = cat.filter(function (m) { return m.grupo === g && (!q || sinAcentos(m.nombre + " " + m.desc + " " + g).indexOf(q) !== -1); });
                if (!items.length) return;
                n += items.length;
                html += '<h2 class="grupo">' + esc(g) + '</h2><div class="rejilla">' + items.map(function (m) {
                    var ok = !motivo && Fiscontable.permitido(m);
                    var porPlan = !ok && !motivo;          // sin conexión o acceso vencido no es cosa del plan
                    return '<a href="' + esc(m.url) + '" class="util' + (ok ? "" : " util--vedado") + '" style="--tono:' + m.tono + ";--tono-suave:" + m.suave + '"' +
                        (ok ? "" : porPlan ? ' data-plan="' + esc(m.clave) + '"' : ' aria-disabled="true" data-fc-quieto title="' + esc(motivo) + '"') + ">" +
                        (porPlan ? '<span class="util__cinta util__cinta--plan">🔒 No incluido en tu plan</span>' : "") +
                        '<span class="util__icono">' + svg(m.icono) + "</span><h3>" + esc(m.nombre) + "</h3><p>" + esc(m.desc) + '.</p><span class="util__cta">' +
                        (ok ? "Abrir" : porPlan ? "Mejorar mi plan →" : "No disponible") + "</span></a>";
                }).join("") + "</div>";
            });
            document.getElementById("herramientas-lista").innerHTML = html;
            document.getElementById("sin-resultados").hidden = n > 0;
            // Resumen del plan (solo si hay algo bloqueado) y próximos desarrollos
            var p = perfil, bloqueados = p && !motivo ? cat.filter(function (m) { return !Fiscontable.permitido(m); }).length : 0;
            var caja = document.getElementById("plan-resumen");
            caja.hidden = !bloqueados || !!q;
            if (bloqueados) caja.innerHTML = "<span>Tu plan: <b>" + esc(Fiscontable.nombrePlan() || "actual") + "</b> · incluye " + (cat.length - bloqueados) + " de " + cat.length +
                " herramientas.</span><button type=\"button\" id=\"btn-mejorar\">Mejorar mi plan</button>";
            var prox = (p && p.planes && p.planes.proximos) || [];
            document.getElementById("proximos").hidden = !prox.length || !!q;
            document.getElementById("proximos-lista").innerHTML = prox.map(function (x) {
                return '<div class="util util--futuro">' + (x.etiqueta ? '<span class="util__etiqueta">' + esc(x.etiqueta) + "</span>" : "") +
                    "<h3>" + esc(x.titulo) + "</h3>" + (x.desc ? "<p>" + esc(x.desc) + "</p>" : "") + "</div>";
            }).join("");
        }
        var perfil = null;
        document.getElementById("plan-resumen").addEventListener("click", function (e) {
            if (!e.target.closest("#btn-mejorar")) return;
            var primero = document.querySelector("#herramientas-lista [data-plan]");
            Fiscontable.avisoPlan(primero ? primero.dataset.plan : null);
        });
        document.getElementById("buscar-herramienta").addEventListener("input", pintar);
        document.getElementById("buscar-herramienta").addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            var a = document.querySelector("#herramientas-lista .util:not(.util--vedado)");
            if (a) location.href = a.getAttribute("href");
        });
        document.addEventListener("fc:perfil", function (e) {
            var p = e.detail;
            perfil = p;
            var inv = Fiscontable.invitacionPendiente && Fiscontable.invitacionPendiente();
            motivo = !p ? "No disponible sin conexión al servidor" : inv ? "Primero acepta la invitación al despacho «" + inv.despacho + "»." :
                p.solo_lectura ? "Tu acceso venció." : null;
            pintar();
        });
        pintar();
    })();
