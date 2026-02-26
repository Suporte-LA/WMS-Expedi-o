import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
};

export function BarcodeScannerModal({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!videoRef.current) return;

    const codeReader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null;
    let permissionStream: MediaStream | null = null;
    let active = true;

    async function start() {
      setLoading(true);
      setError("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Seu navegador nao suporta acesso a camera.");
          return;
        }

        const isLocalhost =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1" ||
          window.location.hostname === "::1";

        if (!window.isSecureContext && !isLocalhost) {
          setError("Camera bloqueada: abra o sistema por HTTPS no celular (HTTP por IP nao libera camera).");
          return;
        }

        // Garante prompt de permissao antes de iniciar leitura de codigo.
        permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } }
        });
        const track = permissionStream.getVideoTracks()[0];
        const deviceId = track?.getSettings().deviceId;
        permissionStream.getTracks().forEach((t) => t.stop());
        permissionStream = null;

        controls = await codeReader.decodeFromVideoDevice(deviceId, videoRef.current!, (result, err) => {
          if (result && active) {
            active = false;
            const value = result.getText().trim();
            if (value) onDetected(value);
            controls?.stop();
            onClose();
          }
          if (err && !(err instanceof NotFoundException)) {
            setError("Falha ao ler codigo. Tente aproximar melhor a camera.");
          }
        });
      } catch (err: any) {
        if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
          setError("Permissao da camera negada. Libere a camera no navegador e tente novamente.");
          return;
        }
        if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
          setError("Nenhuma camera compativel encontrada no dispositivo.");
          return;
        }
        setError("Nao foi possivel acessar a camera.");
      } finally {
        setLoading(false);
      }
    }

    start();

    return () => {
      active = false;
      permissionStream?.getTracks().forEach((t) => t.stop());
      controls?.stop();
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg bg-white rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Scanner de Pedido</h3>
          <button className="underline text-sm" onClick={onClose}>
            Fechar
          </button>
        </div>
        <video ref={videoRef} className="w-full rounded-xl bg-black" autoPlay muted playsInline />
        {loading && <p className="text-sm text-slate-500">Iniciando camera...</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
