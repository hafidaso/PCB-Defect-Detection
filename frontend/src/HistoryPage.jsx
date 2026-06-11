import React, { useState } from 'react';

const HistoryPage = ({ onBack }) => {
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all'); // all | healthy | defective
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);

  // Load history from localStorage
  const rawHistory = JSON.parse(localStorage.getItem('pcbScanHistory') || '[]');

  // Filter
  const filtered = rawHistory
    .filter(item => {
      if (filter === 'healthy') return item.isHealthy;
      if (filter === 'defective') return !item.isHealthy;
      return true;
    })
    .filter(item => {
      if (!search) return true;
      return (
        item.filename?.toLowerCase().includes(search.toLowerCase()) ||
        item.component?.toLowerCase().includes(search.toLowerCase()) ||
        item.status?.toLowerCase().includes(search.toLowerCase())
      );
    })
    .sort((a, b) => {
      let va = a[sortField], vb = b[sortField];
      if (sortField === 'date') { va = new Date(va); vb = new Date(vb); }
      if (sortField === 'defects') { va = Number(va); vb = Number(vb); }
      if (sortField === 'processTime') { va = Number(va); vb = Number(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const healthy = rawHistory.filter(i => i.isHealthy).length;
  const defective = rawHistory.filter(i => !i.isHealthy).length;
  const avgTime = rawHistory.length
    ? (rawHistory.reduce((s, i) => s + Number(i.processTime || 0), 0) / rawHistory.length).toFixed(2)
    : '—';

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-emerald-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const clearHistory = () => {
    if (window.confirm('Effacer tout l\'historique ?')) {
      localStorage.removeItem('pcbScanHistory');
      localStorage.removeItem('pcbScanStats');
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-dot-matrix bg-gradient-to-br from-slate-50 via-teal-50/30 to-emerald-50/50 p-8 font-sans flex text-slate-800">

      {/* Sidebar */}
      <div className="w-72 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 text-white p-7 rounded-3xl mr-8 shadow-2xl shadow-emerald-900/20 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl" />
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center mb-10">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 mr-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-200 tracking-tight">PCBScan</h2>
          </div>

          <ul className="space-y-4 text-sm text-slate-300 flex-1 font-medium">
            <li
              onClick={onBack}
              className="hover:text-white hover:translate-x-2 transform cursor-pointer transition-all duration-300 flex items-center"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3" /> ← Retour au Dashboard
            </li>
            <div className="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent my-6" />
            <li className="text-emerald-300 font-bold flex items-center bg-white/5 p-3 rounded-xl border border-white/10 shadow-inner">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-3 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              Historique des Sessions
            </li>
          </ul>

          <div className="mt-auto border-t border-slate-700/50 pt-5">
            <div className="text-xs text-slate-400 flex items-center justify-center mb-1">Créé par</div>
            <div className="text-center font-bold text-sm text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
              Hafida Belayd
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Historique des Inspections</h1>
            <p className="text-slate-500 text-sm mt-1">Toutes les analyses PCB de cette session</p>
          </div>
          {rawHistory.length > 0 && (
            <button
              onClick={clearHistory}
              className="flex items-center px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-600 font-bold text-sm rounded-xl border border-amber-200 transition-all"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Effacer l'historique
            </button>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Scans', value: rawHistory.length, color: 'from-blue-500 to-indigo-600', icon: '📊' },
            { label: 'PCB Sains', value: healthy, color: 'from-emerald-400 to-teal-500', icon: '✅' },
            { label: 'PCB Défectueux', value: defective, color: 'from-amber-500 to-orange-500', icon: '⚠️' },
          ].map((kpi, i) => (
            <div key={i} className="bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center space-x-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${kpi.color} flex items-center justify-center text-2xl shadow-lg shadow-slate-200/50`}>
                {kpi.icon}
              </div>
              <div>
                <div className="text-3xl font-black font-['JetBrains_Mono'] text-slate-800">{kpi.value}</div>
                <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters & Search */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl border border-white/60 shadow-sm p-4 flex items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Rechercher par fichier, composant..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 text-slate-700"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'healthy', 'defective'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  filter === f
                    ? (f === 'all' ? 'bg-slate-800 text-white shadow-md' :
                       f === 'healthy' ? 'bg-emerald-500 text-white shadow-md' :
                       'bg-amber-500 text-white shadow-md')
                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                {f === 'all' ? 'Tous' : f === 'healthy' ? '✅ Sains' : '⚠️ Défectueux'}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-500 font-medium whitespace-nowrap">{filtered.length} résultat(s)</span>
        </div>

        {/* Table */}
        <div className="bg-white/70 backdrop-blur-xl rounded-3xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex-1">
          {rawHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="text-6xl mb-4">📂</div>
              <p className="font-bold text-lg">Aucun historique disponible</p>
              <p className="text-sm mt-1">Lancez une analyse depuis le Dashboard pour commencer.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="text-6xl mb-4">🔍</div>
              <p className="font-bold text-lg">Aucun résultat trouvé</p>
              <p className="text-sm mt-1">Essayez de modifier vos filtres de recherche.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/60">
                    {['Date', 'Statut', 'Fichier', 'Composant', 'Montage', 'Défauts', 'OCR', 'ID'].map((label, i) => (
                      <th key={i} className="px-4 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item, idx) => (
                    <tr
                      key={item.id || idx}
                      onClick={() => setSelectedItem(item)}
                      className={`transition-colors group cursor-pointer border-l-2 ${
                        item.anomalies && item.anomalies.trim() !== ''
                          ? 'border-red-500/50 bg-red-500/5 hover:bg-red-500/10'
                          : 'border-transparent hover:bg-emerald-50/40'
                      }`}
                    >
                      <td className="px-4 py-3.5 text-slate-500 font-['JetBrains_Mono'] font-bold text-xs">
                        {new Date(item.date).toLocaleString('fr-FR', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                          item.isHealthy
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${item.isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                          {item.isHealthy ? 'Sain' : 'Défaut'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 max-w-[160px]">
                        <div className="truncate font-medium text-slate-700">{item.filename || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5 max-w-[180px]">
                        <div className="truncate font-semibold text-blue-600">{item.component || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <div className="truncate text-slate-600">{item.status || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black font-['JetBrains_Mono'] ${
                          item.defects === 0
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}>
                          {item.defects ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-['JetBrains_Mono'] text-slate-600 font-semibold">
                        {item.ocrCount || 0}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 text-xs font-['JetBrains_Mono']">
                        {item.id?.substring(0, 8) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Details Popup Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <div
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-5 flex items-center justify-between border-b ${selectedItem.isHealthy ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${selectedItem.isHealthy ? 'bg-emerald-200 text-emerald-700' : 'bg-amber-200 text-amber-700'}`}>
                  {selectedItem.isHealthy ? '✅' : '⚠️'}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-800">Détails de l'Inspection</h3>
                  <p className="text-sm font-['JetBrains_Mono'] text-slate-500">{selectedItem.filename}</p>
                </div>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-2 rounded-full hover:bg-slate-200/50 text-slate-500 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5 bg-slate-50/50 flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Date & Heure</p>
                  <p className="text-sm font-['JetBrains_Mono'] font-semibold text-slate-700">
                    {new Date(selectedItem.date).toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Défauts YOLO</p>
                  <p className={`text-sm font-bold font-['JetBrains_Mono'] ${selectedItem.defects > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                    {selectedItem.defects} détecté(s)
                  </p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Composant & Fonction</p>
                <p className="text-sm text-slate-700 font-medium leading-relaxed font-['JetBrains_Mono']">
                  <span className="text-blue-600 font-bold">{selectedItem.component}</span>
                  {selectedItem.functionDetails ? ` - ${selectedItem.functionDetails}` : ''}
                </p>
              </div>

              <div className={`p-4 rounded-2xl border shadow-sm ${selectedItem.isHealthy ? 'bg-emerald-50/50 border-emerald-100' : 'bg-amber-50/50 border-amber-100'}`}>
                <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${selectedItem.isHealthy ? 'text-emerald-600' : 'text-amber-600'}`}>Statut de Montage</p>
                <p className="text-sm text-slate-700 leading-relaxed font-medium font-['JetBrains_Mono']">{selectedItem.status || 'Aucune information.'}</p>
              </div>

              {(selectedItem.defectsList || selectedItem.anomalies) && (
                <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 shadow-sm">
                  {selectedItem.defectsList && (
                    <div className="mb-4">
                      <p className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-1">⚠️ Défauts fréquents</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap font-['JetBrains_Mono']">{selectedItem.defectsList.replace(/^[-* ]+/gm, '• ')}</p>
                    </div>
                  )}
                  {selectedItem.anomalies && (
                    <div className="pt-3 border-t border-amber-200/50">
                      <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">🚫 Anomalies</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap font-['JetBrains_Mono']">{selectedItem.anomalies.replace(/^[-* ]+/gm, '• ')}</p>
                    </div>
                  )}
                </div>
              )}

              {selectedItem.recommendations && (
                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 shadow-sm">
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">💡 Recommandation</p>
                  <p className="text-sm text-slate-700 leading-relaxed font-medium font-['JetBrains_Mono']">{selectedItem.recommendations}</p>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t bg-white flex justify-end">
              <button 
                onClick={() => setSelectedItem(null)}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-slate-200"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
