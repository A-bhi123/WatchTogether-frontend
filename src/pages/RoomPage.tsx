import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../contexts/RoomContext';
import { roomApi } from '../services/api';
import VideoPlayer from '../components/room/VideoPlayer';
import VideoGrid from '../components/video/VideoGrid';
import ChatPanel from '../components/chat/ChatPanel';
import ParticipantList from '../components/room/ParticipantList';
import RoomControls from '../components/room/RoomControls';
import RoomHeader from '../components/room/RoomHeader';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { parseRoomCode } from '../utils/roomCode';
import { waitForSocket } from '../services/socket';

type Panel = 'chat' | 'participants' | null;

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { room, joinRoom, leaveRoom, initLocalStream, requestSync } = useRoom();
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<Panel>('chat');
  const [isChatVisible, setIsChatVisible] = useState(true);
  const joinedCodeRef = useRef<string | null>(null);

  const roomCode = parseRoomCode(code || '');

  useEffect(() => {
    setLoading(true);
  }, [roomCode]);

  // Step 1: validate room + media, then socket join
  useEffect(() => {
    if (!roomCode) {
      toast.error('Invalid room code');
      navigate('/');
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        await roomApi.getByCode(roomCode);
        await initLocalStream();
        await waitForSocket();
        if (cancelled) return;
        joinedCodeRef.current = roomCode;
        joinRoom(roomCode);
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof Error && err.message === 'socket_timeout') {
          toast.error('Server se connect nahi ho paya — backend start karein');
        } else {
          toast.error('Room not found');
        }
        navigate('/');
      }
    };

    init();

    return () => {
      cancelled = true;
      if (joinedCodeRef.current) {
        leaveRoom();
        joinedCodeRef.current = null;
      }
    };
  }, [roomCode]);

  // Step 2: wait for socket room:joined before showing UI
  useEffect(() => {
    if (room && roomCode && room.code?.toUpperCase() === roomCode) {
      setLoading(false);
    }
  }, [room, roomCode]);

  // Join timeout fallback
  useEffect(() => {
    if (!loading || !roomCode) return;
    const t = setTimeout(() => {
      if (!room) {
        toast.error('Room join timeout — dubara try karein');
        navigate('/');
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [loading, room, roomCode, navigate]);

  useEffect(() => {
    if (!loading && room) {
      const t = setTimeout(() => requestSync(), 500);
      return () => clearTimeout(t);
    }
  }, [loading, room, requestSync]);

  const handleToggleChatVisible = () => {
    const newVisible = !isChatVisible;
    setIsChatVisible(newVisible);
    if (newVisible && activePanel !== 'chat') setActivePanel('chat');
    if (!newVisible && activePanel === 'chat') setActivePanel(null);
  };

  const handleLeave = () => {
    joinedCodeRef.current = null;
    leaveRoom();
    navigate('/');
  };

  if (loading) return <LoadingSpinner fullScreen message="Joining room..." />;

  return (
    <div className="h-screen bg-netflix-dark flex flex-col overflow-hidden">
      <RoomHeader
        onLeave={handleLeave}
        panel={activePanel}
        setPanel={(p) => {
          setActivePanel(p);
          if (p === 'chat') setIsChatVisible(true);
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 flex flex-col overflow-hidden bg-black">
            <VideoPlayer />
          </div>

          <div className="h-20 flex-shrink-0 border-t border-white/5">
            <VideoGrid />
          </div>

          <RoomControls
            isChatVisible={isChatVisible}
            onToggleChatVisible={handleToggleChatVisible}
          />
        </div>

        <AnimatePresence>
          {activePanel && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 border-l border-white/5 overflow-hidden"
              style={{ width: 300 }}
            >
              {activePanel === 'chat' ? <ChatPanel /> : <ParticipantList />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
