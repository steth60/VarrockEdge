import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useTweaks } from './hooks/useTweaks';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TweaksPanel } from './components/TweaksPanel';
import { CommandPalette } from './components/CommandPalette';
import { Login } from './views/Login';
import { Overview } from './views/Overview';
import { Dhcp } from './views/Dhcp';
import { Dns } from './views/Dns';
import { Topology } from './views/Topology';
import { Logs } from './views/Logs';
import { Wireguard } from './views/Wireguard';
import { Firewall } from './views/Firewall';
import { Users } from './views/Users';
import { Services } from './views/Services';
import { Settings } from './views/Settings';
import { SystemData } from './views/SystemData';

export default function App() {
  const auth = useAuth();
  const { tweaks, setTweak } = useTweaks();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (auth.loading) {
    return (
      <div className="app-bg min-h-screen flex items-center justify-center">
        <div className="text-[12px] font-mono text-zinc-500">loading…</div>
      </div>
    );
  }

  if (!auth.user) return <Login onLogin={auth.login} />;

  return (
    <div className="app-bg min-h-screen flex flex-col">
      <div className="flex flex-1 min-h-0">
        <Sidebar tweaks={tweaks} user={auth.user} onLogout={auth.logout} />
        <main className="flex-1 min-w-0 flex flex-col">
          <Header onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex-1 overflow-auto">
            <div className="px-6 py-5">
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<Overview />} />
                <Route path="/topology" element={<Topology />} />
                <Route path="/sysdata"  element={<SystemData />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/dhcp" element={<Dhcp />} />
                <Route path="/dns" element={<Dns />} />
                <Route path="/vpn" element={<Wireguard />} />
                <Route path="/firewall" element={<Firewall />} />
                <Route path="/users" element={<Users />} />
                <Route path="/services" element={<Services />} />
                <Route path="/settings/*" element={<Settings />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </div>
          </div>
        </main>
      </div>
      <TweaksPanel tweaks={tweaks} setTweak={setTweak} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
