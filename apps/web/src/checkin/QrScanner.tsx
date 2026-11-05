import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icons.js';

const SCAN_EVERY_MS = 150;
const MAX_SIDE = 640;

/** La linterna aún no está en los tipos del navegador: no todos los teléfonos la ofrecen. */
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') {
    return 'Permite el uso de la cámara en este navegador para escanear.';
  }
  if (name === 'NotFoundError') {
    return 'No se encontró una cámara en este dispositivo.';
  }
  if (!window.isSecureContext) {
    return 'La cámara solo funciona con una conexión segura (HTTPS).';
  }
  return 'No se pudo abrir la cámara.';
}

export function QrScanner({
  paused,
  onCode,
}: {
  paused: boolean;
  onCode: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState('');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  }, [paused, onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      const video = videoRef.current;
      if (
        pausedRef.current ||
        !video ||
        !context ||
        video.readyState < video.HAVE_ENOUGH_DATA
      ) {
        return;
      }
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(video.videoWidth, video.videoHeight),
      );
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code?.data) {
        onCodeRef.current(code.data);
      }
    };

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          await video.play();
        }
        timer = setInterval(scan, SCAN_EVERY_MS);
        // Algunos Android solo la reportan cuando el video ya está corriendo.
        const track = media.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const capabilities = track?.getCapabilities?.() as
          | TorchCapabilities
          | undefined;
        setHasTorch(capabilities?.torch === true);
      } catch (cause) {
        setError(cameraError(cause));
      }
    })();

    return () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
      // Detener la cámara también apaga la linterna.
      stream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
    };
  }, []);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await trackRef.current?.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setHasTorch(false);
      setTorchOn(false);
    }
  };

  return (
    <div className="scanner">
      {error ? (
        <p className="scanner-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Vista de la cámara"
          />
          <div className="scanner-frame" aria-hidden="true" />
          {hasTorch && (
            <button
              type="button"
              className={torchOn ? 'scanner-torch on' : 'scanner-torch'}
              aria-pressed={torchOn}
              onClick={() => void toggleTorch()}
            >
              <Icon name="flash" />
              {torchOn ? 'Apagar linterna' : 'Linterna'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
