'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR code with the full quiet zone wallets need (4 modules) and large modules (level L). */
export function Qr({ value, className = '' }: { value: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toString(value, { type: 'svg', margin: 4, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' } }).then(setSvg);
  }, [value]);
  return <div className={`mx-auto aspect-square w-full max-w-[17rem] overflow-hidden rounded-2xl bg-white ${className}`} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}
