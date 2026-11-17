import QRCode from "qrcode";

/** Server-rendered QR code as crisp SVG rects (no canvas, no client JS). */
export function QrSvg({ data, size }: { data: string; size: number }) {
  const qr = QRCode.create(data, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Payment QR code">
      <path d={d} fill="#16140f" />
    </svg>
  );
}
