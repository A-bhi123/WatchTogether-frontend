import { Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, MessageSquare, MessageSquareOff, PhoneOff } from 'lucide-react';
import { useRoom } from '../../contexts/RoomContext';
import { useNavigate } from 'react-router-dom';

interface Props {
  isChatVisible: boolean;
  onToggleChatVisible: () => void;
}

export default function RoomControls({ isChatVisible, onToggleChatVisible }: Props) {
  const {
    isMuted, isCameraOff, isScreenSharing, isHost, isChatEnabled,
    toggleMute, toggleCamera, startScreenShare, stopScreenShare,
    toggleChatEnabled, leaveRoom,
  } = useRoom();
  const navigate = useNavigate();

  const handleLeave = () => {
    leaveRoom(); // stops all tracks, closes all peers
    navigate('/');
  };

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3 flex-wrap bg-surface border-t border-white/5">

      {/* Mic */}
      <Btn
        onClick={toggleMute}
        active={!isMuted}
        activeClass="bg-white/10 border-white/10 text-white hover:bg-white/20"
        inactiveClass="bg-red-900/40 border-red-500/40 text-red-400 hover:bg-red-900/60"
        icon={isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        label={isMuted ? 'Unmute' : 'Mute'}
      />

      {/* Camera */}
      <Btn
        onClick={toggleCamera}
        active={!isCameraOff}
        activeClass="bg-white/10 border-white/10 text-white hover:bg-white/20"
        inactiveClass="bg-red-900/40 border-red-500/40 text-red-400 hover:bg-red-900/60"
        icon={isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        label={isCameraOff ? 'Show cam' : 'Hide cam'}
      />

      {/* Screen share */}
      <Btn
        onClick={isScreenSharing ? stopScreenShare : startScreenShare}
        active={!isScreenSharing}
        activeClass="bg-white/10 border-white/10 text-white hover:bg-white/20"
        inactiveClass="bg-blue-900/40 border-blue-500/40 text-blue-400 hover:bg-blue-900/60"
        icon={isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        label={isScreenSharing ? 'Stop share' : 'Screen share'}
      />

      {/* My chat visibility toggle (per user) */}
      <Btn
        onClick={onToggleChatVisible}
        active={isChatVisible}
        activeClass="bg-white/10 border-white/10 text-white hover:bg-white/20"
        inactiveClass="bg-yellow-900/40 border-yellow-500/40 text-yellow-400 hover:bg-yellow-900/60"
        icon={isChatVisible ? <MessageSquare className="w-4 h-4" /> : <MessageSquareOff className="w-4 h-4" />}
        label={isChatVisible ? 'Hide chat' : 'Show chat'}
      />

      {/* Host: enable/disable chat for everyone */}
      {isHost && (
        <Btn
          onClick={() => toggleChatEnabled(!isChatEnabled)}
          active={isChatEnabled}
          activeClass="bg-green-900/40 border-green-500/40 text-green-400 hover:bg-green-900/60"
          inactiveClass="bg-orange-900/40 border-orange-500/40 text-orange-400 hover:bg-orange-900/60"
          icon={<MessageSquare className="w-4 h-4" />}
          label={isChatEnabled ? 'Disable chat' : 'Enable chat'}
        />
      )}

      {/* Leave — red, separated */}
      <button
        onClick={handleLeave}
        className="flex flex-col items-center gap-1 px-5 py-2 rounded-xl border bg-red-600 hover:bg-red-700 text-white border-red-500 transition-all active:scale-95 ml-3"
      >
        <PhoneOff className="w-4 h-4" />
        <span className="text-[10px] font-semibold hidden sm:block">Leave</span>
      </button>
    </div>
  );
}

function Btn({ onClick, active, activeClass, inactiveClass, icon, label }: {
  onClick: () => void; active: boolean;
  activeClass: string; inactiveClass: string;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all duration-200 active:scale-95 ${active ? activeClass : inactiveClass}`}
    >
      {icon}
      <span className="text-[10px] font-medium hidden sm:block whitespace-nowrap">{label}</span>
    </button>
  );
}
