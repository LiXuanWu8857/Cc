"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Zero-dependency barcode scanner using the browser-native BarcodeDetector API
 * (Chromium). Runs entirely on-device — no image ever leaves the phone. Where
 * the API is unavailable it reports back so the caller can fall back to manual
 * entry.
 */

// Minimal typings for the experimental BarcodeDetector API.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function isBarcodeScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function BarcodeScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setErr("此裝置不支援相機掃描，請手動輸入條碼。");
      return;
    }
    const detector = new Ctor({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => /^[0-9]{8,14}$/.test(c.rawValue));
            if (hit) {
              onDetect(hit.rawValue);
              return; // stop on first valid hit
            }
          } catch {
            /* transient detect errors are ignored; keep scanning */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setErr("無法開啟相機。請確認已授權相機權限，或改用手動輸入。");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      {err ? (
        <div className="err">{err}</div>
      ) : (
        <div className="scanbox">
          <video ref={videoRef} muted playsInline />
        </div>
      )}
      <button className="btn btn-sm" type="button" onClick={onClose} style={{ width: "auto", alignSelf: "flex-end" }}>
        關閉相機
      </button>
    </div>
  );
}
