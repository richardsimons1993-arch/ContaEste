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

        try {
            const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
            const formattedId = displayId;
            const versionSuffix = currentVersion > 1 ? `_v${currentVersion}` : '';
            const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const fileName = `Cotizacion_${formattedId}${safeProjectName}${versionSuffix}.pdf`;

            // 1. Fetch logo
            let logoSvg = null;
            let logoBase64 = null;
            try {
                const svgRes = await fetch('icono.svg');
                if (svgRes.ok && svgRes.headers.get('content-type').includes('svg')) {
                    logoSvg = await svgRes.text();
                } else {
                    const logoRes = await fetch('logo.png');
                    const contentType = logoRes.headers.get('content-type');
                    if (logoRes.ok && contentType && contentType.startsWith('image/')) {
                        const logoBlob = await logoRes.blob();
                        logoBase64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(logoBlob);
                        });
                    }
                }
            } catch (e) {
                console.warn("Could not load logo for PDF");
            }

            // Inicializar fuentes de pdfMake (vital para evitar cuelgues)
            if (window.pdfMake && window.pdfMake.vfs === undefined && window.pdfMakeFonts !== undefined) {
                window.pdfMake.vfs = window.pdfMakeFonts.pdfMake.vfs;
            }

            // 2. Build PDF Definition
            const docDefinition = {
                pageSize: 'LETTER',
                pageMargins: [ 40, 35, 40, 40 ],
                content: [
                    // Cabecera
                    {
                        columns: [
                            {
                                width: '*',
                                stack: [
                                    { text: 'COTIZACIÓN', fontSize: 20, bold: true, color: '#0f172a', margin: [0, 0, 0, 5] },
                                    { text: `N° ${formattedId}`, fontSize: 12, bold: true, color: '#0f766e', margin: [0, 0, 0, 5] },
                                    (currentVersion > 1 ? { text: `VERSIÓN ${currentVersion}`, fontSize: 9, bold: true, color: '#94a3b8', margin: [0, 0, 0, 5] } : null),
                                    (projectName ? { text: `Proyecto: ${projectName}`, fontSize: 11, bold: true, color: '#0f766e' } : null)
                                ].filter(Boolean)
                            },
                            {
                                width: 200,
                                stack: [
                                    (logoSvg ? { svg: logoSvg, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : (logoBase64 ? { image: logoBase64, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : null)),
                                    { text: 'Simons SPA - Soluciones Tecnológicas', fontSize: 8, color: '#64748b', alignment: 'right' },
                                    { text: `Fecha: ${new Date().toLocaleDateString('es-CL')}`, fontSize: 8, color: '#64748b', alignment: 'right' }
                                ].filter(Boolean)
                            }
                        ],
                        margin: [0, 0, 0, 20]
                    },
                    // Línea separadora
                    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 2, lineColor: '#1e293b' }], margin: [0, 0, 0, 20] }
                ],
                defaultStyle: {
                    fontSize: 10,
                    color: '#334155'
                },
                styles: {
                    tableHeader: {
                        bold: true,
                        fontSize: 10,
                        color: 'white',
                        fillColor: '#0f766e',
                        alignment: 'center',
                        margin: [5, 4, 5, 4]
                    }
                }
            };

            const content = docDefinition.content;

            const buildSectionHeader = (title) => ({
                table: {
                    widths: [4, '*'],
                    body: [
                        [
                            { text: '', fillColor: '#0f766e', border: [false, false, false, false] },
                            { text: title, fillColor: '#f8fafc', border: [false, false, false, false], margin: [5, 4, 0, 4], color: '#1e293b', bold: true, fontSize: 10 }
                        ]
                    ]
                },
                layout: 'noBorders',
                margin: [0, 15, 0, 10]
            });

            // 1. Cliente
            content.push(
                buildSectionHeader(`${nClient}. CLIENTE`),
                { text: clientName, margin: [10, 0, 0, 15] }
            );

            // 2. Requerimiento
            if (requirements && requirements.trim()) {
                content.push(
                    buildSectionHeader(`${nReq}. REQUERIMIENTO`),
                    { text: requirements, margin: [10, 0, 0, 15] }
                );
            }

            // 3. Consideraciones Técnicas
            if (techConditions && techConditions.trim()) {
                content.push(
                    buildSectionHeader(`${nTech}. CONSIDERACIONES TÉCNICAS Y ESTÁNDARES`),
                    { text: techConditions, margin: [10, 0, 0, 15] }
                );
            }

            // 4. Propuesta Económica
            const tableBody = [
                [ 
                    { text: 'Cant.', style: 'tableHeader' }, 
                    { text: 'Descripción', style: 'tableHeader', alignment: 'left' }, 
                    { text: 'P. Unitario', style: 'tableHeader', alignment: 'right' }, 
                    { text: 'Total', style: 'tableHeader', alignment: 'right' } 
                ]
            ];

            items.forEach(item => {
                tableBody.push([
                    { text: item.qty.toString(), alignment: 'center' },
                    item.desc || '-',
                    { text: formatMoney(item.price), alignment: 'right' },
                    { text: formatMoney(item.qty * item.price), alignment: 'right', bold: true }
                ]);
            });

            content.push(
                buildSectionHeader(`${nProp}. PROPUESTA ECONÓMICA`),
                {
                    table: {
                        headerRows: 1,
                        widths: [40, '*', 80, 80],
                        body: tableBody
                    },
                    layout: 'lightHorizontalLines',
                    margin: [0, 0, 0, 10]
                }
            );

            // Totales
            content.push({
                columns: [
                    { width: '*', text: '' },
                    {
                        width: 200,
                        table: {
                            widths: ['*', 80],
                            body: [
                                [ { text: 'Subtotal NETO:', color: '#64748b', fontSize: 9 }, { text: formatMoney(subtotalMains), alignment: 'right', fontSize: 9 } ],
                                [ { text: 'IVA (19%):', color: '#64748b', fontSize: 9 }, { text: formatMoney(iva), alignment: 'right', fontSize: 9 } ],
                                [ { text: 'TOTAL:', color: '#0f766e', bold: true, fontSize: 11 }, { text: formatMoney(total), alignment: 'right', bold: true, fontSize: 11, color: '#0f172a' } ]
                            ]
                        },
                        layout: 'noBorders'
                    }
                ],
                margin: [0, 0, 0, 20]
            });

            // Ítems Opcionales
            if (optionals.length > 0) {
                const optTableBody = [
                    [ 
                        { text: 'Cant.', style: 'tableHeader', fillColor: '#f97316' }, 
                        { text: 'Descripción (Opcional)', style: 'tableHeader', alignment: 'left', fillColor: '#f97316' }, 
                        { text: 'P. Unitario', style: 'tableHeader', alignment: 'right', fillColor: '#f97316' }, 
                        { text: 'Total', style: 'tableHeader', alignment: 'right', fillColor: '#f97316' } 
                    ]
                ];

                optionals.forEach(item => {
                    optTableBody.push([
                        { text: item.qty.toString(), alignment: 'center' },
                        item.desc || '-',
                        { text: formatMoney(item.price), alignment: 'right' },
                        { text: formatMoney(item.qty * item.price), alignment: 'right', bold: true }
                    ]);
                });

                content.push(
                    buildSectionHeader(`ÍTEMS OPCIONALES SUGERIDOS`),
                    {
                        table: {
                            headerRows: 1,
                            widths: [40, '*', 80, 80],
                            body: optTableBody
                        },
                        layout: 'lightHorizontalLines',
                        margin: [0, 0, 0, 10]
                    }
                );
            }

            // Bloque inquebrantable: Condiciones comerciales y Firma
            const commercialBlock = [];
            
            if (commercialConditions && commercialConditions.trim()) {
                commercialBlock.push(
                    buildSectionHeader(`${nCom}. CONDICIONES COMERCIALES`),
                    { text: commercialConditions, margin: [10, 0, 0, 20] }
                );
            }

            commercialBlock.push(
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 2, lineColor: '#1e293b' }], margin: [0, 10, 0, 10] },
                { text: 'DATOS DE TRANSFERENCIA', fontSize: 9, bold: true, color: '#1e293b', margin: [0, 0, 0, 5] },
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 0.5, lineColor: '#cbd5e1' }], margin: [0, 5, 0, 10] },
                {
                    columns: [
                        {
                            width: '*',
                            stack: [
                                { text: 'Titular: SIMONS SPA', fontSize: 8, color: '#475569' },
                                { text: 'RUT: 77.475.581-0', fontSize: 8, color: '#475569' },
                                { text: 'Banco: Banco de Chile', fontSize: 8, color: '#475569' },
                                { text: 'Tipo de Cuenta: Cuenta Corriente', fontSize: 8, color: '#475569' },
                                { text: 'Número de cuenta: 1483514107', fontSize: 8, color: '#475569' },
                                { text: 'Mail: pagos@simons.cl', fontSize: 8, color: '#475569' }
                            ]
                        },
                        {
                            width: 200,
                            stack: [
                                { text: 'Richard Simons', fontSize: 18, color: '#0f766e', alignment: 'center', italics: true, margin: [0, 0, 0, 0] },
                                { canvas: [{ type: 'line', x1: 20, y1: 0, x2: 180, y2: 0, lineWidth: 0.5, lineColor: '#cbd5e1' }], margin: [0, 2, 0, 2] },
                                { text: 'Richard Simons', fontSize: 9, bold: true, alignment: 'center' },
                                { text: 'Fundador', fontSize: 8, color: '#64748b', alignment: 'center' },
                                (logoSvg ? { svg: logoSvg, width: 40, alignment: 'center', margin: [0, 2, 0, 0] } : (logoBase64 ? { image: logoBase64, width: 40, alignment: 'center', margin: [0, 2, 0, 0] } : null))
                            ].filter(Boolean)
                        }
                    ]
                }
            );

            content.push({
                unbreakable: true, // Esto obliga a pdfmake a no cortar este bloque por la mitad
                stack: commercialBlock
            });

            // 3. Generar y guardar
            const pdfDocGenerator = pdfMake.createPdf(docDefinition);
            
            // Usamos una Promesa para garantizar que capturamos cualquier error en la generación asíncrona
            await new Promise((resolve, reject) => {
                try {
                    pdfDocGenerator.getBase64(async (base64) => {
                        try {
                            const pdfBase64DataUri = 'data:application/pdf;base64,' + base64;
                            
                            // Descargar manualmente sin reutilizar el generador
                            const link = document.createElement('a');
                            link.href = pdfBase64DataUri;
                            link.download = fileName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            
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
                            
                            await window.StorageAPI.async.saveQuotationPdf({
                                clientName: clientName,
                                year: currentYear,
                                quotationId: formattedId + versionSuffix,
                                pdfBase64: pdfBase64DataUri
                            });
                            
                            fetchHistory();
                            if (currentVersion <= 1) setNextId(nextId + 1);
                            resolve();
                        } catch (saveErr) {
                            reject(saveErr);
                        }
                    });
                } catch (pdfErr) {
                    reject(pdfErr);
                }
            });

        } catch (error) {
            console.error(error);
            alert("Error al generar PDF: " + (error.message || JSON.stringify(error)));
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
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-8 scrollbar-hide">
                    <div className="tw-max-w-4xl tw-mx-auto">
                        <div className="tw-mb-8">
                            <div className="tw-flex tw-justify-between tw-items-center">
                                <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">
                                    Generador de Cotizaciones
                                </h2>
                                <div className="tw-text-right">
                                    <span className="tw-px-4 tw-py-2 tw-bg-indigo-100 tw-text-indigo-800 tw-rounded-lg tw-text-sm tw-font-bold tw-shadow-sm">
                                        N° {displayId}
                                    </span>
                                    {currentVersion > 1 && (
                                        <div className="tw-text-xs tw-font-bold tw-text-indigo-600 tw-mt-2">VERSION {currentVersion}</div>
                                    )}
                                </div>
                            </div>
                            <div className="tw-mt-4">
                                <button 
                                    onClick={() => setActiveTab('history')}
                                    className="tw-bg-white tw-border tw-border-slate-300 tw-text-googleBlue tw-px-4 tw-py-2 tw-rounded-lg tw-text-xs tw-font-bold hover:tw-bg-slate-50 hover:tw-text-blue-700 tw-transition-all tw-flex tw-items-center tw-shadow-sm"
                                >
                                    <i className="fa-solid fa-clock-rotate-left tw-mr-2"></i>VER HISTORIAL DE COTIZACIONES
                                </button>
                            </div>
                        </div>

                        <div className="tw-space-y-6">
                            {/* Cliente */}
                            <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Cliente</label>
                                <select 
                                    className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all"
                                    value={selectedClient}
                                    onChange={(e) => setSelectedClient(e.target.value)}
                                >
                                    <option value="">-- Seleccionar Cliente --</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreFantasia || c.razonSocial}</option>)}
                                </select>
                            </div>

                            {/* Nombre del Proyecto */}
                            <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Nombre del Proyecto</label>
                                <input 
                                    type="text" 
                                    className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all"
                                    placeholder="Ej: Instalación de Puntos de Red U7"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                />
                            </div>

                            {/* Textos */}
                            <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Requerimiento de Proyecto</label>
                                <textarea 
                                    className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-mb-6"
                                    rows="3"
                                    placeholder="Ej: Suministro e instalación de puntos de red..."
                                    value={requirements}
                                    onChange={(e) => setRequirements(e.target.value)}
                                ></textarea>

                                <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Consideraciones Técnicas (Estándares)</label>
                                <textarea 
                                    className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-mb-6"
                                    rows="3"
                                    value={techConditions}
                                    onChange={(e) => setTechConditions(e.target.value)}
                                ></textarea>

                                <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Condiciones Comerciales</label>
                                <textarea 
                                    className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all"
                                    rows="4"
                                    value={commercialConditions}
                                    onChange={(e) => setCommercialConditions(e.target.value)}
                                ></textarea>
                            </div>

                            {/* Tablas */}
                            {renderTableInput(items, setItems, "Propuesta Económica (Principal)")}
                            {renderTableInput(optionals, setOptionals, "Items Opcionales / Adicionales")}

                            {/* Acciones */}
                            <div className="tw-pt-6 tw-pb-12">
                                <button 
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                    className={`tw-w-full tw-py-4 tw-rounded-xl tw-text-lg tw-font-bold tw-text-white tw-shadow-lg tw-transition-all ${isGenerating ? 'tw-bg-slate-400 tw-cursor-not-allowed' : 'tw-bg-googleBlue hover:tw-bg-blue-700 hover:-tw-translate-y-1 hover:tw-shadow-xl'}`}
                                >
                                    {isGenerating ? <span><i className="fa-solid fa-circle-notch fa-spin tw-mr-3"></i> Generando PDF...</span> : <span><i className="fa-solid fa-file-pdf tw-mr-3"></i> Generar Cotización PDF</span>}
                                </button>
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
