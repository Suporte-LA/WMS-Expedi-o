import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
};

export function BarcodeScannerModal({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);

  function signalDetected() {
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = new AudioContextConstructor();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gain.gain.setValueAtTime(0.12, audioContext.currentTime);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.08);
      navigator.vibrate?.(120);
    } catch {
      // Ignore audio feedback errors on restricted browsers.
    }
  }

  useEffect(() => {
    if (!open) return;
    if (!videoRef.current) return;

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.ITF,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const codeReader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 45, delayBetweenScanSuccess: 300 });
    let controls: IScannerControls | null = null;
    let permissionStream: MediaStream | null = null;
    let active = true;
    let detectorFrame = 0;

    function finishDetection(rawValue: string) {
      if (!active) return;
      const value = rawValue.trim();
      if (!value) return;
      active = false;
      signalDetected();
      onDetected(value);
      controls?.stop();
      onClose();
    }

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
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        permissionStream.getTracks().forEach((t) => t.stop());
        permissionStream = null;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === "videoinput");
        const rearCamera =
          cameras.find((d) => /back|rear|environment|traseira/i.test(d.label)) || cameras[0];

        controls = await codeReader.decodeFromConstraints(
          {
            audio: false,
            video: rearCamera?.deviceId
              ? {
                  deviceId: { exact: rearCamera.deviceId },
                  width: { ideal: 2560 },
                  height: { ideal: 1440 }
                }
              : { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } }
          },
          videoRef.current!,
          (result, err) => {
          if (result && active) {
            finishDetection(result.getText());
          }
          if (err && !(err instanceof NotFoundException)) {
            setError("Falha ao ler codigo. Tente aproximar melhor a camera.");
          }
        });

        const videoTrack = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0] || null;
        cameraTrackRef.current = videoTrack;
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
            zoom?: { min: number; max: number; step?: number };
            focusMode?: string[];
          };
          setTorchAvailable(Boolean(capabilities.torch));
          if (capabilities.zoom) {
            setZoom(capabilities.zoom.min);
            setZoomMax(capabilities.zoom.max);
          }
          const advanced: MediaTrackConstraintSet[] = [];
          if (capabilities.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
          if (advanced.length) await videoTrack.applyConstraints({ advanced });
        }

        type NativeBarcode = { rawValue: string };
        type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<NativeBarcode[]> };
        type NativeDetectorConstructor = new (options: { formats: string[] }) => NativeDetector;
        const NativeBarcodeDetector = (window as Window & { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
        if (NativeBarcodeDetector && videoRef.current) {
          const detector = new NativeBarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "itf", "upc_a", "upc_e"] });
          const detectNative = async () => {
            if (!active || !videoRef.current) return;
            try {
              const found = await detector.detect(videoRef.current);
              if (found[0]?.rawValue) finishDetection(found[0].rawValue);
            } catch {
              // ZXing continua como fallback quando o detector nativo falha.
            }
            if (active) detectorFrame = requestAnimationFrame(detectNative);
          };
          detectorFrame = requestAnimationFrame(detectNative);
        }
      } catch (err: unknown) {
        const errorName = err instanceof DOMException ? err.name : "";
        if (errorName === "NotAllowedError" || errorName === "SecurityError") {
          setError("Permissao da camera negada. Libere a camera no navegador e tente novamente.");
          return;
        }
        if (errorName === "NotFoundError" || errorName === "OverconstrainedError") {
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
      cancelAnimationFrame(detectorFrame);
      permissionStream?.getTracks().forEach((t) => t.stop());
      cameraTrackRef.current = null;
      controls?.stop();
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  async function toggleTorch() {
    const track = cameraTrackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setError("A lanterna nao pode ser ativada neste aparelho.");
    }
  }

  async function changeZoom(value: number) {
    setZoom(value);
    try {
      await cameraTrackRef.current?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
    } catch {
      // Alguns navegadores exibem zoom nas capacidades, mas recusam o ajuste manual.
    }
  }

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
        <div className="flex flex-wrap items-center gap-3">
          {torchAvailable && <button type="button" onClick={toggleTorch} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${torchOn ? "bg-amber-400 text-slate-900" : "bg-white"}`}>{torchOn ? "Desligar lanterna" : "Ligar lanterna"}</button>}
          {zoomMax > 1 && <label className="flex flex-1 items-center gap-2 text-sm"><span>Zoom</span><input className="w-full" type="range" min="1" max={zoomMax} step="0.1" value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} /></label>}
        </div>
        {loading && <p className="text-sm text-slate-500">Iniciando camera...</p>}
        {!loading && !error && <p className="text-sm text-slate-500">Centralize o codigo, mantenha o celular firme e ajuste o zoom se a impressao estiver fraca.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
