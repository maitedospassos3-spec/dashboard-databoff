import React, { useState, useEffect, useMemo } from 'react';
import { Truck, Calendar, AlertTriangle, CheckCircle, Upload, Settings, X, Search, Clock, Activity, ArrowLeft, Gauge, Droplet, RefreshCw, FileSpreadsheet, Image as ImageIcon, FileText } from 'lucide-react';

const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSfglMd6QJe2TOlLZpZ1ANwbT53MzWshQZu6WhzctJqI5ug2_suxYC8mn3pC3kRhDMmNujlcmkt5ill/pub?output=xlsx";

export default function App() {
  const [fleetData, setFleetData] = useState({});
  const [revisions, setRevisions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [depsLoaded, setDepsLoaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  
  // Sincronização e Refresh Automático
  const [lastSync, setLastSync] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  // Navigation State
  const [currentView, setCurrentView] = useState('dashboard');
  const [historyVehicle, setHistoryVehicle] = useState(null);

  // Modal State
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [editLastRev, setEditLastRev] = useState("");
  const [editNextRevKm, setEditNextRevKm] = useState("");

  // Load Dependencies (SheetJS, html2canvas, jspdf) & Google Fonts
  useEffect(() => {
    if (!document.getElementById('inter-font')) {
      const link = document.createElement('link');
      link.id = 'inter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    const loadScript = (src) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });

    Promise.all([
      loadScript("https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    ]).then(() => setDepsLoaded(true)).catch(() => console.error("Erro ao carregar bibliotecas."));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('fleet_revisions');
    if (saved) {
      try {
        setRevisions(JSON.parse(saved));
      } catch (e) {
        console.error("Erro ao ler revisões salvas", e);
      }
    }
  }, []);

  useEffect(() => {
    if (!depsLoaded) return;

    const fetchSpreadsheet = async () => {
      try {
        if (Object.keys(fleetData).length === 0) setLoading(true);
        setIsRefreshing(true);
        
        const timestamp = new Date().getTime();
        let response;
        
        try {
          response = await fetch(`${SPREADSHEET_URL}&_t=${timestamp}`);
          if (!response.ok) throw new Error("Acesso direto bloqueado (CORS)");
        } catch (directErr) {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(SPREADSHEET_URL + "&_t=" + timestamp)}`;
          response = await fetch(proxyUrl);
          if (!response.ok) throw new Error("Falha também no Proxy");
        }
        
        const arrayBuffer = await response.arrayBuffer();
        processWorkbook(arrayBuffer);
        setLastSync(new Date());
      } catch (err) {
        setError("O Google bloqueou a importação automática. Por favor, clique no botão 'Planilha Manual'.");
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    };

    fetchSpreadsheet();
  }, [depsLoaded, refreshTrigger]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 5 * 60 * 1000); 
    return () => clearInterval(intervalId);
  }, []);

  const processWorkbook = (buffer) => {
    try {
      const workbook = window.XLSX.read(buffer, { type: 'array' });
      const newFleetData = {};
      
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (!rows || rows.length === 0) return;

        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const rowStr = String(rows[i]).toUpperCase();
          if (rowStr.includes('DATA') || rowStr.includes('KM') || rowStr.includes('INICIAL') || rowStr.includes('LITROS')) {
            headerRowIndex = i;
            break;
          }
        }

        const headers = rows[headerRowIndex] || [];
        const json = [];

        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const rowArray = rows[i];
          if (!rowArray || rowArray.length === 0) continue;
          
          const isRowEmpty = rowArray.every(val => val === null || val === undefined || val === '');
          if (isRowEmpty) continue;

          let rowObj = {};
          headers.forEach((colName, index) => {
            if (colName) rowObj[colName] = rowArray[index];
          });
          json.push(rowObj);
        }

        if (json.length > 0) {
          newFleetData[sheetName] = json;
        }
      });

      setFleetData(newFleetData);
      setError(null);
    } catch (e) {
      setError("Erro ao processar o arquivo Excel.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const arrayBuffer = evt.target.result;
      processWorkbook(arrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  };

  // Funções de Exportação Otimizadas
  const handleExportImage = async () => {
    if (!window.html2canvas) return;
    setIsExporting(true); // Aciona o modo de impressão (Muda Layout)
    
    // AWAIT VITAL: Aguarda 300ms para o React renderizar o header de impressão
    await new Promise(resolve => setTimeout(resolve, 300)); 
    
    try {
      const scrollPos = window.scrollY;
      window.scrollTo(0, 0);

      const element = document.getElementById('export-container');
      const canvas = await window.html2canvas(element, { 
        scale: 2, 
        useCORS: true,
        backgroundColor: '#f8fafc',
        ignoreElements: (node) => node.classList && node.classList.contains('no-export')
      });
      
      window.scrollTo(0, scrollPos);

      const dataURL = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Controle_Frota_Databoff_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.png`;
      link.href = dataURL;
      link.click();
    } catch (err) {
      console.error("Erro ao exportar imagem", err);
    } finally {
      setIsExporting(false); // Retorna ao modo interativo
    }
  };

  const handleExportPDF = async () => {
    if (!window.html2canvas || !window.jspdf) return;
    setIsExporting(true); 
    
    // AWAIT VITAL: Aguarda 300ms para o React remover o sticky e ocultar botões
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const scrollPos = window.scrollY;
      window.scrollTo(0, 0);

      const element = document.getElementById('export-container');
      const canvas = await window.html2canvas(element, { 
        scale: 2, 
        useCORS: true,
        backgroundColor: '#f8fafc',
        ignoreElements: (node) => node.classList && node.classList.contains('no-export')
      });
      
      window.scrollTo(0, scrollPos);

      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Controle_Frota_Databoff_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`);
    } catch (err) {
      console.error("Erro ao exportar PDF", err);
    } finally {
      setIsExporting(false);
    }
  };

  const openModal = (placa) => {
    setSelectedVehicle(placa);
    const revData = revisions[placa] || {};
    setEditLastRev(revData.lastRevision || "");
    setEditNextRevKm(revData.nextRevisionKm || "");
  };

  const saveRevision = () => {
    if (!selectedVehicle) return;
    const updatedRevisions = {
      ...revisions,
      [selectedVehicle]: { lastRevision: editLastRev, nextRevisionKm: editNextRevKm }
    };
    setRevisions(updatedRevisions);
    localStorage.setItem('fleet_revisions', JSON.stringify(updatedRevisions));
    setSelectedVehicle(null);
  };

  const getStatusInfo = (currentKm, nextRevKm) => {
    if (!nextRevKm) return { status: 'MISSING', text: "Não Informada", color: "text-slate-500", bg: "bg-slate-100/80 border border-slate-200", icon: <Clock className="w-3.5 h-3.5 mr-1.5" /> };
    const diff = Number(nextRevKm) - Number(currentKm);
    if (diff < 0) return { status: 'OVERDUE', text: `Atrasada (${Math.abs(diff)} km)`, color: "text-red-700", bg: "bg-red-50 border border-red-200/60 shadow-sm", icon: <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> };
    if (diff <= 500) return { status: 'WARNING', text: `Vence em ${diff} km`, color: "text-orange-700", bg: "bg-orange-50 border border-orange-200/60 shadow-sm", icon: <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> };
    return { status: 'OK', text: `Em Dia (${diff} km)`, color: "text-emerald-700", bg: "bg-emerald-50 border border-emerald-200/60 shadow-sm", icon: <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> };
  };

  const vehicles = useMemo(() => Object.keys(fleetData), [fleetData]);
  
  const extractValue = (row, keywords) => {
    const normalizedKeywords = keywords.map(kw => kw.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const key = Object.keys(row).find(k => {
      const normalizedKey = k.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return normalizedKeywords.some(kw => normalizedKey.includes(kw));
    });
    return key ? row[key] : null;
  };

  const parseNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let cleanStr = String(val).replace(/[^\d.,-]/g, '');
    cleanStr = cleanStr.replace(/\./g, '');
    cleanStr = cleanStr.replace(',', '.');
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed;
  };

  const currentKms = useMemo(() => {
    const kms = {};
    vehicles.forEach(v => {
      const records = fleetData[v] || [];
      let maxKm = 0;
      records.forEach(row => {
        const kmFinal = parseNumber(extractValue(row, ['KMFINAL', 'FINAL', 'KMATUAL', 'KMRODADO']));
        if (kmFinal > maxKm) maxKm = kmFinal;
      });
      kms[v] = maxKm;
    });
    return kms;
  }, [fleetData, vehicles]);

  const openHistory = (placa) => {
    setHistoryVehicle(placa);
    setCurrentView('history');
  };

  const filteredVehicles = useMemo(() => {
    let filtered = vehicles.filter(v => v.toLowerCase().includes(searchTerm.toLowerCase()));
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter(placa => {
        const revInfo = revisions[placa] || {};
        const currentKm = currentKms[placa] || 0;
        const statusObj = getStatusInfo(currentKm, revInfo.nextRevisionKm);
        return statusObj.status === statusFilter;
      });
    }
    return filtered;
  }, [vehicles, searchTerm, statusFilter, revisions, currentKms]);

  const dashboardStats = useMemo(() => {
    let overdue = 0;
    let warning = 0;
    let ok = 0;
    let missing = 0;
    vehicles.forEach(v => {
      const nextRevKm = revisions[v]?.nextRevisionKm;
      if (!nextRevKm) { missing++; return; }
      const currentKm = currentKms[v] || 0;
      const diff = Number(nextRevKm) - Number(currentKm);
      if (diff < 0) overdue++;
      else if (diff <= 500) warning++;
      else ok++;
    });
    return { total: vehicles.length, overdue, warning, ok, missing };
  }, [vehicles, revisions, currentKms]);

  if (!depsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8fafc] font-sans">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-600"></div>
        <p className="ml-4 text-slate-600 font-medium">Preparando ambiente moderno...</p>
      </div>
    );
  }

  return (
    <div id="export-container" className="min-h-screen bg-[#f8fafc] text-slate-800 selection:bg-cyan-100 relative" style={{ fontFamily: "'Inter', sans-serif" }}>
      
      {/* MARCA D'ÁGUA DATABOFF - Reta (sem rotate), Colorida (sem grayscale) e opacidade 8% */}
      <div className="absolute inset-0 pointer-events-none z-0 flex items-center justify-center opacity-[0.08] overflow-hidden min-h-full">
        <img 
          src="https://images.weserv.nl/?url=drive.google.com/uc?id=1pi35dS2vmAVTiLJi29uP3oNms-obTobC" 
          alt="Watermark Databoff" 
          className="w-[70vw] max-w-[700px] object-contain" 
          crossOrigin="anonymous"
        />
      </div>

      {/* HEADER DINÂMICO - Se "isExporting" removemos o sticky para evitar quebra no PDF */}
      <header className={`${isExporting ? 'static bg-[#f0f9ff]' : 'sticky top-0 bg-gradient-to-r from-[#f0f9ff]/90 via-white/90 to-[#ecfeff]/90 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,168,181,0.04)]'} z-40 border-b border-cyan-100/50`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 min-h-[6rem] sm:min-h-[7.5rem] flex items-center justify-between relative z-10">
          
          <div className="flex items-center space-x-4 sm:space-x-6">
            {/* Oculta o botão de voltar ao exportar */}
            {!isExporting && currentView === 'history' && (
              <button onClick={() => setCurrentView('dashboard')} className="p-2 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-full transition-all duration-300 no-export">
                <ArrowLeft className="w-6 h-6" />
              </button>
            )}
            
            {/* LOGOS DESTACADOS */}
            <div className="flex items-center bg-white/80 backdrop-blur-lg p-2 rounded-[1.25rem] shadow-sm border border-white/90 transition-all hover:shadow-md">
              <img 
                src="https://images.weserv.nl/?url=drive.google.com/uc?id=1pi35dS2vmAVTiLJi29uP3oNms-obTobC" 
                crossOrigin="anonymous" 
                alt="Databoff Logo" 
                className="h-12 sm:h-16 object-contain rounded-xl px-2 sm:px-3 transition-transform hover:scale-105" 
                onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/140x50/ffffff/0A2A4A?text=Databoff&font=montserrat'; }} 
              />
              <div className="w-px h-10 sm:h-12 bg-slate-200/80 mx-1.5 sm:mx-2"></div>
              <img 
                src="https://images.weserv.nl/?url=drive.google.com/uc?id=1hVGqRxvdru5D_SKyScptDUu3GBvzD979" 
                crossOrigin="anonymous" 
                alt="webPosto Logo" 
                className="h-12 sm:h-16 object-contain rounded-xl px-2 sm:px-3 transition-transform hover:scale-105" 
                onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/140x50/ffffff/D31224?text=webPosto&font=montserrat'; }} 
              />
            </div>

            <div className="hidden md:block pl-2">
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[#0A2A4A] to-[#00A8B5]">
                Controle de Frota Databoff
              </h1>
              {/* Oculta status de sincronização ao imprimir */}
              {!isExporting && lastSync && (
                <div className="text-[11px] lg:text-xs uppercase tracking-wider text-slate-400 font-semibold mt-2 flex items-center">
                  <div className={`w-1.5 h-1.5 rounded-full mr-2 ${isRefreshing ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}`}></div>
                  Atualizado • {lastSync.toLocaleTimeString('pt-BR')}
                  {isRefreshing && <span className="ml-2 text-cyan-500">Sincronizando...</span>}
                </div>
              )}
            </div>
          </div>

          {/* LADO DIREITO DO HEADER: Botões (Tela) OU Info de Exportação (Impressão) */}
          {!isExporting ? (
            <div className="flex items-center space-x-3 no-export">
              <div className="hidden md:flex bg-white/60 border border-slate-200/60 p-1 rounded-full shadow-sm backdrop-blur-sm">
                <button onClick={handleExportImage} disabled={isExporting} className="p-2 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded-full transition-all duration-300" title="Exportar Imagem">
                  <ImageIcon className="w-[18px] h-[18px]" />
                </button>
                <button onClick={handleExportPDF} disabled={isExporting} className="p-2 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded-full transition-all duration-300" title="Exportar PDF">
                  <FileText className="w-[18px] h-[18px]" />
                </button>
              </div>

              <button onClick={() => setRefreshTrigger(prev => prev + 1)} disabled={isRefreshing} className="inline-flex items-center px-4 py-2.5 bg-white border border-slate-200/60 shadow-sm text-sm font-semibold rounded-full text-slate-600 hover:bg-slate-50 hover:text-cyan-600 hover:border-cyan-200 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:hover:translate-y-0">
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin text-cyan-500' : ''}`} /> Sincronizar
              </button>
              
              <label className="cursor-pointer inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-semibold rounded-full shadow-md text-white bg-gradient-to-r from-[#0A2A4A] to-[#00A8B5] hover:shadow-lg hover:from-[#0d365e] hover:to-[#00bac9] hover:-translate-y-0.5 transition-all duration-300 hidden sm:inline-flex">
                <Upload className="h-4 w-4 mr-2 opacity-90" /> Planilha Manual
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          ) : (
            <div className="text-right">
              <p className="text-sm font-bold text-[#0A2A4A] uppercase tracking-wider">Relatório Oficial</p>
              <p className="text-xs text-slate-500 font-medium mt-1">Gerado em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
            </div>
          )}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 relative z-10">

        {currentView === 'history' && historyVehicle ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center">
                <div className="p-2.5 bg-cyan-100/50 text-cyan-600 rounded-xl mr-3 border border-cyan-200/30">
                  <Activity className="w-6 h-6" />
                </div>
                Histórico Diário: <span className="ml-3 font-extrabold text-[#0A2A4A] tracking-wider">{historyVehicle}</span>
              </h2>
            </div>

            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Motorista</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Destino</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">KM Inicial</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">KM Final</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">KM Rodado</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Combustível</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Média (KM/L)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-50">
                    {(fleetData[historyVehicle] || []).map((row, idx) => {
                      let dataRaw = extractValue(row, ['DATA', 'DIA']);
                      let dataStr = '-';
                      if (typeof dataRaw === 'number') {
                        const date = new Date(Math.round((dataRaw - 25569) * 86400 * 1000));
                        dataStr = date.toLocaleDateString('pt-BR', {timeZone: 'UTC'});
                      } else if (dataRaw) dataStr = String(dataRaw);

                      const motoristaRaw = extractValue(row, ['MOTORISTA', 'CONDUTOR']);
                      const motorista = motoristaRaw ? String(motoristaRaw) : '-';
                      const destinoRaw = extractValue(row, ['DESTINO', 'ROTA', 'LOCAL']);
                      const destino = destinoRaw ? String(destinoRaw) : '-';
                      const kmInicial = parseNumber(extractValue(row, ['KMINICIAL', 'INICIAL']));
                      const kmFinal = parseNumber(extractValue(row, ['KMFINAL', 'FINAL']));
                      const litros = parseNumber(extractValue(row, ['LITRO', 'COMBUSTIVEL', 'ABASTECIMENTO', 'QTD']));
                      const kmRodado = kmFinal >= kmInicial && kmFinal > 0 ? (kmFinal - kmInicial) : 0;
                      const media = kmRodado > 0 && litros > 0 ? (kmRodado / litros).toFixed(2) : '-';

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-700">{dataStr}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-medium">{motorista}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 truncate max-w-[200px]" title={destino}>{destino}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">{kmInicial || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">{kmFinal || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-[#00A8B5] bg-cyan-50/30">{kmRodado > 0 ? kmRodado : '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {litros > 0 ? <span className="flex items-center font-medium"><Droplet className="w-4 h-4 mr-1.5 text-red-400"/>{litros}L</span> : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-emerald-600 bg-emerald-50/30">
                            {media !== '-' ? <span className="flex items-center"><Gauge className="w-4 h-4 mr-1.5"/>{media}</span> : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-64">
             <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500 mb-5"></div>
             <p className="text-slate-500 font-medium tracking-wide">Sincronizando ambiente na nuvem...</p>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-12 text-center max-w-2xl mx-auto mt-10">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100">
              <FileSpreadsheet className="h-10 w-10 text-slate-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight mb-3">Sem dados automáticos</h2>
            {error && <p className="text-red-600 bg-red-50 p-4 rounded-2xl mb-6 text-sm text-left border border-red-100 font-medium">{error}</p>}
            <p className="text-slate-500 mb-8 leading-relaxed">Faça o upload da sua planilha manualmente usando o botão <span className="font-semibold text-slate-700">Planilha Manual</span> no topo direito para iniciar.</p>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* CARDS SEMÂNTICOS SAAS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
              {/* Card Veículos (Azul) */}
              <div 
                onClick={() => setStatusFilter('ALL')} 
                className={`group bg-gradient-to-br from-white to-blue-50/30 rounded-3xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 cursor-pointer transition-all duration-300 border ${statusFilter === 'ALL' ? 'border-blue-400 ring-4 ring-blue-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-blue-200 hover:shadow-md hover:-translate-y-1'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600 shadow-inner">
                    <Truck className="h-6 w-6" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">Total de Veículos</p>
                  <p className="text-4xl font-extrabold text-slate-800 tracking-tight">{dashboardStats.total}</p>
                </div>
              </div>

              {/* Card Atrasados (Vermelho) */}
              <div 
                onClick={() => setStatusFilter('OVERDUE')} 
                className={`group bg-gradient-to-br from-white to-red-50/30 rounded-3xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 cursor-pointer transition-all duration-300 border ${statusFilter === 'OVERDUE' ? 'border-red-400 ring-4 ring-red-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-red-200 hover:shadow-md hover:-translate-y-1'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-red-100 to-red-50 text-red-600 shadow-inner">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">Atrasados</p>
                  <p className="text-4xl font-extrabold text-slate-800 tracking-tight">{dashboardStats.overdue}</p>
                </div>
              </div>

              {/* Card Próximos (Laranja) */}
              <div 
                onClick={() => setStatusFilter('WARNING')} 
                className={`group bg-gradient-to-br from-white to-orange-50/30 rounded-3xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 cursor-pointer transition-all duration-300 border ${statusFilter === 'WARNING' ? 'border-orange-400 ring-4 ring-orange-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-orange-200 hover:shadow-md hover:-translate-y-1'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-orange-100 to-orange-50 text-orange-600 shadow-inner">
                    <Calendar className="h-6 w-6" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">Próximos (500km)</p>
                  <p className="text-4xl font-extrabold text-slate-800 tracking-tight">{dashboardStats.warning}</p>
                </div>
              </div>

              {/* Card Em Dia (Verde) */}
              <div 
                onClick={() => setStatusFilter('OK')} 
                className={`group bg-gradient-to-br from-white to-emerald-50/30 rounded-3xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 cursor-pointer transition-all duration-300 border ${statusFilter === 'OK' ? 'border-emerald-400 ring-4 ring-emerald-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-emerald-200 hover:shadow-md hover:-translate-y-1'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 text-emerald-600 shadow-inner">
                    <CheckCircle className="h-6 w-6" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">Em Dia</p>
                  <p className="text-4xl font-extrabold text-slate-800 tracking-tight">{dashboardStats.ok}</p>
                </div>
              </div>
            </div>

            {/* CONTROLES DA LISTA */}
            <div className="flex flex-col sm:flex-row justify-between items-end mb-6 gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-800 flex items-center">
                  Listagem de Frota
                  {statusFilter !== 'ALL' && (
                    <button onClick={() => setStatusFilter('ALL')} className="no-export ml-4 inline-flex items-center px-3 py-1 bg-slate-100 text-slate-500 hover:text-slate-700 text-xs font-bold rounded-full hover:bg-slate-200 transition-colors">
                      Limpar Filtro <X className="w-3.5 h-3.5 ml-1" />
                    </button>
                  )}
                </h2>
                <p className="text-sm text-slate-500 mt-1">Gerencie e monitore o status de revisão de cada veículo.</p>
              </div>
              
              <div className="relative w-full sm:w-80 no-export">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Search className="h-4 w-4 text-slate-400" /></div>
                <input
                  type="text"
                  placeholder="Buscar matrícula..."
                  className="block w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-full focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-medium transition-shadow shadow-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* TABELA MODERNA */}
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Matrícula</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Última Revisão</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Próxima (KM)</th>
                      <th className="px-6 py-5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider no-export">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-50">
                    {filteredVehicles.map((placa) => {
                      const revInfo = revisions[placa] || {};
                      const currentKm = currentKms[placa] || 0;
                      const status = getStatusInfo(currentKm, revInfo.nextRevisionKm);

                      return (
                        <tr key={placa} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-6 py-5 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-12 w-12 bg-slate-100 rounded-2xl flex items-center justify-center font-bold text-slate-600 border border-slate-200/50 shadow-sm">
                                {placa.substring(0, 3)}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">{placa}</div>
                                <div className="text-xs font-medium text-slate-400 mt-1">KM Atual: {currentKm > 0 ? <span className="text-slate-600">{currentKm}</span> : '--'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap">
                            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold ${status.bg} ${status.color}`}>
                              {status.icon}{status.text}
                            </span>
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm font-semibold text-slate-500">
                            {revInfo.lastRevision ? new Date(revInfo.lastRevision).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-'}
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm font-extrabold text-slate-800">
                            {revInfo.nextRevisionKm ? `${revInfo.nextRevisionKm} km` : '-'}
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap text-sm no-export">
                            <div className="flex space-x-3">
                              <button onClick={() => openHistory(placa)} className="text-slate-600 hover:text-cyan-700 bg-white border border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 px-4 py-2 rounded-full font-semibold transition-all duration-300 flex items-center shadow-sm hover:shadow hover:-translate-y-0.5">
                                <Activity className="w-4 h-4 mr-1.5" /> Histórico
                              </button>
                              <button onClick={() => openModal(placa)} className="text-slate-600 hover:text-[#0A2A4A] bg-white border border-slate-200 hover:border-[#0A2A4A]/30 hover:bg-blue-50 px-4 py-2 rounded-full font-semibold transition-all duration-300 flex items-center shadow-sm hover:shadow hover:-translate-y-0.5">
                                <Settings className="w-4 h-4 mr-1.5" /> Atualizar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL CONFIG (SaaS Style) */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 overflow-y-auto no-export" style={{ fontFamily: "'Inter', sans-serif" }}>
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={() => setSelectedVehicle(null)}></div>

            <div className="inline-block align-bottom bg-white rounded-[2rem] text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full border border-slate-100 animate-in zoom-in-95 duration-200">
              <div className="bg-white px-8 pt-8 pb-6">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center">
                      Atualizar Revisão
                    </h3>
                    <p className="text-slate-500 text-sm mt-1.5 font-medium flex items-center">
                      Veículo <span className="ml-2 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md font-bold text-slate-700 uppercase">{selectedVehicle}</span>
                    </p>
                  </div>
                  <button onClick={() => setSelectedVehicle(null)} className="text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 p-2.5 rounded-full transition-colors">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Data da Última Revisão</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-cyan-500/20 focus:border-cyan-500 sm:text-sm font-semibold text-slate-700 transition-all outline-none"
                      value={editLastRev}
                      onChange={(e) => setEditLastRev(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">KM da Próxima Revisão</label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="Ex: 160000"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-12 py-3 focus:ring-4 focus:ring-cyan-500/20 focus:border-cyan-500 sm:text-sm font-semibold text-slate-700 transition-all outline-none"
                        value={editNextRevKm}
                        onChange={(e) => setEditNextRevKm(e.target.value)}
                      />
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 font-bold text-sm">KM</span>
                      </div>
                    </div>
                    <p className="mt-2.5 text-xs font-medium text-slate-400">O sistema alertará automaticamente com base no KM atual.</p>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50/50 px-8 py-5 border-t border-slate-100 flex flex-col sm:flex-row-reverse gap-3">
                <button onClick={saveRevision} className="w-full sm:w-auto inline-flex justify-center items-center rounded-full px-8 py-3 bg-gradient-to-r from-[#0A2A4A] to-[#00A8B5] text-sm font-bold text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all outline-none">
                  Guardar Dados
                </button>
                <button onClick={() => setSelectedVehicle(null)} className="w-full sm:w-auto inline-flex justify-center items-center rounded-full border border-slate-200 px-8 py-3 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all outline-none">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}