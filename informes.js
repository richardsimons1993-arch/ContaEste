const { useState, useEffect, useRef } = React;

const ReportsApp = () => {
    // Listas
    const [clients, setClients] = useState([]);
    const [selectedClient, setSelectedClient] = useState('');
    const [projectName, setProjectName] = useState('');
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    
    // Correlativo y versión
    const [nextId, setNextId] = useState(1);
    const [currentVersion, setCurrentVersion] = useState(1);

    // Secciones del Formulario
    const [generalData, setGeneralData] = useState('');
    const [scope, setScope] = useState('');
    const [materials, setMaterials] = useState([{ id: Date.now(), desc: '', notes: '' }]);
    const [results, setResults] = useState('');
    const [conclusions, setConclusions] = useState('');
    const [images, setImages] = useState([]); // URLs de imágenes subidas (/uploads/filename.jpg)
    const [isUploading, setIsUploading] = useState(false);

    // Historial y Control
    const [activeTab, setActiveTab] = useState('generator'); // 'generator' | 'history'
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [previewUrl, setPreviewUrl] = useState(null);
    const [logoData, setLogoData] = useState({ svg: null, base64: null });
    const [isGenerating, setIsGenerating] = useState(false);
    const [dialog, setDialog] = useState(null); // { type: 'alert'|'confirm', title, message, resolve }
    const previewTimeoutRef = useRef(null);

    // Cargar datos iniciales
    useEffect(() => {
        loadData();
        fetchHistory();
        loadLogo();

        // Sincronizar clientes con el estado global de la app
        const syncInterval = setInterval(() => {
            if (window.state && window.state.clients) {
                setClients(prev => {
                    if (prev.length !== window.state.clients.length) {
                        return window.state.clients;
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

    // Cargar clientes desde el estado global en Finanzas
    const loadData = async () => {
        try {
            let clientsData = window.state && window.state.clients ? window.state.clients : [];
            if (clientsData.length > 0) {
                setClients(clientsData);
            }
            const year = new Date().getFullYear();
            setCurrentYear(year);
        } catch (error) {
            console.error("Error cargando clientes en informes:", error);
        }
    };

    // Cargar el logotipo de la empresa
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
            console.warn("No se pudo cargar el logo para PDF de informes", e);
        }
    };

    // Obtener historial de informes
    const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
            const data = await window.StorageAPI.async.getReports();
            if (Array.isArray(data)) {
                setHistory(data);
            } else {
                setHistory([]);
            }
        } catch (err) {
            console.error("Error al buscar historial de informes:", err);
            setHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    // Calcular próximo ID correlativo al cambiar de cliente o año
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

                const idData = await window.StorageAPI.async.getNextReportId(prefix, currentYear);
                setNextId(idData.nextId);
                setCurrentVersion(1);
            } catch (err) {
                console.warn("Error obteniendo correlativo de informe:", err);
            }
        };
        fetchNextIdVal();
    }, [selectedClient, currentYear]);

    // Recalcular previsualización
    useEffect(() => {
        if (activeTab !== 'generator') return;
        
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(() => {
            updatePreview();
        }, 1200);

        return () => {
            if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        };
    }, [selectedClient, projectName, generalData, scope, materials, results, conclusions, images, activeTab, logoData]);

    const activeClient = clients.find(c => c.id === selectedClient);
    let activePrefix = 'INO';
    let selectedClientName = '[Seleccione un Cliente]';
    if (activeClient) {
        selectedClientName = activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente Sin Nombre';
        activePrefix = selectedClientName.replace(/[^A-Za-z\u00C0-\u017F]/g, '').substring(0, 3).toUpperCase();
        if (activePrefix.length < 3) activePrefix = activePrefix.padEnd(3, 'X');
    }
    const displayId = selectedClient ? `INF-${activePrefix}-${currentYear}-${String(nextId).padStart(2, '0')}` : '(Seleccione Cliente)';

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

    // Manejar tabla de materiales
    const handleMaterialChange = (id, field, value) => {
        setMaterials(materials.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const addMaterialRow = () => {
        setMaterials([...materials, { id: Date.now(), desc: '', notes: '' }]);
    };

    const removeMaterialRow = (id) => {
        setMaterials(materials.filter(item => item.id !== id));
    };

    // Subir imágenes
    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setIsUploading(true);
        const uploadedUrls = [];

        for (let file of files) {
            const formData = new FormData();
            formData.append('image', file);

            try {
                // Hacer el post al endpoint de imágenes
                const response = await fetch('/api/reports/upload-image', {
                    method: 'POST',
                    body: formData
                });
                if (response.ok) {
                    const data = await response.json();
                    uploadedUrls.push(data.url);
                } else {
                    console.error("Error al subir archivo:", file.name);
                }
            } catch (err) {
                console.error("Excepción al subir imagen:", err);
            }
        }

        setImages([...images, ...uploadedUrls]);
        setIsUploading(false);
    };

    // Quitar imagen
    const handleRemoveImage = (indexToRemove) => {
        setImages(images.filter((_, idx) => idx !== indexToRemove));
    };

    // Helper para convertir imagen URL a Base64 en navegador
    const convertImageUrlToBase64 = (url) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => {
                resolve(null); // Ignorar fallos de imagen y retornar null
            };
            img.src = url;
        });
    };

    // Construcción del documento pdfMake
    const buildDocDefinition = async (isForPreview = false) => {
        const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
        const formattedId = displayId;

        if (window.pdfMake && window.pdfMake.vfs === undefined && window.pdfMakeFonts !== undefined) {
            window.pdfMake.vfs = window.pdfMakeFonts.pdfMake.vfs;
        }

        // 1. Cabecera principal
        const docDefinition = {
            pageSize: 'LETTER',
            pageMargins: [ 40, 35, 40, 45 ],
            content: [
                {
                    columns: [
                        {
                            width: '*',
                            stack: [
                                { text: 'INFORME TÉCNICO DE PROYECTO', fontSize: 20, bold: true, color: '#0f172a', margin: [0, 0, 0, 5] },
                                { text: `N° ${formattedId}`, fontSize: 12, bold: true, color: '#0f766e', margin: [0, 0, 0, 5] },
                                (currentVersion > 1 ? { text: `VERSIÓN ${currentVersion}`, fontSize: 9, bold: true, color: '#94a3b8', margin: [0, 0, 0, 5] } : null),
                                { text: `Proyecto: ${projectName || '---'}`, fontSize: 11, bold: true, color: '#1e293b' },
                                { text: `Cliente: ${clientName}`, fontSize: 11, bold: true, color: '#1e293b', margin: [0, 2, 0, 0] }
                            ].filter(Boolean)
                        },
                        {
                            width: 220,
                            stack: [
                                (logoData.svg ? { svg: logoData.svg, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : (logoData.base64 ? { image: logoData.base64, width: 120, alignment: 'right', margin: [0, -10, 0, 10] } : null)),
                                { text: 'Simons SPA - Soluciones Tecnológicas', fontSize: 10, color: '#64748b', alignment: 'right' },
                                { text: `Fecha: ${new Date().toLocaleDateString('es-CL')}`, fontSize: 10, color: '#64748b', alignment: 'right' }
                            ].filter(Boolean)
                        }
                    ],
                    margin: [0, 0, 0, 15]
                },
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 2, lineColor: '#1e293b' }], margin: [0, 0, 0, 15] }
            ],
            defaultStyle: {
                fontSize: 11.5,
                color: '#334155',
                lineHeight: 1.3
            },
            styles: {
                sectionHeader: {
                    bold: true,
                    fontSize: 13,
                    color: '#0f766e',
                    margin: [0, 15, 0, 5]
                },
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

        const addSectionHeader = (title) => {
            content.push({
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
                margin: [0, 15, 0, 8]
            });
        };

        // 1. Datos Generales
        addSectionHeader('1. DATOS GENERALES DEL PROYECTO');
        content.push({ text: generalData || 'No se ingresaron datos generales.', margin: [8, 0, 0, 12], alignment: 'justify' });

        // 2. Alcance del Proyecto
        addSectionHeader('2. ALCANCE DEL PROYECTO');
        content.push({ text: scope || 'No se ingresó alcance del proyecto.', margin: [8, 0, 0, 12], alignment: 'justify' });

        // 3. Materiales Utilizados
        const materialsStackElements = [];
        materialsStackElements.push({
            table: {
                widths: [4, '*'],
                body: [
                    [
                        { text: '', fillColor: '#0f766e', border: [false, false, false, false] },
                        { text: '3. MATERIALES UTILIZADOS', fillColor: '#f8fafc', border: [false, false, false, false], margin: [5, 4, 0, 4], color: '#1e293b', bold: true, fontSize: 13 }
                    ]
                ]
            },
            layout: 'noBorders',
            margin: [0, 15, 0, 8]
        });

        if (materials && materials.length > 0) {
            const tableBody = [
                [
                    { text: 'Descripción del Material', style: 'tableHeader', alignment: 'left' },
                    { text: 'Notas / Detalles', style: 'tableHeader', alignment: 'left' }
                ]
            ];
            materials.forEach(m => {
                tableBody.push([
                    { text: m.desc || '-', fontSize: 10 },
                    { text: m.notes || '-', fontSize: 10 }
                ]);
            });
            materialsStackElements.push({
                table: {
                    headerRows: 1,
                    widths: ['*', '*'],
                    body: tableBody
                },
                layout: 'lightHorizontalLines',
                margin: [8, 0, 0, 12]
            });
        } else {
            materialsStackElements.push({ text: 'No se listaron materiales.', margin: [8, 0, 0, 12], italics: true, fontSize: 10 });
        }

        content.push({
            unbreakable: true,
            stack: materialsStackElements
        });

        // 4. Resultados del Proyecto (Texto + Imágenes)
        addSectionHeader('4. RESULTADOS DEL PROYECTO');
        content.push({ text: results || 'No se ingresaron resultados.', margin: [8, 0, 0, 12], alignment: 'justify' });

        // Procesar y adjuntar imágenes
        if (images && images.length > 0) {
            const imageObjects = [];
            // Si estamos previsualizando, cargamos marcadores de posición rápidos para no congelar la UI
            if (isForPreview) {
                images.forEach((_, idx) => {
                    imageObjects.push({
                        table: {
                            widths: ['*'],
                            body: [
                                [{ text: `[Registro Fotográfico - Imagen ${idx + 1}]`, alignment: 'center', margin: [0, 70, 0, 70], color: '#64748b', italics: true }]
                            ]
                        },
                        layout: {
                            hLineWidth: () => 1,
                            vLineWidth: () => 1,
                            hLineColor: () => '#cbd5e1',
                            vLineColor: () => '#cbd5e1',
                            fillColor: () => '#f8fafc'
                        },
                        margin: [40, 10, 40, 10]
                    });
                });
            } else {
                // Para el PDF final definitivo, convertimos las imágenes reales a Base64
                for (let imgUrl of images) {
                    const b64 = await convertImageUrlToBase64(imgUrl);
                    if (b64) {
                        imageObjects.push({
                            table: {
                                widths: ['*'],
                                body: [
                                    [{ image: b64, fit: [380, 250], alignment: 'center', border: [false, false, false, false] }]
                                ]
                            },
                            layout: 'noBorders',
                            margin: [0, 10, 0, 10]
                        });
                    }
                }
            }

            // Agrupar fotos en páginas de hasta 2 imágenes, cada una con su respectivo título y espaciado
            for (let i = 0; i < imageObjects.length; i += 2) {
                const pageContent = [];
                
                // Título de registro fotográfico para esta página de fotos
                pageContent.push({ text: 'Registro Fotográfico:', bold: true, fontSize: 11, margin: [8, 15, 0, 10], color: '#475569' });
                pageContent.push({ text: '\n' }); // Separación de un enter
                
                // Primera imagen de la página
                pageContent.push(imageObjects[i]);
                
                // Segunda imagen de la página (si existe)
                if (i + 1 < imageObjects.length) {
                    pageContent.push({ text: '\n' }); // Enter de separación entre las 2 imágenes
                    pageContent.push(imageObjects[i + 1]);
                }
                
                // Salto de página antes de las siguientes páginas de fotos
                if (i > 0) {
                    content.push({ text: '', pageBreak: 'before' });
                }
                
                content.push({
                    unbreakable: true,
                    stack: pageContent
                });
            }
        }

        // 5. Conclusiones y Recomendaciones
        const conclusionsBlock = [];
        conclusionsBlock.push(buildSectionHeaderInline('5. CONCLUSIONES Y RECOMENDACIONES'));
        conclusionsBlock.push({ text: conclusions || 'Sin conclusiones o recomendaciones.', margin: [8, 0, 0, 15], alignment: 'justify' });

        // Firma final
        conclusionsBlock.push(
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 531.9, y2: 0, lineWidth: 1.5, lineColor: '#1e293b' }], margin: [0, 15, 0, 15] },
            {
                stack: [
                    { text: 'ELABORADO POR:', fontSize: 10, bold: true, color: '#64748b', margin: [0, 0, 0, 2] },
                    { text: 'Departamento de Tecnología', fontSize: 10, bold: true, color: '#1e293b' },
                    { text: 'Simons SPA - Soluciones Tecnológicas', fontSize: 10, color: '#475569' }
                ],
                margin: [0, 10, 0, 10]
            }
        );

        const conclusionsStack = {
            unbreakable: true,
            stack: conclusionsBlock
        };

        if (images && images.length > 0) {
            conclusionsStack.pageBreak = 'before';
        }

        content.push(conclusionsStack);

        return docDefinition;
    };

    const buildSectionHeaderInline = (title) => ({
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
        margin: [0, 15, 0, 8]
    });

    // Actualizar previsualizador rápido
    const updatePreview = async () => {
        if (!selectedClient || !window.pdfMake) return;
        
        try {
            // Pasamos true para usar placeholders rápidos de imágenes en la preview (no congelar UI al escribir)
            const docDefinition = await buildDocDefinition(true);
            const pdfDocGenerator = pdfMake.createPdf(docDefinition);
            pdfDocGenerator.getBlob((blob) => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);
            });
        } catch (err) {
            console.error("Error al actualizar la previsualización del informe:", err);
        }
    };

    // Guardar informe final y subir a OneDrive
    const handleGenerate = async () => {
        if (!selectedClient) {
            await customAlert("Debe seleccionar un cliente.", "Falta Información");
            return;
        }
        
        setIsGenerating(true);

        try {
            // Generación con las fotos Base64 definitivas incorporadas
            const docDefinition = await buildDocDefinition(false);
            const clientName = activeClient ? (activeClient.nombreFantasia || activeClient.razonSocial || 'Cliente_Desconocido') : 'Cliente_Desconocido';
            const versionSuffix = currentVersion > 1 ? `_v${currentVersion}` : '';
            const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const fileName = `Informe_${displayId}${safeProjectName}${versionSuffix}.pdf`;

            const pdfDocGenerator = pdfMake.createPdf(docDefinition);
            
            await new Promise((resolve, reject) => {
                try {
                    pdfDocGenerator.getBase64(async (base64) => {
                        try {
                            const pdfBase64DataUri = 'data:application/pdf;base64,' + base64;
                            
                            // Descarga en navegador
                            const link = document.createElement('a');
                            link.href = pdfBase64DataUri;
                            link.download = fileName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            
                            // Datos del informe para BD
                            const rData = {
                                id: displayId,
                                correlative: nextId,
                                year: currentYear,
                                version: currentVersion,
                                clientId: selectedClient,
                                clientName: clientName,
                                projectName: projectName,
                                generalData: generalData,
                                scope: scope,
                                materials: materials,
                                results: results,
                                conclusions: conclusions,
                                images: images
                            };
                            
                            // Guardar en la base de datos
                            await window.StorageAPI.async.saveReport(rData);
                            
                            // Subir a OneDrive
                            await window.StorageAPI.async.saveReportPdf({
                                clientName: clientName,
                                year: currentYear,
                                reportId: displayId + versionSuffix,
                                projectName: projectName,
                                pdfBase64: pdfBase64DataUri
                            });
                            
                            fetchHistory();
                            if (currentVersion <= 1) setNextId(nextId + 1);
                             
                             // Limpiar formulario tras generar informe
                             setSelectedClient('');
                             setProjectName('');
                             setGeneralData('');
                             setScope('');
                             setMaterials([{ id: Date.now(), desc: '', notes: '' }]);
                             setResults('');
                             setConclusions('');
                             setImages([]);
                             setCurrentVersion(1);

                             await customAlert("Informe generado, descargado y guardado en tu OneDrive con éxito.", "Éxito");
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
            console.error("Fallo al generar el PDF del informe:", error);
            await customAlert("Error al generar PDF: " + (error.message || JSON.stringify(error)));
        } finally {
            setIsGenerating(false);
        }
    };

    // Cargar informe para edición
    const handleEditFromHistory = async (r) => {
        try {
            setSelectedClient(r.clientId);
            setProjectName(r.projectName || '');
            setGeneralData(r.generalData || '');
            setScope(r.scope || '');
            setMaterials(JSON.parse(r.materials || '[]'));
            setResults(r.results || '');
            setConclusions(r.conclusions || '');
            setImages(JSON.parse(r.images || '[]'));
            
            const vData = await window.StorageAPI.async.getReportNextVersion(r.id);
            setCurrentVersion(vData.nextVersion);
            
            setNextId(r.correlative);
            setCurrentYear(r.year);

            setActiveTab('generator');
            await customAlert(`Editando Informe ${r.id}. Se guardará como versión ${vData.nextVersion}.`, "Edición Iniciada");
        } catch (err) {
            console.error(err);
            await customAlert("Error al cargar informe para edición.");
        }
    };

    // Eliminar informe de la BD
    const handleDeleteFromHistory = async (id, version) => {
        if (!await customConfirm(`¿Está seguro de eliminar la versión ${version} del informe ${id}?`, "Eliminar Informe")) return;
        try {
            await window.StorageAPI.async.deleteReport(id, version);
            fetchHistory();
        } catch (err) {
            await customAlert("Error al eliminar.");
        }
    };

    return (
        <div className="tw-flex tw-flex-col tw-min-h-full tw-bg-slate-50 tw-font-sans">
            {activeTab === 'generator' ? (
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-4 md:tw-p-8 scrollbar-hide">
                    <div className="tw-max-w-7xl tw-mx-auto">
                        <div className="tw-mb-8">
                            <div className="tw-flex tw-justify-between tw-items-center">
                                <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">
                                    Generador de Informes Técnicos
                                </h2>
                                <div className="tw-text-right">
                                    <span className="tw-px-4 tw-py-2 tw-bg-teal-100 tw-text-teal-800 tw-rounded-lg tw-text-sm tw-font-bold tw-shadow-sm">
                                        N° {displayId}
                                    </span>
                                    {currentVersion > 1 && (
                                        <div className="tw-text-xs tw-font-bold tw-text-teal-600 tw-mt-2">VERSION {currentVersion}</div>
                                    )}
                                </div>
                            </div>
                            <div className="tw-mt-4">
                                <button 
                                    onClick={() => setActiveTab('history')}
                                    className="tw-bg-white tw-border tw-border-slate-300 tw-text-googleBlue tw-px-4 tw-py-2 tw-rounded-lg tw-text-xs tw-font-bold hover:tw-bg-slate-50 hover:tw-text-blue-700 tw-transition-all tw-flex tw-items-center tw-shadow-sm"
                                >
                                    <i className="fa-solid fa-clock-rotate-left tw-mr-2"></i>VER HISTORIAL DE INFORMES
                                </button>
                            </div>
                        </div>

                        <div className="tw-flex tw-flex-col lg:tw-flex-row tw-gap-8">
                            {/* Columna Formulario */}
                            <div className="tw-flex-1 tw-space-y-6">
                                {/* Cliente y Proyecto */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4">
                                    <div>
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
                                    <div>
                                        <label className="tw-block tw-text-sm tw-font-bold tw-text-slate-700 tw-mb-2">Nombre del Proyecto</label>
                                        <input 
                                            type="text" 
                                            className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all"
                                            placeholder="Ej: Mantenimiento de Antena U7"
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* Secciones del Informe */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-space-y-6">
                                    {/* 1. Datos Generales */}
                                    <div>
                                        <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">1. Datos Generales del Proyecto</label>
                                        <textarea 
                                            className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-text-justify tw-text-base"
                                            rows="3"
                                            placeholder="Resumen ejecutivo y datos generales del sitio..."
                                            value={generalData}
                                            onChange={(e) => setGeneralData(e.target.value)}
                                        ></textarea>
                                    </div>

                                    {/* 2. Alcance */}
                                    <div>
                                        <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">2. Alcance del Proyecto</label>
                                        <textarea 
                                            className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-text-justify tw-text-base"
                                            rows="3"
                                            placeholder="Detalle de las tareas y límites del proyecto realizado..."
                                            value={scope}
                                            onChange={(e) => setScope(e.target.value)}
                                        ></textarea>
                                    </div>
                                </div>

                                {/* 3. Materiales Utilizados */}
                                <div className="tw-bg-white tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-p-6">
                                    <div className="tw-flex tw-justify-between tw-items-center tw-mb-4">
                                        <h3 className="tw-text-base tw-font-bold tw-text-slate-700">3. Materiales Utilizados</h3>
                                        <button onClick={addMaterialRow} className="tw-text-sm tw-text-googleBlue hover:tw-underline tw-font-medium">
                                            + Añadir Fila
                                        </button>
                                    </div>
                                    <div className="tw-overflow-x-auto">
                                        <table className="tw-w-full">
                                            <thead>
                                                <tr className="tw-text-xs tw-font-bold tw-text-slate-400 tw-uppercase tw-tracking-wider tw-border-b tw-border-slate-100">
                                                    <th className="tw-text-left tw-pb-2">Descripción del Material</th>
                                                    <th className="tw-text-left tw-pb-2 tw-w-72">Notas / Detalles</th>
                                                    <th className="tw-w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {materials.map((m) => (
                                                    <tr key={m.id} className="tw-border-b tw-border-slate-50 last:tw-border-0">
                                                        <td className="tw-py-2 tw-pr-2">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Material / Componente..."
                                                                className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-base"
                                                                value={m.desc}
                                                                onChange={(e) => handleMaterialChange(m.id, 'desc', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="tw-py-2 tw-pl-2">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Ej: Serial, Marca, Ubicación"
                                                                className="tw-w-full tw-p-2 tw-border tw-border-slate-300 tw-rounded tw-text-base"
                                                                value={m.notes}
                                                                onChange={(e) => handleMaterialChange(m.id, 'notes', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="tw-py-2 tw-text-center">
                                                            <button onClick={() => removeMaterialRow(m.id)} className="tw-text-red-400 hover:tw-text-red-600">
                                                                <i className="fa-solid fa-trash"></i>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {materials.length === 0 && <div className="tw-text-base tw-text-slate-500 tw-italic tw-mt-2">Sin materiales registrados.</div>}
                                    </div>
                                </div>

                                {/* 4. Resultados del Proyecto y Fotos */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-space-y-6">
                                    <div>
                                        <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">4. Resultados del Proyecto</label>
                                        <textarea 
                                            className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-text-justify tw-text-base"
                                            rows="3"
                                            placeholder="Detalle de mediciones, conclusiones técnicas de finalización..."
                                            value={results}
                                            onChange={(e) => setResults(e.target.value)}
                                        ></textarea>
                                    </div>

                                    {/* Subida de fotos */}
                                    <div>
                                        <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">Adjuntar Registro Fotográfico</label>
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

                                        {/* Galería Previa */}
                                        {images.length > 0 && (
                                            <div className="tw-grid tw-grid-cols-2 md:tw-grid-cols-4 tw-gap-4 tw-mt-6">
                                                {images.map((imgUrl, idx) => (
                                                    <div key={idx} className="tw-group tw-relative tw-h-24 tw-rounded-lg tw-overflow-hidden tw-border tw-border-slate-200 tw-shadow-sm">
                                                        <img src={imgUrl} className="tw-w-full tw-h-full tw-object-cover" alt={`Previo ${idx + 1}`} />
                                                        <div className="tw-absolute tw-inset-0 tw-bg-black tw-bg-opacity-40 tw-opacity-0 group-hover:tw-opacity-100 tw-transition-opacity tw-flex tw-items-center tw-justify-center">
                                                            <button 
                                                                onClick={() => handleRemoveImage(idx)} 
                                                                className="tw-bg-red-500 tw-text-white tw-p-2 tw-rounded-full hover:tw-bg-red-700 tw-transition-colors"
                                                                title="Quitar foto"
                                                            >
                                                                <i className="fa-solid fa-trash-can"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 5. Conclusiones y recomendaciones */}
                                <div className="tw-bg-white tw-p-6 tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200">
                                    <label className="tw-block tw-text-base tw-font-bold tw-text-slate-700 tw-mb-2">5. Conclusiones y Recomendaciones</label>
                                    <textarea 
                                        className="tw-w-full tw-p-3 tw-bg-slate-50 tw-border tw-border-slate-300 tw-rounded-lg focus:tw-border-googleBlue focus:tw-ring-2 focus:tw-ring-blue-100 focus:tw-outline-none tw-transition-all tw-text-justify tw-text-base"
                                        rows="4"
                                        placeholder="Comentarios finales, recomendaciones preventivas, etc..."
                                        value={conclusions}
                                        onChange={(e) => setConclusions(e.target.value)}
                                    ></textarea>
                                </div>

                                {/* Acción de Generar */}
                                <div className="tw-pt-6 tw-pb-12">
                                    <button 
                                        onClick={handleGenerate}
                                        disabled={isGenerating}
                                        className={`tw-w-full tw-py-4 tw-rounded-xl tw-text-lg tw-font-bold tw-text-white tw-shadow-lg tw-transition-all ${isGenerating ? 'tw-bg-slate-400 tw-cursor-not-allowed' : 'tw-bg-teal-600 hover:tw-bg-teal-700 hover:-tw-translate-y-1 hover:tw-shadow-xl'}`}
                                    >
                                        {isGenerating ? <span><i className="fa-solid fa-circle-notch fa-spin tw-mr-3"></i> Generando Informe...</span> : <span><i className="fa-solid fa-file-pdf tw-mr-3"></i> Generar y Descargar Informe PDF</span>}
                                    </button>
                                </div>
                            </div>

                            {/* Columna Previsualización */}
                            <div className="tw-hidden lg:tw-block tw-w-[450px] tw-sticky tw-top-0 tw-h-[calc(100vh-120px)]">
                                <div className="tw-bg-white tw-rounded-xl tw-shadow-md tw-border tw-border-slate-200 tw-h-full tw-flex tw-flex-col tw-overflow-hidden">
                                    <div className="tw-bg-slate-800 tw-text-white tw-px-4 tw-py-2 tw-text-xs tw-font-bold tw-flex tw-justify-between tw-items-center">
                                        <span>VISTA PREVIA DEL INFORME</span>
                                        <i className="fa-solid fa-eye"></i>
                                    </div>
                                    <div className="tw-flex-1 tw-bg-slate-100 tw-relative">
                                        {previewUrl ? (
                                            <iframe 
                                                src={previewUrl} 
                                                className="tw-w-full tw-h-full tw-border-none"
                                                title="Report PDF Preview"
                                            ></iframe>
                                        ) : (
                                            <div className="tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-text-slate-400 tw-p-8 tw-text-center">
                                                <i className="fa-solid fa-file-invoice tw-text-5xl tw-mb-4 tw-opacity-20"></i>
                                                <p className="tw-text-sm">Seleccione un cliente para previsualizar el informe en tiempo real.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* PESTAÑA HISTORIAL */
                <div className="tw-flex-1 tw-overflow-y-auto tw-p-8">
                    <div className="tw-max-w-6xl tw-mx-auto">
                        <div className="tw-flex tw-justify-between tw-items-center tw-mb-8">
                            <div>
                                <h2 className="tw-text-2xl tw-font-bold tw-text-slate-800">Historial de Informes Generados</h2>
                                <button 
                                    onClick={() => setActiveTab('generator')}
                                    className="tw-text-sm tw-font-bold tw-text-googleBlue hover:tw-underline tw-flex tw-items-center tw-mt-2"
                                >
                                    <i className="fa-solid fa-arrow-left tw-mr-2"></i>Volver al Generador
                                </button>
                            </div>
                            <div className="tw-relative tw-flex tw-items-center">
                                <i className="fa-solid fa-magnifying-glass tw-absolute tw-left-3 tw-text-slate-400"></i>
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
                            <div className="tw-bg-white tw-rounded-xl tw-shadow-sm tw-border tw-border-slate-200 tw-overflow-x-auto">
                                <table className="tw-w-full tw-text-sm tw-text-left">
                                    <thead className="tw-bg-slate-50 tw-text-slate-600 tw-font-bold tw-border-b tw-border-slate-200">
                                        <tr>
                                            <th className="tw-px-6 tw-py-4">ID</th>
                                            <th className="tw-px-6 tw-py-4">Versión</th>
                                            <th className="tw-px-6 tw-py-4">Cliente</th>
                                            <th className="tw-px-6 tw-py-4">Proyecto</th>
                                            <th className="tw-px-6 tw-py-4">Fecha</th>
                                            <th className="tw-px-6 tw-py-4 tw-text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="tw-divide-y tw-divide-slate-100">
                                        {history
                                            .filter(r => {
                                                const name = (r.clientName || '').toLowerCase();
                                                const project = (r.projectName || '').toLowerCase();
                                                const rid = (r.id || '').toLowerCase();
                                                const term = (searchTerm || '').toLowerCase();
                                                return name.includes(term) || project.includes(term) || rid.includes(term);
                                            })
                                            .map(r => (
                                                <tr key={`${r.id}-${r.version}`} className="hover:tw-bg-slate-50 tw-transition-colors">
                                                    <td className="tw-px-6 tw-py-4 tw-font-bold tw-text-slate-700 tw-whitespace-nowrap">{r.id}</td>
                                                    <td className="tw-px-6 tw-py-4">
                                                        <span className="tw-px-2 tw-py-0.5 tw-bg-slate-100 tw-text-slate-600 tw-rounded tw-text-xs tw-font-bold">v{r.version}</span>
                                                    </td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-600 tw-whitespace-nowrap">{r.clientName}</td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-600 tw-max-w-xs tw-truncate">{r.projectName || '---'}</td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-slate-500 tw-whitespace-nowrap">
                                                        {r.createdAt ? (new Date(r.createdAt).toLocaleDateString('es-CL')) : '---'}
                                                    </td>
                                                    <td className="tw-px-6 tw-py-4 tw-text-right">
                                                        <div className="tw-flex tw-justify-end tw-gap-2">
                                                            <button 
                                                                onClick={() => handleEditFromHistory(r)}
                                                                className="tw-p-2 tw-text-googleBlue hover:tw-bg-blue-50 tw-rounded-lg tw-transition-colors"
                                                                title="Editar (Nueva versión)"
                                                            >
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteFromHistory(r.id, r.version)}
                                                                className="tw-p-2 tw-text-red-500 hover:tw-bg-red-50 tw-rounded-lg tw-transition-colors"
                                                                title="Eliminar del historial"
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
                                        No hay informes registrados en los últimos 90 días.
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
                        
                        <div className="tw-flex tw-justify-end tw-gap-3">
                            {dialog.type === 'confirm' && (
                                <button 
                                    onClick={() => dialog.resolve(false)}
                                    className="tw-px-4 tw-py-2 tw-bg-slate-100 tw-text-slate-700 tw-rounded-lg tw-text-sm tw-font-bold hover:tw-bg-slate-200 tw-transition-all"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button 
                                onClick={() => dialog.resolve(true)}
                                className="tw-px-4 tw-py-2 tw-bg-teal-600 tw-text-white tw-rounded-lg tw-text-sm tw-font-bold hover:tw-bg-teal-700 tw-transition-all tw-shadow-sm"
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

window.initReports = function() {
    const rootEl = document.getElementById('reports-root');
    if (!rootEl) return;
    
    if (!rootEl.hasChildNodes()) {
        console.log("Inicializando Módulo de Informes...");
        const root = ReactDOM.createRoot(rootEl);
        root.render(<ReportsApp />);
    }
};

window.initReports();
