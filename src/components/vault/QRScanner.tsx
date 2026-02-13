// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview QR Code Scanner Component
 *
 * Uses the device camera to scan QR codes for TOTP setup.
 * Powered by jsQR for decoding video frames.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import { Loader2, Camera, CameraOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QRScannerProps {
    onScan: (data: string) => void;
    onClose: () => void;
    className?: string;
}

export function QRScanner({ onScan, onClose, className }: QRScannerProps) {
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [scanning, setScanning] = useState(true);
    const requestRef = useRef<number>();

    const stopStream = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
        if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
        }
    }, [stream]);

    useEffect(() => {
        return () => stopStream();
    }, [stopStream]);

    const startCamera = async () => {
        try {
            setError(null);
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                // Required for iOS
                videoRef.current.setAttribute('playsinline', 'true');
                videoRef.current.play();
                requestRef.current = requestAnimationFrame(tick);
            }
        } catch (err) {
            console.error('Camera error:', err);
            setError(t('authenticator.cameraError'));
        }
    };

    const tick = () => {
        if (!videoRef.current || !canvasRef.current || !scanning) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (video.readyState === video.HAVE_ENOUGH_DATA && context) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
            });

            if (code && code.data) {
                // Found a QR code
                onScan(code.data);
                // Stop scanning briefly to avoid duplicate reads
                setScanning(false);
            }
        }

        if (scanning) {
            requestRef.current = requestAnimationFrame(tick);
        }
    };

    useEffect(() => {
        startCamera();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Restart scanning if prop changes (not ideal, but keeps it simple)
    useEffect(() => {
        if (!scanning) {
            const timer = setTimeout(() => setScanning(true), 2000);
            return () => clearTimeout(timer);
        }
    }, [scanning]);


    return (
        <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
            {error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4 text-center">
                    <CameraOff className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">{error}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 bg-white/10 border-white/20 hover:bg-white/20 text-white"
                        onClick={startCamera}
                    >
                        {t('common.retry')}
                    </Button>
                </div>
            ) : (
                <>
                    <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        muted
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Scan Overlay */}
                    <div className="absolute inset-0 border-[40px] border-black/50 flex items-center justify-center">
                        <div className="w-64 h-64 border-2 border-primary/80 rounded-lg relative animate-pulse">
                            <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-primary -mt-1 -ml-1"></div>
                            <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-primary -mt-1 -mr-1"></div>
                            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-primary -mb-1 -ml-1"></div>
                            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-primary -mb-1 -mr-1"></div>
                        </div>
                    </div>

                    {!stream && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        </div>
                    )}
                </>
            )}

            <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 text-white hover:bg-white/20 rounded-full"
                onClick={onClose}
            >
                <X className="w-5 h-5" />
            </Button>
        </div>
    );
}
