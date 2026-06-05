import React, {
  createContext, useContext, useState, useEffect, useLayoutEffect,
  useRef, ReactNode, useCallback,
} from 'react';
import { useAuth } from './AuthContext';
import { getSocket } from '../services/socket';
import { Room, Participant, ChatMessage, VideoState } from '../types';
import toast from 'react-hot-toast';
import { isSameId } from '../utils/ids';
import { normalizeRoomCode } from '../utils/roomCode';
import { saveHostMovie, getHostMovie, clearHostMovie } from '../utils/hostMovieCache';

interface RoomContextType {
  room: Room | null;
  participants: Participant[];
  messages: ChatMessage[];
  videoState: VideoState;
  isChatEnabled: boolean;
  isHost: boolean;
  localStream: MediaStream | null;
  peerStreams: Map<string, MediaStream>;
  screenStream: MediaStream | null;
  movieStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  localMovieUrl: string | null;
  movieName: string | null;
  hasMovie: boolean;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  sendMessage: (text: string) => void;
  toggleChatEnabled: (enabled: boolean) => void;
  emitPlay: (currentTime: number) => void;
  emitPause: (currentTime: number) => void;
  emitSeek: (currentTime: number) => void;
  emitRate: (playbackRate: number) => void;
  requestSync: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  selectMovie: (file: File) => void;
  initLocalStream: () => Promise<void>;
}

const RoomContext = createContext<RoomContextType | null>(null);

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

// ── Stream labeling convention ──────────────────────────────────
// We use a custom stream ID prefix to identify movie streams
// Host creates movie stream with id starting with "movie:"
// This way guests can reliably detect which stream is the movie
const MOVIE_STREAM_LABEL = 'movie-stream-watchtogether';

export const RoomProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [videoState, setVideoState] = useState<VideoState>({
    isPlaying: false, currentTime: 0, playbackRate: 1, hasMovie: false, movieName: null,
  });
  const [isChatEnabled, setIsChatEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [movieStream, setMovieStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localMovieUrl, setLocalMovieUrl] = useState<string | null>(null);
  const [movieName, setMovieName] = useState<string | null>(null);
  const [hasMovie, setHasMovie] = useState(false);

  // Refs
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const movieStreamLocalRef = useRef<MediaStream | null>(null);
  const movieBlobUrlRef = useRef<string | null>(null);
  const movieVideoElRef = useRef<HTMLVideoElement | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  const isHostRef = useRef(false);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  // Track which socketIds have already been assigned a movie stream (guest side)
  const movieStreamSourceRef = useRef<string | null>(null);

  const isHost = room ? isSameId(room.host, user?._id) : false;
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // ── STOP PEERS (camera + WebRTC) — keep host movie for rejoin ─
  const stopPeers = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
  }, []);

  const stopMovieCapture = useCallback(() => {
    movieStreamLocalRef.current?.getTracks().forEach(t => t.stop());
    movieStreamLocalRef.current = null;

    if (movieVideoElRef.current) {
      movieVideoElRef.current.pause();
      if (movieVideoElRef.current.parentNode) {
        movieVideoElRef.current.parentNode.removeChild(movieVideoElRef.current);
      }
      movieVideoElRef.current.src = '';
      movieVideoElRef.current = null;
    }

    if (movieBlobUrlRef.current) {
      URL.revokeObjectURL(movieBlobUrlRef.current);
      movieBlobUrlRef.current = null;
    }
    clearHostMovie();
  }, []);

  const stopEverything = useCallback(() => {
    stopPeers();
    stopMovieCapture();
  }, [stopPeers, stopMovieCapture]);

  // ── RENEGOTIATE with a specific peer (host calls after adding tracks) ─
  const renegotiateWithPeer = useCallback((socketId: string) => {
    const pc = peerConnections.current.get(socketId);
    if (!pc || pc.signalingState === 'closed') return;

    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        const localDesc = pc.localDescription;
        if (localDesc) {
          getSocket().emit('webrtc:offer', { targetSocketId: socketId, offer: localDesc });
        }
      })
      .catch(err => console.error('renegotiate error:', err));
  }, []);

  // ── ADD MOVIE STREAM TO ALL EXISTING PEERS (host only) ────────
  const addMovieStreamToPeers = useCallback((stream: MediaStream) => {
    peerConnections.current.forEach((pc, socketId) => {
      if (pc.signalingState === 'closed') return;

      let tracksAdded = false;
      stream.getTracks().forEach(track => {
        const alreadyAdded = pc.getSenders().find(s => s.track?.id === track.id);
        if (!alreadyAdded) {
          pc.addTrack(track, stream);
          tracksAdded = true;
        }
      });

      // Renegotiate so guest receives the new tracks
      if (tracksAdded) {
        renegotiateWithPeer(socketId);
      }
    });
  }, [renegotiateWithPeer]);

  // ── CREATE PEER CONNECTION ────────────────────────────────────
  const createPeerConnection = useCallback((socketId: string): RTCPeerConnection => {
    // Close existing if any
    const existing = peerConnections.current.get(socketId);
    if (existing) {
      existing.close();
      peerConnections.current.delete(socketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(socketId, pc);

    // Add webcam/mic tracks
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Add movie stream tracks if host already has a movie loaded
    if (isHostRef.current && movieStreamLocalRef.current) {
      const mStream = movieStreamLocalRef.current;
      mStream.getTracks().forEach(track => {
        pc.addTrack(track, mStream);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSocket().emit('webrtc:ice', { targetSocketId: socketId, candidate: e.candidate });
      }
    };

    // ── TRACK RECEPTION (guest side) ─────────────────────────
    // Strategy: host sends TWO streams:
    //   stream[0] = webcam  (has audio + video from getUserMedia)
    //   stream[1] = movie   (has audio + video from captureStream)
    //
    // We differentiate by counting streams per peer.
    // The FIRST distinct streamId = webcam, SECOND distinct streamId = movie.
    const receivedStreamIds = new Set<string>();
    let hasWebcamStream = false;

    pc.ontrack = (e) => {
      if (!e.streams || e.streams.length === 0) return;
      if (isHostRef.current) return;

      e.streams.forEach(stream => {
        if (receivedStreamIds.has(stream.id)) return;
        receivedStreamIds.add(stream.id);

        const videoTracks = stream.getVideoTracks();
        if (!hasWebcamStream && videoTracks.length > 0) {
          hasWebcamStream = true;
          setPeerStreams(prev => new Map(prev).set(socketId, stream));
          return;
        }

        if (videoTracks.length > 0) {
          console.log('🎬 Movie stream received from host:', stream.id);
          setMovieStream(stream);
          setHasMovie(true);
          movieStreamSourceRef.current = socketId;
          toast.success('🎬 Movie stream connected!');
        }
      });
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer ${socketId} state: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peerConnections.current.delete(socketId);
        setPeerStreams(prev => { const m = new Map(prev); m.delete(socketId); return m; });
        if (movieStreamSourceRef.current === socketId) {
          setMovieStream(null);
          setHasMovie(false);
          movieStreamSourceRef.current = null;
        }
      }
    };

    return pc;
  }, []);

  // ── INIT LOCAL STREAM ─────────────────────────────────────────
  const initLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setLocalStream(stream);
      localStreamRef.current = stream;
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(audioOnly);
        localStreamRef.current = audioOnly;
        toast('Camera unavailable, mic only', { icon: '🎤' });
      } catch {
        const empty = new MediaStream();
        setLocalStream(empty);
        localStreamRef.current = empty;
      }
    }
  }, []);

  // ── SOCKET EVENTS (useLayoutEffect = listeners before RoomPage join) ─
  useLayoutEffect(() => {
    const socket = getSocket();

    socket.on('room:joined', ({ room: r, participants: ps, videoState: vs, isChatEnabled: ce }) => {
      setRoom(r);
      setParticipants(ps);
      setVideoState(vs);
      setIsChatEnabled(ce ?? true);
      if (r.messages) setMessages(r.messages);
      if (vs?.hasMovie) setHasMovie(true);
      if (vs?.movieName) setMovieName(vs.movieName);

      const joinedAsHost = isSameId(r.host, userRef.current?._id);
      isHostRef.current = joinedAsHost;

      // Joiner initiates WebRTC to everyone already in the room
      ps.forEach((p: Participant) => {
        if (p.socketId !== socket.id) {
          const pc = createPeerConnection(p.socketId);
          pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
            .then(offer => {
              pc.setLocalDescription(offer);
              socket.emit('webrtc:offer', { targetSocketId: p.socketId, offer });
            }).catch(console.error);
        }
      });

      // Guest rejoin: ask host to resend movie WebRTC stream (retry if needed)
      if (!joinedAsHost && vs?.hasMovie) {
        const requestMovie = () => {
          if (!movieStreamSourceRef.current && roomCodeRef.current) {
            socket.emit('webrtc:request-movie', { roomCode: roomCodeRef.current });
          }
        };
        setTimeout(requestMovie, 800);
        setTimeout(requestMovie, 2500);
        setTimeout(requestMovie, 5000);
      }
    });

    socket.on('participant:joined', (p: Participant) => {
      setParticipants(prev => prev.find(x => x.socketId === p.socketId) ? prev : [...prev, p]);
      toast(`${p.name} joined`, { icon: '👋', duration: 2000 });

      if (isHostRef.current && p.socketId !== socket.id && movieStreamLocalRef.current) {
        setTimeout(() => {
          const stream = movieStreamLocalRef.current;
          if (!stream) return;
          let pc = peerConnections.current.get(p.socketId);
          if (!pc) pc = createPeerConnection(p.socketId);
          stream.getTracks().forEach(track => {
            const exists = pc!.getSenders().some(s => s.track?.id === track.id);
            if (!exists) pc!.addTrack(track, stream);
          });
          renegotiateWithPeer(p.socketId);
        }, 400);
      }
    });

    socket.on('webrtc:request-movie', ({ fromSocketId }: { fromSocketId: string }) => {
      if (!isHostRef.current || !movieStreamLocalRef.current) return;
      const stream = movieStreamLocalRef.current;
      let pc = peerConnections.current.get(fromSocketId);
      if (!pc) pc = createPeerConnection(fromSocketId);
      stream.getTracks().forEach(track => {
        const exists = pc!.getSenders().some(s => s.track?.id === track.id);
        if (!exists) pc!.addTrack(track, stream);
      });
      renegotiateWithPeer(fromSocketId);
    });

    socket.on('participant:left', ({ socketId, name }: { socketId: string; name: string }) => {
      setParticipants(prev => prev.filter(p => p.socketId !== socketId));
      setPeerStreams(prev => { const m = new Map(prev); m.delete(socketId); return m; });
      const pc = peerConnections.current.get(socketId);
      if (pc) { pc.close(); peerConnections.current.delete(socketId); }
      toast(`${name} left`, { icon: '👋', duration: 2000 });
    });

    socket.on('webrtc:offer', async ({ offer, fromSocketId }) => {
      const pc = createPeerConnection(fromSocketId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { targetSocketId: fromSocketId, answer });
    });

    socket.on('webrtc:answer', async ({ answer, fromSocketId }) => {
      const pc = peerConnections.current.get(fromSocketId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(console.error);
      }
    });

    socket.on('webrtc:ice', async ({ candidate, fromSocketId }) => {
      const pc = peerConnections.current.get(fromSocketId);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
      }
    });

    socket.on('video:play', ({ currentTime }: { currentTime: number }) => {
      setVideoState(prev => ({ ...prev, isPlaying: true, currentTime }));
    });
    socket.on('video:pause', ({ currentTime }: { currentTime: number }) => {
      setVideoState(prev => ({ ...prev, isPlaying: false, currentTime }));
    });
    socket.on('video:seek', ({ currentTime }: { currentTime: number }) => {
      setVideoState(prev => ({ ...prev, currentTime }));
    });
    socket.on('video:rate', ({ playbackRate }: { playbackRate: number }) => {
      setVideoState(prev => ({ ...prev, playbackRate }));
    });
    socket.on('video:time-update', ({ currentTime }: { currentTime: number }) => {
      setVideoState(prev => (prev.isPlaying ? { ...prev, currentTime } : prev));
    });
    socket.on('video:sync', ({ isPlaying, currentTime, playbackRate, hasMovie: hm, movieName: mn }: any) => {
      setVideoState(prev => ({
        ...prev, isPlaying, currentTime,
        playbackRate: playbackRate ?? prev.playbackRate ?? 1,
        hasMovie: hm, movieName: mn,
      }));
      if (hm) setHasMovie(true);
    });
    socket.on('video:movie-ready', ({ movieName: mn }: { movieName: string }) => {
      setVideoState(prev => ({ ...prev, hasMovie: true, movieName: mn }));
      if (!isHostRef.current) toast(`🎬 Host loaded: ${mn} — connecting stream...`);
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });
    socket.on('chat:toggled', ({ enabled, byName }: { enabled: boolean; byName: string }) => {
      setIsChatEnabled(enabled);
      toast(enabled ? `💬 Chat enabled by ${byName}` : `🔇 Chat disabled by ${byName}`);
    });
    socket.on('chat:disabled', () => toast.error('Chat is disabled by the host'));

    socket.on('participant:audio-toggled', ({ socketId, isMuted: m }: any) => {
      setParticipants(prev => prev.map(p => p.socketId === socketId ? { ...p, isMuted: m } : p));
    });
    socket.on('participant:video-toggled', ({ socketId, isCameraOff: c }: any) => {
      setParticipants(prev => prev.map(p => p.socketId === socketId ? { ...p, isCameraOff: c } : p));
    });
    socket.on('screen:share-started', ({ userName }: any) => {
      toast(`🖥️ ${userName} started screen sharing`);
    });
    socket.on('error', ({ message }: { message: string }) => toast.error(message));

    return () => {
      [
        'room:joined', 'participant:joined', 'participant:left',
        'webrtc:offer', 'webrtc:answer', 'webrtc:ice', 'webrtc:request-movie',
        'video:play', 'video:pause', 'video:seek', 'video:rate', 'video:time-update',
        'video:sync', 'video:movie-ready',
        'chat:message', 'chat:toggled', 'chat:disabled',
        'participant:audio-toggled', 'participant:video-toggled',
        'screen:share-started', 'error',
      ].forEach(ev => socket.off(ev));
    };
  }, [createPeerConnection, renegotiateWithPeer]);

  // ── ACTIONS ───────────────────────────────────────────────────
  const joinRoom = useCallback((code: string) => {
    const normalized = normalizeRoomCode(code);
    if (!normalized || normalized.length !== 6) return;

    const socket = getSocket();
    roomCodeRef.current = normalized;

    const emitJoin = () => socket.emit('room:join', { roomCode: normalized });

    const runJoin = () => {
      socket.emit('room:leave');
      setTimeout(emitJoin, 80);
    };

    if (socket.connected) {
      runJoin();
    } else {
      socket.once('connect', runJoin);
      if (!socket.active) socket.connect();
    }
  }, []);

  const leaveRoom = useCallback(() => {
    const code = roomCodeRef.current;
    const wasHost = isHostRef.current;

    if (code) getSocket().emit('room:leave');

    if (wasHost && movieBlobUrlRef.current) {
      saveHostMovie(code!, movieBlobUrlRef.current, movieName || 'Movie');
      stopPeers();
    } else {
      stopEverything();
    }

    setRoom(null);
    setParticipants([]);
    setMessages([]);
    setPeerStreams(new Map());
    setLocalStream(null);
    setScreenStream(null);
    setMovieStream(null);
    setVideoState({ isPlaying: false, currentTime: 0, playbackRate: 1, hasMovie: false, movieName: null });
    setLocalMovieUrl(null);
    setMovieName(null);
    setHasMovie(false);
    setIsScreenSharing(false);
    setIsMuted(false);
    setIsCameraOff(false);
    roomCodeRef.current = null;
    movieStreamSourceRef.current = null;
  }, [stopEverything, stopPeers, movieName]);

  useEffect(() => () => stopPeers(), [stopPeers]);

  const sendMessage = useCallback((text: string) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('chat:message', { roomCode: roomCodeRef.current, text });
  }, []);

  const toggleChatEnabled = useCallback((enabled: boolean) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('chat:toggle', { roomCode: roomCodeRef.current, enabled });
  }, []);

  const emitPlay = useCallback((currentTime: number) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('video:play', { roomCode: roomCodeRef.current, currentTime });
  }, []);

  const emitPause = useCallback((currentTime: number) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('video:pause', { roomCode: roomCodeRef.current, currentTime });
  }, []);

  const emitSeek = useCallback((currentTime: number) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('video:seek', { roomCode: roomCodeRef.current, currentTime });
  }, []);

  const emitRate = useCallback((playbackRate: number) => {
    if (!roomCodeRef.current) return;
    getSocket().emit('video:rate', { roomCode: roomCodeRef.current, playbackRate });
  }, []);

  const requestSync = useCallback(() => {
    if (!roomCodeRef.current) return;
    getSocket().emit('video:sync-request', { roomCode: roomCodeRef.current });
  }, []);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    if (roomCodeRef.current) {
      getSocket().emit('media:toggle-audio', { roomCode: roomCodeRef.current, isMuted: newMuted });
    }
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const newOff = !isCameraOff;
    setIsCameraOff(newOff);
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !newOff; });
    if (roomCodeRef.current) {
      getSocket().emit('media:toggle-video', { roomCode: roomCodeRef.current, isCameraOff: newOff });
    }
  }, [isCameraOff]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      setScreenStream(stream);
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      const videoTrack = stream.getVideoTracks()[0];
      peerConnections.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });
      if (roomCodeRef.current) getSocket().emit('screen:share-start', { roomCode: roomCodeRef.current });
      videoTrack.onended = stopScreenShare;
    } catch {
      toast.error('Could not start screen sharing');
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsScreenSharing(false);
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      peerConnections.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });
    }
    if (roomCodeRef.current) getSocket().emit('screen:share-stop', { roomCode: roomCodeRef.current });
  }, []);

  // ── HOST MOVIE BROADCAST (select file or restore after rejoin) ─
  const startHostMovieBroadcast = useCallback((url: string, name: string) => {
    if (movieVideoElRef.current?.parentNode) {
      movieVideoElRef.current.pause();
      movieVideoElRef.current.parentNode.removeChild(movieVideoElRef.current);
    }

    movieBlobUrlRef.current = url;
    setLocalMovieUrl(url);
    setMovieName(name);
    setHasMovie(true);
    setVideoState(prev => ({
      ...prev, hasMovie: true, movieName: name,
      isPlaying: prev.isPlaying, currentTime: prev.currentTime,
    }));

    if (roomCodeRef.current) {
      saveHostMovie(roomCodeRef.current, url, name);
    }

    const hiddenVideo = document.createElement('video');
    hiddenVideo.src = url;
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideo.preload = 'auto';
    hiddenVideo.style.position = 'fixed';
    hiddenVideo.style.top = '-9999px';
    hiddenVideo.style.left = '-9999px';
    hiddenVideo.style.width = '1px';
    hiddenVideo.style.height = '1px';
    document.body.appendChild(hiddenVideo);
    movieVideoElRef.current = hiddenVideo;

    const tryCapture = () => {
      try {
        // @ts-ignore
        const capturedStream: MediaStream = hiddenVideo.captureStream
          ? hiddenVideo.captureStream(30)
          // @ts-ignore
          : hiddenVideo.mozCaptureStream?.(30) ?? null;

        if (!capturedStream) {
          toast.error('Your browser does not support movie streaming');
          return;
        }

        const waitForTracks = () => {
          if (capturedStream.getVideoTracks().length === 0) {
            setTimeout(waitForTracks, 200);
            return;
          }
          movieStreamLocalRef.current?.getTracks().forEach(t => t.stop());
          movieStreamLocalRef.current = capturedStream;
          addMovieStreamToPeers(capturedStream);
        };
        waitForTracks();
      } catch (err) {
        console.error('captureStream error:', err);
        toast.error('Could not capture movie stream');
      }
    };

    hiddenVideo.onloadedmetadata = () => {
      hiddenVideo.play().then(() => {
        hiddenVideo.pause();
        hiddenVideo.currentTime = videoState.currentTime || 0;
        tryCapture();
      }).catch(() => tryCapture());
    };
    hiddenVideo.load();
  }, [addMovieStreamToPeers, videoState.currentTime]);

  const selectMovie = useCallback((file: File) => {
    if (movieBlobUrlRef.current && movieBlobUrlRef.current !== getHostMovie(roomCodeRef.current || '')?.blobUrl) {
      URL.revokeObjectURL(movieBlobUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    if (roomCodeRef.current) {
      getSocket().emit('video:movie-selected', {
        roomCode: roomCodeRef.current,
        movieName: file.name,
      });
    }
    startHostMovieBroadcast(url, file.name);
    toast.success(`🎬 "${file.name}" — streaming to all participants`);
  }, [startHostMovieBroadcast]);

  // Restore host movie after leave + rejoin
  useEffect(() => {
    if (!room || !isHost || localMovieUrl) return;
    const cached = getHostMovie(room.code);
    if (!cached || !videoState.hasMovie) return;
    startHostMovieBroadcast(cached.blobUrl, cached.movieName);
    toast('Movie restored — streaming resumed', { icon: '🎬' });
  }, [room, isHost, localMovieUrl, videoState.hasMovie, startHostMovieBroadcast]);

  // ── Sync hidden video (WebRTC source) with shared videoState ───
  useEffect(() => {
    if (!isHostRef.current) return;
    const hiddenVid = movieVideoElRef.current;
    if (!hiddenVid) return;

    const rate = videoState.playbackRate ?? 1;
    if (hiddenVid.playbackRate !== rate) hiddenVid.playbackRate = rate;

    const diff = Math.abs(hiddenVid.currentTime - videoState.currentTime);
    if (diff > 0.35) hiddenVid.currentTime = videoState.currentTime;

    if (videoState.isPlaying && hiddenVid.paused) {
      hiddenVid.play().catch(() => {});
    } else if (!videoState.isPlaying && !hiddenVid.paused) {
      hiddenVid.pause();
    }
  }, [videoState.isPlaying, videoState.currentTime, videoState.playbackRate]);

  // Host broadcasts actual playback position while playing
  useEffect(() => {
    if (!isHostRef.current || !videoState.isPlaying || !roomCodeRef.current) return;
    const interval = setInterval(() => {
      const t = movieVideoElRef.current?.currentTime;
      if (t == null || !roomCodeRef.current) return;
      getSocket().emit('video:time-update', {
        roomCode: roomCodeRef.current,
        currentTime: t,
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [videoState.isPlaying]);

  return (
    <RoomContext.Provider value={{
      room, participants, messages, videoState, isChatEnabled, isHost,
      localStream, peerStreams, screenStream, movieStream,
      isMuted, isCameraOff, isScreenSharing,
      localMovieUrl, movieName, hasMovie,
      joinRoom, leaveRoom, sendMessage, toggleChatEnabled,
      emitPlay, emitPause, emitSeek, emitRate, requestSync,
      toggleMute, toggleCamera, startScreenShare, stopScreenShare,
      selectMovie, initLocalStream,
    }}>
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = () => {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
};
