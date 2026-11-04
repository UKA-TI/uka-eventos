import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

const SCAN_EVERY_MS = 150;
const MAX_SIDE = 640;

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
  const [error, setError] = useState('');

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
      } catch (cause) {
        setError(cameraError(cause));
      }
    })();

    return () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
        </>
      )}
    </div>
  );
}
