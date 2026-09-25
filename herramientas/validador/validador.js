/**
 * validador.js — código de herramientas/validador/ (antes vivía dentro del HTML).
 */
let xmlFilesStage = [];
let rawDataForFilters = [];
let proveedoresSeleccionados = new Set();
const mesesTexto = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatDateToMX(isoString) {
    if (!isoString) return "";
    const parts = isoString.split('-');
    if (parts.length !== 3) return isoString;
    return `${parts[2].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[0]}`;
}

const modal = document.getElementById('modalCarga');
document.getElementById('btnAbrirCarga').onclick = () => modal.classList.add('modal-active');
document.getElementById('btnCerrarModal').onclick = () => modal.classList.remove('modal-active');

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

document.getElementById('btnLimpiarDatos').addEventListener('click', () => {
    xmlFilesStage = [];
    rawDataForFilters = [];
    proveedoresSeleccionados.clear();

    document.getElementById('lblStagedCount').innerText = "0";
    document.getElementById('btnProcesarStaged').disabled = true;
    document.getElementById('btnDescargar').disabled = true;

    ['dashTotal', 'dashVigentes', 'dashCancelados', 'dashErrores'].forEach(id => document.getElementById(id).innerText = "0");
    document.getElementById('cuerpoTabla').innerHTML = `<tr><td colspan="10" class="p-12 text-center text-slate-400 font-medium">Sube tus XML para auditar estatus con el SAT...</td></tr>`;

    ['fTipo', 'fMes', 'fEstatus'].forEach(id => {
        document.getElementById(id).innerHTML = `<option value="ALL">Todas</option>`;
    });
    actualizarEtiquetaProveedor();
    document.getElementById('listProv').innerHTML = '<li class="p-2 text-gray-400 text-center">Esperando datos...</li>';
});

// Lógica del Dropdown Custom para Proveedores
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
        li.className = "px-2 py-1.5 hover:bg-emerald-50 cursor-pointer flex items-start gap-2";
        li.innerHTML = `
            <input type="checkbox" value="${p}" class="prov-checkbox mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" ${isChecked}>
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

// Lógica de Comunicación con el Servidor Python
async function validarFacturaEnServidor(rfcEmisor, rfcReceptor, total, uuid) {
    try {
        const respuesta = await fetch("https://api.josuealan.com/validar-factura/", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                rfc_emisor: rfcEmisor,
                rfc_receptor: rfcReceptor,
                total: parseFloat(total).toFixed(2),
                uuid: uuid
            })
        });
        if (!respuesta.ok) throw new Error("Error de conexión");
        return await respuesta.json();
    } catch (error) {
        return { estado: "Error", es_cancelable: "Verifica el túnel o conexión", estatus_cancelacion: "" };
    }
}

document.getElementById('btnProcesarStaged').addEventListener('click', async () => {
    modal.classList.remove('modal-active');
    const tbody = document.getElementById('cuerpoTabla');
    tbody.innerHTML = `<tr><td colspan="10" class="p-12 text-center text-blue-600 font-bold text-lg animate-pulse">Analizando XMLs y conectando con SAT...</td></tr>`;

    const parser = new DOMParser();
    let facturasTemp = [];
    rawDataForFilters = [];
    proveedoresSeleccionados.clear();
    actualizarEtiquetaProveedor();

    // Extracción Inicial
    for (let file of xmlFilesStage) {
        const text = await file.text();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        const comprobante = xmlDoc.getElementsByTagName("cfdi:Comprobante")[0] || xmlDoc.getElementsByTagName("Comprobante")[0];
        const timbre = xmlDoc.getElementsByTagName("tfd:TimbreFiscalDigital")[0] || xmlDoc.getElementsByTagName("TimbreFiscalDigital")[0];
        if (!comprobante || !timbre) continue;

        const emisor = xmlDoc.getElementsByTagName("cfdi:Emisor")[0] || xmlDoc.getElementsByTagName("Emisor")[0];
        const receptor = xmlDoc.getElementsByTagName("cfdi:Receptor")[0] || xmlDoc.getElementsByTagName("Receptor")[0];

        let fechaCruda = comprobante.getAttribute("Fecha")?.split('T')[0] || "";
        let valMesEm = "", txtMesEm = "";
        if(fechaCruda) {
            const fDate = new Date(fechaCruda);
            valMesEm = `${fDate.getFullYear()}-${String(fDate.getMonth() + 1).padStart(2,'0')}`;
            txtMesEm = `${mesesTexto[fDate.getMonth()]} ${fDate.getFullYear()}`;
        }

        let totalTraslados = 0;
        const nodosTraslado = xmlDoc.getElementsByTagName("cfdi:Traslado");
        for (let t of nodosTraslado) {
            if(t.parentNode.nodeName === "cfdi:Traslados") {
                totalTraslados += parseFloat(t.getAttribute("Importe") || 0);
            }
        }

        let totalRetenciones = 0;
        const nodosRetencion = xmlDoc.getElementsByTagName("cfdi:Retencion");
        for (let r of nodosRetencion) {
            if(r.parentNode.nodeName === "cfdi:Retenciones") {
                totalRetenciones += parseFloat(r.getAttribute("Importe") || 0);
            }
        }

        facturasTemp.push({
            uuid: timbre.getAttribute("UUID")?.toUpperCase(),
            rfcEmisor: emisor?.getAttribute("Rfc") || "SIN RFC",
            nombreEmisor: emisor?.getAttribute("Nombre") || "SIN NOMBRE",
            rfcReceptor: receptor?.getAttribute("Rfc") || "",
            total: parseFloat(comprobante.getAttribute("Total") || 0),
            subTotal: parseFloat(comprobante.getAttribute("SubTotal") || 0),
            totalTraslados: totalTraslados,
            totalRetenciones: totalRetenciones,
            tipo: comprobante.getAttribute("TipoDeComprobante")?.toUpperCase() || "",
            fechaCruda: fechaCruda,
            mesEmisionVal: valMesEm,
            mesEmisionTxt: txtMesEm
        });
    }

    let cVigentes = 0, cCancelados = 0, cErrores = 0;

    // Consulta al SAT y llenado de Data Global
    for (let i = 0; i < facturasTemp.length; i++) {
        let f = facturasTemp[i];
        tbody.innerHTML = `<tr><td colspan="10" class="p-12 text-center text-blue-600 font-bold">Consultando SAT: ${i + 1} de ${facturasTemp.length}...</td></tr>`;

        const respuestaSAT = await validarFacturaEnServidor(f.rfcEmisor, f.rfcReceptor, f.total, f.uuid);

        let estatus = respuestaSAT.estado || "Error";
        let cancelable = respuestaSAT.es_cancelable || "";
        let motivo = respuestaSAT.estatus_cancelacion || "";

        let estatusLimpio = "Error";
        if (estatus.includes("Vigente")) { cVigentes++; estatusLimpio = "Vigente"; }
        else if (estatus.includes("Cancelado")) { cCancelados++; estatusLimpio = "Cancelado"; }
        else { cErrores++; }

        rawDataForFilters.push({
            ...f,
            satEstatus: estatus,
            estatusLimpio: estatusLimpio,
            satCancelable: cancelable,
            satMotivo: motivo
        });
    }

    document.getElementById('dashTotal').innerText = rawDataForFilters.length;
    document.getElementById('dashVigentes').innerText = cVigentes;
    document.getElementById('dashCancelados').innerText = cCancelados;
    document.getElementById('dashErrores').innerText = cErrores;

    actualizarSelectsDesdeData(true);
    btnDescargar.disabled = false;
});

// Filtros Cruzados Reactivos
const filtrosIds = ['fTipo', 'fMes', 'fEstatus'];
filtrosIds.forEach(id => document.getElementById(id).addEventListener('change', () => {
    actualizarSelectsDesdeData(false);
    renderizarTablaUI();
}));

function actualizarSelectsDesdeData(isInitial) {
    const vTipo = isInitial ? "ALL" : document.getElementById('fTipo').value;
    const vMes  = isInitial ? "ALL" : document.getElementById('fMes').value;
    const vEst  = isInitial ? "ALL" : document.getElementById('fEstatus').value;

    let sets = { prov: new Set(), tipo: new Set(), mes: new Set(), est: new Set() };

    rawDataForFilters.forEach(f => {
        let matchTipo = (vTipo === "ALL" || f.tipo === vTipo);
        let matchMes  = (vMes === "ALL" || f.mesEmisionVal === vMes);
        let matchEst  = (vEst === "ALL" || f.estatusLimpio === vEst);
        let matchProv = (proveedoresSeleccionados.size === 0 || proveedoresSeleccionados.has(f.nombreEmisor));

        if(matchTipo && matchMes && matchEst) sets.prov.add(f.nombreEmisor);
        if(matchProv && matchMes && matchEst) sets.tipo.add(f.tipo);
        if(matchProv && matchTipo && matchEst && f.mesEmisionVal) sets.mes.add(JSON.stringify({v: f.mesEmisionVal, t: f.mesEmisionTxt}));
        if(matchProv && matchTipo && matchMes) sets.est.add(f.estatusLimpio);
    });

    renderizarListaProveedores(sets.prov);

    const rellenar = (id, setObjs, label, curVal, prefixMap = {}) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="ALL">${label} (Todos)</option>`;
        let found = false;

        let arr = Array.from(setObjs);
        if(arr.length > 0 && arr[0].startsWith('{')) { 
            arr.map(JSON.parse).sort((a,b) => a.v > b.v ? 1 : -1).forEach(i => {
                el.innerHTML += `<option value="${i.v}">${i.t}</option>`;
                if(i.v === curVal) found = true;
            });
        } else { 
            arr.sort().forEach(m => {
                let text = prefixMap[m] ? `${prefixMap[m]} ${m}` : m;
                el.innerHTML += `<option value="${m}">${text}</option>`;
                if(m === curVal) found = true;
            });
        }

        if(!isInitial) {
            if(found) el.value = curVal; 
            else el.value = "ALL"; 
        }
    };

    rellenar('fTipo', sets.tipo, 'Tipo', vTipo, {"I": "Ingreso (I)", "E": "Egreso (E)", "P": "Pago (P)"});
    rellenar('fMes', sets.mes, 'Mes Emisión', vMes);
    rellenar('fEstatus', sets.est, 'Estatus SAT', vEst, {"Vigente": "🟢", "Cancelado": "🔴", "Error": "⚠️"});

    if(isInitial) renderizarTablaUI();
}

function renderizarTablaUI() {
    const vTipo = document.getElementById('fTipo').value;
    const vMes = document.getElementById('fMes').value;
    const vEst = document.getElementById('fEstatus').value;

    let htmlFinal = "";
    rawDataForFilters.forEach(f => {
        let show = true;
        if (proveedoresSeleccionados.size > 0 && !proveedoresSeleccionados.has(f.nombreEmisor)) show = false;
        if (vTipo !== "ALL" && f.tipo !== vTipo) show = false;
        if (vMes !== "ALL" && f.mesEmisionVal !== vMes) show = false;
        if (vEst !== "ALL" && f.estatusLimpio !== vEst) show = false;

        if (show) {
            let colorBadge = "bg-gray-100 text-gray-800";
            let icono = "";
            if(f.estatusLimpio === "Vigente") { colorBadge = "bg-green-100 text-green-800"; icono = "🟢"; }
            if(f.estatusLimpio === "Cancelado") { colorBadge = "bg-red-100 text-red-800"; icono = "🔴"; }
            if(f.estatusLimpio === "Error") { colorBadge = "bg-amber-100 text-amber-800"; icono = "⚠️"; }

            htmlFinal += `
            <tr class="hover:bg-emerald-50/50 transition border-b">
                <td class="p-3 align-top">
                    <div class="font-mono text-blue-700 font-bold">${f.rfcEmisor}</div>
                    <div class="text-[10px] text-slate-500 truncate w-48" title="${f.nombreEmisor}">${f.nombreEmisor}</div>
                </td>
                <td class="p-3 align-top text-[11px] text-slate-700 font-mono">${f.uuid}</td>
                <td class="p-3 align-top font-medium">${formatDateToMX(f.fechaCruda)}</td>
                <td class="p-3 align-top text-center font-bold text-slate-500">${f.tipo}</td>
                <td class="p-3 text-right tabular-nums align-top">$${f.subTotal.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                <td class="p-3 text-right tabular-nums text-slate-500 align-top">$${f.totalTraslados.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                <td class="p-3 text-right tabular-nums text-red-500 align-top">$${f.totalRetenciones.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                <td class="p-3 text-right tabular-nums font-bold align-top">$${f.total.toLocaleString('es-MX', {minimumFractionDigits:2})}</td>
                <td class="p-3 text-center align-top"><span class="px-2 py-1 rounded text-[10px] font-bold ${colorBadge} border">${icono} ${f.satEstatus}</span></td>
                <td class="p-3 text-[10px] text-slate-500 italic align-top">
                    ${f.satCancelable} <br> <span class="font-semibold text-slate-700">${f.satMotivo}</span>
                </td>
            </tr>`;
        }
    });

    if(htmlFinal === "") htmlFinal = "<tr><td colspan='10' class='p-12 text-center text-slate-500'>Sin resultados para los filtros actuales.</td></tr>";
    document.getElementById('cuerpoTabla').innerHTML = htmlFinal;
}

// Exportación Exacta Respetando Filtros
document.getElementById('btnDescargar').addEventListener('click', () => {
    const vTipo = document.getElementById('fTipo').value;
    const vMes = document.getElementById('fMes').value;
    const vEst = document.getElementById('fEstatus').value;

    let dataExportar = [];

    rawDataForFilters.forEach(f => {
        let show = true;
        if (proveedoresSeleccionados.size > 0 && !proveedoresSeleccionados.has(f.nombreEmisor)) show = false;
        if (vTipo !== "ALL" && f.tipo !== vTipo) show = false;
        if (vMes !== "ALL" && f.mesEmisionVal !== vMes) show = false;
        if (vEst !== "ALL" && f.estatusLimpio !== vEst) show = false;

        if (show) {
            dataExportar.push({
                "RFC Emisor": f.rfcEmisor,
                "Nombre Emisor": f.nombreEmisor,
                "RFC Receptor": f.rfcReceptor,
                "UUID": f.uuid,
                "Fecha Emisión": formatDateToMX(f.fechaCruda),
                "Tipo Comprobante": f.tipo,
                "SubTotal MXN": parseFloat(f.subTotal.toFixed(2)),
                "Traslados MXN": parseFloat(f.totalTraslados.toFixed(2)),
                "Retenciones MXN": parseFloat(f.totalRetenciones.toFixed(2)),
                "Total MXN": parseFloat(f.total.toFixed(2)),
                "Estatus SAT": f.satEstatus,
                "Es Cancelable": f.satCancelable,
                "Motivo/Estatus Cancelación": f.satMotivo
            });
        }
    });

    if(dataExportar.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(dataExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Auditoria_SAT");
    XLSX.writeFile(wb, "Reporte_Validacion_XML.xlsx");
});

// Se comprueba el permiso al entrar, no al enviar.
document.addEventListener("DOMContentLoaded", function () {
    Fiscontable.exigirModulo("validador");
});
