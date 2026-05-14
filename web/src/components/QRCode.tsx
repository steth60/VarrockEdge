import { useEffect, useState } from 'react';
import { Icon } from './primitives';

export function QRCode({ peerId, size = 280 }: { peerId: number | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (peerId == null) { setSrc(null); return; }
    let revoked: string | null = null;
    fetch(`/api/wireguard/peers/${peerId}/qr`, { credentials: 'include' })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (!blob) return;
        revoked = URL.createObjectURL(blob);
        setSrc(revoked);
      })
      .catch(() => {});
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [peerId]);
  if (peerId == null) {
    return (
      <div className="aspect-square bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-4 flex items-center justify-center" style={{ width: size, height: size }}>
        <div className="text-center text-zinc-600 text-[11.5px] leading-relaxed">
          <Icon name="QrCode" size={32} className="mx-auto mb-2 text-zinc-700" />
          Generate keys to create<br />a config + QR code.
        </div>
      </div>
    );
  }
  return (
    <div className="aspect-square bg-white border border-zinc-800/60 rounded-lg p-3 flex items-center justify-center" style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="WireGuard config QR" className="w-full h-full" />
        : <div className="text-zinc-500 text-[11px]">rendering…</div>}
    </div>
  );
}
