/**
 * modulo-sat.js — Lógica compartida entre Constancias y Opinión 32-D.
 *
 * Los dos módulos eran archivos de ~1000 líneas con solo 21 líneas de
 * diferencia entre sí (nombres, endpoints y colores). Todo lo demás
 * -- jobs, caché, permisos, e.firma guardada, lote masivo, progreso --
 * era idéntico y estaba duplicado, así que cualquier arreglo había que
 * hacerlo dos veces. Ya nos pasó con el bug del botón "Actualizar".
 *
 * Ahora esa lógica vive aquí una sola vez, y cada módulo solo declara
 * su configuración en una constante MODULO antes de cargar este
 * archivo:
 *
 *   const MODULO = {
 *       slug: "constancia",        // para las URLs del backend
 *       tipo: "csf",               // tipo de documento en el caché
 *       permiso: "constancias",    // nombre del módulo en los permisos
 *       nombre: "Constancias",     // para los mensajes al usuario
 *       prefijoArchivo: "CSF",     // nombre del PDF descargado
 *   };
 */


        const API_URL = "https://api.josuealan.com";
        let archivosGlobalesMasivo = [];

        // Antes de mostrar cualquier formulario, confirmamos que el usuario
        // pueda usar este módulo. Sin esto, alguien con el acceso vencido
        // llenaba todo el formulario para que el servidor lo rechazara al
        // final -- es peor experiencia que decírselo desde el principio.
        function bloquearModulo(mensaje) {
            document.querySelectorAll("#form-individual, #form-masivo, #panel-cliente-detectado")
                .forEach(el => { el.classList.add("hidden"); el.classList.remove("flex"); });
            document.querySelector(".flex.border-b.bg-slate-50")?.classList.add("hidden");
            document.getElementById("panel-bloqueo-texto").textContent = mensaje;
            const panel = document.getElementById("panel-bloqueo");
            panel.classList.remove("hidden");
            panel.classList.add("flex");
        }

        async function verificarPermisos() {
            try {
                const resp = await fetch(`${API_URL}/api/mi-perfil`, { credentials: "include" });

                if (resp.status === 401 || resp.status === 403) {
                    bloquearModulo("Tu sesión expiró. Recarga la página para iniciar sesión de nuevo.");
                    return false;
                }
                if (!resp.ok) {
                    bloquearModulo("No pudimos conectar con el servidor. Intenta de nuevo más tarde o contacta al administrador.");
                    return false;
                }

                const perfil = await resp.json();

                if (perfil.solo_lectura) {
                    bloquearModulo("Tu acceso venció. No puedes generar documentos hasta que se renueve. Contacta al administrador.");
                    return false;
                }
                if (!(perfil.modulos_permitidos || []).includes(MODULO.permiso)) {
                    bloquearModulo(`Tu plan actual no incluye el módulo de ${MODULO.nombre}. Contacta al administrador si necesitas acceso.`);
                    return false;
                }
                return true;
            } catch (error) {
                bloquearModulo("No pudimos conectar con el servidor. Verifica tu conexión, intenta de nuevo más tarde o contacta al administrador.");
                return false;
            }
        }

        // --- Llegada desde el módulo "Clientes" (?rfc=...&cliente=...) ---
        const parametros = new URLSearchParams(window.location.search);
        const rfcDesdeCliente = parametros.get("rfc");
        const nombreCliente = parametros.get("cliente");

        async function verificarCacheAlEntrar() {
            if (!rfcDesdeCliente) return; // uso normal de Herramientas Rápidas, sin cambios

            const campoRFC = document.getElementById("rfc");
            campoRFC.value = rfcDesdeCliente.toUpperCase();
            campoRFC.readOnly = true;
            campoRFC.classList.add("campo-solo-lectura");

            await revisarSiEsCliente(rfcDesdeCliente.toUpperCase());
            await revisarEstadoDelRFC(rfcDesdeCliente, nombreCliente);
        }

        function mostrarFormularioGeneracion() {
            document.getElementById("panel-cliente-detectado").classList.add("hidden");
            document.getElementById("panel-cliente-detectado").classList.remove("flex");
            document.getElementById("panel-efirma-guardada").classList.add("hidden");
            document.getElementById("panel-efirma-guardada").classList.remove("flex");
            document.getElementById("form-individual").classList.remove("hidden");
        }

        function manejarActualizar() {
            const panelCache = document.getElementById("panel-cliente-detectado");
            panelCache.classList.add("hidden");
            panelCache.classList.remove("flex");

            if (efirmaGuardadaActual) {
                // El botón y la barra de progreso viven dentro de este
                // panel, así que hay que mostrarlo ANTES de arrancar --
                // si no, se ocultan los tres paneles y la pantalla queda
                // vacía aunque el proceso sí esté corriendo.
                const panelEfirma = document.getElementById("panel-efirma-guardada");
                panelEfirma.classList.remove("hidden");
                panelEfirma.classList.add("flex");
                generarConEfirmaGuardada();
            } else {
                mostrarFormularioGeneracion();
            }
        }

        async function generarConEfirmaGuardada() {
            if (trabajosEnCurso[rfcActivo]) {
                mostrarAlerta("error", "Ya se está generando este documento, espera a que termine.");
                return;
            }
            ocultarAlerta();

            const boton = document.getElementById("btn-generar-efirma-guardada");
            const originalHTML = boton.innerHTML;
            toggleLoadingState("btn-generar-efirma-guardada", true, originalHTML);

            try {
                const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcActivo)}/generar-${MODULO.slug}`, {
                    method: "POST",
                    credentials: "include",
                });
                if (!resp.ok) {
                    toggleLoadingState("btn-generar-efirma-guardada", false, originalHTML);
                    mostrarAlerta("error", await interpretarError(resp));
                    return;
                }
                const { job_id } = await resp.json();
                monitorearTrabajo(job_id, "efirma-guardada", rfcActivo, "btn-generar-efirma-guardada", originalHTML);
            } catch (error) {
                toggleLoadingState("btn-generar-efirma-guardada", false, originalHTML);
                mostrarAlerta("error", await interpretarError(null));
            }
        }

        async function descargarDesdeCache() {
            const boton = document.getElementById("btn-descargar-cache");
            const originalHTML = boton.innerHTML;
            boton.disabled = true;
            boton.innerHTML = "Descargando...";
            try {
                const resp = await fetch(`${API_URL}/api/documentos/descargar?rfc=${encodeURIComponent(rfcActivo)}&tipo=${MODULO.tipo}`, {
                    credentials: "include",
                });
                if (!resp.ok) {
                    mostrarAlerta("error", "No se pudo descargar el documento en caché. Intenta 'Actualizar' para generar uno nuevo.");
                    return;
                }
                const blob = await resp.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${MODULO.prefijoArchivo}_${rfcActivo}.pdf`;
                a.click();
            } catch (error) {
                mostrarAlerta("error", "No se pudo conectar con el servidor para descargar el documento.");
            } finally {
                boton.disabled = false;
                boton.innerHTML = originalHTML;
            }
        }

        // --- Detección simple de móvil, para decidir cómo se piden los
        // archivos del lote (carpeta completa vs selección múltiple). ---
        const esMovil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;

        document.addEventListener("DOMContentLoaded", async () => {
            const permitido = await verificarPermisos();
            if (!permitido) return;

            verificarCacheAlEntrar();
            const folderInput = document.getElementById("folder_input");
            if (esMovil) {
                document.getElementById("dropzone-titulo").innerText = "Toca aquí para seleccionar tus archivos";
                document.getElementById("dropzone-subtitulo").innerText = "Elige el directorio.xlsx y todos los .cer/.key a la vez";
                document.getElementById("instruccion-dropzone-texto").innerText = "En celular no se puede arrastrar una carpeta: selecciona el Excel y todos los archivos .cer/.key juntos desde tu explorador de archivos.";
            } else {
                folderInput.setAttribute("webkitdirectory", "");
                folderInput.setAttribute("directory", "");
            }
        });

        // --- Autocompletar RFC desde el certificado .cer ---
        // --- Estado compartido: qué RFC está "activo" en pantalla ahora
        // mismo, venga de un link de "Mis Clientes" o de haber leído el
        // .cer a mano en Herramientas Rápidas. El panel de Descargar /
        // Actualizar usa esta misma variable en los dos casos. ---
        let rfcActivo = rfcDesdeCliente ? rfcDesdeCliente.toUpperCase() : null;
        let efirmaGuardadaActual = false;
        let clienteRegistrado = null;  // {existe, alias, efirma_guardada} del RFC en pantalla

        // --- Cuando ya sabemos el RFC, consultamos si está en el
        // directorio: de eso depende si al guardar la e.firma hay que
        // pedir un nombre (para darlo de alta) o no. ---
        async function revisarSiEsCliente(rfc) {
            try {
                const resp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfc)}/existe`, {
                    credentials: "include",
                });
                clienteRegistrado = resp.ok ? await resp.json() : null;
            } catch (error) {
                clienteRegistrado = null;
            }
            actualizarBloqueEfirma();
        }

        function actualizarBloqueEfirma() {
            const bloque = document.getElementById("bloque-guardar-efirma");
            const texto = document.getElementById("texto-guardar-efirma");
            const chk = document.getElementById("chk_guardar_efirma");

            if (clienteRegistrado && clienteRegistrado.efirma_guardada) {
                // Ya la tiene guardada: no tiene caso ofrecer guardarla otra vez
                bloque.classList.add("hidden");
                chk.checked = false;
                return;
            }
            bloque.classList.remove("hidden");

            if (clienteRegistrado && clienteRegistrado.existe) {
                texto.textContent = `Se guardará en la ficha de ${clienteRegistrado.alias}, cifrada, para no volver a subirla.`;
            } else {
                texto.textContent = "Se guarda cifrada y este RFC se dará de alta en tu directorio de clientes.";
            }
            alCambiarGuardarEfirma();
        }

        function alCambiarGuardarEfirma() {
            const activo = document.getElementById("chk_guardar_efirma").checked;
            const necesitaAlias = activo && !(clienteRegistrado && clienteRegistrado.existe);
            const campo = document.getElementById("campo-alias-cliente");
            campo.classList.toggle("hidden", !necesitaAlias);
            if (necesitaAlias) document.getElementById("alias_cliente").focus();
        }

        // --- Trabajos en curso para este RFC (para no dejar que un
        // segundo clic en "Generar Constancia" dispare un segundo robot
        // en paralelo mientras el primero sigue corriendo). ---
        const trabajosEnCurso = {};

        async function revisarEstadoDelRFC(rfc, nombreMostrar) {
            rfcActivo = rfc.toUpperCase();

            try {
                const pendResp = await fetch(`${API_URL}/api/trabajos/pendiente?rfc=${encodeURIComponent(rfcActivo)}&tipo=${MODULO.tipo}`, {
                    credentials: "include",
                });
                if (pendResp.ok) {
                    const pendiente = await pendResp.json();
                    if (pendiente.existe) {
                        document.getElementById("form-individual").classList.add("hidden");
                        mostrarAlerta("success", "Ya tenías un documento en proceso para este RFC. Retomando el seguimiento...");
                        monitorearTrabajo(pendiente.job_id, "individual", rfcActivo);
                        return;
                    }
                }
            } catch (error) {
                console.warn("No se pudo consultar si había un trabajo pendiente:", error);
            }

            try {
                const efirmaResp = await fetch(`${API_URL}/api/clientes/${encodeURIComponent(rfcActivo)}/efirma-estado`, {
                    credentials: "include",
                });
                if (efirmaResp.ok) {
                    const efirmaData = await efirmaResp.json();
                    efirmaGuardadaActual = !!efirmaData.efirma_guardada;
                }
            } catch (error) {
                console.warn("No se pudo consultar el estado de la e.firma guardada:", error);
            }

            try {
                const resp = await fetch(`${API_URL}/api/documentos/estado?rfc=${encodeURIComponent(rfcActivo)}&tipo=${MODULO.tipo}`, {
                    credentials: "include",
                });
                if (!resp.ok) return;
                const data = await resp.json();

                if (data.existe) {
                    document.getElementById("panel-cliente-nombre").textContent = nombreMostrar || rfcActivo;
                    const fecha = new Date(data.generado_en + "Z");
                    document.getElementById("panel-cliente-fecha").textContent = fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
                    document.getElementById("panel-cliente-detectado").classList.remove("hidden");
                    document.getElementById("panel-cliente-detectado").classList.add("flex");
                    document.getElementById("form-individual").classList.add("hidden");
                    return;
                }
            } catch (error) {
                console.warn("No se pudo consultar el caché de documentos:", error);
            }

            // No hay documento en caché. Si de todas formas ya tiene la
            // e.firma guardada, no tiene caso pedirle que la vuelva a
            // subir -- se ofrece generar directo.
            if (efirmaGuardadaActual) {
                document.getElementById("panel-efirma-guardada").classList.remove("hidden");
                document.getElementById("panel-efirma-guardada").classList.add("flex");
                document.getElementById("form-individual").classList.add("hidden");
            }
        }

        document.getElementById("archivo_cer").addEventListener("change", async (e) => {
            if (rfcDesdeCliente) return; // el RFC ya vino fijo desde "Mis Clientes"; no hace falta releerlo

            const archivo = e.target.files[0];
            const campoRFC = document.getElementById("rfc");
            const hint = document.getElementById("rfc-hint");
            if (!archivo) return;

            hint.textContent = "Leyendo certificado...";
            const rfcDetectado = await extraerRFCDeCertificado(archivo);

            if (rfcDetectado) {
                campoRFC.value = rfcDetectado;
                campoRFC.readOnly = true;
                campoRFC.classList.add("campo-solo-lectura");
                hint.textContent = "RFC leído automáticamente de tu certificado.";
                hint.className = "text-xs text-green-600 mt-1";
                await revisarSiEsCliente(rfcDetectado);
                await revisarEstadoDelRFC(rfcDetectado, null);
            } else {
                campoRFC.value = "";
                campoRFC.readOnly = false;
                campoRFC.classList.remove("campo-solo-lectura");
                campoRFC.placeholder = "No se pudo leer, escribe tu RFC";
                hint.textContent = "No pudimos leerlo automáticamente de tu certificado. Ingrésalo manualmente.";
                hint.className = "text-xs text-amber-600 mt-1";
            }
        });

        function obtenerFechaDDMMAA() {
            const hoy = new Date();
            const dd = String(hoy.getDate()).padStart(2, '0');
            const mm = String(hoy.getMonth() + 1).padStart(2, '0');
            const aa = String(hoy.getFullYear()).slice(-2);
            return `${dd}_${mm}_${aa}`;
        }

        function abrirInstructivo() { document.getElementById('modal-instrucciones').classList.add('modal-active'); }
        function cerrarInstructivo() { document.getElementById('modal-instrucciones').classList.remove('modal-active'); }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cerrarInstructivo();
        });

        function switchTab(modo) {
            document.getElementById('tab-ind').className = modo === 'individual' ? "flex-1 py-4 text-sm font-bold text-indigo-700 border-b-2 border-indigo-600 transition flex justify-center items-center gap-2 bg-white" : "flex-1 py-4 text-sm font-semibold text-slate-500 border-b-2 border-transparent hover:text-slate-700 transition flex justify-center items-center gap-2";
            document.getElementById('tab-mas').className = modo === 'masivo' ? "flex-1 py-4 text-sm font-bold text-indigo-700 border-b-2 border-indigo-600 transition flex justify-center items-center gap-2 bg-white" : "flex-1 py-4 text-sm font-semibold text-slate-500 border-b-2 border-transparent hover:text-slate-700 transition flex justify-center items-center gap-2";
            document.getElementById('form-individual').classList.toggle('hidden', modo !== 'individual');
            document.getElementById('form-masivo').classList.toggle('hidden', modo !== 'masivo');
            ocultarAlerta();
        }

        function limpiarFormularios() {
            document.getElementById('form-individual').reset();
            document.getElementById('form-masivo').reset();
            archivosGlobalesMasivo = [];
            document.getElementById('panel-validacion').classList.add('hidden');
            document.getElementById('btn-masivo').disabled = true;

            const campoRFC = document.getElementById('rfc');
            campoRFC.readOnly = true;
            campoRFC.classList.add('campo-solo-lectura');
            campoRFC.placeholder = "";
            const hint = document.getElementById('rfc-hint');
            hint.textContent = "";
            hint.className = "text-xs mt-1";

            document.getElementById('panel-efirma-guardada').classList.add('hidden');
            document.getElementById('panel-efirma-guardada').classList.remove('flex');
            document.getElementById('form-individual').classList.remove('hidden');

            ocultarAlerta();
        }

        function togglePassword(inputId) {
            const input = document.getElementById(inputId);
            input.type = input.type === "password" ? "text" : "password";
        }

        function mostrarAlerta(tipo, mensaje) {
            const container = document.getElementById('alert-container');
            const alertBox = document.getElementById('alert-message');
            container.classList.remove('hidden');
            alertBox.className = tipo === 'error'
                ? "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-amber-50 text-amber-800 border border-amber-200"
                : "p-4 rounded-lg text-sm font-semibold flex items-start gap-2 bg-green-50 text-green-700 border border-green-200";
            alertBox.innerHTML = tipo === 'error'
                ? `<svg class="w-5 h-5 flex-none mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> <span>${mensaje}</span>`
                : `<svg class="w-5 h-5 flex-none mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> <span>${mensaje}</span>`;
        }

        function ocultarAlerta() { document.getElementById('alert-container').classList.add('hidden'); }

        const dropzone = document.getElementById('dropzone');
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => { dropzone.addEventListener(eventName, preventDefaults, false); });
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
        ['dragenter', 'dragover'].forEach(eventName => { dropzone.addEventListener(eventName, () => dropzone.classList.add('drag-over'), false); });
        ['dragleave', 'drop'].forEach(eventName => { dropzone.addEventListener(eventName, () => dropzone.classList.remove('drag-over'), false); });

        dropzone.addEventListener('drop', async (e) => {
            let files = [];
            const items = e.dataTransfer.items;
            for (let i = 0; i < items.length; i++) {
                const item = items[i].webkitGetAsEntry();
                if (item) { files = files.concat(await readEntry(item)); }
            }
            procesarYValidarCarpeta(files);
        });

        function leerCarpeta(e) { procesarYValidarCarpeta(Array.from(e.target.files)); }

        async function readEntry(entry) {
            if (entry.isFile) { return new Promise(resolve => entry.file(resolve)); }
            else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const entries = await new Promise(resolve => dirReader.readEntries(resolve));
                let files = [];
                for (let i = 0; i < entries.length; i++) { files = files.concat(await readEntry(entries[i])); }
                return files;
            }
        }

        function procesarYValidarCarpeta(files) {
            archivosGlobalesMasivo = files.filter(f => f.name.toLowerCase().endsWith('.cer') || f.name.toLowerCase().endsWith('.key') || f.name.toLowerCase().endsWith('.xlsx'));

            const excelFile = archivosGlobalesMasivo.find(f => f.name.toLowerCase() === 'directorio.xlsx');
            const panel = document.getElementById('panel-validacion');
            const listaErrores = document.getElementById('lista-errores');
            const msgExito = document.getElementById('msg-exito');
            const badge = document.getElementById('badge-status');
            const btnMasivo = document.getElementById('btn-masivo');

            panel.classList.remove('hidden');
            listaErrores.innerHTML = '';
            msgExito.classList.add('hidden');
            btnMasivo.disabled = true;

            if (!excelFile) {
                badge.className = "px-2 py-1 rounded font-bold bg-red-100 text-red-700";
                badge.innerText = "Error Crítico";
                listaErrores.innerHTML = "<li>No se encontró el archivo 'directorio.xlsx' entre los archivos seleccionados.</li>";
                return;
            }

            badge.className = "px-2 py-1 rounded font-bold bg-indigo-100 text-indigo-700";
            badge.innerText = "Analizando...";

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonExcel = XLSX.utils.sheet_to_json(firstSheet);

                    if (jsonExcel.length === 0) {
                        badge.className = "px-2 py-1 rounded font-bold bg-amber-100 text-amber-700";
                        badge.innerText = "Excel Vacío";
                        listaErrores.innerHTML = "<li>El archivo Excel no contiene registros para procesar.</li>";
                        return;
                    }

                    let erroresEncontrados = [];
                    const nombresEnCarpeta = archivosGlobalesMasivo.map(f => f.name.toLowerCase());

                    jsonExcel.forEach((row, index) => {
                        const filaNum = index + 2;
                        const rfc = row.RFC ? String(row.RFC).trim() : `Fila ${filaNum}`;

                        let reqCer = row.Archivo_CER ? String(row.Archivo_CER).trim().toLowerCase() : "";
                        let reqKey = row.Archivo_KEY ? String(row.Archivo_KEY).trim().toLowerCase() : "";

                        if (reqCer && !reqCer.endsWith('.cer')) reqCer += '.cer';
                        if (reqKey && !reqKey.endsWith('.key')) reqKey += '.key';

                        if (!reqCer || !nombresEnCarpeta.includes(reqCer)) {
                            erroresEncontrados.push(`<li><b>${rfc}:</b> Falta archivo CER (${reqCer || 'Celda vacía'})</li>`);
                        }
                        if (!reqKey || !nombresEnCarpeta.includes(reqKey)) {
                            erroresEncontrados.push(`<li><b>${rfc}:</b> Falta archivo KEY (${reqKey || 'Celda vacía'})</li>`);
                        }
                    });

                    if (erroresEncontrados.length > 0) {
                        badge.className = "px-2 py-1 rounded font-bold bg-red-100 text-red-700";
                        badge.innerText = `${erroresEncontrados.length} Errores de Archivos`;
                        listaErrores.innerHTML = erroresEncontrados.join('');
                    } else {
                        badge.className = "px-2 py-1 rounded font-bold bg-green-100 text-green-700";
                        badge.innerText = "Validación Exitosa";
                        msgExito.classList.remove('hidden');
                        btnMasivo.disabled = false;
                    }

                } catch (error) {
                    listaErrores.innerHTML = "<li>Error al leer el formato del archivo Excel. Verifica que no esté corrupto.</li>";
                }
            };
            reader.readAsArrayBuffer(excelFile);
        }

        // --- PARTE VISUAL (no le importa de dónde vienen los números).
        // Este controlador es el que va a seguir existiendo tal cual el
        // día que conectemos progreso real: solo cambia quién llama a
        // .actualizar(), nunca esta función. ---
        function crearControladorProgreso(prefijo) {
            const contenedor = document.getElementById(`progreso-${prefijo}`);
            const relleno = document.getElementById(`progreso-${prefijo}-fill`);
            const texto = document.getElementById(`progreso-${prefijo}-texto`);

            contenedor.classList.remove("hidden");
            relleno.style.width = "0%";

            return {
                actualizar(porcentaje, mensaje) {
                    relleno.style.width = `${Math.min(porcentaje, 100)}%`;
                    if (mensaje) texto.textContent = mensaje;
                },
                completar(mensajeFinal = "¡Listo!") {
                    relleno.style.width = "100%";
                    texto.textContent = mensajeFinal;
                    setTimeout(() => contenedor.classList.add("hidden"), 900);
                },
                detener() {
                    contenedor.classList.add("hidden");
                },
            };
        }

        // --- Interpretación de errores: distingue lo que sí podemos
        // distinguir hoy (sin conexión, sesión expirada, error del
        // servidor) y muestra el detalle real del backend en vez de
        // un mensaje único genérico para todo. La distinción fina de
        // "contraseña incorrecta" requiere una mejora aparte en el
        // robot de Playwright, pendiente. ---
        async function interpretarError(response) {
            if (!response) {
                return "No pudimos conectar con el servidor. Verifica tu conexión a internet o si el túnel/portal está activo.";
            }
            if (response.status === 401 || response.status === 403) {
                return "Tu sesión de acceso expiró. Recarga la página, inicia sesión de nuevo e intenta otra vez.";
            }
            if (response.status >= 500) {
                try {
                    const data = await response.json();
                    let detalle = (data.detail || "").replace(/^Fallo en robot SAT:\s*/i, "");
                    if (/dashboard|redirecciones|Generar Constancia|timeout/i.test(detalle)) {
                        return "El SAT no respondió a tiempo. Puede ser tu contraseña de e.firma o que el servicio del SAT esté saturado. Verifica tus datos e intenta de nuevo en unos minutos.";
                    }
                    return detalle
                        ? `No se pudo completar el proceso: ${detalle}`
                        : "Ocurrió un error inesperado en el servidor.";
                } catch {
                    return "Ocurrió un error inesperado en el servidor.";
                }
            }
            return `Ocurrió un problema al procesar la solicitud (código ${response.status}). Intenta de nuevo.`;
        }

        function toggleLoadingState(btnId, isLoading, originalHTML) {
            const btn = document.getElementById(btnId);
            if (isLoading) {
                btn.disabled = true;
                btn.innerHTML = `<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Procesando, esto puede tardar unos segundos...`;
            } else {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        // --- Monitoreo real de un trabajo en el servidor: reemplaza el
        // reloj falso de iniciarProgresoSimulado() por polling de verdad.
        // Es exactamente el punto donde dijimos que solo había que
        // cambiar "quién produce los números" -- crearControladorProgreso
        // no se tocó. ---
        function monitorearTrabajo(jobId, prefijo, rfcParaNombre, botonId = null, botonOriginalHTML = null) {
            const controlador = crearControladorProgreso(prefijo);
            trabajosEnCurso[rfcParaNombre] = jobId;
            let segundos = 0;

            const intervalo = setInterval(async () => {
                segundos += 2;
                let resp;
                try {
                    resp = await fetch(`${API_URL}/api/trabajos/${jobId}`, { credentials: "include" });
                } catch (error) {
                    clearInterval(intervalo);
                    delete trabajosEnCurso[rfcParaNombre];
                    if (botonId) toggleLoadingState(botonId, false, botonOriginalHTML);
                    controlador.detener();
                    mostrarAlerta("error", await interpretarError(null));
                    return;
                }

                if (!resp.ok) {
                    clearInterval(intervalo);
                    delete trabajosEnCurso[rfcParaNombre];
                    if (botonId) toggleLoadingState(botonId, false, botonOriginalHTML);
                    controlador.detener();
                    mostrarAlerta("error", await interpretarError(resp));
                    return;
                }

                const trabajo = await resp.json();

                if (trabajo.estado === "procesando") {
                    const porcentaje = Math.min(10 + segundos * 2, 90);
                    controlador.actualizar(porcentaje, `Procesando... (${segundos}s)`);
                    return;
                }

                clearInterval(intervalo);
                delete trabajosEnCurso[rfcParaNombre];
                if (botonId) toggleLoadingState(botonId, false, botonOriginalHTML);

                if (trabajo.estado === "completado") {
                    controlador.completar();
                    try {
                        const descarga = await fetch(`${API_URL}/api/trabajos/${jobId}/descargar`, { credentials: "include" });
                        if (!descarga.ok) {
                            mostrarAlerta("error", await interpretarError(descarga));
                            return;
                        }
                        const blob = await descarga.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = trabajo.nombre_descarga || `${rfcParaNombre}.pdf`;
                        a.click();
                        mostrarAlerta("success", "¡Proceso completado con éxito!");
                    } catch (error) {
                        mostrarAlerta("error", "El documento se generó, pero no se pudo descargar automáticamente. Intenta de nuevo.");
                    }
                } else {
                    controlador.detener();
                    mostrarAlerta("error", trabajo.mensaje_error || "Ocurrió un error al procesar tu documento.");
                }
            }, 2000);
        }

        async function procesarIndividual(e) {
            e.preventDefault();
            ocultarAlerta();

            const rfc = document.getElementById('rfc').value.trim().toUpperCase();

            if (trabajosEnCurso[rfc]) {
                mostrarAlerta("error", "Ya se está generando este documento, espera a que termine.");
                return;
            }

            const quiereGuardar = document.getElementById('chk_guardar_efirma').checked;
            const aliasCliente = document.getElementById('alias_cliente').value.trim();
            const esClienteNuevo = quiereGuardar && !(clienteRegistrado && clienteRegistrado.existe);

            if (esClienteNuevo && !aliasCliente) {
                mostrarAlerta("error", "Escribe el nombre del cliente para darlo de alta, o desactiva el guardado de la e.firma.");
                return;
            }

            const boton = document.getElementById('btn-individual');
            const originalHTML = boton.innerHTML;
            toggleLoadingState('btn-individual', true, originalHTML);

            const formData = new FormData();
            formData.append("rfc", rfc);
            formData.append("password", document.getElementById('password').value);
            formData.append("cer", document.getElementById('archivo_cer').files[0]);
            formData.append("key", document.getElementById('archivo_key').files[0]);
            formData.append("descargar_csf", MODULO.tipo === "csf" ? "true" : document.getElementById("chk_adicional").checked);
            formData.append("descargar_32d", MODULO.tipo === "opinion" ? "true" : document.getElementById("chk_adicional").checked);
            formData.append("guardar_efirma", quiereGuardar);
            formData.append("alias_cliente", aliasCliente);

            try {
                const response = await fetch(`${API_URL}/api/${MODULO.slug}/iniciar`, { method: "POST", credentials: "include", body: formData });
                if (!response.ok) {
                    toggleLoadingState('btn-individual', false, originalHTML);
                    mostrarAlerta('error', await interpretarError(response));
                    return;
                }
                const { job_id } = await response.json();
                // El botón se queda deshabilitado -- monitorearTrabajo lo
                // libera cuando el trabajo termina (completado o error).
                monitorearTrabajo(job_id, 'individual', rfc, 'btn-individual', originalHTML);
            } catch (error) {
                toggleLoadingState('btn-individual', false, originalHTML);
                mostrarAlerta('error', await interpretarError(null));
            }
        }

        function monitorearLote(loteId, botonId, botonOriginalHTML) {
            const controlador = crearControladorProgreso('masivo');

            const intervalo = setInterval(async () => {
                let resp;
                try {
                    resp = await fetch(`${API_URL}/api/lotes/${loteId}`, { credentials: "include" });
                } catch (error) {
                    clearInterval(intervalo);
                    toggleLoadingState(botonId, false, botonOriginalHTML);
                    controlador.detener();
                    mostrarAlerta("error", await interpretarError(null));
                    return;
                }

                if (!resp.ok) {
                    clearInterval(intervalo);
                    toggleLoadingState(botonId, false, botonOriginalHTML);
                    controlador.detener();
                    mostrarAlerta("error", await interpretarError(resp));
                    return;
                }

                const lote = await resp.json();

                if (lote.estado === "procesando") {
                    const porcentaje = lote.total > 0 ? Math.round((lote.procesados / lote.total) * 100) : 5;
                    const texto = lote.total > 0
                        ? `Procesando ${lote.procesados}/${lote.total}${lote.rfc_actual ? " — " + lote.rfc_actual : ""}`
                        : "Preparando el lote...";
                    controlador.actualizar(Math.max(porcentaje, 5), texto);
                    return;
                }

                clearInterval(intervalo);
                toggleLoadingState(botonId, false, botonOriginalHTML);

                if (lote.estado === "completado") {
                    controlador.completar();
                    try {
                        const descarga = await fetch(`${API_URL}/api/lotes/${loteId}/descargar`, { credentials: "include" });
                        if (!descarga.ok) {
                            mostrarAlerta("error", await interpretarError(descarga));
                            return;
                        }
                        const blob = await descarga.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = lote.nombre_descarga || "Lote.zip";
                        a.click();

                        if (lote.fallidos && lote.fallidos.length > 0) {
                            const listaFallidos = lote.fallidos.map(f => f[0]).join(", ");
                            mostrarAlerta("error", `Lote completado: ${lote.exitosos} de ${lote.total} exitosos. Fallaron: ${listaFallidos}`);
                        } else {
                            mostrarAlerta("success", `Lote completado: ${lote.exitosos} de ${lote.total} documentos generados.`);
                        }
                    } catch (error) {
                        mostrarAlerta("error", "El lote se generó, pero no se pudo descargar automáticamente. Intenta de nuevo.");
                    }
                } else {
                    controlador.detener();
                    mostrarAlerta("error", lote.mensaje_error || "Ocurrió un error al procesar el lote.");
                }
            }, 3000);
        }

        async function procesarMasivo(e) {
            e.preventDefault();
            ocultarAlerta();
            const boton = document.getElementById('btn-masivo');
            const btnOriginalHTML = boton.innerHTML;
            toggleLoadingState('btn-masivo', true, btnOriginalHTML);

            const formData = new FormData();
            archivosGlobalesMasivo.forEach(file => { formData.append("archivos_lote", file); });

            try {
                const response = await fetch(`${API_URL}/api/${MODULO.slug}/lote/iniciar`, { method: "POST", credentials: "include", body: formData });
                if (!response.ok) {
                    toggleLoadingState('btn-masivo', false, btnOriginalHTML);
                    mostrarAlerta('error', await interpretarError(response));
                    return;
                }
                const { lote_id } = await response.json();
                monitorearLote(lote_id, 'btn-masivo', btnOriginalHTML);
            } catch (error) {
                toggleLoadingState('btn-masivo', false, btnOriginalHTML);
                mostrarAlerta('error', await interpretarError(null));
            }
        }
    