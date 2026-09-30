const { useState, useEffect, useMemo, useRef } = React;

const formatBullets = (text) => {
    if (!text) return '';
    if (text === '-' || text === '- ') return '- ';
    if (!text.startsWith('-')) {
        text = '- ' + text;
    }
    const lines = text.split('\n');
    const formatted = lines.map(line => {
        if (line.trim() === '') return '';
        let trimmed = line.trimStart();
        if (!trimmed.startsWith('-')) {
            trimmed = '- ' + trimmed;
        }
        if (trimmed.startsWith('- ')) {
            const content = trimmed.substring(2).trimStart();
            if (content.length > 0) {
                return '- ' + content.charAt(0).toUpperCase() + content.slice(1);
            }
            return '- ';
        }
        if (trimmed.startsWith('-') && !trimmed.startsWith('- ')) {
            const content = trimmed.substring(1).trimStart();
            if (content.length > 0) {
                return '- ' + content.charAt(0).toUpperCase() + content.slice(1);
            }
            return '- ';
        }
        return trimmed;
    });
    return formatted.join('\n');
};

const QuotationsApp = () => {
    const [clients, setClients] = useState([]);
    const [selectedClient, setSelectedClient] = useState('');
    const [projectName, setProjectName] = useState('');
    const [requirements, setRequirements] = useState('');
    const [techConditions, setTechConditions] = useState('');
    const [commercialConditions, setCommercialConditions] = useState('• La solicitud se considerará aprobada una vez recibida la Orden de Compra por el total de la propuesta comercial, o bien, al efectuarse el depósito del 50% de la misma.');
    const [images, setImages] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    
    // Items Principales
    const [items, setItems] = useState([{ id: Date.now(), desc: '', qty: 1, price: 0 }]);
    // Items Opcionales
    const [optionals, setOptionals] = useState([]);
    
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [nextId, setNextId] = useState(1);
    const [currentVersion, setCurrentVersion] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    
    // Moneda y tipo de cambio
    const [currency, setCurrency] = useState('CLP');
    const [mode, setMode] = useState('new'); // 'new' | 'copy' | 'edit' | 'edit-draft'
    const [dialog, setDialog] = useState(null); // { type: 'alert'|'confirm'|'prompt', title, message, defaultValue, resolve }
    const [lastExchangeRate, setLastExchangeRate] = useState(null);
    
    // Historial
    const [activeTab, setActiveTab] = useState('generator'); // 'generator' | 'history'
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [historyClientFilter, setHistoryClientFilter] = useState('');
    const [historyMonthFilter, setHistoryMonthFilter] = useState('');
    const [historyStatusFilter, setHistoryStatusFilter] = useState('');
    const [previewUrl, setPreviewUrl] = useState(null);
    const [logoData, setLogoData] = useState({ svg: null, base64: null });
    const previewTimeoutRef = useRef(null);

    useEffect(() => {
        loadData();
        fetchHistory(); // Cargar historial al inicio también
        loadLogo();

        // Polling para sincronizar con el estado de Finanzas si cambia
        const syncInterval = setInterval(() => {
            if (window.state && window.state.clients) {
                setClients(prev => {
                    // Solo actualizar si hay una diferencia en la cantidad para evitar re-renders innecesarios
                    if (prev.length !== window.state.clients.length) {
                        return [...window.state.clients];
                    }
                    return prev;
                });
            }
        }, 1500);

        return () => {
            clearInterval(syncInterval);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, []);

    const loadLogo = async () => {
        try {
            const svgRes = await fetch('icono.svg');
            if (svgRes.ok && svgRes.headers.get('content-type').includes('svg')) {
                const svgText = await svgRes.text();
                setLogoData({ svg: svgText, base64: null });
            } else {
                const logoRes = await fetch('logo.png');
                const contentType = logoRes.headers.get('content-type');
                if (logoRes.ok && contentType && contentType.startsWith('image/')) {
                    const logoBlob = await logoRes.blob();
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(logoBlob);
                    });
                    setLogoData({ svg: null, base64: base64 });
                }
            }
        } catch (e) {
            console.warn("Could not load logo for PDF", e);
        }
    };

    const loadData = async () => {
        try {
            // Utilizar el estado global ya cargado en Finanzas si está disponible
            let clientsData = window.state && window.state.clients ? window.state.clients : [];
            if (clientsData.length > 0) {
                setClients(clientsData);
            }
            const year = new Date().getFullYear();
            setCurrentYear(year);

            // No cargamos tipos de cambio online de forma automática (removido por petición del usuario)
        } catch (error) {
            console.error("Error cargando datos:", error);
        }
    };

    useEffect(() => {
        if (!selectedClient) {
            if (mode === 'new') {
                setNextId(1);
                setCurrentVersion(1);
            }
            return;
        }

        if (mode === 'edit' || mode === 'edit-draft') {
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

                if (mode === 'new') {
                    setCurrency('CLP');
                }
            } catch (err) {
                console.warn("Error correlativo:", err);
            }
        };
        fetchNextIdVal();
    }, [selectedClient, currentYear, mode]);

    const handleResetToNewQuotation = () => {
        setSelectedClient('');
        setProjectName('');
        setRequirements('');
        setTechConditions('');
        setCommercialConditions('• La solicitud se considerará aprobada una vez recibida la Orden de Compra por el total de la propuesta comercial, o bien, al efectuarse el depósito del 50% de la misma.');
        setImages([]);
        setItems([{ id: Date.now(), desc: '', qty: 1, price: 0 }]);
        setOptionals([]);
        setCurrentVersion(1);
        setCurrency('CLP');
        setMode('new');
    };

    const showCustomDialog = (config) => {
        return new Promise((resolve) => {
            setDialog({
                ...config,
                resolve: (val) => {
                    setDialog(null);
                    resolve(val);
                }
            });
        });
    };

    const customAlert = (message, title = 'Notificación') => {
        return showCustomDialog({ type: 'alert', title, message });
    };

    const customConfirm = (message, title = 'Confirmar') => {
        return showCustomDialog({ type: 'confirm', title, message });
    };

    const customPrompt = (message, defaultValue = '', title = 'Ingresar Valor') => {
        return showCustomDialog({ type: 'prompt', title, message, defaultValue });
    };


    // Subir imágenes
    const handleImageUpload = async (e) => {
        const inputElem = e.target;
        const files = Array.from(inputElem.files);
        if (files.length === 0) return;

        setIsUploading(true);
        const uploadedUrls = [];

        try {
            const sessionData = JSON.parse(localStorage.getItem('contabilidad_session') || '{}');
            const headers = {};
            if (sessionData.token) headers['Authorization'] = `Bearer ${sessionData.token}`;

            for (let file of files) {
                const formData = new FormData();
                formData.append('image', file);

                const response = await fetch('/api/quotations/upload-image', {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });
                if (response.ok) {
                    const data = await response.json();
                    uploadedUrls.push(data.url);
                } else {
                    const errText = await response.text();
                    console.error("Error al subir archivo:", file.name, errText);
                    await customAlert(`Error al subir ${file.name}: ${response.statusText || errText}`);
                }
            }
        } catch (err) {
            console.error("Excepción al subir imagen:", err);
            await customAlert(`Excepción al subir imagen: ${err.message}`);
        } finally {
            if (uploadedUrls.length > 0) {
                const newImageObjs = uploadedUrls.map(url => ({ url, title: '' }));
                setImages(prev => [...prev, ...newImageObjs]);
            }
            setIsUploading(false);
            if (inputElem) inputElem.value = '';
        }
    };

    const handleImageTitleChange = (index, newTitle) => {
        setImages(prev => {
            const updated = [...prev];
            const current = typeof updated[index] === 'string' ? { url: updated[index], title: '' } : updated[index];
            updated[index] = { ...current, title: newTitle };
            return updated;
        });
    };

    const handleMoveImage = (index, direction) => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= images.length) return;
        setImages(prev => {
            const updated = [...prev];
            const temp = updated[index];
            updated[index] = updated[newIndex];
            updated[newIndex] = temp;
            return updated;
        });
    };

    const handleRemoveImage = (indexToRemove) => {
        setImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const convertImageUrlToBase64 = (url) => {
        return new Promise((resolve) => {
            const img = new Image();
            if (url.startsWith('http')) img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => {
                resolve(null);
            };
            img.src = url;
        });
    };

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
    const formatMoney = (val, selectedCurr = 'CLP') => {
        if (selectedCurr === 'USD') {
            const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
            return `USD ${formatted}`;
        } else if (selectedCurr === 'UF') {
            const formatted = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
            return `UF ${formatted}`;
        } else {
            const formatted = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
            return `CLP ${formatted}`;
        }
    };
    
    const subtotalItems = items.reduce((acc, curr) => acc + (Number(curr.qty) * Number(curr.price)), 0);
    const subtotalOptionals = optionals.reduce((acc, curr) => acc + (Number(curr.qty) * Number(curr.price)), 0);
    
    // Formateo de entrada de números
    const formatInputNumber = (val, isPrice = false) => {
        if (val === undefined || val === null || val === '') return '';
        if (currency === 'CLP' || !isPrice) {
            const numStr = String(val).replace(/\D/g, ''); // Solo dígitos
            if (numStr === '') return '';
            return new Intl.NumberFormat('es-CL').format(parseInt(numStr, 10));
        } else {
            return String(val);
        }
    };

    const parseInputNumber = (str, isPrice = false) => {
        if (!str) return 0;
        if (currency === 'CLP' || !isPrice) {
            const num = parseInt(String(str).replace(/\D/g, ''), 10);
            return isNaN(num) ? 0 : num;
        } else {
            let cleanStr = String(str).replace(/[^0-9.,-]/g, '');
            const lastDot = cleanStr.lastIndexOf('.');
            const lastComma = cleanStr.lastIndexOf(',');
            if (lastDot > lastComma) {
                cleanStr = cleanStr.replace(/,/g, '');
            } else if (lastComma > lastDot) {
                cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
            }
            const num = parseFloat(cleanStr);
            return isNaN(num) ? 0 : num;
        }
    };

    const handleCurrencyChange = (newCurrency) => {
        setCurrency(newCurrency);
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

    const buildDocDefinitionForHistory = async (q, isForPreview = false) => {
        const itemsList = typeof q.items1 === 'string' ? JSON.parse(q.items1 || '[]') : (q.items1 || []);
        const optionalsList = typeof q.itemsOptional === 'string' ? JSON.parse(q.itemsOptional || '[]') : (q.itemsOptional || []);
        const selectedCurr = q.currency || 'CLP';

        const imagesList = typeof q.images === "string" ? JSON.parse(q.images || "[]") : (q.images || []);

        let sectionCounter = 1;
        const nReq = (q.requirements && q.requirements.trim()) ? sectionCounter++ : null;
        const nTech = (q.technicalConditions && q.technicalConditions.trim()) ? sectionCounter++ : null;
        const nImg = (imagesList && imagesList.length > 0) ? sectionCounter++ : null;
        const nProp = sectionCounter++;
        const nCom = (q.commercialConditions && q.commercialConditions.trim()) ? sectionCounter++ : null;

        // Asegurar que pdfMake esté inicializado
        if (window.pdfMake && window.pdfMake.vfs === undefined && window.pdfMakeFonts !== undefined) {
            window.pdfMake.vfs = window.pdfMakeFonts.pdfMake.vfs;
        }

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
                                { text: `N° ${q.id}`, fontSize: 12, bold: true, color: '#0f766e', margin: [0, 0, 0, 5] },
                                (q.version > 1 ? { text: `VERSIÓN ${q.version}`, fontSize: 9, bold: true, color: '#94a3b8', margin: [0, 0, 0, 5] } : null),
                                (q.projectName ? { text: `Proyecto: ${q.projectName}`, fontSize: 11, bold: true, color: '#000000' } : null),
                                { text: `Cliente: ${q.clientName.replace(/_/g, ' ')}`, fontSize: 11, bold: true, color: '#000000', margin: [0, 2, 0, 0] }
                            ].filter(Boolean)
                        },
                        {
                            width: 220,
                            stack: [
                                (logoData.svg ? { svg: logoData.svg, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : (logoData.base64 ? { image: logoData.base64, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : null)),
                                { text: 'Simons SPA - Soluciones Tecnológicas', fontSize: 10, color: '#64748b', alignment: 'right' },
                                { text: `Fecha: ${q.createdAt ? new Date(q.createdAt).toLocaleDateString('es-CL') : new Date().toLocaleDateString('es-CL')}`, fontSize: 10, color: '#64748b', alignment: 'right' }
                            ].filter(Boolean)
                        }
                    ],
                    margin: [0, 0, 0, 20]
                },
                // Línea separadora
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 2, lineColor: '#1e293b' }], margin: [0, 0, 0, 20] }
            ],
            defaultStyle: {
                fontSize: 11.5,
                color: '#334155'
            },
            styles: {
                tableHeader: {
                    bold: true,
                    fontSize: 11.5,
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
                        { text: title, fillColor: '#f8fafc', border: [false, false, false, false], margin: [5, 4, 0, 4], color: '#1e293b', bold: true, fontSize: 13 }
                    ]
                ]
            },
            layout: 'noBorders',
            margin: [0, 15, 0, 10]
        });

        // 1. Requerimiento
        if (q.requirements && q.requirements.trim()) {
            content.push(
                buildSectionHeader(`${nReq}. REQUERIMIENTO`),
                { text: q.requirements, margin: [10, 0, 0, 15], alignment: 'justify' }
            );
        }

        // 2. Consideraciones Técnicas
        if (q.technicalConditions && q.technicalConditions.trim()) {
            content.push(
                buildSectionHeader(`${nTech}. CONSIDERACIONES TÉCNICAS Y ESTÁNDARES`),
                { text: q.technicalConditions, margin: [10, 0, 0, 15], alignment: 'justify' }
            );
        }

        // 3. Registro Fotográfico (sólo si existen imágenes)
        if (imagesList && imagesList.length > 0) {
            const imageObjects = [];
            if (isForPreview) {
                imagesList.forEach((imgItem, idx) => {
                    const imgObj = typeof imgItem === "string" ? { url: imgItem, title: "" } : imgItem;
                    const previewLabel = imgObj.title ? `[Foto ${idx + 1}: ${imgObj.title}]` : `[Registro Fotográfico - Imagen ${idx + 1}]`;
                    imageObjects.push({
                        table: {
                            widths: ["*"],
                            body: [
                                [{ text: previewLabel, alignment: "center", margin: [0, 40, 0, 40], color: "#64748b", italics: true }]
                            ]
                        },
                        layout: {
                            hLineWidth: () => 1,
                            vLineWidth: () => 1,
                            hLineColor: () => "#cbd5e1",
                            vLineColor: () => "#cbd5e1",
                            fillColor: () => "#f8fafc"
                        },
                        margin: [20, 8, 20, 8]
                    });
                });
            } else {
                for (let imgItem of imagesList) {
                    const imgObj = typeof imgItem === "string" ? { url: imgItem, title: "" } : imgItem;
                    const b64 = await convertImageUrlToBase64(imgObj.url);
                    if (b64) {
                        const tableBody = [
                            [{ image: b64, fit: [380, 230], alignment: "center", border: [false, false, false, false] }]
                        ];
                        if (imgObj.title && imgObj.title.trim()) {
                            tableBody.push([
                                { text: imgObj.title.trim(), fontSize: 10, bold: true, alignment: "center", color: "#1e293b", margin: [0, 4, 0, 2], border: [false, false, false, false] }
                            ]);
                        }
                        imageObjects.push({
                            table: {
                                widths: ["*"],
                                body: tableBody
                            },
                            layout: "noBorders",
                            margin: [0, 8, 0, 8]
                        });
                    }
                }
            }

            if (imageObjects.length > 0) {
                const imgSectionElements = [];
                imgSectionElements.push(buildSectionHeader(`${nImg}. REGISTRO FOTOGRÁFICO`));
                for (let i = 0; i < imageObjects.length; i += 2) {
                    imgSectionElements.push(imageObjects[i]);
                    if (i + 1 < imageObjects.length) {
                        imgSectionElements.push({ text: "\n" });
                        imgSectionElements.push(imageObjects[i + 1]);
                    }
                }
                content.push({
                    unbreakable: false,
                    stack: imgSectionElements
                });
            }
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

        itemsList.forEach(item => {
            tableBody.push([
                { text: item.qty.toString(), alignment: 'center' },
                item.desc || '-',
                { text: formatMoney(item.price, selectedCurr), alignment: 'right' },
                { text: formatMoney(item.qty * item.price, selectedCurr), alignment: 'right', bold: true }
            ]);
        });

        const proposalBlock = [
            buildSectionHeader(`${nProp}. PROPUESTA ECONÓMICA`),
            {
                table: {
                    headerRows: 1,
                    widths: [40, '*', 80, 80],
                    body: tableBody
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 10]
            },
            {
                columns: [
                    { width: '*', text: '' },
                    {
                        width: 200,
                        table: {
                            widths: ['*', 100],
                            body: [
                                [ { text: 'Subtotal NETO:', color: '#64748b', fontSize: 10.5 }, { text: formatMoney(q.subtotal, selectedCurr), alignment: 'right', fontSize: 10.5 } ],
                                [ { text: 'IVA (19%):', color: '#64748b', fontSize: 10.5 }, { text: formatMoney(q.iva, selectedCurr), alignment: 'right', fontSize: 10.5 } ],
                                [ { text: 'TOTAL:', color: '#0f766e', bold: true, fontSize: 13.5 }, { text: formatMoney(q.total, selectedCurr), alignment: 'right', bold: true, fontSize: 13.5, color: '#0f172a' } ]
                            ]
                        },
                        layout: 'noBorders'
                    }
                ],
                margin: [0, 0, 0, 20]
            }
        ];

        content.push({
            unbreakable: true,
            stack: proposalBlock
        });

        // Ítems Opcionales
        if (optionalsList.length > 0) {
            const optTableBody = [
                [ 
                    { text: 'Cant.', style: 'tableHeader', fillColor: '#f97316' }, 
                    { text: 'Descripción (Opcional)', style: 'tableHeader', alignment: 'left', fillColor: '#f97316' }, 
                    { text: 'P. Unitario', style: 'tableHeader', alignment: 'right', fillColor: '#f97316' }, 
                    { text: 'Total', style: 'tableHeader', alignment: 'right', fillColor: '#f97316' } 
                ]
            ];

            optionalsList.forEach(item => {
                optTableBody.push([
                    { text: item.qty.toString(), alignment: 'center' },
                    item.desc || '-',
                    { text: formatMoney(item.price, selectedCurr), alignment: 'right' },
                    { text: formatMoney(item.qty * item.price, selectedCurr), alignment: 'right', bold: true }
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
        
        if (q.commercialConditions && q.commercialConditions.trim()) {
            commercialBlock.push(
                buildSectionHeader(`${nCom}. CONDICIONES COMERCIALES`),
                { text: q.commercialConditions, margin: [10, 0, 0, 20], alignment: 'justify' }
            );
        }

        commercialBlock.push(
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 2, lineColor: '#1e293b' }], margin: [0, 10, 0, 10] },
            { text: 'DATOS DE TRANSFERENCIA', fontSize: 12, bold: true, color: '#1e293b', margin: [0, 0, 0, 5] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 0.5, lineColor: '#cbd5e1' }], margin: [0, 5, 0, 10] },
            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            { text: 'Titular: SIMONS SPA', fontSize: 10.5, color: '#475569' },
                            { text: 'RUT: 77.475.581-0', fontSize: 10.5, color: '#475569' },
                            { text: 'Banco: Banco de Chile', fontSize: 10.5, color: '#475569' },
                            { text: 'Tipo de Cuenta: Cuenta Corriente', fontSize: 10.5, color: '#475569' },
                            { text: 'Número de cuenta: 1483514107', fontSize: 10.5, color: '#475569' },
                            { text: 'Mail: pagos@simons.cl', fontSize: 10.5, color: '#475569' }
                        ]
                    }
                ]
            }
        );

        content.push({
            unbreakable: true, 
            stack: commercialBlock
        });

        return docDefinition;
    };

    const buildDocDefinition = async (isForPreview = false) => {
        const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
        return await buildDocDefinitionForHistory({
            id: displayId,
            version: currentVersion,
            projectName: projectName,
            clientName: clientName,
            requirements: requirements,
            technicalConditions: techConditions,
            commercialConditions: commercialConditions,
            items1: items,
            itemsOptional: optionals,
            images: images,
            subtotal: subtotalMains,
            iva: iva,
            total: total,
            currency: currency,
            createdAt: new Date().toISOString()
        }, isForPreview);
    };

    const handleDownloadFromHistory = async (q) => {
        if (!window.pdfMake) {
            try { await window._loadPdfMake(); } catch(e) { await customAlert('Error cargando librería PDF. Verifique su conexión.'); return; }
        }
        try {
            const docDefinition = await buildDocDefinitionForHistory(q, false);
            const versionSuffix = q.version > 1 ? `_v${q.version}` : '';
            const safeProjectName = q.projectName ? `_${q.projectName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const fileName = `Cotizacion_${q.id}${safeProjectName}${versionSuffix}.pdf`;
            pdfMake.createPdf(docDefinition).download(fileName);
        } catch (err) {
            console.error("Error al descargar cotización histórica:", err);
            await customAlert("Error al regenerar PDF de cotización.");
        }
    };

    const updatePreview = async () => {
        if (!selectedClient) return;
        
        if (!window.pdfMake) {
            try {
                await window._loadPdfMake();
            } catch (err) {
                console.error("Error al cargar pdfMake para la previsualización:", err);
                return;
            }
        }
        
        try {
            const docDefinition = await buildDocDefinition(true);
            const pdfDocGenerator = pdfMake.createPdf(docDefinition);
            pdfDocGenerator.getBlob((blob) => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);
            });
        } catch (err) {
            console.error("Error actualizando previsualización:", err);
        }
    };

    useEffect(() => {
        if (activeTab !== 'generator') return;
        
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(() => {
            updatePreview();
        }, 1000);

        return () => {
            if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        };
    }, [selectedClient, projectName, requirements, techConditions, commercialConditions, items, optionals, images, activeTab, logoData, currency]);

    const handleGenerate = async () => {
        if (!window.pdfMake) {
            try { await window._loadPdfMake(); } catch(e) { await customAlert('Error cargando librería PDF. Verifique su conexión.'); return; }
        }

        if (!selectedClient) {
            await customAlert("Debe seleccionar un cliente.", "Falta Información");
            return;
        }

        let exchangeRateToSave = null;
        if (currency !== 'CLP') {
            const defaultRate = lastExchangeRate ? String(lastExchangeRate) : (currency === 'USD' ? '950' : '40000');
            const entered = await customPrompt(`Esta cotización está en ${currency}.\nPor favor, ingrese el tipo de cambio (Valor de 1 ${currency} en CLP) para registrar el proyecto en la base de datos en pesos chilenos:`, defaultRate, `Tipo de Cambio (${currency})`);
            if (!entered || isNaN(parseFloat(entered)) || parseFloat(entered) <= 0) {
                await customAlert("Debe ingresar un tipo de cambio válido para guardar la cotización.");
                return;
            }
            exchangeRateToSave = parseFloat(entered);
            setLastExchangeRate(exchangeRateToSave);
        }
        
        setIsGenerating(true);

        try {
            const docDefinition = await buildDocDefinition(false);
            const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
            const versionSuffix = currentVersion > 1 ? `_v${currentVersion}` : '';
            const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const fileName = `Cotizacion_${displayId}${safeProjectName}${versionSuffix}.pdf`;

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
                                id: displayId,
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
                                total: total,
                                currency: currency,
                                exchangeRate: exchangeRateToSave,
                                status: 'Emitida'
                            };
                            
                            await window.StorageAPI.async.saveQuotation(qData);
                            
                            await window.StorageAPI.async.saveQuotationPdf({
                                clientName: clientName,
                                year: currentYear,
                                quotationId: displayId + versionSuffix,
                                projectName: projectName,
                                pdfBase64: pdfBase64DataUri
                            });
                            
                            fetchHistory();
                            if (currentVersion <= 1) setNextId(nextId + 1);

                            // Refrescar UI general de Proyectos
                            if (window.UI && typeof window.UI.reloadProjects === 'function') {
                                window.UI.reloadProjects().catch(err => console.error('Error al recargar proyectos:', err));
                            }

                            // Limpiar formulario tras generar cotización
                            handleResetToNewQuotation();

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
            await customAlert("Error al generar PDF: " + (error.message || JSON.stringify(error)));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveDraft = async () => {
        if (!selectedClient) {
            await customAlert("Debe seleccionar un cliente para poder guardar el borrador.", "Falta Información");
            return;
        }

        setIsSavingDraft(true);

        try {
            const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
            
            const qData = {
                id: displayId,
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
                images: images,
                subtotal: subtotalMains,
                iva: iva,
                total: total,
                currency: currency,
                exchangeRate: null,
                status: 'Borrador'
            };
            
            await window.StorageAPI.async.saveQuotation(qData);
            
            await customAlert(`Borrador de Cotización ${displayId} guardado con éxito.`, "Borrador Guardado");
            fetchHistory();
        } catch (error) {
            console.error("Error al guardar borrador:", error);
            await customAlert("Error al guardar borrador: " + (error.message || JSON.stringify(error)));
        } finally {
            setIsSavingDraft(false);
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
            setImages(q.images ? (typeof q.images === 'string' ? JSON.parse(q.images || '[]') : q.images) : []);
            setItems(JSON.parse(q.items1 || '[]'));
            setOptionals(JSON.parse(q.itemsOptional || '[]'));
            setCurrency(q.currency || 'CLP');
            
            // No cambiar el correlativo visual ni el año
            setNextId(q.correlative);
            setCurrentYear(q.year);

            if (q.status === 'Borrador') {
                setMode('edit-draft');
                setCurrentVersion(q.version || 1);
                setActiveTab('generator');
                await customAlert(`Editando Borrador de Cotización ${q.id}.`, "Edición de Borrador");
            } else {
                setMode('edit');
                // Calcular siguiente versión para este ID exacto
                const vData = await window.StorageAPI.async.getQuotationNextVersion(q.id);
                setCurrentVersion(vData.nextVersion);
                setActiveTab('generator');
                await customAlert(`Editando Cotización ${q.id}. Se guardará como versión ${vData.nextVersion}.`, "Edición Iniciada");
            }
        } catch (err) {
            await customAlert("Error al cargar para edición.");
        }
    };

    const handleCopyFromHistory = async (q) => {
        try {
            // Cargar contenido de la cotización
            setMode('copy');
            setSelectedClient(''); // Limpiar el cliente para forzar selección y evitar confusiones
            setProjectName(q.projectName || '');
            setRequirements(q.requirements || '');
            setTechConditions(q.technicalConditions || '');
            setCommercialConditions(q.commercialConditions || '');
            setImages(q.images ? (typeof q.images === 'string' ? JSON.parse(q.images || '[]') : q.images) : []);
            setItems(JSON.parse(q.items1 || '[]'));
            setOptionals(JSON.parse(q.itemsOptional || '[]'));
            setCurrency(q.currency || 'CLP');
            
            // Forzar a versión 1 y correlativo inicial temporal
            setCurrentVersion(1);
            setNextId(1);
            
            setActiveTab('generator');
            await customAlert(`Contenido de Cotización ${q.id} copiado. Seleccione un cliente para asignarle esta nueva cotización.`, "Copia Realizada");
        } catch (err) {
            await customAlert("Error al copiar la cotización.");
        }
    };

    const handleDeleteFromHistory = async (id, version) => {
        if (!await customConfirm(`¿Está seguro de eliminar la versión ${version} de la cotización ${id}?`, "Eliminar Cotización")) return;
        try {
            await window.StorageAPI.async.deleteQuotation(id, version);
            fetchHistory();
        } catch (err) {
            await customAlert("Error al eliminar.");
        }
    };

    const renderTableInput = (list, setList, title) => {
        const addItemLocal = () => addItem(setList, list);
        const removeItemLocal = (id) => removeItem(setList, list, id);

        const moveItem = (index, targetIndex) => {
            if (targetIndex < 0 || targetIndex >= list.length) return;
            const newList = [...list];
            const [moved] = newList.splice(index, 1);
            newList.splice(targetIndex, 0, moved);
            setList(newList);
        };

        return (
            <div className="tw-bg-white tw-rounded-lg tw-shadow-sm tw-border tw-border-slate-200 tw-p-4 tw-mb-6">
                <div className="tw-flex tw-justify-between tw-items-center tw-mb-4">
                    <h3 className="tw-text-base tw-font-bold tw-text-slate-800">{title}</h3>
                    <button onClick={addItemLocal} className="tw-text-sm tw-text-googleBlue hover:tw-underline tw-font-medium">
                        + Añadir Fila
                    </button>
                </div>
                
                <div className="tw-overflow-x-auto">
                    <table className="tw-w-full">
                        <thead>
                            <tr className="tw-text-xs tw-font-bold tw-text-slate-400 tw-uppercase tw-tracking-wider tw-border-b tw-border-slate-100">
                                <th className="tw-w-8 tw-pb-2"></th>
                                <th className="tw-text-left tw-pb-2 tw-w-20">Cant.</th>
                                <th className="tw-text-left tw-pb-2">Descripción</th>
                                <th className="tw-text-right tw-pb-2 tw-w-36">Precio Unit. ({currency})</th>
                                <th className="tw-w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((item, index) => (
                                <tr key={item.id} className="tw-border-b tw-border-slate-50 last:tw-border-0">
                                    <td className="tw-py-2 tw-pr-2 tw-align-middle">
                                        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-1">
                                            <button 
                                                disabled={index === 0}
                                                onClick={() => moveItem(index, index - 1)}
                                                className="tw-text-slate-400 hover:tw-text-slate-700 disabled:tw-text-slate-200 disabled:tw-cursor-not-allowed tw-transition-colors"
                                                title="Subir"
                                            >
                                                <i className="fa-solid fa-chevron-up tw-text-[10px]"></i>
                                            </button>
                                            <button 
                                                disabled={index === list.length - 1}
                                                onClick={() => moveItem(index, index + 1)}
                                                className="tw-text-slate-400 hover:tw-text-slate-700 disabled:tw-text-slate-200 disabled:tw-cursor-not-allowed tw-transition-colors"
                                                title="Bajar"
                                            >
                                                <i className="fa-solid fa-chevron-down tw-text-[10px]"></i>
                                            </button>
                                        </div>
                                    </td>
                                    <td className="tw-py-2 tw-pr-2">
                                        <input 
                                            type="text" 
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-base tw-text-center"
                                            value={formatInputNumber(item.qty, false)}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'qty', parseInputNumber(e.target.value, false))}
                                        />
                                    </td>
                                    <td className="tw-py-2">
                                        <input 
                                            type="text" 
                                            placeholder="Detalle..."
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-base"
                                            value={item.desc}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'desc', e.target.value)}
                                        />
                                    </td>
                                    <td className="tw-py-2 tw-pl-2">
                                        <input 
                                            type="text" 
                                            className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-base tw-text-right"
                                            value={formatInputNumber(item.price, true)}
                                            onChange={(e) => handleItemChange(setList, list, item.id, 'price', parseInputNumber(e.target.value, true))}
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
                    {list.length === 0 && <div className="tw-text-base tw-text-slate-500 tw-italic tw-mt-2">Sin ítems.</div>}
                </div>
            </div>
        );
    };

    return (
        <div className="tw-flex tw-flex-col tw-min-h-full tw-bg-slate-50 tw-font-sans">
            {activeTab === 'generator' ? (
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-4 md:tw-p-8 scrollbar-hide">
                    <div className="tw-max-w-7xl tw-mx-auto">
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
                            <div className="tw-mt-4 tw-flex tw-gap-3">
                                <button 
                                    onClick={() => setActiveTab('history')}
                                    className="tw-bg-white tw-border tw-border-slate-300 tw-text-googleBlue tw-px-4 tw-py-2 tw-rounded-lg tw-text-xs tw-font-bold hover:tw-bg-slate-50 hover:tw-text-blue-700 tw-transition-all tw-flex tw-items-center tw-shadow-sm"
                                >
                                    <i className="fa-solid fa-clock-rotate-left tw-mr-2"></i>VER HISTORIAL DE COTIZACIONES
                                </button>
                                
                                {(selectedClient || projectName || requirements || techConditions || (items.length > 1 || items[0]?.price > 0 || items[0]?.desc) || optionals.length > 0 || currency !== 'CLP' || mode !== 'new') && (
                                    <button 
                                        onClick={async () => {
                                            if (await customConfirm("¿Está seguro de limpiar todos los campos del formulario?", "Limpiar Formulario")) {
                                                handleResetToNewQuotation();
                                            }
                                        }}
                                        className="tw-bg-white tw-border tw-border-red-300 tw-text-red-600 tw-px-4 tw-py-2 tw-rounded-lg tw-text-xs tw-font-bold hover:tw-bg-red-50 hover:tw-text-red-700 tw-transition-all tw-flex tw-items-center tw-shadow-sm"
                                        title="Limpiar todos los campos del formulario"
                                    >
                                        <i className="fa-solid fa-eraser tw-mr-2"></i>LIMPIAR FORMULARIO
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="tw-flex tw-flex-col lg:tw-flex-row tw-gap-8">
                            {/* Columna Formulario */}
                            <div className="tw-flex-1 tw-space-y-6">
                                {/* Cliente */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                    <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Cliente</label>
                                    <select 
                                        className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all"
                                        value={selectedClient}
                                        onChange={(e) => setSelectedClient(e.target.value)}
                                    >
                                        <option value="">-- Seleccionar Cliente --</option>
                                        {[...clients]
                                            .sort((a, b) => {
                                                const nameA = a.nombreFantasia || a.razonSocial || '';
                                                const nameB = b.nombreFantasia || b.razonSocial || '';
                                                return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
                                            })
                                            .map(c => <option key={c.id} value={c.id}>{c.nombreFantasia || c.razonSocial}</option>)}
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
                                    <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">Requerimiento de Proyecto</label>
                                    <textarea 
                                        className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-mb-6 tw-text-justify tw-text-base"
                                        rows="3"
                                        placeholder="Ej: Suministro e instalación de puntos de red..."
                                        value={requirements}
                                        onChange={(e) => setRequirements(formatBullets(e.target.value))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const textarea = e.target;
                                                const val = textarea.value;
                                                const cursor = textarea.selectionStart;
                                                const beforeCursor = val.substring(0, cursor);
                                                const afterCursor = val.substring(cursor);
                                                const lastNewline = beforeCursor.lastIndexOf('\n');
                                                const currentLine = beforeCursor.substring(lastNewline + 1);

                                                if (currentLine.trim().endsWith('.')) {
                                                    e.preventDefault();
                                                    const newVal = beforeCursor + '\n\n- ' + afterCursor;
                                                    setRequirements(newVal);
                                                    const newCursorPos = cursor + 4; // \n + \n + - + espacio
                                                    setTimeout(() => {
                                                        textarea.selectionStart = textarea.selectionEnd = newCursorPos;
                                                    }, 0);
                                                }
                                            }
                                        }}
                                    ></textarea>

                                    <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">Consideraciones Técnicas (Estándares)</label>
                                    <textarea 
                                        className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-mb-6 tw-text-justify tw-text-base"
                                        rows="3"
                                        value={techConditions}
                                        onChange={(e) => setTechConditions(formatBullets(e.target.value))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const textarea = e.target;
                                                const val = textarea.value;
                                                const cursor = textarea.selectionStart;
                                                const beforeCursor = val.substring(0, cursor);
                                                const afterCursor = val.substring(cursor);
                                                const lastNewline = beforeCursor.lastIndexOf('\n');
                                                const currentLine = beforeCursor.substring(lastNewline + 1);

                                                if (currentLine.trim().endsWith('.')) {
                                                    e.preventDefault();
                                                    const newVal = beforeCursor + '\n\n- ' + afterCursor;
                                                    setTechConditions(newVal);
                                                    const newCursorPos = cursor + 4; // \n + \n + - + espacio
                                                    setTimeout(() => {
                                                        textarea.selectionStart = textarea.selectionEnd = newCursorPos;
                                                    }, 0);
                                                }
                                            }
                                        }}
                                    ></textarea>

                                    {/* Subida de fotos / Registro Fotográfico */}
                                    <div className="tw-mb-6">
                                        <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">Adjuntar Registro Fotográfico (Opcional)</label>
                                        <div className="tw-flex tw-items-center tw-justify-center tw-w-full">
                                            <label className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-w-full tw-h-32 tw-border-2 tw-border-slate-300 tw-border-dashed tw-rounded-lg tw-cursor-pointer tw-bg-slate-50 hover:tw-bg-slate-100 tw-transition-all">
                                                <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-pt-5 tw-pb-6">
                                                    <i className="fa-solid fa-cloud-arrow-up tw-text-2xl tw-text-slate-400 tw-mb-2"></i>
                                                    <p className="tw-text-sm tw-text-slate-500"><span className="tw-font-semibold">Haz clic para subir</span> o arrastra tus imágenes</p>
                                                    <p className="tw-text-xs tw-text-slate-400">JPG, PNG o GIF (Max. 5MB cada una)</p>
                                                </div>
                                                <input type="file" multiple className="tw-hidden" accept="image/*" onChange={handleImageUpload} />
                                            </label>
                                        </div>

                                        {isUploading && (
                                            <div className="tw-flex tw-items-center tw-justify-center tw-mt-4 tw-text-sm tw-text-slate-600">
                                                <i className="fa-solid fa-circle-notch fa-spin tw-mr-2 tw-text-googleBlue"></i> Subiendo fotos...
                                            </div>
                                        )}

                                        {/* Galería y Edición de Títulos de Imágenes */}
                                        {images.length > 0 && (
                                            <div className="tw-space-y-4 tw-mt-6">
                                                <div className="tw-text-xs tw-font-bold tw-text-slate-500 tw-uppercase tw-tracking-wider">
                                                    Fotos Adjuntas ({images.length}) — Asigna un título opcional y ajusta el orden:
                                                </div>
                                                {images.map((imgItem, idx) => {
                                                    const url = typeof imgItem === 'string' ? imgItem : (imgItem.url || imgItem);
                                                    const title = typeof imgItem === 'string' ? '' : (imgItem.title || '');
                                                    return (
                                                        <div key={idx} className="tw-flex tw-flex-col sm:tw-flex-row tw-items-center tw-gap-4 tw-p-3.5 tw-bg-slate-50 dark:tw-bg-slate-800 tw-border tw-border-slate-200 dark:tw-border-slate-700 tw-rounded-xl tw-shadow-sm hover:tw-border-slate-300 tw-transition-all">
                                                            <div className="tw-relative tw-w-28 tw-h-20 tw-flex-shrink-0 tw-rounded-lg tw-overflow-hidden tw-border tw-border-slate-300 tw-bg-slate-200">
                                                                <img src={url} className="tw-w-full tw-h-full tw-object-cover" alt={`Foto ${idx + 1}`} />
                                                                <span className="tw-absolute tw-top-1 tw-left-1 tw-bg-slate-900/80 tw-text-white tw-text-[10px] tw-font-bold tw-px-1.5 tw-py-0.5 tw-rounded">
                                                                    #{idx + 1}
                                                                </span>
                                                            </div>
                                                            <div className="tw-flex-1 tw-w-full">
                                                                <label className="tw-block tw-text-xs tw-font-bold tw-text-slate-600 dark:tw-text-slate-300 tw-mb-1">
                                                                    Título / Leyenda Opcional (Foto #{idx + 1}):
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Ej: Foto 1: Registro de instalación..."
                                                                    className="tw-w-full tw-p-2.5 tw-bg-white dark:tw-bg-slate-900 tw-border tw-border-slate-300 dark:tw-border-slate-600 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-text-sm"
                                                                    value={title}
                                                                    onChange={(e) => handleImageTitleChange(idx, e.target.value)}
                                                                />
                                                            </div>
                                                            <div className="tw-flex sm:tw-flex-col tw-gap-1.5 tw-justify-end tw-w-full sm:tw-w-auto">
                                                                <div className="tw-flex tw-gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleMoveImage(idx, 'up')}
                                                                        disabled={idx === 0}
                                                                        className={`tw-px-2.5 tw-py-1.5 tw-text-xs tw-rounded-md tw-border ${idx === 0 ? 'tw-text-slate-300 tw-border-slate-200 tw-bg-slate-100 tw-cursor-not-allowed' : 'tw-text-slate-700 tw-bg-white hover:tw-bg-slate-100 tw-border-slate-300'}`}
                                                                        title="Mover arriba / antes"
                                                                    >
                                                                        <i className="fa-solid fa-arrow-up"></i>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleMoveImage(idx, 'down')}
                                                                        disabled={idx === images.length - 1}
                                                                        className={`tw-px-2.5 tw-py-1.5 tw-text-xs tw-rounded-md tw-border ${idx === images.length - 1 ? 'tw-text-slate-300 tw-border-slate-200 tw-bg-slate-100 tw-cursor-not-allowed' : 'tw-text-slate-700 tw-bg-white hover:tw-bg-slate-100 tw-border-slate-300'}`}
                                                                        title="Mover abajo / después"
                                                                    >
                                                                        <i className="fa-solid fa-arrow-down"></i>
                                                                    </button>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveImage(idx)}
                                                                    className="tw-px-2.5 tw-py-1.5 tw-text-xs tw-text-red-600 tw-bg-red-50 hover:tw-bg-red-100 tw-border tw-border-red-200 tw-rounded-md tw-transition-colors"
                                                                    title="Quitar foto"
                                                                >
                                                                    <i className="fa-solid fa-trash-can tw-mr-1"></i> Quitar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">Condiciones Comerciales</label>
                                    <textarea 
                                        className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-text-justify tw-text-base"
                                        rows="4"
                                        value={commercialConditions}
                                        onChange={(e) => setCommercialConditions(e.target.value)}
                                    ></textarea>
                                </div>

                                {/* Selector de Moneda */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                    <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-3">Moneda de la Cotización</label>
                                    <div className="tw-grid tw-grid-cols-3 tw-gap-3">
                                        {[
                                            { id: 'CLP', label: 'Pesos (CLP)', icon: 'fa-solid fa-money-bill-1-wave', desc: 'Símbolo: $' },
                                            { id: 'USD', label: 'Dólares (USD)', icon: 'fa-solid fa-dollar-sign', desc: 'Símbolo: US$' },
                                            { id: 'UF', label: 'Unidad de Fomento (UF)', icon: 'fa-solid fa-chart-line', desc: 'Símbolo: UF' }
                                        ].map((curr) => (
                                            <button
                                                key={curr.id}
                                                type="button"
                                                onClick={() => handleCurrencyChange(curr.id)}
                                                className={`tw-flex tw-flex-col tw-items-center tw-justify-center tw-p-4 tw-rounded-xl tw-border tw-transition-all tw-duration-200 ${
                                                    currency === curr.id
                                                        ? 'tw-border-googleBlue tw-bg-blue-50/50 tw-text-googleBlue tw-ring-2 tw-ring-blue-100 tw-font-bold'
                                                        : 'tw-border-slate-200 tw-bg-slate-50 tw-text-slate-600 hover:tw-bg-slate-100 hover:tw-border-slate-300'
                                                }`}
                                            >
                                                <i className={`${curr.icon} tw-text-xl tw-mb-2`}></i>
                                                <span className="tw-text-sm">{curr.label}</span>
                                                <span className="tw-text-[10px] tw-text-slate-400 tw-mt-1">{curr.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Tablas */}
                                {renderTableInput(items, setItems, "Propuesta Económica (Principal)")}
                                {renderTableInput(optionals, setOptionals, "Items Opcionales / Adicionales")}

                                {/* Acciones */}
                                <div className="tw-pt-6 tw-pb-12 tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4">
                                    <button 
                                        onClick={handleSaveDraft}
                                        disabled={isGenerating || isSavingDraft}
                                        className={`tw-w-full tw-py-4 tw-rounded-xl tw-text-lg tw-font-bold tw-text-slate-700 tw-border tw-border-slate-300 tw-bg-white hover:tw-bg-slate-50 hover:-tw-translate-y-1 tw-shadow-md tw-transition-all ${(isGenerating || isSavingDraft) ? 'tw-opacity-50 tw-cursor-not-allowed' : ''}`}
                                    >
                                        {isSavingDraft ? <span><i className="fa-solid fa-spinner fa-spin tw-mr-3"></i> Guardando...</span> : <span><i className="fa-solid fa-floppy-disk tw-mr-3"></i> Guardar Borrador</span>}
                                    </button>
                                    <button 
                                        onClick={handleGenerate}
                                        disabled={isGenerating || isSavingDraft}
                                        className={`tw-w-full tw-py-4 tw-rounded-xl tw-text-lg tw-font-bold tw-text-white tw-shadow-lg tw-transition-all ${(isGenerating || isSavingDraft) ? 'tw-bg-slate-400 tw-cursor-not-allowed' : 'tw-bg-googleBlue hover:tw-bg-blue-700 hover:-tw-translate-y-1 hover:tw-shadow-xl'}`}
                                    >
                                        {isGenerating ? <span><i className="fa-solid fa-circle-notch fa-spin tw-mr-3"></i> Generando PDF...</span> : <span><i className="fa-solid fa-file-pdf tw-mr-3"></i> Generar y Descargar Cotización PDF</span>}
                                    </button>
                                </div>
                            </div>

                            {/* Columna Previsualización */}
                            <div className="tw-hidden lg:tw-block tw-w-[450px] tw-sticky tw-top-0 tw-h-[calc(100vh-120px)]">
                                <div className="tw-bg-white tw-rounded-xl tw-shadow-md tw-border tw-border-slate-200 tw-h-full tw-flex tw-flex-col tw-overflow-hidden">
                                    <div className="tw-bg-slate-800 tw-text-white tw-px-4 tw-py-2 tw-text-xs tw-font-bold tw-flex tw-justify-between tw-items-center">
                                        <span>PREVISUALIZACIÓN REAL</span>
                                        <i className="fa-solid fa-eye"></i>
                                    </div>
                                    <div className="tw-flex-1 tw-bg-slate-100 tw-relative">
                                        {previewUrl ? (
                                            <iframe 
                                                src={previewUrl} 
                                                className="tw-w-full tw-h-full tw-border-none"
                                                title="PDF Preview"
                                            ></iframe>
                                        ) : (
                                            <div className="tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-text-slate-400 tw-p-8 tw-text-center">
                                                <i className="fa-solid fa-file-pdf tw-text-5xl tw-mb-4 tw-opacity-20"></i>
                                                <p className="tw-text-sm">Seleccione un cliente para ver la previsualización del PDF en tiempo real.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* VISTA HISTORIAL */
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-8">
                    <div className="tw-max-w-[98%] xl:tw-max-w-[95%] 2xl:tw-max-w-7xl tw-mx-auto">
                        <div className="tw-mb-6">
                            <div className="tw-flex tw-flex-col sm:tw-flex-row sm:tw-items-center tw-justify-between tw-gap-4 tw-mb-4">
                                <div>
                                    <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">Historial Completo de Cotizaciones</h2>
                                    <button
                                        onClick={() => setActiveTab('generator')}
                                        className="tw-text-sm tw-font-bold tw-text-googleBlue hover:tw-underline tw-flex tw-items-center tw-mt-1"
                                    >
                                        <i className="fa-solid fa-arrow-left tw-mr-2"></i>Volver al Generador
                                    </button>
                                </div>
                                <div className="tw-flex tw-items-center tw-gap-2">
                                    <button
                                        onClick={fetchHistory}
                                        className="tw-px-3 tw-py-2 tw-bg-white tw-border tw-border-slate-300 tw-rounded-lg hover:tw-bg-slate-50 tw-text-slate-700 tw-text-sm tw-font-bold tw-flex tw-items-center tw-gap-2 tw-shadow-sm"
                                        title="Actualizar Historial"
                                    >
                                        <i className={`fa-solid fa-arrows-rotate ${historyLoading ? 'fa-spin' : ''}`}></i>
                                        <span>Actualizar</span>
                                    </button>
                                </div>
                            </div>

                            {/* Barra de Filtros Avanzados */}
                            <div className="tw-bg-white tw-p-4 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 lg:tw-grid-cols-4 tw-gap-3">
                                {/* Buscador de texto */}
                                <div>
                                    <label className="tw-block tw-text-[11px] tw-font-bold tw-text-slate-500 tw-uppercase tw-mb-1">Buscar por Texto</label>
                                    <div className="tw-relative">
                                        <i className="fa-solid fa-magnifying-glass tw-absolute tw-left-3 tw-top-2.5 tw-text-slate-400 tw-text-xs"></i>
                                        <input
                                            type="text"
                                            placeholder="ID, cliente, proyecto..."
                                            className="tw-pl-8 tw-pr-3 tw-py-1.5 tw-border tw-border-slate-300 tw-rounded-lg tw-w-full tw-text-sm focus:tw-outline-none focus:tw-border-googleBlue"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* Filtro por Cliente */}
                                <div>
                                    <label className="tw-block tw-text-[11px] tw-font-bold tw-text-slate-500 tw-uppercase tw-mb-1">Cliente (Todos los años)</label>
                                    <select
                                        className="tw-w-full tw-py-1.5 tw-px-3 tw-border tw-border-slate-300 tw-rounded-lg tw-text-sm tw-bg-white focus:tw-outline-none focus:tw-border-googleBlue"
                                        value={historyClientFilter}
                                        onChange={(e) => setHistoryClientFilter(e.target.value)}
                                    >
                                        <option value="">-- Todos los Clientes --</option>
                                        {clients.map(c => {
                                            const cName = c.nombreFantasia || c.razonSocial || c.name || c.id;
                                            return <option key={c.id} value={c.id}>{cName}</option>;
                                        })}
                                    </select>
                                </div>

                                {/* Filtro por Mes / Año */}
                                <div>
                                    <label className="tw-block tw-text-[11px] tw-font-bold tw-text-slate-500 tw-uppercase tw-mb-1">Filtrar por Mes / Año</label>
                                    <input
                                        type="month"
                                        className="tw-w-full tw-py-1.5 tw-px-3 tw-border tw-border-slate-300 tw-rounded-lg tw-text-sm tw-bg-white focus:tw-outline-none focus:tw-border-googleBlue"
                                        value={historyMonthFilter}
                                        onChange={(e) => setHistoryMonthFilter(e.target.value)}
                                    />
                                </div>

                                {/* Filtro por Estado y Limpiar */}
                                <div>
                                    <label className="tw-block tw-text-[11px] tw-font-bold tw-text-slate-500 tw-uppercase tw-mb-1">Estado / Limpiar</label>
                                    <div className="tw-flex tw-gap-2">
                                        <select
                                            className="tw-w-full tw-py-1.5 tw-px-3 tw-border tw-border-slate-300 tw-rounded-lg tw-text-sm tw-bg-white focus:tw-outline-none focus:tw-border-googleBlue"
                                            value={historyStatusFilter}
                                            onChange={(e) => setHistoryStatusFilter(e.target.value)}
                                        >
                                            <option value="">Todos los Estados</option>
                                            <option value="Borrador">Borradores 📝</option>
                                            <option value="Generada">Generadas 📄</option>
                                        </select>
                                        {(searchTerm || historyClientFilter || historyMonthFilter || historyStatusFilter) && (
                                            <button
                                                onClick={() => {
                                                    setSearchTerm('');
                                                    setHistoryClientFilter('');
                                                    setHistoryMonthFilter('');
                                                    setHistoryStatusFilter('');
                                                }}
                                                className="tw-px-3 tw-py-1.5 tw-bg-slate-100 hover:tw-bg-slate-200 tw-text-slate-700 tw-rounded-lg tw-text-xs tw-font-bold tw-whitespace-nowrap tw-border tw-border-slate-300"
                                                title="Limpiar Filtros"
                                            >
                                                Limpiar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {historyLoading ? (
                            <div className="tw-text-center tw-py-20">
                                <i className="fa-solid fa-circle-notch fa-spin tw-text-4xl tw-text-slate-300"></i>
                                <p className="tw-mt-4 tw-text-slate-500">Cargando historial...</p>
                            </div>
                        ) : (
                            <div className="tw-bg-white tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-overflow-x-auto">
                                <table className="tw-w-full tw-text-sm tw-text-left">
                                    <thead className="tw-bg-slate-50 tw-text-slate-600 tw-font-bold tw-border-b tw-border-slate-200">
                                        <tr>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">ID</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Versión</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Estado</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Cliente</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Proyecto</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Fecha</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3">Total</th>
                                            <th className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="tw-divide-y tw-divide-slate-100">
                                        {history
                                            .filter(q => {
                                                const name = (q.clientName || '').toLowerCase();
                                                const project = (q.projectName || '').toLowerCase();
                                                const qid = (q.id || '').toLowerCase();
                                                const term = (searchTerm || '').toLowerCase();

                                                // 1. Buscador texto
                                                const matchesTerm = !term || name.includes(term) || project.includes(term) || qid.includes(term);

                                                // 2. Filtro por Cliente
                                                let matchesClient = true;
                                                if (historyClientFilter) {
                                                    const selectedC = clients.find(c => c.id === historyClientFilter);
                                                    const selectedCName = selectedC ? (selectedC.nombreFantasia || selectedC.razonSocial || selectedC.name || '').toLowerCase() : '';
                                                    matchesClient = (q.clientId === historyClientFilter) || (q.clientName && q.clientName.toLowerCase().includes(selectedCName));
                                                }

                                                // 3. Filtro por Mes/Año (YYYY-MM)
                                                let matchesMonth = true;
                                                if (historyMonthFilter && q.createdAt) {
                                                    try {
                                                        const dateObj = new Date(q.createdAt);
                                                        if (!isNaN(dateObj.getTime())) {
                                                            const yyyy = dateObj.getFullYear();
                                                            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                                                            matchesMonth = (`${yyyy}-${mm}` === historyMonthFilter);
                                                        }
                                                    } catch (e) {}
                                                }

                                                // 4. Filtro por Estado
                                                let matchesStatus = true;
                                                if (historyStatusFilter) {
                                                    if (historyStatusFilter === 'Borrador') {
                                                        matchesStatus = (q.status === 'Borrador');
                                                    } else if (historyStatusFilter === 'Generada') {
                                                        matchesStatus = (q.status !== 'Borrador');
                                                    }
                                                }

                                                return matchesTerm && matchesClient && matchesMonth && matchesStatus;
                                            })
                                            .map(q => (
                                                <tr key={`${q.id}-${q.version}`} className="hover:tw-bg-slate-50 tw-transition-colors">
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-font-bold tw-text-slate-700 tw-whitespace-nowrap">{q.id}</td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-whitespace-nowrap">
                                                        <span className="tw-px-2 tw-py-0.5 tw-bg-slate-100 tw-text-slate-600 tw-rounded tw-text-xs tw-font-bold">v{q.version}</span>
                                                    </td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-whitespace-nowrap">
                                                        {q.status === 'Borrador' ? (
                                                            <span className="tw-px-2 tw-py-1 tw-bg-amber-100 tw-text-amber-800 tw-rounded-lg tw-text-xs tw-font-bold tw-shadow-sm tw-whitespace-nowrap tw-inline-block">Borrador 📝</span>
                                                        ) : (
                                                            <span className="tw-px-2 tw-py-1 tw-bg-emerald-100 tw-text-emerald-800 tw-rounded-lg tw-text-xs tw-font-bold tw-shadow-sm tw-whitespace-nowrap tw-inline-block">Emitida 📄</span>
                                                        )}
                                                    </td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-text-slate-600 tw-max-w-[140px] tw-truncate" title={q.clientName}>{q.clientName}</td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-text-slate-600 tw-max-w-[180px] tw-truncate" title={q.projectName || '---'}>{q.projectName || '---'}</td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-text-slate-500 tw-whitespace-nowrap">
                                                        {q.createdAt ? (new Date(q.createdAt).toLocaleDateString('es-CL')) : '---'}
                                                    </td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-font-semibold tw-text-[#004d4d] tw-whitespace-nowrap">{formatMoney(q.total || 0, q.currency)}</td>
                                                    <td className="tw-px-2 lg:tw-px-3 xl:tw-px-4 tw-py-3 tw-text-right">
                                                        <div className="tw-flex tw-justify-end tw-gap-1">
                                                            <button 
                                                                onClick={() => handleDownloadFromHistory(q)}
                                                                className="tw-p-1.5 tw-text-teal-600 hover:tw-bg-teal-50 tw-rounded-lg tw-transition-colors"
                                                                title="Descargar PDF"
                                                            >
                                                                <i className="fa-solid fa-download"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleEditFromHistory(q)}
                                                                className="tw-p-1.5 tw-text-googleBlue hover:tw-bg-blue-50 tw-rounded-lg tw-transition-colors"
                                                                title="Editar (Generar nueva versión)"
                                                            >
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleCopyFromHistory(q)}
                                                                className="tw-p-1.5 tw-text-emerald-600 hover:tw-bg-emerald-50 tw-rounded-lg tw-transition-colors"
                                                                title="Copiar (Crear nueva cotización)"
                                                            >
                                                                <i className="fa-solid fa-copy"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteFromHistory(q.id, q.version)}
                                                                className="tw-p-1.5 tw-text-red-500 hover:tw-bg-red-50 tw-rounded-lg tw-transition-colors"
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

            {dialog && (
                <div className="tw-fixed tw-inset-0 tw-z-[9999] tw-flex tw-items-center tw-justify-center tw-bg-black/50 tw-backdrop-blur-sm">
                    <div className="tw-bg-white tw-rounded-xl tw-shadow-2xl tw-border tw-border-slate-200 tw-p-6 tw-w-full tw-max-w-md tw-mx-4 tw-transform tw-transition-all animate-fade-in">
                        <h3 className="tw-text-lg tw-font-bold tw-text-slate-800 tw-mb-2">{dialog.title}</h3>
                        <p className="tw-text-sm tw-text-slate-600 tw-mb-6 tw-whitespace-pre-wrap">{dialog.message}</p>
                        
                        {dialog.type === 'prompt' && (
                            <input 
                                type="text" 
                                id="custom-dialog-prompt-input"
                                defaultValue={dialog.defaultValue}
                                className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-mb-6 tw-text-sm"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        dialog.resolve(e.target.value);
                                    }
                                }}
                            />
                        )}
                        
                        <div className="tw-flex tw-justify-end tw-gap-3">
                            {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                                <button 
                                    onClick={() => dialog.resolve(dialog.type === 'prompt' ? null : false)}
                                    className="tw-px-4 tw-py-2 tw-bg-slate-100 tw-text-slate-700 tw-rounded-lg tw-text-sm tw-font-bold hover:tw-bg-slate-200 tw-transition-all"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button 
                                onClick={() => {
                                    if (dialog.type === 'prompt') {
                                        const inputVal = document.getElementById('custom-dialog-prompt-input')?.value;
                                        dialog.resolve(inputVal);
                                    } else {
                                        dialog.resolve(true);
                                    }
                                }}
                                className="tw-px-4 tw-py-2 tw-bg-googleBlue tw-text-white tw-rounded-lg tw-text-sm tw-font-bold hover:tw-bg-blue-700 tw-transition-all tw-shadow-sm"
                            >
                                Aceptar
                            </button>
                        </div>
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
