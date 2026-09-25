/**
 * conciliacion.js — código de herramientas/conciliacion/ (antes vivía dentro del HTML).
 */
const URL_CANCELADOS = "https://api-fiscal.josuealan9.workers.dev/api/cancelados"; 
const URL_TC = "https://api-fiscal.josuealan9.workers.dev/api/tc";

let diccionarioManual = {};
let diccionarioTC = {};

let xmlFilesStage = [];
let motorFacturas = {};
let cuboFiscal44Columnas = []; 
let rawDataForFilters = []; 
let proveedoresSeleccionados = new Set(); 
const mesesTexto = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatDateToMX(isoString) {
    if (!isoString) return "";
    const parts = isoString.split('-');
    if (parts.length !== 3) return isoString;
    return `${parts[2].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[0]}`;
}
function formatearFechaCSV(fechaStr) {
    if (!fechaStr) return "";
    const partes = fechaStr.trim().split('/');
    if (partes.length === 3) return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
    return fechaStr.trim();
}

async function cargarGoogleSheets() {
    try {
        const resManual = await fetch(URL_CANCELADOS);
        const csvManual = await resManual.text();
        csvManual.split('\n').slice(1).forEach(linea => {
            const col = linea.split(',').map(i => i?.trim()?.toUpperCase().replace(/"/g, ''));
            if (col[0]) diccionarioManual[col[0]] = { esCancelado: col[1] === "CANCELADO", estaPagadoManual: col[2] === "PAGADO" };
        });

        const resTC = await fetch(URL_TC);
        const csvTC = await resTC.text();
        csvTC.split('\n').slice(1).forEach(linea => {
            const col = linea.split(',').map(i => i?.trim().replace(/"/g, ''));
            if (col.length >= 3 && col[0]) {
                const llave = `${formatearFechaCSV(col[0])}_${col[1].toUpperCase()}`;
                diccionarioTC[llave] = parseFloat(col[2]);
            }
        });

        const statusDiv = document.getElementById('statusConexion');
        statusDiv.className = "bg-emerald-100 border border-emerald-400 text-emerald-800 px-3 py-1.5 rounded-full font-bold text-xs flex items-center gap-2";
        statusDiv.innerHTML = "✅ BD Sincronizada";
    } catch (error) {
        const statusDiv = document.getElementById('statusConexion');
        statusDiv.className = "bg-red-100 border border-red-400 text-red-800 px-3 py-1.5 rounded-full font-bold text-xs flex items-center gap-2";
        statusDiv.innerHTML = "❌ Error BD";
    }
}
window.onload = cargarGoogleSheets;

const modal = document.getElementById('modalCarga');
document.getElementById('btnAbrirCarga').onclick = () => modal.classList.add('modal-active');
document.getElementById('btnCerrarModal').onclick = () => modal.classList.remove('modal-active');

document.getElementById('btnLimpiarDatos').addEventListener('click', () => {
    xmlFilesStage = [];
    motorFacturas = {};
    cuboFiscal44Columnas = [];
    rawDataForFilters = [];
    proveedoresSeleccionados.clear();

    document.getElementById('lblStagedCount').innerText = "0";
    document.getElementById('btnProcesarStaged').disabled = true;
    document.getElementById('btnDescargar').disabled = true;

    ['dashI', 'dashP', 'dashE', 'dashTotal'].forEach(id => document.getElementById(id).innerText = "0");
    document.getElementById('cuerpoTabla').innerHTML = `<tr><td colspan="10" class="p-12 text-center text-slate-400 font-medium">Sube tus XML para iniciar el motor analítico...</td></tr>`;

    ['fMetodo', 'fMoneda', 'fMesEmision', 'fMesPago', 'fEstatus'].forEach(id => {
        document.getElementById(id).innerHTML = `<option value="ALL">Todas</option>`;
    });
    actualizarEtiquetaProveedor();
    document.getElementById('listProv').innerHTML = '<li class="p-2 text-gray-400 text-center">Esperando datos...</li>';
});

const handleFilesSelected = (e) => {
    const archivos = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.xml'));
    archivos.forEach(newFile => {
        if(!xmlFilesStage.some(staged => staged.name === newFile.name && staged.size === newFile.size)) {
            xmlFilesStage.push(newFile);
        }
    });
    document.getElementById('lblStagedCount').innerText = xmlFilesStage.length;
    document.getElementById('btnProcesarStaged').disabled = xmlFilesStage.length === 0;
    e.target.value = ""; 
};

document.getElementById('fileInputArr').addEventListener('change', handleFilesSelected);
document.getElementById('folderInputArr').addEventListener('change', handleFilesSelected);

const btnProvDropdown = document.getElementById('btnProvDropdown');
const panelProvDropdown = document.getElementById('panelProvDropdown');
const searchProv = document.getElementById('searchProv');
const btnToggleTodosProv = document.getElementById('btnToggleTodosProv');

btnProvDropdown.addEventListener('click', () => {
    panelProvDropdown.classList.toggle('hidden');
    if(!panelProvDropdown.classList.hidden) searchProv.focus();
});

document.addEventListener('click', (e) => {
    if (!document.getElementById('provDropdownContainer').contains(e.target)) {
        panelProvDropdown.classList.add('hidden');
    }
});

searchProv.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const items = document.querySelectorAll('#listProv li');
    items.forEach(li => {
        const text = li.textContent.toLowerCase();
        li.style.display = text.includes(term) ? '' : 'none';
    });
    actualizarTextoBotonTodos();
});

btnToggleTodosProv.addEventListener('click', () => {
    const checkboxesVisibles = Array.from(document.querySelectorAll('.prov-checkbox')).filter(cb => cb.closest('li').style.display !== 'none');
    if (checkboxesVisibles.length === 0) return;

    const todosMarcados = checkboxesVisibles.every(cb => cb.checked);
    if (todosMarcados) checkboxesVisibles.forEach(cb => proveedoresSeleccionados.delete(cb.value));
    else checkboxesVisibles.forEach(cb => proveedoresSeleccionados.add(cb.value));

    actualizarEtiquetaProveedor();
    actualizarSelectsDesdeData(false);
    renderizarTablaUI();
});

function actualizarTextoBotonTodos() {
    const checkboxesVisibles = Array.from(document.querySelectorAll('.prov-checkbox')).filter(cb => cb.closest('li').style.display !== 'none');
    if(checkboxesVisibles.length === 0) {
        btnToggleTodosProv.innerText = "Sin resultados";
        btnToggleTodosProv.disabled = true;
        return;
    }
    btnToggleTodosProv.disabled = false;
    const todosMarcados = checkboxesVisibles.every(cb => cb.checked);
    btnToggleTodosProv.innerText = todosMarcados ? "Deseleccionar Visibles" : "Seleccionar Visibles";
}

function renderizarListaProveedores(setProveedoresDisponibles) {
    const listProv = document.getElementById('listProv');
    listProv.innerHTML = '';
    let arrProvs = Array.from(setProveedoresDisponibles).sort();

    if(arrProvs.length === 0) {
        listProv.innerHTML = '<li class="p-2 text-gray-400 text-center">No hay proveedores en este filtro</li>';
        actualizarTextoBotonTodos();
        return;
    }

    arrProvs.forEach(p => {
        const isChecked = proveedoresSeleccionados.has(p) ? 'checked' : '';
        const li = document.createElement('li');
        li.className = "px-2 py-1.5 hover:bg-blue-50 cursor-pointer flex items-start gap-2";
        li.innerHTML = `
            <input type="checkbox" value="${p}" class="prov-checkbox mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" ${isChecked}>
            <label class="cursor-pointer text-gray-700 w-full truncate" title="${p}">${p}</label>
        `;
        li.addEventListener('click', (e) => {
            if(e.target.tagName !== 'INPUT') {
                const cb = li.querySelector('input');
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change'));
            }
        });
        li.querySelector('input').addEventListener('change', (e) => {
            if(e.target.checked) proveedoresSeleccionados.add(e.target.value);
            else proveedoresSeleccionados.delete(e.target.value);
            actualizarEtiquetaProveedor();
            actualizarSelectsDesdeData(false);
            renderizarTablaUI();
        });
        listProv.appendChild(li);
    });

    const term = searchProv.value.toLowerCase();
    if (term) {
        const items = document.querySelectorAll('#listProv li');
        items.forEach(li => {
            const text = li.textContent.toLowerCase();
            li.style.display = text.includes(term) ? '' : 'none';
        });
    }
    actualizarTextoBotonTodos();
}

function actualizarEtiquetaProveedor() {
    const lbl = document.getElementById('lblProvDropdown');
    if (proveedoresSeleccionados.size === 0) lbl.textContent = "Proveedor (Todos)";
    else if (proveedoresSeleccionados.size === 1) lbl.textContent = "1 Seleccionado";
    else lbl.textContent = `${proveedoresSeleccionados.size} Seleccionados`;
}

document.getElementById('btnProcesarStaged').addEventListener('click', async () => {
    modal.classList.remove('modal-active');
    document.getElementById('cuerpoTabla').innerHTML = `<tr><td colspan="10" class="p-12 text-center text-blue-600 font-bold text-lg animate-pulse">Analizando ${xmlFilesStage.length} archivos...</td></tr>`;
    await new Promise(r => setTimeout(r, 50)); 

    const parser = new DOMParser();
    motorFacturas = {};
    let listaPagos = [];
    let listaNotas = [];
    let contadores = { I: 0, P: 0, E: 0, Total: xmlFilesStage.length };
    rawDataForFilters = []; 
    proveedoresSeleccionados.clear();
    actualizarEtiquetaProveedor();

    for (let file of xmlFilesStage) {
        const text = await file.text();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        const comprobante = xmlDoc.getElementsByTagName("cfdi:Comprobante")[0] || xmlDoc.getElementsByTagName("Comprobante")[0];
        const timbre = xmlDoc.getElementsByTagName("tfd:TimbreFiscalDigital")[0] || xmlDoc.getElementsByTagName("TimbreFiscalDigital")[0];
        if (!comprobante || !timbre) continue;

        const tipo = comprobante.getAttribute("TipoDeComprobante")?.toUpperCase();
        const uuid = timbre.getAttribute("UUID")?.toUpperCase();
        const folioFactura = comprobante.getAttribute("Folio") || "-";

        const emisor = xmlDoc.getElementsByTagName("cfdi:Emisor")[0] || xmlDoc.getElementsByTagName("Emisor")[0];
        const receptor = xmlDoc.getElementsByTagName("cfdi:Receptor")[0] || xmlDoc.getElementsByTagName("Receptor")[0];

        const nodosPago20 = xmlDoc.getElementsByTagName("pago20:Pago");
        const nodosPago10 = xmlDoc.getElementsByTagName("pago10:Pago");
        const esREPReal = (nodosPago20.length > 0 || nodosPago10.length > 0);

        if (tipo === "I" && !esREPReal) {
            contadores.I++;

            let arrayConceptos = [];
            const nodosConcepto = xmlDoc.getElementsByTagName("cfdi:Concepto");
            for(let c of nodosConcepto) arrayConceptos.push(c.getAttribute("Descripcion"));
            const strConceptosFull = arrayConceptos.join(" | ");

            let ivaMXN = 0, base16 = 0, base8 = 0, base0 = 0, baseEx = 0;
            let retISR = 0, retIVA = 0;

            const traslados = xmlDoc.getElementsByTagName("cfdi:Traslado");
            for (let t of traslados) {
                if(t.parentNode.nodeName === "cfdi:Traslados") {
                    const factor = t.getAttribute("TipoFactor")?.toUpperCase();
                    const tasa = parseFloat(t.getAttribute("TasaOCuota") || 0);
                    const base = parseFloat(t.getAttribute("Base") || 0);
                    const imp = parseFloat(t.getAttribute("Importe") || 0);

                    if (factor === "EXENTO") baseEx += base;
                    else if (tasa === 0.16) { base16 += base; ivaMXN += imp; }
                    else if (tasa === 0.08) { base8 += base; ivaMXN += imp; }
                    else if (tasa === 0.00) { base0 += base; }
                }
            }

            const retenciones = xmlDoc.getElementsByTagName("cfdi:Retencion");
            for(let r of retenciones){
                if(r.parentNode.nodeName === "cfdi:Retenciones") {
                    const imp = r.getAttribute("Impuesto");
                    const importe = parseFloat(r.getAttribute("Importe") || 0);
                    if(imp === "001") retISR += importe;
                    if(imp === "002") retIVA += importe;
                }
            }

            let tasaTxt = "No Objeto";
            if (base16 > 0 && base8 === 0) tasaTxt = "16%";
            else if (base8 > 0 && base16 === 0) tasaTxt = "8%";
            else if (base16 > 0 && base8 > 0) tasaTxt = "Mixta";
            else if (base0 > 0) tasaTxt = "0%";
            else if (baseEx > 0) tasaTxt = "Exento";

            let fechaCruda = comprobante.getAttribute("Fecha")?.split('T')[0] || "";
            let valMesEm = "", txtMesEm = "";
            if(fechaCruda) {
                const f = new Date(fechaCruda);
                valMesEm = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2,'0')}`;
                txtMesEm = `${mesesTexto[f.getMonth()]} ${f.getFullYear()}`;
            }

            motorFacturas[uuid] = {
                F_UUID: uuid,
                F_Folio: folioFactura,
                F_RFC_Prov: emisor?.getAttribute("Rfc") || "SIN RFC",
                F_Nombre_Prov: emisor?.getAttribute("Nombre") || "SIN NOMBRE", 
                F_RFC_Receptor: receptor?.getAttribute("Rfc") || "SIN RFC",
                F_Nombre_Receptor: receptor?.getAttribute("Nombre") || "SIN NOMBRE", 
                F_FechaEmision: fechaCruda,
                F_AñoEmision: fechaCruda ? new Date(fechaCruda).getFullYear() : "",
                F_MesEmision: fechaCruda ? new Date(fechaCruda).getMonth() + 1 : "",
                MesUI_Val: valMesEm, MesUI_Txt: txtMesEm,
                F_UsoCFDI: receptor?.getAttribute("UsoCFDI"),
                F_MetodoPago: comprobante.getAttribute("MetodoPago")?.toUpperCase() || "PPD", 
                F_FormaPago: comprobante.getAttribute("FormaPago") || "",
                F_Moneda: comprobante.getAttribute("Moneda") || "MXN",
                F_TC: parseFloat(comprobante.getAttribute("TipoCambio") || 1),
                F_Total_Origen: parseFloat(comprobante.getAttribute("Total") || 0),
                F_SubTotal_Origen: parseFloat(comprobante.getAttribute("SubTotal") || 0),
                Tasa_Dominante: tasaTxt,
                F_Conceptos_Full: strConceptosFull,
                F_Base_16: base16, F_Base_8: base8, F_Base_0: base0, F_Base_Exenta: baseEx, 
                F_IVA_Total: ivaMXN, F_Ret_ISR: retISR, F_Ret_IVA: retIVA,
                historialPagos: [], historialNC: [], pagadoOrigenAcumulado: 0, ncOrigenAcumulada: 0
            };
        } 
        else if (esREPReal) {
            contadores.P++;
            const iterarPagos = (nodos, prefijo) => {
                for (let p of nodos) {
                    const tcPago = parseFloat(p.getAttribute("TipoCambioP") || 1);
                    const monedaPago = p.getAttribute("MonedaP");
                    const fechaPago = p.getAttribute("FechaPago")?.split('T')[0];
                    const formaPago = p.getAttribute("FormaDePagoP");

                    const docsRel = p.getElementsByTagName(`${prefijo}:DoctoRelacionado`);
                    for (let dr of docsRel) {
                        let objPago = {
                            uuidFactura: dr.getAttribute("IdDocumento")?.toUpperCase(),
                            uuidREP: uuid,
                            montoPagadoDR: parseFloat(dr.getAttribute("ImpPagado") || 0),
                            monedaDR: dr.getAttribute("MonedaDR"),
                            tcDR: parseFloat(dr.getAttribute("EquivalenciaDR") || 1),
                            fechaPago: fechaPago,
                            monedaPago: monedaPago,
                            tcPago: tcPago,
                            formaPago: formaPago,
                            P_Base_Gravada_Total: 0, P_IVA_Total_Origen: 0,
                            P_Ret_ISR_Origen: 0, P_Ret_IVA_Origen: 0
                        };

                        if(prefijo === "pago20") {
                            const trasDR = dr.getElementsByTagName("pago20:TrasladoDR");
                            for(let tr of trasDR) {
                                const tq = parseFloat(tr.getAttribute("TasaOCuotaDR")||0);
                                if(tq === 0.16 || tq === 0.08) {
                                    objPago.P_Base_Gravada_Total += parseFloat(tr.getAttribute("BaseDR")||0);
                                    objPago.P_IVA_Total_Origen += parseFloat(tr.getAttribute("ImporteDR")||0);
                                }
                            }
                            const retDR = dr.getElementsByTagName("pago20:RetencionDR");
                            for(let rdr of retDR) {
                                const impDR = rdr.getAttribute("ImpuestoDR");
                                const importeDR = parseFloat(rdr.getAttribute("ImporteDR")||0);
                                if(impDR === "001") objPago.P_Ret_ISR_Origen += importeDR;
                                if(impDR === "002") objPago.P_Ret_IVA_Origen += importeDR;
                            }
                        }
                        listaPagos.push(objPago);
                    }
                }
            };
            iterarPagos(nodosPago20, "pago20");
            iterarPagos(nodosPago10, "pago10");
        }
        else if (tipo === "E") {
            contadores.E++;
            const relacionados = xmlDoc.getElementsByTagName("cfdi:CfdiRelacionado");
            for (let rel of relacionados) {
                listaNotas.push({
                    uuidFactura: rel.getAttribute("UUID")?.toUpperCase(), uuidNC: uuid,
                    montoDescuento: parseFloat(comprobante.getAttribute("Total") || 0),
                    tcNC: parseFloat(comprobante.getAttribute("TipoCambio") || 1)
                });
            }
        }
    }

    listaPagos.forEach(pago => {
        if(motorFacturas[pago.uuidFactura]) {
            motorFacturas[pago.uuidFactura].pagadoOrigenAcumulado += pago.montoPagadoDR;
            motorFacturas[pago.uuidFactura].historialPagos.push(pago);
        }
    });
    listaNotas.forEach(nota => {
        if(motorFacturas[nota.uuidFactura]) {
            motorFacturas[nota.uuidFactura].ncOrigenAcumulada += nota.montoDescuento;
            motorFacturas[nota.uuidFactura].historialNC.push(nota);
        }
    });

    cuboFiscal44Columnas = [];

    for (let uuid in motorFacturas) {
        let f = motorFacturas[uuid];

        let tcF = (f.F_Moneda === "MXN") ? 1 : f.F_TC;
        let totalMXN = f.F_Total_Origen * tcF;
        let pagadoMXN = f.pagadoOrigenAcumulado * tcF;
        let ncMXN = f.ncOrigenAcumulada * tcF;
        let saldoInsoluto = totalMXN - pagadoMXN - ncMXN;
        if(saldoInsoluto < 0) saldoInsoluto = 0;

        let b16_mxn = f.F_Base_16 * tcF; let b8_mxn = f.F_Base_8 * tcF;
        let b0_mxn = f.F_Base_0 * tcF;   let bEx_mxn = f.F_Base_Exenta * tcF;
        let iva_mxn = f.F_IVA_Total * tcF;
        let bNoObj_mxn = (f.F_SubTotal_Origen * tcF) - b16_mxn - b8_mxn - b0_mxn - bEx_mxn;
        let retIsr_mxn = f.F_Ret_ISR * tcF;
        let retIva_mxn = f.F_Ret_IVA * tcF;

        let estGlobal = "", estAux = "";
        let conf = diccionarioManual[uuid];

        if (conf && conf.esCancelado) { estGlobal = "⚫ Cancelado"; estAux = "Cancelado en portal SAT/Manual"; } 
        else if (conf && conf.estaPagadoManual) { estGlobal = "🟢 Pagado"; estAux = "Saldado Manualmente en Excel"; saldoInsoluto = 0; }
        else if (f.F_MetodoPago === "PUE") { estGlobal = "🟢 Pagado"; estAux = "Saldado por Método PUE"; saldoInsoluto = 0; }
        else if (saldoInsoluto <= 1 && f.ncOrigenAcumulada > 0) { estGlobal = "🟢 Pagado"; estAux = "Cubierto con Nota de Crédito"; }
        else if (saldoInsoluto <= 1) { estGlobal = "🟢 Pagado"; estAux = "Abonos completan Total (PPD)"; }
        else if (saldoInsoluto >= (totalMXN - 1)) { estGlobal = "🔴 No Pagado"; estAux = "Sin Recepción de Pagos"; } 
        else { estGlobal = "🟡 Pago Parcial"; estAux = "Saldos pendientes en PPD"; }

        let uiFechas = `<div class="font-semibold text-slate-700">${formatDateToMX(f.F_FechaEmision)}</div>`;
        let uiPagosMeses = [];
        f.historialPagos.forEach(p => {
            uiFechas += `<div class="text-[10px] text-blue-600 mt-0.5">↪ ${formatDateToMX(p.fechaPago)}</div>`;
            if(p.fechaPago) uiPagosMeses.push(`${new Date(p.fechaPago).getFullYear()}-${String(new Date(p.fechaPago).getMonth()+1).padStart(2,'0')}`);
        });
        if(f.F_MetodoPago === "PUE") uiPagosMeses.push(f.MesUI_Val);

        const crearFilaCubo = (esPrimerAbono, refREP = null, refNC = null) => {
            let p_tc_banco = refREP ? refREP.tcPago : (f.F_MetodoPago==="PUE" ? tcF : 0);
            let monedaPago = refREP ? refREP.monedaPago : (f.F_MetodoPago==="PUE" ? f.F_Moneda : null);
            let fechaPagoClean = refREP ? refREP.fechaPago : (f.F_MetodoPago==="PUE" ? f.F_FechaEmision : null);

            let tc_contable = 1;
            if(monedaPago && monedaPago !== "MXN" && fechaPagoClean) {
                const llaveTC = `${fechaPagoClean}_${monedaPago}`;
                if(diccionarioTC[llaveTC]) tc_contable = diccionarioTC[llaveTC];
                else tc_contable = 0;
            }

            let p_impPagado_orig = refREP ? refREP.montoPagadoDR : (f.F_MetodoPago==="PUE" && esPrimerAbono ? f.F_Total_Origen : 0);
            let p_impPagado_mxn = p_impPagado_orig * p_tc_banco;

            let p_baseG_total = refREP ? refREP.P_Base_Gravada_Total : (f.F_MetodoPago==="PUE" && esPrimerAbono ? b16_mxn+b8_mxn : 0);
            let p_iva_total_origen = refREP ? refREP.P_IVA_Total_Origen : (f.F_MetodoPago==="PUE" && esPrimerAbono ? iva_mxn/tcF : 0);
            let p_iva_total_mxn = p_iva_total_origen * p_tc_banco;

            let p_ret_isr_mxn = refREP ? (refREP.P_Ret_ISR_Origen * p_tc_banco) : (f.F_MetodoPago==="PUE" && esPrimerAbono ? retIsr_mxn : 0);
            let p_ret_iva_mxn = refREP ? (refREP.P_Ret_IVA_Origen * p_tc_banco) : (f.F_MetodoPago==="PUE" && esPrimerAbono ? retIva_mxn : 0);

            let fluc_sat = (p_impPagado_orig * p_tc_banco) - (p_impPagado_orig * tcF);
            let dif_aud = (p_impPagado_orig * p_tc_banco) - (p_impPagado_orig * tc_contable);
            let dif_aud_iva = (p_iva_total_origen * p_tc_banco) - (p_iva_total_origen * tc_contable);
            if(tc_contable === 0) { dif_aud = "⚠️ Faltó Capturar TC"; dif_aud_iva = "⚠️ Faltó Capturar TC"; }

            let fila = {
                "Estatus Global": estGlobal,
                "Estatus Auxiliar": estAux,
                "F_AñoEmision": f.F_AñoEmision,
                "F_MesEmision": f.F_MesEmision,
                "P_AñoPago": fechaPagoClean ? new Date(fechaPagoClean).getFullYear() : null,
                "P_MesPago": fechaPagoClean ? new Date(fechaPagoClean).getMonth() + 1 : null,
                "F_FechaEmision": f.F_FechaEmision,
                "P_FechaPago": fechaPagoClean,
                "F_UsoCFDI": f.F_UsoCFDI,
                "F_MetodoPago": f.F_MetodoPago,
                "F_FormaPago": f.F_FormaPago,
                "P_FormaPago": refREP ? refREP.formaPago : (f.F_MetodoPago === "PUE" ? f.F_FormaPago : null),
                "F_RFC_Prov": f.F_RFC_Prov,
                "F_Nombre_Prov": f.F_Nombre_Prov,
                "F_RFC_Receptor": f.F_RFC_Receptor,
                "F_Nombre_Receptor": f.F_Nombre_Receptor,
                "F_UUID": uuid,
                "P_UUID_REP": refNC ? "Aplica a: " + uuid : (refREP ? refREP.uuidREP : (f.F_MetodoPago === "PUE" ? "PUE (Cobro Inmediato)" : "Sin Pago")),
                "UUID_Presentacion": refNC ? uuid : uuid, 
                "F_Conceptos": f.F_Conceptos_Full,
                "F_Moneda": f.F_Moneda,
                "F_TC": tcF,
                "Tasa_Dominante": f.Tasa_Dominante, 
                "F_Total_Origen_Unico": esPrimerAbono ? f.F_Total_Origen : 0,
                "F_Total_MXN_Unico": esPrimerAbono ? totalMXN : 0,
                "F_Base_Gravada_Unica": esPrimerAbono ? (b16_mxn + b8_mxn) : 0,
                "F_IVA_Total_Unico": esPrimerAbono ? iva_mxn : 0,
                "F_Ret_ISR_Unica": esPrimerAbono ? retIsr_mxn : 0,
                "F_Ret_IVA_Unica": esPrimerAbono ? retIva_mxn : 0,
                "F_Base_0_MXN": esPrimerAbono ? b0_mxn : 0,
                "F_Base_Exenta_MXN": esPrimerAbono ? bEx_mxn : 0,
                "F_Base_NoObjeto_MXN": esPrimerAbono ? bNoObj_mxn : 0,
                "P_MonedaPago": monedaPago,
                "P_TC_Pago": p_tc_banco,
                "TC_Contable_Final": tc_contable,
                "Diferencia_TC_Auditoria": dif_aud,
                "Diferencia_TC_Auditoria_IVA": dif_aud_iva,
                "Fluctuacion_Cambiaria_SAT": fluc_sat,
                "P_ImpPagado_Origen": p_impPagado_orig,
                "P_ImpPagado_MXN": p_impPagado_mxn,
                "P_Base_Gravada_Total": p_baseG_total,
                "P_IVA_Total": p_iva_total_mxn,
                "P_Ret_ISR_MXN": p_ret_isr_mxn,
                "P_Ret_IVA_MXN": p_ret_iva_mxn
            };

            if (refNC) {
                let fD = refNC.montoDescuento / f.F_Total_Origen;
                fila["F_Total_Origen_Unico"] = refNC.montoDescuento * -1;
                fila["F_Total_MXN_Unico"] = (refNC.montoDescuento * refNC.tcNC) * -1;
                fila["F_Base_Gravada_Unica"] = ((b16_mxn + b8_mxn) * fD) * -1;
                fila["F_IVA_Total_Unico"] = (iva_mxn * fD) * -1;
                fila["F_Ret_ISR_Unica"] = (retIsr_mxn * fD) * -1;
                fila["F_Ret_IVA_Unica"] = (retIva_mxn * fD) * -1;
                fila["P_ImpPagado_Origen"] = 0; fila["P_ImpPagado_MXN"]=0; fila["P_IVA_Total"]=0; 
            }
            cuboFiscal44Columnas.push(fila);
        };

        if (f.historialPagos.length === 0 && f.historialNC.length === 0) {
            crearFilaCubo(true, null, null); 
        } else {
            let esPrim = true;
            f.historialPagos.forEach(p => { crearFilaCubo(esPrim, p, null); esPrim = false; });
            f.historialNC.forEach(nc => { crearFilaCubo(esPrim, null, nc); esPrim = false; }); 
        }

        let colorSaldo = saldoInsoluto > 1 ? "text-red-600 font-bold" : "text-slate-400";
        let badgeColor = 
            estGlobal.includes("🟢") ? "bg-green-100 text-green-800" :
            estGlobal.includes("🟡") ? "bg-yellow-100 text-yellow-800" :
            estGlobal.includes("🔴") ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800";

        let strPagosAttr = uiPagosMeses.join(","); 

        // Almacenamos data cruda adicional para generar la Vista Dashboard de Excel
        rawDataForFilters.push({
            proveedor: f.F_Nombre_Prov,
            uuid: uuid,
            fechaEmision: f.F_FechaEmision,
            conceptos: f.F_Conceptos_Full,
            tasa: f.Tasa_Dominante,
            totalMXN: totalMXN,
            ivaMXN: iva_mxn,
            saldoInsoluto: saldoInsoluto,
            metodo: f.F_MetodoPago,
            moneda: f.F_Moneda,
            mesEmisionVal: f.MesUI_Val,
            mesEmisionTxt: f.MesUI_Txt,
            mesesPagos: uiPagosMeses,
            estatus: estGlobal,
            estatusAuxiliar: estAux,
            html: `
                <tr class="hover:bg-blue-50/50 transition border-b" 
                    data-metodo="${f.F_MetodoPago}" data-moneda="${f.F_Moneda}" 
                    data-mesem="${f.MesUI_Val}" data-mespa="${strPagosAttr}" data-estatus="${estGlobal}">
                    <td class="p-3 align-top">
                        <div class="font-mono text-blue-700 font-bold">${f.F_RFC_Prov}</div>
                        <div class="text-[10px] text-slate-500 truncate w-48" title="${f.F_Nombre_Prov}">${f.F_Nombre_Prov}</div>
                    </td>
                    <td class="p-3 align-top">
                        <div class="text-[11px] text-slate-700 font-mono break-all whitespace-normal max-w-[140px] leading-tight" title="Doble clic para copiar">${uuid}</div>
                    </td>
                    <td class="p-3 leading-tight align-top w-28">${uiFechas}</td>
                    <td class="p-3 align-top">
                        <div class="text-[10px] text-slate-500 whitespace-normal w-64 clamp-2 leading-relaxed" title="${f.F_Conceptos_Full}">${f.F_Conceptos_Full}</div>
                    </td>
                    <td class="p-3 align-top"><span class="px-2 py-1 bg-slate-100 rounded text-[10px] text-slate-600 font-semibold border">${f.Tasa_Dominante}</span></td>
                    <td class="p-3 text-right tabular-nums font-semibold align-top">$${totalMXN.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                    <td class="p-3 text-right tabular-nums text-slate-500 align-top">$${iva_mxn.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                    <td class="p-3 text-right tabular-nums align-top ${colorSaldo}">$${saldoInsoluto.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                    <td class="p-3 text-center align-top"><span class="px-2 py-1 rounded text-[10px] font-bold ${badgeColor} border whitespace-nowrap">${estGlobal}</span></td>
                    <td class="p-3 text-[10px] text-slate-500 italic whitespace-normal w-40 align-top">${estAux}</td>
                </tr>`
        });
    }

    document.getElementById('dashI').innerText = contadores.I.toLocaleString();
    document.getElementById('dashP').innerText = contadores.P.toLocaleString(); 
    document.getElementById('dashE').innerText = contadores.E.toLocaleString();
    document.getElementById('dashTotal').innerText = contadores.Total.toLocaleString();

    actualizarSelectsDesdeData(true);
    btnDescargar.disabled = false;
});

// ==========================================
// 3. MATRIZ REACTIVA DE FILTROS CRUZADOS
// ==========================================
const filtrosIds = ['fMetodo', 'fMoneda', 'fMesEmision', 'fMesPago', 'fEstatus'];
filtrosIds.forEach(id => document.getElementById(id).addEventListener('change', () => {
    actualizarSelectsDesdeData(false);
    renderizarTablaUI();
}));

function actualizarSelectsDesdeData(isInitial) {
    const vMet = isInitial ? "ALL" : document.getElementById('fMetodo').value;
    const vMon = isInitial ? "ALL" : document.getElementById('fMoneda').value;
    const vEm  = isInitial ? "ALL" : document.getElementById('fMesEmision').value;
    const vPa  = isInitial ? "ALL" : document.getElementById('fMesPago').value;
    const vEst = isInitial ? "ALL" : document.getElementById('fEstatus').value;

    let sets = { prov: new Set(), met: new Set(), mon: new Set(), em: new Set(), pa: new Set(), est: new Set() };

    rawDataForFilters.forEach(f => {
        let matchMet = (vMet === "ALL" || f.metodo === vMet);
        let matchMon = (vMon === "ALL" || f.moneda === vMon);
        let matchEm  = (vEm === "ALL" || f.mesEmisionVal === vEm);
        let matchPa  = (vPa === "ALL" || f.mesesPagos.includes(vPa));
        let matchEst = (vEst === "ALL" || f.estatus === vEst);
        let matchProv = (proveedoresSeleccionados.size === 0 || proveedoresSeleccionados.has(f.proveedor));

        if(matchMet && matchMon && matchEm && matchPa && matchEst) sets.prov.add(f.proveedor);
        if(matchProv && matchMon && matchEm && matchPa && matchEst) sets.met.add(f.metodo);
        if(matchProv && matchMet && matchEm && matchPa && matchEst) sets.mon.add(f.moneda);
        if(matchProv && matchMet && matchMon && matchPa && matchEst && f.mesEmisionVal) sets.em.add(JSON.stringify({v: f.mesEmisionVal, t: f.mesEmisionTxt}));
        if(matchProv && matchMet && matchMon && matchEm && matchEst) f.mesesPagos.forEach(mp => {
            if(mp) sets.pa.add(JSON.stringify({v: mp, t: `${mesesTexto[parseInt(mp.split('-')[1])-1]} ${mp.split('-')[0]}`}));
        });
        if(matchProv && matchMet && matchMon && matchEm && matchPa) sets.est.add(f.estatus);
    });

    renderizarListaProveedores(sets.prov);

    const rellenar = (id, setObjs, label, curVal) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="ALL">${label} (Todas)</option>`;
        let found = false;

        let arr = Array.from(setObjs);
        if(arr.length > 0 && arr[0].startsWith('{')) { 
            arr.map(JSON.parse).sort((a,b) => a.v > b.v ? 1 : -1).forEach(i => {
                el.innerHTML += `<option value="${i.v}">${i.t}</option>`;
                if(i.v === curVal) found = true;
            });
        } else { 
            arr.sort().forEach(m => {
                el.innerHTML += `<option value="${m}">${m}</option>`;
                if(m === curVal) found = true;
            });
        }

        if(!isInitial) {
            if(found) el.value = curVal; 
            else el.value = "ALL"; 
        }
    };

    rellenar('fMetodo', sets.met, 'Método', vMet);
    rellenar('fMoneda', sets.mon, 'Moneda', vMon);
    rellenar('fMesEmision', sets.em, 'Emisión', vEm);
    rellenar('fMesPago', sets.pa, 'Pago', vPa);
    rellenar('fEstatus', sets.est, 'Estatus', vEst);

    if(isInitial) renderizarTablaUI();
}

function renderizarTablaUI() {
    const vMet = document.getElementById('fMetodo').value;
    const vMon = document.getElementById('fMoneda').value;
    const vEm = document.getElementById('fMesEmision').value;
    const vPa = document.getElementById('fMesPago').value;
    const vEst = document.getElementById('fEstatus').value;

    let htmlFinal = "";
    rawDataForFilters.forEach(f => {
        let show = true;
        if (proveedoresSeleccionados.size > 0 && !proveedoresSeleccionados.has(f.proveedor)) show = false;
        if (vMet !== "ALL" && f.metodo !== vMet) show = false;
        if (vMon !== "ALL" && f.moneda !== vMon) show = false;
        if (vEm !== "ALL" && f.mesEmisionVal !== vEm) show = false;
        if (vPa !== "ALL" && !f.mesesPagos.includes(vPa)) show = false;
        if (vEst !== "ALL" && f.estatus !== vEst) show = false;
        if (show) htmlFinal += f.html;
    });

    if(htmlFinal === "") htmlFinal = "<tr><td colspan='10' class='p-12 text-center text-slate-500'>Sin resultados para los filtros actuales.</td></tr>";
    document.getElementById('cuerpoTabla').innerHTML = htmlFinal;
}

// ==========================================
// 4. EXPORTACIÓN A EXCEL (MULTI-PESTAÑA)
// ==========================================
btnDescargar.addEventListener('click', () => {
    if (cuboFiscal44Columnas.length === 0) return;

    // Pestaña 1: Cubo Maestro de Datos
    const wsCubo = XLSX.utils.json_to_sheet(cuboFiscal44Columnas);

    // Pestaña 2: Vista Dashboard (Respetando Filtros Activos)
    const vMet = document.getElementById('fMetodo').value;
    const vMon = document.getElementById('fMoneda').value;
    const vEm = document.getElementById('fMesEmision').value;
    const vPa = document.getElementById('fMesPago').value;
    const vEst = document.getElementById('fEstatus').value;

    let vistaDashboardData = [];
    rawDataForFilters.forEach(f => {
        let show = true;
        if (proveedoresSeleccionados.size > 0 && !proveedoresSeleccionados.has(f.proveedor)) show = false;
        if (vMet !== "ALL" && f.metodo !== vMet) show = false;
        if (vMon !== "ALL" && f.moneda !== vMon) show = false;
        if (vEm !== "ALL" && f.mesEmisionVal !== vEm) show = false;
        if (vPa !== "ALL" && !f.mesesPagos.includes(vPa)) show = false;
        if (vEst !== "ALL" && f.estatus !== vEst) show = false;

        if (show) {
            vistaDashboardData.push({
                "Proveedor": f.proveedor,
                "UUID": f.uuid,
                "Fecha Emisión": formatDateToMX(f.fechaEmision),
                "Conceptos": f.conceptos,
                "Tasa": f.tasa,
                "Total MXN": parseFloat(f.totalMXN.toFixed(2)),
                "IVA MXN": parseFloat(f.ivaMXN.toFixed(2)),
                "Saldo Insoluto": parseFloat(f.saldoInsoluto.toFixed(2)),
                "Estatus Global": f.estatus,
                "Detalle": f.estatusAuxiliar
            });
        }
    });

    const wsDashboard = XLSX.utils.json_to_sheet(vistaDashboardData);

    // Armar y Descargar el Libro de Excel
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsDashboard, "Resumen");
    XLSX.utils.book_append_sheet(workbook, wsCubo, "Data_Facturas");  
    XLSX.writeFile(workbook, "Conciliación_PPD.xlsx");
});

// ==========================================
// ESCUDO BÁSICO DE INTERFAZ (Anti-Inspeccionar)
// ==========================================
document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) {
    if(e.keyCode == 123) return false; // Bloquea F12
    if(e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0)) return false; // Ctrl+Shift+I
    if(e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0)) return false; // Ctrl+Shift+J
    if(e.ctrlKey && e.keyCode == 'U'.charCodeAt(0)) return false; // Ctrl+U
};

// Se comprueba el permiso al entrar, no al enviar.
document.addEventListener("DOMContentLoaded", function () {
    Fiscontable.exigirModulo("conciliacion");
});
