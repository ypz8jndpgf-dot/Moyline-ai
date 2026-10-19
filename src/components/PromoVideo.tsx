"use client";

import { useRef, useState } from "react";

export default function PromoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [unmuted, setUnmuted] = useState(false);

  const handleUnmute = () => {
    const v = videoRef.current;
    if (!v) return;
    // iOS Safari needs defaultMuted cleared too, not just muted
    v.defaultMuted = false;
    v.muted = false;
    v.controls = true;
    v.play().catch(() => {});
    setUnmuted(true);
  };

  return (
    <div className="mb-10">
      <div className="card overflow-hidden relative">
        <video
          ref={videoRef}
          className="w-full aspect-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        >
          <source src="/video/moyline-ad.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        {!unmuted && (
          <button
            onClick={handleUnmute}
            className="absolute bottom-4 right-4 px-4 py-2 rounded-full bg-gold text-black font-bold text-sm shadow-lg hover:bg-goldsoft transition"
          >
            🔊 Tap for sound
          </button>
        )}
      </div>
    </div>
  );
}
