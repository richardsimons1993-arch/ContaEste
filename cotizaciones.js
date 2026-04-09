const { useState, useEffect, useMemo, useRef } = React;

const QuotationsApp = () => {
    const [clients, setClients] = useState([]);
    const [selectedClient, setSelectedClient] = useState('');
    const [projectName, setProjectName] = useState('');
    const [requirements, setRequirements] = useState('');
    const [techConditions, setTechConditions] = useState('');
    const [commercialConditions, setCommercialConditions] = useState('• Cotización con validez de 10 días hábiles desde fecha de emisión de propuesta.\n• Se considera aprobada solicitud al recibir Orden de Compra por la totalidad de la propuesta comercial o al depositar el 50% del mismo.');
    
    // Items Principales
    const [items, setItems] = useState([{ id: Date.now(), desc: '', qty: 1, price: 0 }]);
    // Items Opcionales
    const [optionals, setOptionals] = useState([]);
    
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [nextId, setNextId] = useState(1);
    const [currentVersion, setCurrentVersion] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false);
    
    // Historial
    const [activeTab, setActiveTab] = useState('generator'); // 'generator' | 'history'
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const pdfRef = useRef();

    useEffect(() => {
        loadData();
        fetchHistory(); // Cargar historial al inicio también

        // Polling para sincronizar con el estado de Finanzas si cambia
        const syncInterval = setInterval(() => {
            if (window.state && window.state.clients) {
                setClients(prev => {
                    // Solo actualizar si hay una diferencia en la cantidad para evitar re-renders innecesarios
                    if (prev.length !== window.state.clients.length) {
                        return window.state.clients;
                    }
                    return prev;
                });
            }
        }, 1500);

        return () => clearInterval(syncInterval);
    }, []);

    const loadData = async () => {
        try {
            // Utilizar el estado global ya cargado en Finanzas si está disponible
            let clientsData = window.state && window.state.clients ? window.state.clients : [];
            if (clientsData.length > 0) {
                setClients(clientsData);
            }
            const year = new Date().getFullYear();
            setCurrentYear(year);
        } catch (error) {
            console.error("Error cargando datos:", error);
        }
    };

    useEffect(() => {
        if (!selectedClient) {
            setNextId(1);
            setCurrentVersion(1);
            return;
        }
        const fetchNextIdVal = async () => {
            try {
                const activeClient = clients.find(c => c.id === selectedClient);
                if (!activeClient) return;

                const name = activeClient.nombreFantasia || activeClient.razonSocial || 'XXX';
                const prefix = name.replace(/[^A-Za-z\u00C0-\u017F]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');

                const idData = await window.StorageAPI.async.getNextQuotationId(prefix, currentYear);
                setNextId(idData.nextId);
                setCurrentVersion(1); // Default para nuevas
            } catch (err) {
                console.warn("Error correlativo:", err);
            }
        };
        fetchNextIdVal();
    }, [selectedClient, currentYear]);

    const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
            const data = await window.StorageAPI.async.getQuotations();
            console.log("Historial recibido:", data);
            if (Array.isArray(data)) {
                setHistory(data);
            } else {
                console.error("Error en historial:", data);
                setHistory([]);
            }
        } catch (err) {
            console.error("Error historial:", err);
            setHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'history') fetchHistory();
    }, [activeTab]);

    // Cálculos
    const formatMoney = (val) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(val);
    
    const subtotalItems = items.reduce((acc, curr) => acc + (Number(curr.qty) * Number(curr.price)), 0);
    const subtotalOptionals = optionals.reduce((acc, curr) => acc + (Number(curr.qty) * Number(curr.price)), 0);
    
    // Formateo de entrada de números con puntos de miles
    const formatInputNumber = (val) => {
        if (val === undefined || val === null || val === '') return '';
        const numStr = String(val).replace(/\D/g, ''); // Solo dígitos
        if (numStr === '') return '';
        return new Intl.NumberFormat('es-CL').format(parseInt(numStr, 10));
    };

    const parseInputNumber = (str) => {
        if (!str) return 0;
        const num = parseInt(String(str).replace(/\D/g, ''), 10);
        return isNaN(num) ? 0 : num;
    };
    const subtotalMains = subtotalItems; 
    // Nota: Generalmente el IVA y Total se calculan solo sobre lo principal, u opcional, 
    // asuminos que el Subtotal Total de la cotización es lo principal + opcional si el cliente lo elige, 
    // pero para el documento base calculamos todo sumado como referencia, o mostramos los opcionales aparte.
    const iva = subtotalMains * 0.19;
    const total = subtotalMains + iva;

    const activeClient = clients.find(c => c.id === selectedClient);
    let activePrefix = 'INO';
    let selectedClientName = '[Seleccione un Cliente]';
    if (activeClient) {
        selectedClientName = activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente Sin Nombre';
        activePrefix = selectedClientName.replace(/[^A-Za-z\u00C0-\u017F]/g, '').substring(0, 3).toUpperCase();
        if (activePrefix.length < 3) activePrefix = activePrefix.padEnd(3, 'X');
    }
    const displayId = selectedClient ? `${activePrefix}-${currentYear}-${String(nextId).padStart(2, '0')}` : '(Seleccione Cliente)';

    // Manejadores de tablas
    const handleItemChange = (setState, list, id, field, value) => {
        setState(list.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const addItem = (setState, list) => {
        setState([...list, { id: Date.now(), desc: '', qty: 1, price: 0 }]);
    };

    const removeItem = (setState, list, id) => {
        setState(list.filter(item => item.id !== id));
    };

    let sectionCounter = 1;
    const nClient = sectionCounter++;
    const nReq = (requirements && requirements.trim()) ? sectionCounter++ : null;
    const nTech = (techConditions && techConditions.trim()) ? sectionCounter++ : null;
    const nProp = sectionCounter++;
    const nCom = (commercialConditions && commercialConditions.trim()) ? sectionCounter++ : null;

    const handleGenerate = async () => {
        if (!selectedClient) {
            alert("Debe seleccionar un cliente.");
            return;
        }
        
        setIsGenerating(true);
        const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
        const formattedId = displayId;
        const versionSuffix = currentVersion > 1 ? `_v${currentVersion}` : '';
        let spacer = null;
        try {
            // Generar PDF con html2pdf
            const element = pdfRef.current;
            const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const fileName = `Cotizacion_${formattedId}${safeProjectName}${versionSuffix}.pdf`;

            // Detectar si el bloque final (condiciones + firma) se dividiría entre páginas
            // Si se dividiría, le pasamos '.void-break' a html2pdf para que fuerce el salto
            let needsBreakBefore = false;
            const finalBlock = element.querySelector('.void-break');
            if (finalBlock) {
                // html2canvas renderiza el contenedor a 794px de ancho
                const canvasScale = 794 / element.offsetWidth;

                const containerTop  = element.getBoundingClientRect().top;
                const blockTop      = (finalBlock.getBoundingClientRect().top - containerTop) * canvasScale;
                const blockBottom   = (finalBlock.getBoundingClientRect().bottom - containerTop) * canvasScale;

                // Lógica "Safety First": Altura virtual conservadora (1150px)
                // Esto garantiza que detectemos el corte ANTES que el motor de PDF del navegador.
                const PAGE_H = 1150; 
                const currentPosOnPage = blockTop % PAGE_H;
                const availableSpace = PAGE_H - currentPosOnPage;
                const blockHeightWithBuffer = (blockBottom - blockTop) + 50; // 50px buffer de seguridad

                needsBreakBefore = (blockHeightWithBuffer > availableSpace);
                
                console.log(`[PDF] Block Detection: pos=${currentPosOnPage.toFixed(0)} available=${availableSpace.toFixed(0)} heightWithBuffer=${blockHeightWithBuffer.toFixed(0)} break=${needsBreakBefore}`);
            }

            const opt = {
                margin:       [10, 10],
                filename:     fileName,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { 
                    scale: 2, 
                    useCORS: true, 
                    width: 794,
                    letterRendering: true,
                    logging: false
                },
                jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' },
                // Si el bloque se dividiría, html2pdf fuerza un salto ANTES de .void-break
                pagebreak:    needsBreakBefore
                    ? { mode: 'css', before: ['.void-break'] }
                    : { mode: 'css' }
            };
            
            // 1. Descarga Local Inmediata
            await html2pdf().from(element).set(opt).save();

            // 2. Obtener Base64 para OneDrive
            const pdfBase64 = await html2pdf().from(element).set(opt).outputPdf('datauristring');
            
            // 3. Guardar en Base de Datos SQL
            const qData = {
                id: formattedId,
                correlative: nextId,
                year: currentYear,
                version: currentVersion,
                clientId: selectedClient,
                clientName: clientName,
                projectName: projectName,
                requirements: requirements,
                technicalConditions: techConditions,
                commercialConditions: commercialConditions,
                items1: items,
                itemsOptional: optionals,
                subtotal: subtotalMains,
                iva: iva,
                total: total
            };
            
            await window.StorageAPI.async.saveQuotation(qData);
            
            // 4. Enviar a OneDrive
            await window.StorageAPI.async.saveQuotationPdf({
                clientName: clientName,
                year: currentYear,
                quotationId: formattedId + versionSuffix,
                pdfBase64: pdfBase64
            });
            
            fetchHistory();
            if (currentVersion <= 1) setNextId(nextId + 1);
            
        } catch (error) {
            console.error(error);
            alert("Error en la generación: " + error.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleEditFromHistory = async (q) => {
        try {
            // Cargar datos
            setSelectedClient(q.clientId);
            setProjectName(q.projectName || '');
            setRequirements(q.requirements || '');
            setTechConditions(q.technicalConditions || '');
            setCommercialConditions(q.commercialConditions || '');
            setItems(JSON.parse(q.items1 || '[]'));
            setOptionals(JSON.parse(q.itemsOptional || '[]'));
            
            // Calcular siguiente versión para este ID exacto
            const vData = await window.StorageAPI.async.getQuotationNextVersion(q.id);
            setCurrentVersion(vData.nextVersion);
            
            // No cambiar el correlativo visual ni el año
            setNextId(q.correlative);
            setCurrentYear(q.year);

            setActiveTab('generator');
            alert(`Editando Cotización ${q.id}. Se guardará como versión ${vData.nextVersion}.`);
        } catch (err) {
            alert("Error al cargar para edición.");
        }
    };

    const handleDeleteFromHistory = async (id, version) => {
        if (!confirm(`¿Está seguro de eliminar la versión ${version} de la cotización ${id}?`)) return;
        try {
            await window.StorageAPI.async.deleteQuotation(id, version);
            fetchHistory();
        } catch (err) {
            alert("Error al eliminar.");
        }
    };

    const renderTableInput = (list, setList, title) => {
        const addItemLocal = () => addItem(setList, list);
        const removeItemLocal = (id) => removeItem(setList, list, id);

        return (
            <div className="tw-bg-white tw-rounded-lg tw-shadow-sm tw-border tw-border-slate-200 tw-p-4 tw-mb-6">
                <div className="tw-flex tw-justify-between tw-items-center tw-mb-4">
                    <h3 className="tw-font-semibold tw-text-slate-800">{title}</h3>
                    <button onClick={addItemLocal} className="tw-text-sm tw-text-googleBlue hover:tw-underline tw-font-medium">
                        + Añadir Fila
                    </button>
                </div>
                
                <div className="tw-overflow-x-auto">
                    <table className="tw-w-full">
                        <thead>
                            <tr className="tw-text-[10px] tw-font-bold tw-text-slate-400 tw-uppercase tw-tracking-wider tw-border-b tw-border-slate-100">
                                <th className="tw-text-left tw-pb-2 tw-w-20">Cant.</th>
                                <th className="tw-text-left tw-pb-2">Descripción</th>
                                <th className="tw-text-right tw-pb-2 tw-w-36">Precio Unit. (CLP)</th>
                                <th className="tw-w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((item) => (
                                <tr key={item.id} className="tw-border-b tw-border-slate-50 last:tw-border-0">
                                    <td className="tw-py-2 tw-pr-2">
                                        <input 
                                            type="text" 
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-sm tw-text-center"
                                            value={formatInputNumber(item.qty)}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'qty', parseInputNumber(e.target.value))}
                                        />
                                    </td>
                                    <td className="tw-py-2">
                                        <input 
                                            type="text" 
                                            placeholder="Detalle..."
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-sm"
                                            value={item.desc}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'desc', e.target.value)}
                                        />
                                    </td>
                                    <td className="tw-py-2 tw-pl-2">
                                        <input 
                                            type="text" 
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-sm tw-text-right"
                                            value={formatInputNumber(item.price)}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'price', parseInputNumber(e.target.value))}
                                        />
                                    </td>
                                    <td className="tw-py-2 tw-text-center">
                                        <button onClick={() => removeItemLocal(item.id)} className="tw-text-red-400 hover:tw-text-red-600">
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {list.length === 0 && <div className="tw-text-sm tw-text-slate-500 tw-italic tw-mt-2">Sin ítems.</div>}
                </div>
            </div>
        );
    };

    return (
        <div className="tw-flex tw-flex-col tw-min-h-full tw-bg-slate-50 tw-font-sans">
            {activeTab === 'generator' ? (
                <div className="tw-flex tw-flex-1 tw-overflow-hidden">
                    {/* Panel Izquierdo: Formulario */}
                    <div className="tw-w-1/2 tw-h-full tw-overflow-y-auto tw-border-r tw-border-slate-200 tw-p-6 scrollbar-hide">
                        <div className="tw-mb-6">
                            <div className="tw-flex tw-justify-between tw-items-center">
                                <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">
                                    Generador de Cotizaciones
                                </h2>
                                <div className="tw-text-right">
                                    <span className="tw-px-3 tw-py-1 tw-bg-indigo-100 tw-text-indigo-800 tw-rounded-full tw-text-sm tw-font-semibold">
                                        N° {displayId}
                                    </span>
                                    {currentVersion > 1 && (
                                        <div className="tw-text-[10px] tw-font-bold tw-text-indigo-600 tw-mt-1">VERSION {currentVersion}</div>
                                    )}
                                </div>
                            </div>
                            <div className="tw-mt-4">
                                <button 
                                    onClick={() => setActiveTab('history')}
                                    className="tw-bg-slate-100 tw-text-googleBlue tw-px-4 tw-py-2 tw-rounded-lg tw-text-xs tw-font-bold hover:tw-bg-googleBlue hover:tw-text-white tw-transition-all tw-flex tw-items-center tw-shadow-sm"
                                >
                                    <i className="fa-solid fa-clock-rotate-left tw-mr-2"></i>VER HISTORIAL DE COTIZACIONES
                                </button>
                            </div>
                        </div>

                        <div className="tw-space-y-6">
                            {/* Cliente */}
                            <div className="tw-bg-white tw-p-4 tw-rounded-lg tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-semibold tw-text-slate-700 tw-mb-2">Cliente</label>
                                <select 
                                    className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded focus:tw-border-googleBlue focus:tw-outline-none"
                                    value={selectedClient}
                                    onChange={(e) => setSelectedClient(e.target.value)}
                                >
                                    <option value="">-- Seleccionar Cliente --</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreFantasia || c.razonSocial}</option>)}
                                </select>
                            </div>

                            {/* Nombre del Proyecto */}
                            <div className="tw-bg-white tw-p-4 tw-rounded-lg tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-semibold tw-text-slate-700 tw-mb-2">Nombre del Proyecto</label>
                                <input 
                                    type="text" 
                                    className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded focus:tw-border-googleBlue focus:tw-outline-none"
                                    placeholder="Ej: Instalación de Puntos de Red U7"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                />
                            </div>

                            {/* Textos */}
                            <div className="tw-bg-white tw-p-4 tw-rounded-lg tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-semibold tw-text-slate-700 tw-mb-2">Requerimiento de Proyecto</label>
                                <textarea 
                                    className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded focus:tw-border-googleBlue focus:tw-outline-none tw-mb-4"
                                    rows="3"
                                    placeholder="Ej: Suministro e instalación de puntos de red..."
                                    value={requirements}
                                    onChange={(e) => setRequirements(e.target.value)}
                                ></textarea>

                                <label className="tw-block tw-text-sm tw-font-semibold tw-text-slate-700 tw-mb-2">Consideraciones Técnicas (Estándares)</label>
                                <textarea 
                                    className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded focus:tw-border-googleBlue focus:tw-outline-none tw-mb-4"
                                    rows="3"
                                    value={techConditions}
                                    onChange={(e) => setTechConditions(e.target.value)}
                                ></textarea>

                                <label className="tw-block tw-text-sm tw-font-semibold tw-text-slate-700 tw-mb-2">Condiciones Comerciales</label>
                                <textarea 
                                    className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded focus:tw-border-googleBlue focus:tw-outline-none"
                                    rows="4"
                                    value={commercialConditions}
                                    onChange={(e) => setCommercialConditions(e.target.value)}
                                ></textarea>
                            </div>

                            {/* Tablas */}
                            {renderTableInput(items, setItems, "Propuesta Económica (Principal)")}
                            {renderTableInput(optionals, setOptionals, "Items Opcionales / Adicionales")}

                            {/* Acciones */}
                            <div className="tw-pt-4 tw-pb-10">
                                <button 
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                    className={`tw-w-full tw-py-3 tw-rounded-lg tw-font-semibold tw-text-white tw-shadow-md tw-transition-colors ${isGenerating ? 'tw-bg-slate-400' : 'tw-bg-googleBlue hover:tw-bg-blue-700'}`}
                                >
                                    {isGenerating ? <span><i className="fa-solid fa-circle-notch fa-spin tw-mr-2"></i> Generando y Guardando...</span> : <span><i className="fa-solid fa-file-pdf tw-mr-2"></i> Generar Cotización PDF</span>}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Panel Derecho: Live Preview (A4 Paper Style) */}
                    <div className="tw-w-1/2 tw-h-full tw-overflow-y-auto tw-bg-slate-200 tw-p-8 tw-flex tw-justify-center scrollbar-hide">
                        <div 
                            id="pdf-content" 
                            ref={pdfRef}
                            className="tw-bg-white tw-w-[215.9mm] tw-relative tw-block tw-text-slate-800"
                            style={{ 
                                boxSizing: 'border-box', 
                                border: 'none',
                                boxShadow: '0 0 40px rgba(0,0,0,0.1)',
                                padding: '10mm', // Margen exacto del PDF
                                minHeight: '279.4mm', // Altura de hoja Letter
                                pageBreakInside: 'auto' 
                            }}
                        >
                            {/* Guías de Salto de Página - Dinámicas por recorte CSS (No requiere re-renders) */}
                            <div className="tw-absolute tw-inset-0 tw-overflow-hidden tw-pointer-events-none" data-html2canvas-ignore="true">
                                {[1, 2, 3, 4, 5, 6].map(page => (
                                    <div
                                        key={page}
                                        style={{
                                            position: 'absolute',
                                            left: 0,
                                            right: 0,
                                            // 1150px = Altura virtual de seguridad para detección de cortes
                                            top: `calc(${page} * (1150px / ${794 / 215.9}))`,
                                            zIndex: 50
                                        }}
                                    >
                                        <div style={{ borderTop: '2px dashed #3b82f6', width: '100%', position: 'relative' }}>
                                            <span style={{
                                                position: 'absolute',
                                                right: '8px',
                                                top: '4px',
                                                fontSize: '10px',
                                                fontWeight: 700,
                                                color: '#3b82f6',
                                                backgroundColor: 'white',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                boxShadow: '0 1px 3px rgba(59,130,246,0.3)',
                                                letterSpacing: '0.05em',
                                                userSelect: 'none'
                                            }}>
                                                PÁGINA {page + 1}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Cabecera Cotizacion */}
                            <div className="tw-border-b-2 tw-border-slate-800 tw-pb-6 tw-mb-6 tw-flex tw-justify-between tw-items-center">
                                <div>
                                    <h1 className="tw-text-3xl tw-font-bold tw-text-slate-900 tw-tracking-tight">COTIZACIÓN</h1>
                                    <p className="tw-text-lg tw-text-[#004d4d] tw-font-semibold tw-mt-1">
                                        N° {displayId}
                                    </p>
                                    {currentVersion > 1 && (
                                        <p className="tw-text-[10px] tw-text-slate-400 tw-font-bold tw-uppercase tw-mt-0">Versión {currentVersion}</p>
                                    )}
                                    {projectName && (
                                        <p className="tw-text-base tw-text-[#004d4d] tw-font-medium tw-mt-1">
                                            Proyecto: {projectName}
                                        </p>
                                    )}
                                </div>
                                <div className="tw-text-right">
                                    <img src="logo.png" alt="Simons Logo" className="tw-h-12 tw-object-contain tw-ml-auto" />
                                    <p className="tw-text-xs tw-text-slate-500 tw-mt-2">Simons SPA - Soluciones Tecnológicas</p>
                                    <p className="tw-text-xs tw-text-slate-500">Fecha: {new Date().toLocaleDateString('es-CL')}</p>
                                </div>
                            </div>

                            {/* Contenido Dinámico */}
                            <div className="tw-block">
                                <div style={{ pageBreakInside: 'avoid' }} className="tw-mb-8">
                                    <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-[#004d4d] tw-text-slate-800 tw-uppercase tw-mb-2">{nClient}. Cliente</h4>
                                    <p className="tw-text-base tw-text-slate-700 tw-ml-2 tw-text-justify">{selectedClientName}</p>
                                </div>

                                {requirements && (
                                    <div style={{ pageBreakInside: 'avoid' }} className="tw-mb-8">
                                        <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-[#004d4d] tw-text-slate-800 tw-uppercase tw-mb-2">{nReq}. Requerimiento</h4>
                                        <p className="tw-text-sm tw-text-slate-700 tw-whitespace-pre-wrap tw-leading-relaxed tw-ml-2 tw-text-justify">{requirements}</p>
                                    </div>
                                )}

                                {techConditions && (
                                    <div style={{ pageBreakInside: 'avoid' }} className="tw-mb-8">
                                        <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-[#004d4d] tw-text-slate-800 tw-uppercase tw-mb-2">{nTech}. Consideraciones Técnicas y Estándares</h4>
                                        <p className="tw-text-sm tw-text-slate-700 tw-whitespace-pre-wrap tw-leading-relaxed tw-ml-2 tw-text-justify">{techConditions}</p>
                                    </div>
                                )}

                                <div style={{ pageBreakInside: 'avoid' }} className="tw-mb-8">
                                    <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-[#004d4d] tw-text-slate-800 tw-uppercase tw-mb-2">{nProp}. Propuesta Económica</h4>
                                    <table className="tw-w-full tw-text-sm tw-text-left tw-border-collapse">
                                        <thead>
                                            <tr className="tw-bg-slate-800 tw-text-white">
                                                <th className="tw-py-2 tw-px-3 tw-w-16">Cant.</th>
                                                <th className="tw-py-2 tw-px-3">Descripción</th>
                                                <th className="tw-py-2 tw-px-3 tw-text-right tw-w-28">P. Unitario</th>
                                                <th className="tw-py-2 tw-px-3 tw-text-right tw-w-28">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item) => (
                                                <tr key={item.id} className="tw-border-b tw-border-slate-200">
                                                    <td className="tw-py-2 tw-px-3 tw-text-center">{item.qty}</td>
                                                    <td className="tw-py-2 tw-px-3">{item.desc || '-'}</td>
                                                    <td className="tw-py-2 tw-px-3 tw-text-right">{formatMoney(item.price)}</td>
                                                    <td className="tw-py-2 tw-px-3 tw-text-right tw-font-medium">{formatMoney(item.qty * item.price)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <div className="tw-flex tw-justify-end tw-mt-4">
                                        <div className="tw-w-64">
                                            <div className="tw-flex tw-justify-between tw-py-1 tw-text-sm">
                                                <span className="tw-text-slate-600">Subtotal NETO:</span>
                                                <span className="tw-font-medium">{formatMoney(subtotalMains)}</span>
                                            </div>
                                            <div className="tw-flex tw-justify-between tw-py-1 tw-text-sm border-b border-slate-200">
                                                <span className="tw-text-slate-600">IVA (19%):</span>
                                                <span className="tw-font-medium">{formatMoney(iva)}</span>
                                            </div>
                                            <div className="tw-flex tw-justify-between tw-py-2 tw-text-base tw-font-bold tw-text-[#004d4d]">
                                                <span>TOTAL:</span>
                                                <span>{formatMoney(total)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {optionals.length > 0 && (
                                    <div style={{ pageBreakInside: 'avoid' }} className="tw-mb-8">
                                        <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-orange-400 tw-text-slate-800 tw-uppercase tw-mb-2">Ítems Opcionales Sugeridos</h4>
                                        <table className="tw-w-full tw-text-sm tw-text-left tw-border-collapse">
                                            <thead>
                                                <tr className="tw-bg-slate-100 tw-text-slate-700 tw-border-b-2 tw-border-slate-300">
                                                    <th className="tw-py-2 tw-px-3 tw-w-16">Cant.</th>
                                                    <th className="tw-py-2 tw-px-3">Descripción</th>
                                                    <th className="tw-py-2 tw-px-3 tw-text-right tw-w-32">P. Unitario</th>
                                                    <th className="tw-py-2 tw-px-3 tw-text-right tw-w-32">Total Opcional</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {optionals.map((item) => (
                                                    <tr key={item.id} className="tw-border-b tw-border-slate-200">
                                                        <td className="tw-py-2 tw-px-3 tw-text-center">{item.qty}</td>
                                                        <td className="tw-py-2 tw-px-3 tw-text-slate-600 italic">{item.desc || '-'}</td>
                                                        <td className="tw-py-2 tw-px-3 tw-text-right">{formatMoney(item.price)}</td>
                                                        <td className="tw-py-2 tw-px-3 tw-text-right tw-font-medium tw-text-slate-700">{formatMoney(item.qty * item.price)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Bloque de Firma + Datos inyectado para evitar saltos dentro de él */}
                                <div className="tw-w-full tw-mt-4 void-break" style={{ breakInside: 'avoid', pageBreakInside: 'avoid', borderTop: 'none', display: 'block', overflow: 'hidden' }}>
                                    {(commercialConditions && commercialConditions.trim() !== '') && (
                                        <div className="tw-mb-6">
                                            <h4 className="tw-text-sm tw-font-bold tw-bg-slate-100 tw-p-2 tw-border-l-4 tw-border-[#004d4d] tw-text-slate-800 tw-uppercase tw-mb-2">
                                                {nCom}. Condiciones Comerciales
                                            </h4>
                                            <div className="tw-text-sm tw-text-slate-700 tw-whitespace-pre-wrap tw-leading-relaxed tw-ml-2 tw-text-justify">
                                                {commercialConditions}
                                            </div>
                                        </div>
                                    )}

                                    <div className="tw-pt-6 tw-border-t-2 tw-border-slate-800 tw-w-full">
                                        <div className="tw-flex tw-justify-between tw-items-end">
                                            <div className="tw-text-xs tw-text-slate-600 tw-leading-relaxed">
                                                <p className="tw-font-bold tw-text-slate-800 tw-mb-1 tw-uppercase">Datos de Transferencia</p>
                                                <p>Titular: SIMONS SPA</p>
                                                <p>RUT: 77.475.581-0</p>
                                                <p>Banco: Banco de Chile</p>
                                                <p>Tipo de Cuenta: Cuenta Corriente</p>
                                                <p>Número de cuenta: 1483514107</p>
                                                <p>Mail: pagos@simons.cl</p>
                                            </div>
                                            
                                            <div className="tw-text-center tw-w-48">
                                                <div className="tw-border-b tw-border-slate-300 tw-pb-2 tw-mb-2">
                                                     <span className="tw-font-signature tw-text-3xl tw-text-[#004d4d]" style={{ fontFamily: "'Dancing Script', cursive" }}>Richard Simons</span>
                                                </div>
                                                <p className="tw-text-sm tw-font-bold tw-text-slate-800">Richard Simons</p>
                                                <p className="tw-text-xs tw-text-slate-500">Fundador</p>
                                                <img src="logo.png" alt="Simons" className="tw-h-4 tw-opacity-50 tw-mx-auto tw-mt-2" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* VISTA HISTORIAL */
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-8">
                    <div className="tw-max-w-6xl tw-mx-auto">
                        <div className="tw-flex tw-justify-between tw-items-center tw-mb-8">
                            <div>
                                <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">Historial de Cotizaciones (Últimos 90 días)</h2>
                                <button 
                                    onClick={() => setActiveTab('generator')}
                                    className="tw-text-sm tw-font-bold tw-text-googleBlue hover:tw-underline tw-flex tw-items-center tw-mt-2"
                                >
                                    <i className="fa-solid fa-arrow-left tw-mr-2"></i>Volver al Generador
                                </button>
                            </div>
                            <div className="tw-relative">
                                <i className="fa-solid fa-magnifying-glass tw-absolute tw-left-3 tw-top-3 tw-text-slate-400"></i>
                                <input 
                                    type="text" 
                                    placeholder="Buscar por cliente o proyecto..."
                                    className="tw-pl-10 tw-pr-4 tw-py-2 tw-border tw-border-slate-300 tw-rounded-lg tw-w-80 focus:tw-outline-none focus:tw-border-googleBlue"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <button 
                                    onClick={fetchHistory}
                                    className="tw-ml-2 tw-p-2 tw-bg-white tw-border tw-border-slate-300 tw-rounded-lg hover:tw-bg-slate-50 tw-text-slate-600"
                                    title="Actualizar Historial"
                                >
                                    <i className={`fa-solid fa-arrows-rotate ${historyLoading ? 'fa-spin' : ''}`}></i>
                                </button>
                            </div>
                        </div>

                        {historyLoading ? (
                            <div className="tw-text-center tw-py-20">
                                <i className="fa-solid fa-circle-notch fa-spin tw-text-4xl tw-text-slate-300"></i>
                                <p className="tw-mt-4 tw-text-slate-500">Cargando historial...</p>
                            </div>
                        ) : (
                            <div className="tw-bg-white tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-overflow-hidden">
                                <table className="tw-w-full tw-text-sm tw-text-left">
                                    <thead className="tw-bg-slate-50 tw-text-slate-600 tw-font-bold tw-border-b tw-border-slate-200">
                                        <tr>
                                            <th className="tw-px-6 tw-py-4">ID</th>
                                            <th className="tw-px-6 tw-py-4">Versión</th>
                                            <th className="tw-px-6 tw-py-4">Cliente</th>
                                            <th className="tw-px-6 tw-py-4">Proyecto</th>
                                            <th className="tw-px-6 tw-py-4">Fecha</th>
                                            <th className="tw-px-6 tw-py-4">Total</th>
                                            <th className="tw-px-6 tw-py-4 tw-text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="tw-divide-y tw-divide-slate-100">
                                        {history
                                            .filter(q => {
                                                const name = (q.clientName || '').toLowerCase();
                                                const project = (q.projectName || '').toLowerCase();
                                                const qid = (q.id || '').toLowerCase();
                                                const term = (searchTerm || '').toLowerCase();
                                                return name.includes(term) || project.includes(term) || qid.includes(term);
                                            })
                                            .map(q => (
                                                <tr key={`${q.id}-${q.version}`} className="hover:tw-bg-slate-50 tw-transition-colors">
                                                    <td className="tw-px-6 tw-py-4 tw-font-bold tw-text-slate-700">{q.id}</td>
                                                    <td className="tw-px-6 tw-py-4">
                                                        <span className="tw-px-2 tw-py-0.5 tw-bg-slate-100 tw-text-slate-600 tw-rounded tw-text-xs tw-font-bold">v{q.version}</span>
                                                    </td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-600">{q.clientName}</td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-600 tw-max-w-xs tw-truncate">{q.projectName || '---'}</td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-500">
                                                        {q.createdAt ? (new Date(q.createdAt).toLocaleDateString('es-CL')) : '---'}
                                                    </td>
                                                    <td className="tw-px-6 tw-py-4 tw-font-semibold tw-text-[#004d4d]">{formatMoney(q.total || 0)}</td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-right">
                                                        <div className="tw-flex tw-justify-end tw-gap-2">
                                                            <button 
                                                                onClick={() => handleEditFromHistory(q)}
                                                                className="tw-p-2 tw-text-googleBlue hover:tw-bg-blue-50 tw-rounded-lg tw-transition-colors"
                                                                title="Editar (Generar nueva versión)"
                                                            >
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteFromHistory(q.id, q.version)}
                                                                className="tw-p-2 tw-text-red-500 hover:tw-bg-red-50 tw-rounded-lg tw-transition-colors"
                                                                title="Eliminar de la BD"
                                                            >
                                                                <i className="fa-solid fa-trash"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                                {history.length === 0 && (
                                    <div className="tw-text-center tw-py-12 tw-text-slate-400">
                                        No hay cotizaciones registradas en los últimos 90 días.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Necesario si se va a inyectar directamente a ReactDOM (se maneja en app.js o se carga condicionalmente)
// Se proveerá una función initQuotations como con notas.js para inicializarlo dinámicamente

window.initQuotations = function() {
    const rootEl = document.getElementById('quotations-root');
    if (!rootEl) return;
    
    // Solo inicializar una vez
    if (!rootEl.hasChildNodes()) {
        console.log("Inicializando Módulo de Cotizaciones...");
        const root = ReactDOM.createRoot(rootEl);
        root.render(<QuotationsApp />);
    }
};

// Autoejecutar cuando Babel termine de transpilear
window.initQuotations();
