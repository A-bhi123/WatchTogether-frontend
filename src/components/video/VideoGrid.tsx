import { useRef, useEffect, useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { isSameId } from '../../utils/ids';
import { useAuth } from '../../contexts/AuthContext';
import { MicOff, VideoOff, Crown, Maximize2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TileProps {
  stream: MediaStream | null;
  name: string;
  avatar?: string | null;
  avatarColor: string;
  isMuted?: boolean;
  isCameraOff?: boolean;
  isHost?: boolean;
  isLocal?: boolean;
  onMaximize: () => void;
}

function VideoTile({ stream, name, avatar, avatarColor, isMuted, isCameraOff, isHost: tileHost, isLocal, onMaximize }: TileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-gray-900 border border-white/10 flex-shrink-0 group cursor-pointer"
      style={{ width: 110, height: 74 }}
      onClick={onMaximize}
    >
      {stream && !isCameraOff ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal}
          className="w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs overflow-hidden"
            style={{ backgroundColor: avatarColor }}>
            {avatar
              ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
              : initials}
          </div>
        </div>
      )}

      {/* Hover — maximize icon */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Maximize2 className="w-5 h-5 text-white drop-shadow" />
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 flex items-center justify-between">
        <div className="flex items-center gap-0.5 min-w-0">
          {tileHost && <Crown className="w-2.5 h-2.5 text-yellow-400 flex-shrink-0" />}
          <span className="text-white text-[9px] truncate">{isLocal ? 'You' : name}</span>
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          {isMuted && <MicOff className="w-2.5 h-2.5 text-red-400" />}
          {isCameraOff && <VideoOff className="w-2.5 h-2.5 text-red-400" />}
        </div>
      </div>
    </div>
  );
}

// ── Maximized overlay ─────────────────────────────────────────────
interface MaximizedProps {
  stream: MediaStream | null;
  name: string;
  avatar?: string | null;
  avatarColor: string;
  isMuted?: boolean;
  isCameraOff?: boolean;
  isHost?: boolean;
  isLocal?: boolean;
  onClose: () => void;
}

function MaximizedTile({ stream, name, avatar, avatarColor, isMuted, isCameraOff, isHost: tileHost, isLocal, onClose }: MaximizedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-2xl border border-white/10"
        style={{ width: '70vw', maxWidth: 900, aspectRatio: '16/9' }}
        onClick={e => e.stopPropagation()}
      >
        {stream && !isCameraOff ? (
          <video ref={videoRef} autoPlay playsInline muted={isLocal}
            className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-white font-bold text-3xl overflow-hidden"
              style={{ backgroundColor: avatarColor }}>
              {avatar
                ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
                : initials}
            </div>
          </div>
        )}

        {/* Name bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-5 py-4 flex items-center gap-3">
          {tileHost && <Crown className="w-4 h-4 text-yellow-400" />}
          <span className="text-white font-semibold text-lg">{isLocal ? 'You' : name}</span>
          {isMuted && (
            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
              <MicOff className="w-3 h-3" /> Muted
            </span>
          )}
          {isCameraOff && (
            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
              <VideoOff className="w-3 h-3" /> Camera off
            </span>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>

      {/* Hint */}
      <p className="absolute bottom-6 text-white/40 text-xs">Click outside or press Esc to close</p>
    </motion.div>
  );
}

// ── Main Grid ────────────────────────────────────────────────────
export default function VideoGrid() {
  const { localStream, peerStreams, participants, room, isHost, isMuted, isCameraOff } = useRoom();
  const { user } = useAuth();

  const [maximized, setMaximized] = useState<{
    stream: MediaStream | null;
    name: string;
    avatar?: string | null;
    avatarColor: string;
    isMuted?: boolean;
    isCameraOff?: boolean;
    isHost?: boolean;
    isLocal?: boolean;
  } | null>(null);

  // Build tiles list — local first, then peers in join order
  const tiles: TileProps[] = [];

  if (user) {
    tiles.push({
      stream: localStream,
      name: user.name,
      avatar: user.avatar,
      avatarColor: user.avatarColor,
      isMuted,
      isCameraOff,
      isHost,
      isLocal: true,
      onMaximize: () => setMaximized({
        stream: localStream,
        name: user.name,
        avatar: user.avatar,
        avatarColor: user.avatarColor,
        isMuted,
        isCameraOff,
        isHost,
        isLocal: true,
      }),
    });
  }

  participants.forEach(p => {
    if (p.userId === user?._id) return;
    const pStream = peerStreams.get(p.socketId) || null;
    const pIsHost = isSameId(p.userId, room?.host);
    tiles.push({
      stream: pStream,
      name: p.name,
      avatar: p.avatar,
      avatarColor: p.avatarColor,
      isMuted: p.isMuted,
      isCameraOff: p.isCameraOff,
      isHost: pIsHost,
      isLocal: false,
      onMaximize: () => setMaximized({
        stream: pStream,
        name: p.name,
        avatar: p.avatar,
        avatarColor: p.avatarColor,
        isMuted: p.isMuted,
        isCameraOff: p.isCameraOff,
        isHost: pIsHost,
        isLocal: false,
      }),
    });
  });

  return (
    <>
      {/* Horizontal strip */}
      <div className="h-full bg-black/40 overflow-x-auto overflow-y-hidden">
        <div className="flex items-center gap-1.5 px-2 h-full" style={{ width: 'max-content' }}>
          {tiles.map((tile, i) => (
            <VideoTile key={i} {...tile} />
          ))}
        </div>
      </div>

      {/* Maximized overlay */}
      <AnimatePresence>
        {maximized && (
          <MaximizedTile
            {...maximized}
            onClose={() => setMaximized(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
