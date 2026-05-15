import { Card, Icon } from '../../components/primitives';

export function WifiSection() {
  return (
    <Card title="WiFi" subtitle="Wireless networks">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-zinc-900/60 border border-zinc-800/70 flex items-center justify-center mb-4">
          <Icon name="WifiOff" size={20} className="text-zinc-500" />
        </div>
        <div className="text-[13px] font-medium text-zinc-300">No access points managed</div>
        <p className="text-[11.5px] text-zinc-500 mt-1.5 max-w-md leading-relaxed">
          VarrokEdge is a wired network controller — it does not run a wireless radio.
          SSIDs are configured on your access points directly. Wired clients land on a
          VLAN network defined under <span className="text-zinc-300">Networks</span>.
        </p>
      </div>
    </Card>
  );
}
