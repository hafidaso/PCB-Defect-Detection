import { useState } from 'react';
import PCBScanDashboard from './PCBScanDashboard';
import HistoryPage from './HistoryPage';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  return (
    <>
      {currentPage === 'dashboard' && <PCBScanDashboard onNavigate={setCurrentPage} />}
      {currentPage === 'history' && <HistoryPage onBack={() => setCurrentPage('dashboard')} />}
    </>
  )
}

export default App;
